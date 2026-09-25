#!/usr/bin/env python3
"""Serve the simulator's v1alpha1 bot API with the deterministic baseline policy.

Install requirements-bot.txt; no MLX, model weights, Node or database is needed.
The simulator registers the public URL; this command does not register or deploy it.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.sim_bot import BotProfile, BotService, build_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3100)
    parser.add_argument("--base-path", default="", help="For example /cyberpunk")
    parser.add_argument("--bot-id", default=BotProfile.bot_id)
    parser.add_argument("--name", default=BotProfile.name)
    parser.add_argument("--version", default=BotProfile.version)
    parser.add_argument("--profile-url", help="Print the registration JSON for this public base URL and exit")
    args = parser.parse_args()
    profile = BotProfile(args.bot_id, args.name, args.version)
    if args.profile_url:
        from urllib.parse import urlsplit
        url = urlsplit(args.profile_url)
        if url.scheme not in ("http", "https") or not url.netloc or url.query or url.fragment:
            parser.error("--profile-url must be an HTTP(S) base URL without query or fragment")
        print(json.dumps({"botId": profile.bot_id, "name": profile.name,
                          "url": args.profile_url.rstrip("/"), "version": profile.version,
                          "description": "Deterministic legal-action baseline; no trained gameplay model.",
                          "timeoutMs": 3000, "apiVersions": ["v1alpha1"]}, indent=2))
        return
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    app = build_app(BotService(profile), base_path=args.base_path)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
