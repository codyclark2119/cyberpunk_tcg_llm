"""Connect the assistant's tool loop to a local MLX chat worker (``scripts/mlx_chat_worker.py``).

``make_chat_model`` checks the model (and adapter) directory up front and
returns a ``WorkerChatModel`` whose worker process starts lazily, on the first
``generate``. Nothing here downloads anything: the worker loads offline.
Each step's timeout scales with its ``max_tokens`` (``chat_worker.step_timeout``)
unless fixed, and the prompt cap (default 32,768 tokens) is held to the
model's own ``config.json`` context; ``prompt_token_limit`` tells the loop's
prompt guard the cap a step will be held to.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from harness.core.chat_worker import (DEFAULT_MAX_PROMPT_TOKENS, MAX_PROMPT_TOKENS_LIMIT, ChatWorker,
                                      ChatWorkerError, context_length, prompt_cap, step_timeout)

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODEL = "models/qwen3-8b-4bit"
WORKER_SCRIPT = REPO_ROOT / "scripts/mlx_chat_worker.py"


def local_path(value: str) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else REPO_ROOT / path).resolve()


def chat_worker_command(model: str = DEFAULT_MODEL, *, adapter: str | None = None,
                        max_prompt_tokens: int = DEFAULT_MAX_PROMPT_TOKENS) -> list[str]:
    """The worker's argv after checking the directories exist locally; raises ValueError otherwise."""
    model_path = local_path(model)
    if not (model_path / "config.json").is_file() or not any(model_path.glob("*.safetensors")):
        raise ValueError("Model must be a downloaded local directory with config.json and safetensors; "
                         "see docs/local-mlx-bot.md for the download command.")
    if not 1 <= max_prompt_tokens <= MAX_PROMPT_TOKENS_LIMIT:
        raise ValueError(f"The prompt token limit must be 1..{MAX_PROMPT_TOKENS_LIMIT}.")
    command = [sys.executable, "-u", str(WORKER_SCRIPT), "--model", str(model_path),
               "--max-prompt-tokens", str(max_prompt_tokens)]
    if adapter is not None:
        adapter_path = local_path(adapter)
        if not (adapter_path / "adapter_config.json").is_file() or not (adapter_path / "adapters.safetensors").is_file():
            raise ValueError("Adapter must contain adapter_config.json and adapters.safetensors.")
        command += ["--adapter", str(adapter_path)]
    return command


def model_context_length(model: str) -> int | None:
    """The context length the model directory's ``config.json`` states (``chat_worker.context_length``)."""
    try:
        config = json.loads((local_path(model) / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return context_length(config) if isinstance(config, dict) else None


class WorkerChatModel:
    """The loop's model interface over a ``ChatWorker``: one ``generate`` per model step.

    Each step's timeout is ``step_timeout(max_tokens)`` unless ``response_timeout`` fixes it, and
    ``prompt_token_limit(max_tokens)`` is the cap the worker will hold that step's prompt to, so the
    loop's prompt guard keeps under it.
    """

    def __init__(self, worker: ChatWorker, *, label: str = "local",
                 max_prompt_tokens: int = DEFAULT_MAX_PROMPT_TOKENS, context: int | None = None,
                 response_timeout: float | None = None):
        self.worker = worker
        self.label = label
        self.max_prompt_tokens = max_prompt_tokens
        self.context = context
        self.response_timeout = response_timeout

    def prompt_token_limit(self, max_tokens: int) -> int:
        return prompt_cap(self.max_prompt_tokens, self.context, max_tokens)

    def timeout_for(self, max_tokens: int) -> float:
        return self.response_timeout if self.response_timeout is not None else step_timeout(max_tokens)

    async def generate(self, messages: list[dict], tools: list[dict], *, max_tokens: int,
                       enable_thinking: bool) -> dict:
        try:
            return await self.worker.request({"messages": messages, "tools": tools, "max_tokens": max_tokens,
                                              "enable_thinking": enable_thinking},
                                             timeout=self.timeout_for(max_tokens))
        except ChatWorkerError as exc:
            return {"ok": False, "error": exc.code}

    async def close(self):
        await self.worker.close()


def make_chat_model(model: str = DEFAULT_MODEL, *, adapter: str | None = None,
                    response_timeout: float | None = None,
                    max_prompt_tokens: int = DEFAULT_MAX_PROMPT_TOKENS) -> WorkerChatModel:
    """``response_timeout`` None scales each step's timeout with its ``max_tokens`` (``step_timeout``)."""
    if response_timeout is not None and not (0 < response_timeout < float("inf")):
        raise ValueError("The worker timeout must be a positive number of seconds.")
    command = chat_worker_command(model, adapter=adapter, max_prompt_tokens=max_prompt_tokens)
    label = Path(command[command.index("--model") + 1]).name + (f" + {Path(adapter).name}" if adapter else "")
    worker = ChatWorker(command, cwd=REPO_ROOT)
    return WorkerChatModel(worker, label=label, max_prompt_tokens=max_prompt_tokens,
                           context=model_context_length(model), response_timeout=response_timeout)
