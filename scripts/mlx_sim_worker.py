#!/usr/bin/env python3
"""Run local MLX generation over private stdin/stdout JSONL, never HTTP.

The parent owns deadlines and legal-action validation. Load and warm the model
once before announcing readiness. No prompt cache or state crosses requests.
Use serve_sim_bot.py or benchmark_sim_bot.py rather than launching this directly.
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

from harness.core.local_worker import MAX_LINE_BYTES, PROTOCOL


def run_generation(model, tokenizer, messages, *, stream_fn, sampler,
                   max_prompt_tokens, max_tokens):
    """Keep tokenization/limits testable without importing Apple-only libraries."""
    started = time.monotonic()
    tokens = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True,
                                           enable_thinking=False, return_dict=False)
    if len(tokens) > max_prompt_tokens:
        return {"ok": False, "error": "prompt_too_large", "promptTokens": len(tokens)}
    text, last = "", None
    for part in stream_fn(model, tokenizer, prompt=tokens, sampler=sampler, max_tokens=max_tokens):
        text += part.text
        last = part
    stats = {"promptTokens": len(tokens), "generationTokens": last.generation_tokens if last else 0,
             "inferenceMs": round((time.monotonic() - started) * 1000, 2)}
    if last is None or last.finish_reason != "stop":
        return {"ok": False, "error": "incomplete_output", **stats}
    return {"ok": True, "text": text, **stats}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--max-prompt-tokens", type=int, default=4096)
    parser.add_argument("--max-tokens", type=int, default=16)
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("MLX gameplay requires native arm64 Python on Apple Silicon macOS.")
    if not args.model.is_dir() or (args.adapter is not None and not args.adapter.is_dir()):
        parser.error("Download the model and any adapter locally before starting the worker.")
    if not 1 <= args.max_prompt_tokens <= 32768 or not 1 <= args.max_tokens <= 128:
        parser.error("Invalid token limits.")

    # Must precede MLX/Hugging Face imports, including when launched directly.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    output = sys.stdout

    def emit(record):
        output.write(json.dumps({"protocol": PROTOCOL, **record}, separators=(",", ":")) + "\n")
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
            # Exercise the actual template and GPU before the ready handshake.
            run_generation(model, tokenizer, [{"role": "user", "content": 'Return {"choice":0}.'}],
                           stream_fn=stream_generate, sampler=sampler,
                           max_prompt_tokens=32768, max_tokens=2)
        except Exception:
            emit({"event": "ready", "ok": False, "error": "model_load_failed"})
            return 1
        emit({"event": "ready", "ok": True, "mlxVersion": version("mlx"),
              "mlxLMVersion": version("mlx-lm")})
        while True:
            line = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
            if not line:
                return 0
            if len(line) > MAX_LINE_BYTES or not line.endswith(b"\n"):
                return 1
            request = None
            try:
                request = json.loads(line)
                if (not isinstance(request, dict) or request.get("protocol") != PROTOCOL
                        or type(request.get("id")) is not int or not isinstance(request.get("messages"), list)):
                    return 1
                result = run_generation(model, tokenizer, request["messages"],
                                        stream_fn=stream_generate, sampler=sampler,
                                        max_prompt_tokens=args.max_prompt_tokens, max_tokens=args.max_tokens)
            except Exception:
                if not isinstance(request, dict):
                    return 1
                result = {"ok": False, "error": "generation_failed"}
            emit({"id": request["id"], **result})


if __name__ == "__main__":
    raise SystemExit(main())
