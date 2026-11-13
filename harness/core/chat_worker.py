"""Asynchronous JSONL client for one local chat-generation subprocess (protocol local-chat-v1).

The chat counterpart of ``local_worker.LocalWorker``, kept separate so the
gameplay worker and its protocol stay untouched. A chat turn is not a timed
game decision, so the rules are simpler: requests are serialised behind a lock
(a second chat waits instead of failing with ``worker_busy``), the response
timeout is long, and a timeout or protocol error kills the process; the next
request starts a fresh one. Ids increase across restarts, so a stale reply can
never match a later request. No game imports.

The limits a caller needs are pure functions here so they are tested without
mlx: ``step_timeout`` scales a request's timeout with its ``max_tokens``,
``context_length`` reads a model's context from its ``config.json`` and
``prompt_cap`` is the prompt size a step may send (the configured cap, default
``DEFAULT_MAX_PROMPT_TOKENS``, leaving room for the generation in the model's
context).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
from pathlib import Path
from typing import Sequence

CHAT_PROTOCOL = "local-chat-v1"
MAX_LINE_BYTES = 4 * 1024 * 1024
DEFAULT_RESPONSE_TIMEOUT = 600.0   # seconds; also the floor of ``step_timeout``
TIMEOUT_BASE_SECONDS = 120.0       # prompt processing of a long prompt before the first token
TIMEOUT_SECONDS_PER_TOKEN = 0.15   # about 6.7 tokens/s: slower than a 27B 8-bit model's ~10-12 on a Mac
DEFAULT_MAX_PROMPT_TOKENS = 32768
MAX_PROMPT_TOKENS_LIMIT = 131072


def step_timeout(max_tokens: int) -> float:
    """Seconds one generation step may take: ``max(600, 120 + 0.15 * max_tokens)``.

    Why: the fixed 600 s timeout killed an 8,192-token step of a 27B model
    (about 11-14 minutes at 10-12 tokens/s) on 2026-11-13. At the default
    2,048 tokens this is exactly the old 600 s; 4,096 gives 735 s, 8,192
    gives 1,349 s and 16,384 gives 2,578 s.
    """
    return float(max(DEFAULT_RESPONSE_TIMEOUT,
                     math.ceil(TIMEOUT_BASE_SECONDS + TIMEOUT_SECONDS_PER_TOKEN * max_tokens)))


def context_length(config: dict) -> int | None:
    """The model's context length from its ``config.json``: ``max_position_embeddings``, top level or in
    ``text_config`` (multimodal configs nest it there). None when absent or not a positive int."""
    for source in (config, config.get("text_config") if isinstance(config.get("text_config"), dict) else {}):
        value = source.get("max_position_embeddings")
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
    return None


def prompt_cap(configured: int, context: int | None, max_tokens: int) -> int:
    """The largest prompt a step may send: the configured cap, and room for ``max_tokens`` more in the
    model's context when it is known. At least 1 (a step that cannot fit is refused by the worker)."""
    if context is None:
        return configured
    return max(1, min(configured, context - max_tokens))


class ChatWorkerError(RuntimeError):
    """A safe machine-readable reason; never contains prompts or model output."""

    @property
    def code(self) -> str:
        return str(self.args[0]) if self.args else "worker_error"


class ChatWorker:
    def __init__(self, command: Sequence[str], *, cwd: Path,
                 startup_timeout: float = 300, response_timeout: float = DEFAULT_RESPONSE_TIMEOUT):
        if not command or any(not isinstance(part, str) or not part for part in command):
            raise ValueError("worker command must be a nonempty argument list")
        for timeout in (startup_timeout, response_timeout):
            if not math.isfinite(timeout) or timeout <= 0:
                raise ValueError("worker timeouts must be positive and finite")
        self.command = tuple(command)
        self.cwd = cwd
        self.startup_timeout = startup_timeout
        self.response_timeout = response_timeout
        self.process: asyncio.subprocess.Process | None = None
        self.ready_info: dict = {}
        self.starts = 0
        self._serial = 0
        self._lock: asyncio.Lock | None = None
        self._closed = False

    @property
    def available(self) -> bool:
        return not self._closed and self.process is not None and self.process.returncode is None

    def _get_lock(self) -> asyncio.Lock:
        # Created lazily so the lock binds to the loop that serves requests.
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def _read(self) -> dict:
        line = await self.process.stdout.readline()
        if not line or not line.endswith(b"\n"):
            raise ChatWorkerError("worker_eof")
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError, RecursionError):
            raise ChatWorkerError("worker_protocol") from None
        if not isinstance(value, dict) or value.get("protocol") != CHAT_PROTOCOL:
            raise ChatWorkerError("worker_protocol")
        return value

    async def _start(self):
        env = {**os.environ, "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
               "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false"}
        self.starts += 1
        try:
            async with asyncio.timeout(self.startup_timeout):
                self.process = await asyncio.create_subprocess_exec(
                    *self.command, cwd=self.cwd, env=env,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    # No library warning or traceback may spill private prompts to logs.
                    stderr=asyncio.subprocess.DEVNULL, limit=MAX_LINE_BYTES)
                ready = await self._read()
                if ready.get("event") != "ready" or ready.get("ok") is not True:
                    raise ChatWorkerError("worker_startup_failed")
                self.ready_info = ready
        except ChatWorkerError:
            await self._stop_process()
            raise
        except (OSError, TimeoutError):
            await self._stop_process()
            raise ChatWorkerError("worker_startup_failed") from None
        except BaseException:
            await self._stop_process()
            raise

    async def _stop_process(self):
        process, self.process = self.process, None
        if process is not None:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            # Drain stdout too: waiting alone can hang on a full pipe.
            await process.communicate()

    async def start(self):
        """Start the worker now (otherwise the first request starts it)."""
        if self._closed:
            raise ChatWorkerError("worker_closed")
        async with self._get_lock():
            if not self.available:
                await self._start()

    async def request(self, payload: dict, *, timeout: float | None = None) -> dict:
        """Send one generation request and return the worker's reply (``ok`` is always a bool).

        ``timeout`` replaces ``response_timeout`` for this request (``step_timeout`` scales it by
        ``max_tokens``).
        """
        timeout = self.response_timeout if timeout is None else timeout
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("worker timeouts must be positive and finite")
        if self._closed:
            raise ChatWorkerError("worker_closed")
        async with self._get_lock():
            if not self.available:
                await self._start()
            self._serial += 1
            message = {**payload, "protocol": CHAT_PROTOCOL, "id": self._serial}
            data = (json.dumps(message, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
                    + "\n").encode()
            if len(data) > MAX_LINE_BYTES:
                raise ChatWorkerError("worker_input_too_large")
            try:
                async with asyncio.timeout(timeout):
                    self.process.stdin.write(data)
                    await self.process.stdin.drain()
                    reply = await self._read()
                if reply.get("id") != message["id"] or type(reply.get("ok")) is not bool:
                    raise ChatWorkerError("worker_protocol")
                return reply
            except TimeoutError:
                await self._stop_process()
                raise ChatWorkerError("worker_timeout") from None
            except ChatWorkerError:
                await self._stop_process()
                raise
            except asyncio.CancelledError:
                await self._stop_process()
                raise
            except Exception:
                await self._stop_process()
                raise ChatWorkerError("worker_unavailable") from None

    async def close(self):
        self._closed = True
        await self._stop_process()
