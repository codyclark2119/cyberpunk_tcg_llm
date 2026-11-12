#!/usr/bin/env python3
"""Run local MLX chat generation with tool specs over private stdin/stdout JSONL, never HTTP.

Why: the local assistant's tool loop (games/cyberpunk/assistant/loop.py) needs
free-text answers and Qwen3's native tool calls, which the gameplay worker's
single-choice protocol (128 tokens, no thinking) cannot give. This is a separate
worker with its own protocol, local-chat-v1, so the gameplay worker is untouched.

Each request carries ``messages`` (system/user/assistant/tool), ``tools``
(OpenAI-style function specs, rendered by the tokenizer's own chat template),
``max_tokens`` and ``enable_thinking``; the reply carries the raw generated text
(tool-call blocks and any <think> block included; the parent parses them), token
counts and elapsed time. Sampling is greedy, so the same prompt gives the same
text. The model loads once, offline; no prompt cache or state crosses requests.
Launched by games/cyberpunk/assistant/mlx_chat.py; do not run it by hand.

``max_tokens`` may be 1..``MAX_TOKENS_LIMIT`` (16384), the same ceiling as
``games/cyberpunk/assistant/loop.py``'s ``MAX_TOKENS_LIMIT``. It was 4096 until
2026-11-12, when larger models (Qwen3-Next-80B, Qwen3.8-27B) thought past 4096
tokens on quiz questions and an 8192 run was refused. 16384 leaves room to try
8192 and one doubling past it on the Mac's memory; it is a ceiling, not a
default, so the defaults (1024 here, 1024/2048 in the loop) are unchanged.

Rendering and request checks are pure functions so they are tested on Linux
without mlx (scripts/test_assistant_loop.py); only ``main`` imports mlx.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from contextlib import redirect_stdout
from importlib.metadata import version
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from harness.core.chat_worker import CHAT_PROTOCOL, MAX_LINE_BYTES

DEFAULT_MAX_TOKENS = 1024
MAX_TOKENS_LIMIT = 16384  # same as loop.MAX_TOKENS_LIMIT (see the docstring)
MAX_PROMPT_TOKENS = 16384
ROLES = frozenset({"system", "user", "assistant", "tool"})


def check_request(request, *, max_tokens_limit: int = MAX_TOKENS_LIMIT) -> tuple[dict | None, str | None]:
    """Normalise one request, or name why it is refused. Never raises."""
    if not isinstance(request, dict) or request.get("protocol") != CHAT_PROTOCOL or type(request.get("id")) is not int:
        return None, "bad_envelope"
    messages = request.get("messages")
    if not isinstance(messages, list) or not messages:
        return None, "bad_messages"
    for message in messages:
        if (not isinstance(message, dict) or message.get("role") not in ROLES
                or not isinstance(message.get("content"), str)):
            return None, "bad_messages"
        calls = message.get("tool_calls")
        if calls is not None:
            if message["role"] != "assistant" or not isinstance(calls, list):
                return None, "bad_messages"
            for call in calls:
                function = call.get("function") if isinstance(call, dict) else None
                if (not isinstance(function, dict) or not isinstance(function.get("name"), str)
                        or not isinstance(function.get("arguments"), dict)):
                    return None, "bad_messages"
    tools = request.get("tools", [])
    if not isinstance(tools, list) or not all(isinstance(t, dict) for t in tools):
        return None, "bad_tools"
    max_tokens = request.get("max_tokens", DEFAULT_MAX_TOKENS)
    if type(max_tokens) is not int or not 1 <= max_tokens <= max_tokens_limit:
        return None, "bad_max_tokens"
    thinking = request.get("enable_thinking", False)
    if type(thinking) is not bool:
        return None, "bad_enable_thinking"
    return {"id": request["id"], "messages": messages, "tools": tools, "max_tokens": max_tokens,
            "enable_thinking": thinking}, None


def render_prompt(tokenizer, messages: list, tools: list, *, enable_thinking: bool) -> list:
    """Token ids for the chat template; Qwen3's template renders ``tools`` into its system block."""
    return tokenizer.apply_chat_template(messages, tools=tools or None, tokenize=True,
                                         add_generation_prompt=True, enable_thinking=enable_thinking,
                                         return_dict=False)


