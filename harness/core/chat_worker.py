"""Asynchronous JSONL client for one local chat-generation subprocess (protocol local-chat-v1).

The chat counterpart of ``local_worker.LocalWorker``, kept separate so the
gameplay worker and its protocol stay untouched. A chat turn is not a timed
game decision, so the rules are simpler: requests are serialised behind a lock
(a second chat waits instead of failing with ``worker_busy``), the response
timeout is long, and a timeout or protocol error kills the process; the next
request starts a fresh one. Ids increase across restarts, so a stale reply can
never match a later request. No game imports.
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


class ChatWorkerError(RuntimeError):
    """A safe machine-readable reason; never contains prompts or model output."""

    @property
    def code(self) -> str:
        return str(self.args[0]) if self.args else "worker_error"


class ChatWorker:
    def __init__(self, command: Sequence[str], *, cwd: Path,
                 startup_timeout: float = 300, response_timeout: float = 600):
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

    async def request(self, payload: dict) -> dict:
        """Send one generation request and return the worker's reply (``ok`` is always a bool)."""
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
                async with asyncio.timeout(self.response_timeout):
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
