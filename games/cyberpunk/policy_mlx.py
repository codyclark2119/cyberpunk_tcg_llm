"""Compose the local action-selection policy with a persistent local MLX worker."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import sys
from pathlib import Path
from typing import Any, Mapping

from games.cyberpunk.policy_prompt import (PROMPT_VERSION, build_choice_messages, check_prompt_version, parse_choice,
                                           prompt_fingerprint)
from harness.core.local_worker import LocalWorker, WorkerError

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = "models/qwen3-8b-4bit"
LOGGER = logging.getLogger("cyberpunk.policy_mlx")


def local_path(value: str) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else REPO_ROOT / path).resolve()


_REVISION_RE = re.compile(r"^[0-9a-f]{40}$")
DEFAULT_MAX_TOKENS = 16


def model_revision(model_dir: str | Path) -> str | None:
    """The upstream commit the local weights were downloaded at, or None if the files do not say.

    Read from local files only, never fetched: ``hf download --local-dir`` leaves
    ``.cache/huggingface/download/<file>.metadata`` whose first line is the
    commit (docs/local-mlx-bot.md pins 545dc425... and 4dcb3d10...); a Hugging
    Face cache snapshot directory is itself named after the commit.
    """
    path = Path(model_dir)
    metadata_dir = path / ".cache" / "huggingface" / "download"
    others = sorted(p.name for p in metadata_dir.glob("*.metadata")) if metadata_dir.is_dir() else []
    for name in ["config.json.metadata", *others]:
        try:
            first = (metadata_dir / name).read_text(encoding="utf-8").splitlines()[0].strip()
        except (OSError, IndexError, UnicodeError):
            continue
        if _REVISION_RE.match(first):
            return first
    if path.parent.name == "snapshots" and _REVISION_RE.match(path.name):
        return path.name
    return None


def adapter_revision(adapter_dir: str | Path) -> str:
    """A LoRA adapter's identity: the sha256 of its weights file (adapters are small and local)."""
    digest = hashlib.sha256()
    with open(Path(adapter_dir) / "adapters.safetensors", "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def display_path(path: Path) -> str:
    """Repo-relative when the path is inside the repository, else absolute."""
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def model_info(model: str = DEFAULT_MODEL, *, adapter: str | None = None,
               max_tokens: int = DEFAULT_MAX_TOKENS, prompt_version: str = PROMPT_VERSION) -> dict[str, Any]:
    """What a match header records about an mlx seat; reads local files only.

    ``prompt_version`` (one of ``policy_prompt.PROMPT_VERSIONS``) is the prompt
    the seat's ``MLXPolicy`` renders; it is recorded with its fingerprint.
    """
    check_prompt_version(prompt_version)
    model_path = local_path(model)
    adapter_path = local_path(adapter) if adapter is not None else None
    return {"modelPath": display_path(model_path), "modelRevision": model_revision(model_path),
            "adapterPath": display_path(adapter_path) if adapter_path is not None else None,
            "adapterRevision": adapter_revision(adapter_path) if adapter_path is not None else None,
            "promptVersion": prompt_version,
            "promptFingerprint": prompt_fingerprint([], prompt_version)["prompt_fingerprint"],
            # mlx_policy_worker.py samples greedily (make_sampler(temp=0)) with no seed.
            "decoding": {"temperature": 0.0, "topP": 1.0, "maxTokens": max_tokens, "seed": None}}


def watchdog_seconds(budget_ms: int) -> float:
    """The worker's hard response watchdog for a decision budget.

    It only has to stop a wedged worker, never a slow answer the runner already
    abandoned, so it stays well above the budget: at least 30 s, else 3x budget.
    """
    return max(30.0, 3 * budget_ms / 1000)


def make_worker(model: str = DEFAULT_MODEL, *, adapter: str | None = None,
                max_prompt_tokens: int = 4096, max_tokens: int = DEFAULT_MAX_TOKENS,
                response_timeout: float = 30.0) -> LocalWorker:
    model_path = local_path(model)
    if not (model_path / "config.json").is_file() or not any(model_path.glob("*.safetensors")):
        raise ValueError("Model must be a downloaded local directory with config.json and safetensors; "
                         "see docs/local-mlx-bot.md for the download command.")
    if not 1 <= max_prompt_tokens <= 32768 or not 1 <= max_tokens <= 128:
        raise ValueError("Token limits must be 1..32768 for prompts and 1..128 for outputs.")
    command = [sys.executable, "-u", str(REPO_ROOT / "scripts/mlx_policy_worker.py"),
               "--model", str(model_path), "--max-prompt-tokens", str(max_prompt_tokens),
               "--max-tokens", str(max_tokens)]
    if adapter is not None:
        adapter_path = local_path(adapter)
        if not (adapter_path / "adapter_config.json").is_file() or not (adapter_path / "adapters.safetensors").is_file():
            raise ValueError("Adapter must contain adapter_config.json and adapters.safetensors.")
        command += ["--adapter", str(adapter_path)]
    return LocalWorker(command, cwd=REPO_ROOT, response_timeout=response_timeout)


class MLXPolicy:
    """Ask the local worker for one offered action.

    Before each decision's clock starts (``prepare``), any answer still being
    generated for an earlier, timed-out decision is awaited and discarded, and a
    dead worker is restarted at most ``max_restarts`` times per match
    (``begin_match`` resets the allowance). Share one instance between seats that
    share a worker so the allowance is per match, not per seat.

    ``info`` (see ``model_info``) is what ``describe`` reports for the match
    header; its ``promptVersion`` (default the current ``PROMPT_VERSION``) is the
    prompt this policy renders. Each answered request leaves its raw output, token counts and parsed
    index for ``take_details``; a request cancelled by a timeout leaves nothing.
    """

    def __init__(self, worker: LocalWorker, *, max_restarts: int = 1,
                 info: Mapping[str, Any] | None = None):
        self.worker = worker
        self.max_restarts = max_restarts
        self.restarts_left = max_restarts
        self.info = dict(info) if info is not None else {"promptVersion": PROMPT_VERSION}
        self.prompt_version = check_prompt_version(self.info.get("promptVersion") or PROMPT_VERSION)
        self._details: tuple[str, dict[str, Any]] | None = None

    def describe(self) -> dict[str, Any]:
        return dict(self.info)

    def take_details(self, request_id: str) -> dict[str, Any] | None:
        """The model's raw answer for ``request_id`` (once), else None."""
        details, self._details = self._details, None
        return details[1] if details is not None and details[0] == request_id else None

    def begin_match(self):
        self.restarts_left = self.max_restarts

    async def prepare(self) -> str | None:
        await self.worker.drain_abandoned()
        if self.worker.available or self.worker.closed or self.restarts_left <= 0:
            return None
        self.restarts_left -= 1
        try:
            await self.worker.restart()
        except (WorkerError, OSError, TimeoutError) as exc:
            LOGGER.info(json.dumps({"event": "local_worker_restart", "ok": False,
                                    "reason": getattr(exc, "code", type(exc).__name__)}))
            return "worker_restart_failed"
        LOGGER.info(json.dumps({"event": "local_worker_restart", "ok": True}))
        return "worker_restarted"

    async def __call__(self, decision):
        # Capture this request's mapping before crossing the process boundary.
        offered = tuple(action["actionId"] for action in decision.legal_actions)
        self._details = None
        try:
            reply = await self.worker.request({"messages": build_choice_messages(decision, self.prompt_version),
                                               "promptVersion": self.prompt_version})
            text = reply.get("text")
            details = {"rawOutput": text if isinstance(text, str) else None,
                       "inputTokens": _count(reply.get("promptTokens")),
                       "outputTokens": _count(reply.get("generationTokens")),
                       "inferenceMs": _milliseconds(reply.get("inferenceMs")),
                       "parsedIndex": None}
            self._details = (decision.request_id, details)
            if reply.get("ok") is not True:
                code = reply.get("error")
                raise WorkerError(code if code in {"prompt_too_large", "generation_failed",
                                                  "incomplete_output"} else "worker_error")
            try:
                choice = parse_choice(reply.get("text"), len(offered))
            except (ValueError, TypeError, RecursionError):
                raise WorkerError("invalid_output") from None
            details["parsedIndex"] = choice
            return offered[choice]
        except WorkerError as exc:
            LOGGER.info(json.dumps({"event": "local_policy_fallback", "requestId": decision.request_id,
                                    "reason": str(exc)}))
            raise


def _count(value) -> int | None:
    return value if type(value) is int and value >= 0 else None


def _milliseconds(value) -> float | None:
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None