def run_generation(model, tokenizer, request: dict, *, stream_fn, sampler,
                   max_prompt_tokens: int = MAX_PROMPT_TOKENS) -> dict:
    """Generate for one checked request; the fields below are the reply minus id and protocol."""
    started = time.monotonic()
    tokens = render_prompt(tokenizer, request["messages"], request["tools"],
                           enable_thinking=request["enable_thinking"])
    if len(tokens) > max_prompt_tokens:
        return {"ok": False, "error": "prompt_too_large", "promptTokens": len(tokens)}
    text, last = "", None
    for part in stream_fn(model, tokenizer, prompt=tokens, sampler=sampler, max_tokens=request["max_tokens"]):
        text += part.text
        last = part
    finish = last.finish_reason if last is not None else None
    return {"ok": True, "text": text, "finishReason": finish or "none", "promptTokens": len(tokens),
            "generationTokens": last.generation_tokens if last is not None else 0,
            "elapsedMs": round((time.monotonic() - started) * 1000, 2)}


def handle_line(line: bytes, generate) -> tuple[dict | None, bool]:
    """Turn one stdin line into a reply via ``generate(request)``; the bool says keep running."""
    if len(line) > MAX_LINE_BYTES or not line.endswith(b"\n"):
        return None, False
    try:
        raw = json.loads(line)
    except (ValueError, UnicodeError, RecursionError):
        return None, False
    request, problem = check_request(raw)
    if request is None:
        if isinstance(raw, dict) and type(raw.get("id")) is int and raw.get("protocol") == CHAT_PROTOCOL:
            return {"id": raw["id"], "ok": False, "error": problem}, True
        return None, False
    try:
        result = generate(request)
    except Exception:
        result = {"ok": False, "error": "generation_failed"}
    return {"id": request["id"], **result}, True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--max-prompt-tokens", type=int, default=MAX_PROMPT_TOKENS)
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("MLX chat requires native arm64 Python on Apple Silicon macOS.")
    if not args.model.is_dir() or (args.adapter is not None and not args.adapter.is_dir()):
        parser.error("Download the model and any adapter locally before starting the worker.")
    if not 1 <= args.max_prompt_tokens <= 32768:
        parser.error("Invalid prompt token limit.")

    # Must precede MLX/Hugging Face imports, including when launched directly.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    output = sys.stdout

    def emit(record):
        output.write(json.dumps({"protocol": CHAT_PROTOCOL, **record}, separators=(",", ":")) + "\n")
        output.flush()

    # Library prints must never corrupt the protocol or expose a model response.
    with open(os.devnull, "w") as sink, redirect_stdout(sink):
        try:
            from mlx_lm import load, stream_generate
            from mlx_lm.sample_utils import make_sampler

            model, tokenizer = load(str(args.model.resolve()),
                                    adapter_path=str(args.adapter.resolve()) if args.adapter else None,
                                    tokenizer_config={"trust_remote_code": False, "local_files_only": True})
            sampler = make_sampler(temp=0)

            def generate(request):
                return run_generation(model, tokenizer, request, stream_fn=stream_generate, sampler=sampler,
                                      max_prompt_tokens=args.max_prompt_tokens)

            # Exercise the template (with a tool spec) and the GPU before the ready handshake.
            generate({"messages": [{"role": "user", "content": "Say ok."}], "max_tokens": 2,
                      "enable_thinking": False,
                      "tools": [{"type": "function", "function": {
                          "name": "noop", "description": "Does nothing.",
                          "parameters": {"type": "object", "properties": {}, "required": []}}}]})
        except Exception:
            emit({"event": "ready", "ok": False, "error": "model_load_failed"})
            return 1
        emit({"event": "ready", "ok": True, "mlxVersion": version("mlx"), "mlxLMVersion": version("mlx-lm")})
        while True:
            line = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
            if not line:
                return 0
            reply, keep_going = handle_line(line, generate)
            if reply is not None:
                emit(reply)
            if not keep_going:
                return 1


if __name__ == "__main__":
    raise SystemExit(main())
