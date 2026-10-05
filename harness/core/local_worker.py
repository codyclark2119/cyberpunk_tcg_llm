"""Bounded asynchronous JSONL client for one local inference subprocess.

One exchange may be active. Cancelling its caller leaves the exchange draining
in the background; the next caller fails fast until that response is consumed.
This avoids stale replies, queued GPU work, and reloading weights on every game
deadline. A separate hard watchdog stops a wedged worker. No game imports.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
from pathlib import Path
from typing import Sequence

PROTOCOL = "local-choice-v1"
MAX_LINE_BYTES = 2 * 1024 * 1024


class WorkerError(RuntimeError):
    """A safe machine-readable reason; never contains prompts/model output."""


class LocalWorker:
    def __init__(self, command: Sequence[str], *, cwd: Path,
                 startup_timeout: float = 300, response_timeout: float = 30):
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
        self._active: asyncio.Task | None = None
        self._serial = 0
        self._available = False
        self._closed = False
        self.ready_info: dict = {}
        self.last_reply: dict | None = None

    @property
    def busy(self):
        return self._active is not None and not self._active.done()

    @property
    def available(self):
        return (self._available and not self._closed and self.process is not None
                and self.process.returncode is None)

    async def _read(self):
        line = await self.process.stdout.readline()
        if not line or not line.endswith(b"\n"):
            raise WorkerError("worker_eof")
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError, RecursionError):
            raise WorkerError("worker_protocol") from None
        if not isinstance(value, dict) or value.get("protocol") != PROTOCOL:
            raise WorkerError("worker_protocol")
        return value

    async def start(self):
        if self.process is not None or self._closed:
            raise WorkerError("worker_already_started")
        env = {**os.environ, "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
               "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false"}
        try:
            async with asyncio.timeout(self.startup_timeout):
                self.process = await asyncio.create_subprocess_exec(
                    *self.command, cwd=self.cwd, env=env,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    # No library warning/traceback may spill private prompts to logs.
                    stderr=asyncio.subprocess.DEVNULL, limit=MAX_LINE_BYTES)
                ready = await self._read()
                if ready.get("event") != "ready" or ready.get("ok") is not True:
                    raise WorkerError("worker_startup_failed")
                self.ready_info = ready
                self._available = True
        except BaseException:
            await self._stop_process()
            raise

    async def _stop_process(self):
        self._available = False
        if self.process is not None:
            if self.process.returncode is None:
                try:
                    self.process.kill()
                except ProcessLookupError:
                    pass
            # Drain stdout after killing too: waiting alone can hang when a
            # malformed/oversized reply has filled the subprocess pipe.
            await self.process.communicate()

    async def _exchange(self, message_id, data):
        try:
            async with asyncio.timeout(self.response_timeout):
                self.process.stdin.write(data)
                await self.process.stdin.drain()
                reply = await self._read()
                if (type(reply.get("id")) is not int or reply["id"] != message_id
                        or type(reply.get("ok")) is not bool):
                    raise WorkerError("worker_protocol")
                self.last_reply = reply
                return reply
        except asyncio.CancelledError:
            await self._stop_process()
            raise
        except Exception:
            self.last_reply = {"ok": False, "error": "worker_unavailable"}
            await self._stop_process()
            raise WorkerError("worker_unavailable") from None

    async def request(self, payload: dict) -> dict:
        if not self.available:
            raise WorkerError("worker_unavailable")
        if self.busy:
            raise WorkerError("worker_busy")
        message = {**payload, "protocol": PROTOCOL, "id": self._serial + 1}
        data = (json.dumps(message, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode()
        if len(data) > MAX_LINE_BYTES:
            raise WorkerError("worker_input_too_large")
        self._serial += 1
        self.last_reply = None
        task = asyncio.create_task(self._exchange(message["id"], data))
        # Observe background failures even if the original caller has timed out.
        task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        self._active = task
        return await asyncio.shield(task)

    async def wait_idle(self):
        """Used by serial benchmarks and orderly shutdown, never the HTTP path."""
        if self._active is not None:
            try:
                await asyncio.shield(self._active)
            except WorkerError:
                pass

    async def close(self):
        self._closed = True
        if self.busy:
            self._active.cancel()
            try:
                await self._active
            except (asyncio.CancelledError, WorkerError):
                pass
        await self._stop_process()
