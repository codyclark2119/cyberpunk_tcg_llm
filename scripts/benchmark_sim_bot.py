#!/usr/bin/env python3
"""Measure local model decisions through the policy runner's deadline/fallback path.

Why: latency and fallback rates only mean something on positions the engine
really produces. By default this plays --matches baseline-vs-baseline games on
the local engine (games/cyberpunk/local_match.py), keeps the decisions that
offered more than one action, takes --positions of them evenly spaced, and asks
the local model to choose in each. That is a timing and protocol measurement,
not a gameplay strength evaluation. Pass --requests with JSONL of decision
records (camelCase Decision fields, such as requestId, playerId, legalActions;
other keys are ignored) to measure saved positions instead.
The per-decision budget is --budget-ms (default 10,000 ms, the local-play
default; docs/local-time-budget.md); pass a smaller one to see how many
positions a tighter budget would lose. Reports contain timing, selection
source, failure code and token counts, never prompts/snapshots or generated text. No network connection or model download occurs here.
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import json
import logging
import math
import platform
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import load_default_setup, play_match
from games.cyberpunk.sim_bot import (DEFAULT_DECISION_BUDGET_MS, PolicyRunner, check_budget_ms,
                                     decision_from_record)
from games.cyberpunk.sim_mlx import DEFAULT_MODEL, MLXPolicy, local_path, make_worker, watchdog_seconds
from games.cyberpunk.sim_prompt import PROMPT_VERSION
from harness.core.io import read_jsonl, write_jsonl_atomic


def sample_evenly(decisions, count):
    """Deterministic spread over the whole game rather than the first few setup choices."""
    if len(decisions) <= count:
        return list(decisions)
    return [decisions[(index * len(decisions)) // count] for index in range(count)]


async def engine_decisions(args):
    """Real engine decision points from baseline-vs-baseline local matches."""
    setup = load_default_setup(REPO_ROOT)
    collected = []
    with EngineWorker(REPO_ROOT) as engine:
        for index in range(args.matches):
            def keep(decision):
                if len(decision.legal_actions) > 1:
                    collected.append(decision)
            await play_match(engine, setup.for_seed(f"{args.seed}-{index}"),
                             [PolicyRunner(), PolicyRunner()], policy_names=["baseline", "baseline"],
                             on_decision=keep)
    return sample_evenly(collected, args.positions), setup


def summarize(rows):
    times = sorted(row["elapsedMs"] for row in rows)
    selections = dict(collections.Counter(row["selection"] for row in rows))
    errors = dict(collections.Counter(row["error"] for row in rows if row.get("error")))
    def percentile(fraction):
        return times[max(0, math.ceil(len(times) * fraction) - 1)]
    return {"kind": "summary", "decisions": len(rows), "selections": selections, "errors": errors,
            "modelDecisions": selections.get("policy", 0),
            "fallbacks": len(rows) - selections.get("policy", 0),
            "p50Ms": percentile(0.5), "p95Ms": percentile(0.95), "maxMs": times[-1],
            "allModelDecisions": selections.get("policy", 0) == len(rows)}


async def measure(worker, decisions, repeat, budget_ms=DEFAULT_DECISION_BUDGET_MS):
    runner = PolicyRunner(MLXPolicy(worker), max_decision_ms=budget_ms)
    rows = []
    for iteration in range(repeat):
        for index, decision in enumerate(decisions):
            # A deadline can expire before the worker is called at all.
            # Such a row must not inherit the preceding decision's token metrics.
            worker.last_reply = None
            selection = await runner.choose(decision)
            row = {"kind": "decision", "case": index, "repeat": iteration,
                   "selection": selection.reason, "error": selection.error,
                   "elapsedMs": selection.elapsed_ms}
            # A model timeout is already recorded. Drain its bounded exchange so
            # later cases measure inference instead of inheriting a busy slot.
            await worker.wait_idle()
            reply = worker.last_reply or {}
            for key in ("promptTokens", "generationTokens", "inferenceMs"):
                value = reply.get(key)
                if type(value) in (float, int) and math.isfinite(value) and value >= 0:
                    row[key] = value
            assert selection.action_id in decision.offered_ids
            rows.append(row)
    return rows


async def run(args):
    setup = None
    if args.requests:
        decisions = [decision_from_record(record)
                     for record in read_jsonl(local_path(args.requests), missing_ok=False)]
    else:
        print("Playing baseline matches on the local engine for positions...", file=sys.stderr)
        decisions, setup = await engine_decisions(args)
    if not decisions:
        raise ValueError("Benchmark requires at least one valid decision record.")
    worker = make_worker(args.model, adapter=args.adapter,
                         max_prompt_tokens=args.max_prompt_tokens, max_tokens=args.max_tokens,
                         response_timeout=watchdog_seconds(args.budget_ms))
    try:
        print("Loading and warming the local model...", file=sys.stderr)
        started = time.monotonic()
        await worker.start()
        startup_ms = round((time.monotonic() - started) * 1000, 2)
        rows = await measure(worker, decisions, args.repeat, args.budget_ms)
    finally:
        await worker.close()
    metadata = {"kind": "metadata", "promptVersion": PROMPT_VERSION,
                "inputKind": "user_positions" if args.requests else "engine_positions",
                "positions": len(decisions),
                "engine": dict(setup.engine) if setup else None,
                "matchSeeds": None if args.requests else [f"{args.seed}-{i}" for i in range(args.matches)],
                "model": str(local_path(args.model)),
                "adapter": str(local_path(args.adapter)) if args.adapter else None,
                "maxPromptTokens": args.max_prompt_tokens, "maxTokens": args.max_tokens,
                "serviceBudgetMs": args.budget_ms, "startupMs": startup_ms,
                "platform": platform.platform(), "pythonVersion": platform.python_version(),
                "mlxVersion": worker.ready_info.get("mlxVersion"),
                "mlxLMVersion": worker.ready_info.get("mlxLMVersion")}
    summary = summarize(rows)
    print(json.dumps({**metadata, **summary}, indent=2))
    if args.output:
        write_jsonl_atomic(local_path(args.output), [metadata, *rows, summary])
        print(f"Report saved to {local_path(args.output)}", file=sys.stderr)
    return 0 if summary["allModelDecisions"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--adapter")
    parser.add_argument("--max-prompt-tokens", type=int, default=4096)
    parser.add_argument("--max-tokens", type=int, default=16)
    parser.add_argument("--requests", help="JSONL of decision records (camelCase Decision fields)")
    parser.add_argument("--matches", type=int, default=1, help="baseline engine matches to draw positions from")
    parser.add_argument("--positions", type=int, default=20, help="engine positions to measure")
    parser.add_argument("--seed", default="benchmark", help="match seed prefix; match i uses <seed>-<i>")
    parser.add_argument("--repeat", type=int, default=5)
    parser.add_argument("--budget-ms", type=int, default=DEFAULT_DECISION_BUDGET_MS,
                        help=f"per-decision budget (default {DEFAULT_DECISION_BUDGET_MS})")
    parser.add_argument("--output", help="Write a new JSONL report; existing reports are never overwritten")
    args = parser.parse_args()
    if args.repeat < 1 or args.matches < 1 or args.positions < 1:
        parser.error("--repeat, --matches and --positions must be positive")
    try:
        check_budget_ms(args.budget_ms)
    except ValueError as exc:
        parser.error(f"--budget-ms: {exc}")
    if args.output and local_path(args.output).exists():
        parser.error("--output already exists; choose a new report name")
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("Benchmark requires native arm64 Python on Apple Silicon macOS")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        return asyncio.run(run(args))
    except (ValueError, OSError, RuntimeError, TimeoutError) as exc:
        # Parsing exceptions can contain input values; do not echo the payload.
        print(f"Benchmark could not start/complete ({type(exc).__name__}). Check local model paths, "
              "dependencies and decision record format; see docs/local-mlx-bot.md.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
