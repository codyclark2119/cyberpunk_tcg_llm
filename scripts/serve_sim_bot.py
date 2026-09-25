#!/usr/bin/env python3
"""Serve the simulator's v1alpha1 bot API with a baseline or local MLX policy.

Baseline: requirements-bot.txt. MLX: requirements-mlx-bot.txt and downloaded weights.
The simulator registers the reachable URL; this command does not register or deploy it.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.sim_bot import BotProfile, BotService, build_app
from games.cyberpunk.sim_mlx import DEFAULT_MODEL, MLXPolicy, make_worker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3100)
    parser.add_argument("--base-path", default="", help="For example /cyberpunk")
    parser.add_argument("--bot-id", default=BotProfile.bot_id)
    parser.add_argument("--name", help="Defaults to a name describing the selected policy")
    parser.add_argument("--version", help="Defaults to the selected policy version")
    parser.add_argument("--policy", choices=("baseline", "mlx"), default="baseline")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Local MLX model directory, relative to repo root")
    parser.add_argument("--adapter", help="Optional local MLX adapter directory")
    parser.add_argument("--max-prompt-tokens", type=int, default=4096)
    parser.add_argument("--max-tokens", type=int, default=16)
    parser.add_argument("--profile-url", help="Print the registration JSON for this public base URL and exit")
    args = parser.parse_args()
    if args.adapter and args.policy != "mlx":
        parser.error("--adapter requires --policy mlx")
    profile = BotProfile(args.bot_id,
                         args.name or ("Cyberpunk TCG AI (local MLX)" if args.policy == "mlx" else BotProfile.name),
                         args.version or ("0.2.0" if args.policy == "mlx" else BotProfile.version))
    if args.profile_url:
        from urllib.parse import urlsplit
        url = urlsplit(args.profile_url)
        if url.scheme not in ("http", "https") or not url.netloc or url.query or url.fragment:
            parser.error("--profile-url must be an HTTP(S) base URL without query or fragment")
        print(json.dumps({"botId": profile.bot_id, "name": profile.name,
                          "url": args.profile_url.rstrip("/"), "version": profile.version,
                          "description": ("Local MLX action selection with a deterministic fallback."
                                          if args.policy == "mlx" else
                                          "Deterministic legal-action baseline; no trained gameplay model."),
                          "timeoutMs": 3000, "apiVersions": ["v1alpha1"]}, indent=2))
        return
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    worker = None
    if args.policy == "mlx":
        import platform
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            parser.error("--policy mlx requires native arm64 Python on Apple Silicon macOS")
        try:
            worker = make_worker(args.model, adapter=args.adapter,
                                 max_prompt_tokens=args.max_prompt_tokens, max_tokens=args.max_tokens)
        except ValueError as exc:
            parser.error(str(exc))

    @asynccontextmanager
    async def lifespan(_app):
        try:
            if worker is not None:
                logging.info("Loading and warming the local MLX model; startup may take several minutes.")
                await worker.start()
                logging.info("Local MLX worker ready.")
            yield
        finally:
            if worker is not None:
                await worker.close()

    app = build_app(BotService(profile, policy=MLXPolicy(worker) if worker else None),
                    base_path=args.base_path, lifespan=lifespan)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
