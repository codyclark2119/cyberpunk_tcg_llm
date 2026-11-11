"""Connect the assistant's tool loop to a local MLX chat worker (``scripts/mlx_chat_worker.py``).

``make_chat_model`` checks the model (and adapter) directory up front and
returns a ``WorkerChatModel`` whose worker process starts lazily, on the first
``generate``. Nothing here downloads anything: the worker loads offline.
"""

from __future__ import annotations

import sys
from pathlib import Path

from harness.core.chat_worker import ChatWorker, ChatWorkerError

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODEL = "models/qwen3-8b-4bit"
WORKER_SCRIPT = REPO_ROOT / "scripts/mlx_chat_worker.py"


def local_path(value: str) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else REPO_ROOT / path).resolve()


def chat_worker_command(model: str = DEFAULT_MODEL, *, adapter: str | None = None,
                        max_prompt_tokens: int = 16384) -> list[str]:
    """The worker's argv after checking the directories exist locally; raises ValueError otherwise."""
    model_path = local_path(model)
    if not (model_path / "config.json").is_file() or not any(model_path.glob("*.safetensors")):
        raise ValueError("Model must be a downloaded local directory with config.json and safetensors; "
                         "see docs/local-mlx-bot.md for the download command.")
    if not 1 <= max_prompt_tokens <= 32768:
        raise ValueError("The prompt token limit must be 1..32768.")
    command = [sys.executable, "-u", str(WORKER_SCRIPT), "--model", str(model_path),
               "--max-prompt-tokens", str(max_prompt_tokens)]
    if adapter is not None:
        adapter_path = local_path(adapter)
        if not (adapter_path / "adapter_config.json").is_file() or not (adapter_path / "adapters.safetensors").is_file():
            raise ValueError("Adapter must contain adapter_config.json and adapters.safetensors.")
        command += ["--adapter", str(adapter_path)]
    return command


class WorkerChatModel:
    """The loop's model interface over a ``ChatWorker``: one ``generate`` per model step."""

    def __init__(self, worker: ChatWorker, *, label: str = "local"):
        self.worker = worker
        self.label = label

    async def generate(self, messages: list[dict], tools: list[dict], *, max_tokens: int,
                       enable_thinking: bool) -> dict:
        try:
            return await self.worker.request({"messages": messages, "tools": tools, "max_tokens": max_tokens,
                                              "enable_thinking": enable_thinking})
        except ChatWorkerError as exc:
            return {"ok": False, "error": exc.code}

    async def close(self):
        await self.worker.close()


def make_chat_model(model: str = DEFAULT_MODEL, *, adapter: str | None = None,
                    response_timeout: float = 600) -> WorkerChatModel:
    command = chat_worker_command(model, adapter=adapter)
    label = Path(command[command.index("--model") + 1]).name + (f" + {Path(adapter).name}" if adapter else "")
    return WorkerChatModel(ChatWorker(command, cwd=REPO_ROOT, response_timeout=response_timeout), label=label)
