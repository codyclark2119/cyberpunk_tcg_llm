"""Compose the external simulator policy with a persistent local MLX worker."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

from games.cyberpunk.sim_prompt import PROMPT_VERSION, build_choice_messages, parse_choice
from harness.core.local_worker import LocalWorker, WorkerError

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = "models/qwen3-8b-4bit"
LOGGER = logging.getLogger("cyberpunk.sim_mlx")


def local_path(value: str) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else REPO_ROOT / path).resolve()


def make_worker(model: str = DEFAULT_MODEL, *, adapter: str | None = None,
                max_prompt_tokens: int = 4096, max_tokens: int = 16) -> LocalWorker:
    model_path = local_path(model)
    if not (model_path / "config.json").is_file() or not any(model_path.glob("*.safetensors")):
        raise ValueError("Model must be a downloaded local directory with config.json and safetensors; "
                         "see docs/local-mlx-bot.md for the download command.")
    if not 1 <= max_prompt_tokens <= 32768 or not 1 <= max_tokens <= 128:
        raise ValueError("Token limits must be 1..32768 for prompts and 1..128 for outputs.")
    command = [sys.executable, "-u", str(REPO_ROOT / "scripts/mlx_sim_worker.py"),
               "--model", str(model_path), "--max-prompt-tokens", str(max_prompt_tokens),
               "--max-tokens", str(max_tokens)]
    if adapter is not None:
        adapter_path = local_path(adapter)
        if not (adapter_path / "adapter_config.json").is_file() or not (adapter_path / "adapters.safetensors").is_file():
            raise ValueError("Adapter must contain adapter_config.json and adapters.safetensors.")
        command += ["--adapter", str(adapter_path)]
    return LocalWorker(command, cwd=REPO_ROOT)


class MLXPolicy:
    def __init__(self, worker: LocalWorker):
        self.worker = worker

    async def __call__(self, decision):
        # Capture this request's mapping before crossing the process boundary.
        offered = tuple(action["actionId"] for action in decision.legal_actions)
        try:
            reply = await self.worker.request({"messages": build_choice_messages(decision),
                                               "promptVersion": PROMPT_VERSION})
            if reply.get("ok") is not True:
                code = reply.get("error")
                raise WorkerError(code if code in {"prompt_too_large", "generation_failed",
                                                  "incomplete_output"} else "worker_error")
            try:
                choice = parse_choice(reply.get("text"), len(offered))
            except (ValueError, TypeError, RecursionError):
                raise WorkerError("invalid_output") from None
            return offered[choice]
        except WorkerError as exc:
            LOGGER.info(json.dumps({"event": "local_policy_fallback", "requestId": decision.request_id,
                                    "reason": str(exc)}))
            raise
