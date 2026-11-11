#!/usr/bin/env python3
"""Serve the local play UI: play a bot, launch bot-vs-bot matches, browse match records.

Why: every tool in this project gets a UI, and local matches were CLI-only. This
serves one self-contained page (no CDN, works offline) from
``games/cyberpunk/play_app.py`` and prints its URL. The TypeScript engine
worker stays the only rules authority: the page shows the human seat's public
engine observation and the engine-offered actions, and the server submits only
an offered actionId. Match records go to local/matches/ (gitignored), the same
JSONL the bot-vs-bot runner writes.

It binds 127.0.0.1 by default and needs no token there. Any other bind
(``--host`` or ``--lan``) requires the random token printed with the URL,
following the harness monitor's rule, unless ``--no-auth`` is given for a
trusted network. Stop it with Ctrl-C; open engine workers are closed then.

An mlx bot needs native arm64 Python on Apple Silicon and a downloaded model
(docs/local-mlx-bot.md). Nothing here downloads, fetches or calls a remote API.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.local_match import DEFAULT_OUTPUT_DIR


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--lan", action="store_true", help="bind all interfaces; a token is then required")
    parser.add_argument("--no-auth", action="store_true", help="no token off loopback (trusted network only)")
    parser.add_argument("--records-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
                        help="where match records are read and written (default local/matches)")
    parser.add_argument("--model", help="local model directory for an mlx bot (default: sim_mlx.DEFAULT_MODEL)")
    parser.add_argument("--adapter", help="optional LoRA adapter for an mlx bot")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be 1..65535")
    try:
        from games.cyberpunk.play_app import serve_play
        import fastapi  # noqa: F401
        import uvicorn  # noqa: F401
    except ImportError as exc:
        parser.error(f"{exc.name} is not installed; pip install fastapi uvicorn")
    records_dir = args.records_dir if args.records_dir.is_absolute() else REPO_ROOT / args.records_dir
    serve_play(args.host, args.port, lan=args.lan, no_auth=args.no_auth, records_dir=records_dir,
               node=args.node, mlx_model=args.model, mlx_adapter=args.adapter)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
