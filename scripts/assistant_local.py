#!/usr/bin/env python3
"""Serve the local assistant page: chat with a local model over the tools, or run them by hand.

Why: the local chat assistant gets every card, rule and deck fact from tools in
``games/cyberpunk/assistant/`` (find_card, get_card, search_cards, get_rule,
search_rules, card_interactions; parse_deck, check_deck, deck_profile,
similar_decks, archetype_of, played_with), and every tool in this project gets
a UI. This serves one self-contained page (no CDN, works offline) from
``games/cyberpunk/assistant_app.py`` that lists the tools, builds a form from
each tool's JSON schema and shows the exact JSON result a model would receive.

With ``--model`` (an MLX model directory, e.g. models/qwen3-8b-4bit, plus an
optional ``--adapter``) the page's chat box works: the first question starts
``scripts/mlx_chat_worker.py`` (Apple Silicon only, offline), and each answer
comes from ``games/cyberpunk/assistant/loop.py`` with a trace of every tool the
model ran. Without ``--model`` the chat box answers "no model configured".

The Eval tab shows the multiple-choice gold sets (with a review note per
question), runs ``scripts/eval_assistant.py`` with the same ``--model``,
``--adapter``, ``--thinking`` and ``--max-tokens``, and shows the scored runs
under ``eval/runs/``.

It binds 127.0.0.1 by default and needs no token there; it then answers only
to a loopback Host and Origin, which blocks DNS-rebinding pages. Any other bind
(``--host`` or ``--lan``) requires the random token printed with the URL,
following the harness monitor's rule, unless ``--no-auth`` is given for a
trusted network. Nothing here downloads, fetches or calls a remote API.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--lan", action="store_true", help="bind all interfaces; a token is then required")
    parser.add_argument("--no-auth", action="store_true", help="no token off loopback (trusted network only)")
    parser.add_argument("--model", help="local MLX model directory for chat, e.g. models/qwen3-8b-4bit")
    parser.add_argument("--adapter", help="optional local LoRA adapter directory for --model")
    parser.add_argument("--thinking", action="store_true", help="let Qwen3 think before answering (slower)")
    parser.add_argument("--max-tokens", type=int, default=1024, help="generation limit per model step")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be 1..65535")
    if args.adapter and not args.model:
        parser.error("--adapter needs --model")
    if not 1 <= args.max_tokens <= 4096:
        parser.error("--max-tokens must be 1..4096")
    try:
        import fastapi  # noqa: F401
        import uvicorn  # noqa: F401
        from games.cyberpunk.assistant_app import ChatService, serve_assistant
    except ImportError as exc:
        parser.error(f"{exc.name} is not installed; pip install fastapi uvicorn")
    model = None
    if args.model:
        from games.cyberpunk.assistant.mlx_chat import make_chat_model
        try:
            model = make_chat_model(args.model, adapter=args.adapter)
        except ValueError as exc:
            parser.error(str(exc))
        print(f"Chat model: {model.label} (the worker starts on the first question)", flush=True)
    chat = ChatService(model, enable_thinking=args.thinking, max_tokens=args.max_tokens,
                       model_path=args.model, adapter_path=args.adapter)
    serve_assistant(args.host, args.port, lan=args.lan, no_auth=args.no_auth, chat=chat)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
