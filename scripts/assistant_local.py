#!/usr/bin/env python3
"""Serve the local assistant page: run the card, rules and deck tools by hand.

Why: the local chat assistant gets every card, rule and deck fact from tools in
``games/cyberpunk/assistant/`` (find_card, get_card, search_cards, get_rule,
search_rules, card_interactions; parse_deck, check_deck, deck_profile,
similar_decks, archetype_of, played_with), and every tool in this project gets
a UI. This serves one self-contained page (no CDN, works offline) from
``games/cyberpunk/assistant_app.py`` that lists the tools, builds a form from
each tool's JSON schema and shows the exact JSON result a model would receive.
No model runs here yet.

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
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be 1..65535")
    try:
        import fastapi  # noqa: F401
        import uvicorn  # noqa: F401
        from games.cyberpunk.assistant_app import serve_assistant
    except ImportError as exc:
        parser.error(f"{exc.name} is not installed; pip install fastapi uvicorn")
    serve_assistant(args.host, args.port, lan=args.lan, no_auth=args.no_auth)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
