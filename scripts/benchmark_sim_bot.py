#!/usr/bin/env python3
"""Measure local model decisions through the policy runner's deadline/fallback path.

By default use a synthetic protocol probe, not a gameplay strength evaluation.
Pass --requests with JSONL of decision records (camelCase Decision fields, such as
requestId, playerId, legalActions; other keys are ignored) for realistic sizes.
Reports contain timing, selection source and token counts, never prompts/snapshots
or generated text. No network connection or model download occurs here.
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

from games.cyberpunk.sim_bot import Decision, PolicyRunner, decision_from_record
from games.cyberpunk.sim_mlx import DEFAULT_MODEL, MLXPolicy, local_path, make_worker
from games.cyberpunk.sim_prompt import PROMPT_VERSION
from harness.core.io import read_jsonl, write_jsonl_atomic


def smoke_decision():
    return Decision(request_id="smoke-1", match_id="synthetic-smoke", sequence=1,
                    player_id="player2", deadline_ms=3000, prompt="Choose an action.",
                    snapshot={"game": {}, "players": {}, "controls": {}}, legal_actions=[
                        {"actionId": "smoke-roll", "source": "die", "label": "ROLL D12",
                         "type": "roll_die", "payload": {"dieId": "die_player2_1"}},
                        {"actionId": "smoke-end", "source": "primary", "label": "END TURN",
                         "type": "end_turn", "payload": {}}])


def summarize(rows):
    times = sorted(row["elapsedMs"] for row in rows)
    selections = dict(collections.Counter(row["selection"] for row in rows))
    def percentile(fraction):
        return times[max(0, math.ceil(len(times) * fraction) - 1)]
    return {"kind": "summary", "decisions": len(rows), "selections": selections,
            "modelDecisions": selections.get("policy", 0),
            "fallbacks": len(rows) - selections.get("policy", 0),
            "p50Ms": percentile(0.5), "p95Ms": percentile(0.95), "maxMs": times[-1],
            "allModelDecisions": selections.get("policy", 0) == len(rows)}


async def measure(worker, decisions, repeat):
    runner = PolicyRunner(MLXPolicy(worker))
    rows = []
    for iteration in range(repeat):
        for index, decision in enumerate(decisions):
            # A deadline can expire before the worker is called at all.
            # Such a row must not inherit the preceding decision's token metrics.
            worker.last_reply = None
            selection = await runner.choose(decision)
            row = {"kind": "decision", "case": index, "repeat": iteration,
                   "selection": selection.reason, "elapsedMs": selection.elapsed_ms}
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
    decisions = ([decision_from_record(record)
                  for record in read_jsonl(local_path(args.requests), missing_ok=False)]
                 if args.requests else [smoke_decision()])
    if not decisions:
        raise ValueError("Benchmark requires at least one valid decision record.")
    worker = make_worker(args.model, adapter=args.adapter,
                         max_prompt_tokens=args.max_prompt_tokens, max_tokens=args.max_tokens)
    try:
        print("Loading and warming the local model...", file=sys.stderr)
        started = time.monotonic()
        await worker.start()
        startup_ms = round((time.monotonic() - started) * 1000, 2)
        rows = await measure(worker, decisions, args.repeat)
    finally:
        await worker.close()
    metadata = {"kind": "metadata", "promptVersion": PROMPT_VERSION,
                "inputKind": "user_positions" if args.requests else "synthetic_smoke",
                "model": str(local_path(args.model)),
                "adapter": str(local_path(args.adapter)) if args.adapter else None,
                "maxPromptTokens": args.max_prompt_tokens, "maxTokens": args.max_tokens,
                "serviceBudgetMs": PolicyRunner().max_decision_ms, "startupMs": startup_ms,
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
    parser.add_argument("--repeat", type=int, default=5)
    parser.add_argument("--output", help="Write a new JSONL report; existing reports are never overwritten")
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be positive")
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
