#!/usr/bin/env python3
"""Play N bot-vs-bot matches on the local engine and print a summary.

Why: with the external simulator bridge retired, the only way to watch the
policy layer play whole games is locally. The TypeScript engine worker owns
rules, legal actions and transitions; each seat's policy (the deterministic
``baseline`` or a local ``mlx`` model) only picks one engine-offered actionId.

Each match is written as a JSONL record under local/matches/ (gitignored),
schemaVersion 3 (docs/local-match-records-v3.md): a match header with seed,
decks, engine identity and, per seat, the policy, decision budget, model path
and revision and prompt version; one row per decision with the offered count,
chosen actionId and its index, what the baseline would have picked and whether
they agree, selection reason, failure code (error), elapsed ms and, for a model
seat, its raw output and token counts; and a result row with per-seat baseline
agreement. The local play UI (scripts/play_local.py) reads those records and
can launch this script as its bot-vs-bot job.

With --training-dir DIR (off by default; local/training/ is the usual place,
gitignored), every model decision is also logged as an engine-built
TrainingPosition plus one TrainingAttempt in DIR/positions.jsonl and
DIR/attempts.jsonl (harness/core/training_records.py), provenance generator
"local_match" at the current git commit. Baseline seats log nothing. A match
that raises writes no training records. An mlx seat must have a model revision
in its local download metadata for this; a path alone is refused.

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
                                         TrainingRecorder, git_revision, load_default_setup,
                                         load_setup_file, play_match, summarize, write_match_record)
from games.cyberpunk.policy_bot import DEFAULT_DECISION_BUDGET_MS, PolicyRunner, check_budget_ms
from games.cyberpunk.policy_mlx import DEFAULT_MODEL, MLXPolicy, make_worker, model_info, watchdog_seconds
from harness.core.training_records import TrainingLog

POLICIES = ("baseline", "mlx")


async def run(args, setup, *, mlx_worker=None):
    """Play the matches. ``mlx_worker`` replaces the real MLX worker (tests only)."""
    worker = policy = None
    if "mlx" in args.policy:
        info = model_info(args.model, adapter=args.adapter)
        if args.training_dir is not None:
            TrainingRecorder.check_seat(info)  # fail before loading weights
        worker = mlx_worker or make_worker(args.model, adapter=args.adapter,
                                           response_timeout=watchdog_seconds(args.budget_ms))
        print("Loading and warming the local model...", file=sys.stderr)
        await worker.start()
        # One policy for both seats: they share the worker and its restart allowance.
        policy = MLXPolicy(worker, info=info)
    revision = git_revision(REPO_ROOT) if args.training_dir is not None else None
    try:
        runners = [PolicyRunner(policy, max_decision_ms=args.budget_ms) if name == "mlx"
                   else PolicyRunner(max_decision_ms=args.budget_ms) for name in args.policy]
        records = []
        with EngineWorker(REPO_ROOT, node=args.node) as engine:
            for index in range(args.matches):
                seed = f"{args.seed}-{index}"
                record_path = args.output_dir / f"{seed}.jsonl"
                if record_path.exists() and not args.force:
                    # Refuse before playing, so no training records are logged for it either.
                    raise FileExistsError(f"{record_path} already exists; choose another output or force (--force)")
                if args.training_dir is None:
                    rows = await play_match(engine, setup.for_seed(seed), runners, policy_names=args.policy,
                                            max_decisions=args.max_decisions, max_turns=args.max_turns)
                else:
                    # One log per match: a match that raises writes no training records.
                    with TrainingLog(args.training_dir / "positions.jsonl", args.training_dir / "attempts.jsonl",
                                     expect_engine=setup.engine) as log:
                        recorder = TrainingRecorder(log, revision=revision)
                        rows = await play_match(engine, setup.for_seed(seed), runners,
                                                policy_names=args.policy, max_decisions=args.max_decisions,
                                                max_turns=args.max_turns, training=recorder)
                    if recorder.attempts:
                        print(f"{seed}: {recorder.attempts} training attempts -> {args.training_dir}",
                              file=sys.stderr)
                path = write_match_record(record_path, rows, force=args.force)
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
    parser.add_argument("--training-dir", type=Path,
                        help="also log each model decision as TrainingPosition/TrainingAttempt records "
                             "here (e.g. local/training); off by default")
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
    if args.training_dir is not None and not args.training_dir.is_absolute():
        args.training_dir = REPO_ROOT / args.training_dir
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    setup = load_setup_file(args.setup) if args.setup else load_default_setup(REPO_ROOT, node=args.node)
    try:
        return asyncio.run(run(args, setup))
    except (FileExistsError, ValueError) as exc:
        print(f"{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
