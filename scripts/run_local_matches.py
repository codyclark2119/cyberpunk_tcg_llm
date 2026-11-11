#!/usr/bin/env python3
"""Play N bot-vs-bot matches on the local engine and print a summary.

Why: with the external simulator bridge retired, the only way to watch the
policy layer play whole games is locally. The TypeScript engine worker owns
rules, legal actions and transitions; each seat's policy (the deterministic
``baseline`` or a local ``mlx`` model) only picks one engine-offered actionId.

Each match is written as a JSONL record under local/matches/ (gitignored): a
match header with seed, decks, engine identity and each seat's decision budget,
one row per decision with the offered count, chosen actionId, selection reason,
failure code (error) and elapsed ms, and a result row. The local play UI (scripts/play_local.py) reads those records and
can launch this script as its bot-vs-bot job.

Decks and format are whatever the engine's createGame accepts. By default the
fixed Demo content and decks are used; pass --setup with a JSON object holding
``content`` and ``initialization`` (an engine replay fixture also works) to play
anything else. Match i uses seed <--seed>-<i>; with two baseline seats the same
seed always replays the same game.

An mlx seat needs native arm64 Python on Apple Silicon and a downloaded model
(see docs/local-mlx-bot.md). Its per-decision budget is --budget-ms (default
10,000 ms; docs/local-time-budget.md): local play has no external deadline, so
the budget only bounds how long a seat may think before the baseline answers.
Nothing here downloads, fetches or serves.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import platform
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import (DEFAULT_MAX_DECISIONS, DEFAULT_MAX_TURNS, DEFAULT_OUTPUT_DIR,
                                         load_default_setup, load_setup_file, play_match, summarize,
                                         write_match_record)
from games.cyberpunk.sim_bot import DEFAULT_DECISION_BUDGET_MS, PolicyRunner, check_budget_ms
from games.cyberpunk.sim_mlx import DEFAULT_MODEL, MLXPolicy, make_worker, watchdog_seconds

POLICIES = ("baseline", "mlx")


async def run(args, setup):
    worker = policy = None
    if "mlx" in args.policy:
        worker = make_worker(args.model, adapter=args.adapter,
                             response_timeout=watchdog_seconds(args.budget_ms))
        print("Loading and warming the local model...", file=sys.stderr)
        await worker.start()
        # One policy for both seats: they share the worker and its restart allowance.
        policy = MLXPolicy(worker)
    try:
        runners = [PolicyRunner(policy, max_decision_ms=args.budget_ms) if name == "mlx"
                   else PolicyRunner(max_decision_ms=args.budget_ms) for name in args.policy]
        records = []
        with EngineWorker(REPO_ROOT, node=args.node) as engine:
            for index in range(args.matches):
                seed = f"{args.seed}-{index}"
                rows = await play_match(engine, setup.for_seed(seed), runners, policy_names=args.policy,
                                        max_decisions=args.max_decisions, max_turns=args.max_turns)
                path = write_match_record(args.output_dir / f"{seed}.jsonl", rows, force=args.force)
                result = rows[-1]
                print(f"{seed}: {result['status']} winnerSeat={result['winnerSeat']} "
                      f"reason={result['reason']} decisions={result['decisions']} -> {path}",
                      file=sys.stderr)
                records.append(rows)
    finally:
        if worker is not None:
            await worker.close()
    summary = summarize(records)
    print(json.dumps({"setupSource": setup.source, "engine": dict(setup.engine),
                      "policies": list(args.policy), "budgetMs": args.budget_ms, **summary}, indent=2))
    return 0 if summary["statuses"].get("engine_error", 0) == 0 else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--matches", type=int, default=1, help="number of matches (default 1)")
    parser.add_argument("--seed", default="local", help="seed prefix; match i uses <seed>-<i>")
    parser.add_argument("--policy", nargs=2, choices=POLICIES, default=["baseline", "baseline"],
                        metavar=("SEAT0", "SEAT1"), help="policy per engine seat: baseline or mlx")
    parser.add_argument("--setup", type=Path, help="JSON with content and initialization; default: fixed Demo decks")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--force", action="store_true", help="replace existing match records")
    parser.add_argument("--max-decisions", type=int, default=DEFAULT_MAX_DECISIONS)
    parser.add_argument("--max-turns", type=int, default=DEFAULT_MAX_TURNS)
    parser.add_argument("--budget-ms", type=int, default=DEFAULT_DECISION_BUDGET_MS,
                        help=f"per-decision budget for an mlx seat (default {DEFAULT_DECISION_BUDGET_MS})")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="local model for an mlx seat")
    parser.add_argument("--adapter", help="optional LoRA adapter for an mlx seat")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if args.matches < 1 or args.max_decisions < 1 or args.max_turns < 0:
        parser.error("--matches and --max-decisions must be positive, --max-turns nonnegative")
    try:
        check_budget_ms(args.budget_ms)
    except ValueError as exc:
        parser.error(f"--budget-ms: {exc}")
    if "mlx" in args.policy and (platform.system() != "Darwin" or platform.machine() != "arm64"):
        parser.error("An mlx seat requires native arm64 Python on Apple Silicon macOS")
    if not args.output_dir.is_absolute():
        args.output_dir = REPO_ROOT / args.output_dir
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    setup = load_setup_file(args.setup) if args.setup else load_default_setup(REPO_ROOT, node=args.node)
    try:
        return asyncio.run(run(args, setup))
    except FileExistsError as exc:
        print(f"{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
