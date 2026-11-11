"""Bounded asynchronous JSONL client for one local inference subprocess.

One exchange may be active. Cancelling its caller (a decision timeout) leaves
the exchange running in the background as an *abandoned* exchange: it still
reads its own reply, matched by request id, and that late reply is discarded.
The next request waits for an abandoned exchange to finish before it writes
anything, so a timeout costs one decision instead of failing every request
until the GPU is free (the 2026-11-11 Mac cascade; docs/local-time-budget.md).
Two *live* callers still never queue: the second fails fast with worker_busy.
Ids increase across restarts, so a stale reply can never match a later request.
A separate hard watchdog stops a wedged worker; ``restart`` relaunches it.
No game imports.
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

    @property
    def code(self) -> str:
        return str(self.args[0]) if self.args else "worker_error"


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
        self._abandoned: asyncio.Task | None = None
        self._caller: asyncio.Task | None = None
        self._serial = 0
        self.restarts = 0
        self.late_replies_discarded = 0
        self._available = False
        self._closed = False
        self.ready_info: dict = {}
        self.last_reply: dict | None = None

    @property
    def busy(self):
        return self._active is not None and not self._active.done()

    @property
    def closed(self):
        return self._closed

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

    def _count_late(self, task: asyncio.Task):
        if not task.cancelled() and task.exception() is None:
            self.late_replies_discarded += 1

    def _abandon(self, task: asyncio.Task):
        if self._abandoned is not task and not task.done():
            self._abandoned = task
            task.add_done_callback(self._count_late)

    def _active_is_abandoned(self) -> bool:
        """The in-flight exchange's caller is gone or being cancelled (a decision timeout).

        Checked on the caller task itself, so it holds as soon as the runner calls
        ``cancel()``, before the cancelled caller next runs.
        """
        if not self.busy:
            return False
        caller = self._caller
        if self._active is self._abandoned or caller is None or caller.done() or caller.cancelling():
            self._abandon(self._active)
            return True
        return False

    async def request(self, payload: dict) -> dict:
        if not self.available:
            raise WorkerError("worker_unavailable")
        if self._active_is_abandoned():
            # Its caller gave up; let it read (and drop) its own reply first.
            await self.drain_abandoned()
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
        self._active, self._caller = task, asyncio.current_task()
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            self._abandon(task)
            raise

    async def drain_abandoned(self):
        """Wait for an exchange whose caller gave up; its late reply is discarded.

        A live caller's exchange is left alone, so live callers never queue.
        """
        if self._active_is_abandoned():
            await asyncio.wait({self._active})

    async def wait_idle(self):
        """Wait for any in-flight exchange to finish; its reply is not returned."""
        if self._active is not None and not self._active.done():
            await asyncio.wait({self._active})

    async def restart(self):
        """Stop the process if it is still there and start a fresh one (weights reload)."""
        if self._closed:
            raise WorkerError("worker_closed")
        if self.busy:
            self._active.cancel()
            await asyncio.wait({self._active})
        await self._stop_process()
        self.process, self._active, self._abandoned, self._caller = None, None, None, None
        self.ready_info = {}
        self.restarts += 1
        await self.start()

    async def close(self):
        self._closed = True
        if self.busy:
            self._active.cancel()
            try:
                await self._active
            except (asyncio.CancelledError, WorkerError):
                pass
        await self._stop_process()
