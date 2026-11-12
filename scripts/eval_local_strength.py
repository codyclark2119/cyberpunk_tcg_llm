#!/usr/bin/env python3
"""Measure how strong local models play: many matches of each configuration against the baseline.

Why: agreement with the baseline only says whether a model plays differently;
whether it plays better takes wins and losses over many games, read with their
uncertainty. This runs N matches per configuration (a local model directory, a
prompt version and a decision budget) against the deterministic baseline bot on
the local engine, and summarises win rate with a 95% Wilson interval, baseline
agreement, fallbacks, decision latency and prompt tokens
(docs/local-strength-eval.md).

Configurations are every combination of --model, --prompt-version and
--budget-ms. Every configuration plays the same seed list: match i uses seed
<--seed>-<i // 2> with the model in seat i % 2, so each configuration plays each
seed, and so each seat and each Demo deck, equally often. --matches must be even.

Everything goes under <--output-root>/<--run-id>/ (default local/strength/,
gitignored): plan.json (the configurations and seeds), matches/<config>-<seed>-s<seat>.jsonl
(ordinary match records, schemaVersion 3, docs/local-match-records-v3.md, which
the play UI's viewer opens), timings.jsonl (wall time per match and per model
load) and summary.json, rewritten after every match. Re-running the same command
with the same run id resumes: finished matches are skipped and the model is not
even loaded when all its matches exist. A different plan under an existing run
id is refused. Results are deterministic given the seeds, apart from timings
(and from decisions a model answers too late, which fall back to the baseline).

The summary comes from games/cyberpunk/strength_eval.py, which the play UI's
"Strength" tab also uses; --summarize-only re-summarises an existing run without
playing anything.

An mlx seat needs native arm64 Python on Apple Silicon and a downloaded model
(docs/local-mlx-bot.md). Nothing here downloads, fetches or serves.
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import logging
import platform
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import (DEFAULT_MAX_DECISIONS, DEFAULT_MAX_TURNS, load_default_setup,
                                         load_setup_file, play_match, write_match_record)
from games.cyberpunk.policy_bot import DEFAULT_DECISION_BUDGET_MS, PolicyRunner, check_budget_ms
from games.cyberpunk.policy_mlx import MLXPolicy, make_worker, model_info, watchdog_seconds
from games.cyberpunk.policy_prompt import PROMPT_VERSION, PROMPT_VERSIONS
from games.cyberpunk.strength_eval import (MATCHES_DIR, PLAN_FILE, RUN_ID_RE, TIMINGS_FILE, config_label,
                                           read_plan, summarize_run, write_json_atomic, write_summary)

DEFAULT_OUTPUT_ROOT = REPO_ROOT / "local" / "strength"
PLAN_SCHEMA_VERSION = 1
SEED_PREFIX_RE = RUN_ID_RE


def build_plan(args, setup) -> dict:
    """The run's configurations and seeds; equal plans mean the same run."""
    budgets = args.budget_ms or [DEFAULT_DECISION_BUDGET_MS]
    versions = args.prompt_version or [PROMPT_VERSION]
    configs, labels = [], set()
    for index, (model, version, budget) in enumerate(itertools.product(args.model, versions, budgets)):
        info = model_info(model, prompt_version=version)
        config = {"policy": "mlx", **{k: info[k] for k in ("modelPath", "modelRevision", "adapterPath",
                                                           "adapterRevision", "promptVersion")},
                  "budgetMs": budget}
        label = config_label(config)
        if label in labels:
            raise ValueError(f"configuration {label!r} is listed twice")
        labels.add(label)
        configs.append({"id": f"c{index}", "label": label, "model": model, **config})
    seeds = [f"{args.seed}-{k}" for k in range(args.matches // 2)]
    return {"schemaVersion": PLAN_SCHEMA_VERSION, "runId": args.run_id, "seed": args.seed,
            "matchesPerConfig": args.matches, "seeds": seeds, "configs": configs,
            "plannedMatches": args.matches * len(configs), "opponent": "baseline",
            "setupSource": setup.source, "engine": dict(setup.engine),
            "limits": {"maxDecisions": args.max_decisions, "maxTurns": args.max_turns}}


def schedule(plan: dict) -> list[tuple[dict, str, int, str]]:
    """(config, seed, model seat, record name) per match: seed i // 2, model seat i % 2."""
    out = []
    for config in plan["configs"]:
        for i in range(plan["matchesPerConfig"]):
            seed, seat = plan["seeds"][i // 2], i % 2
            out.append((config, seed, seat, f"{config['id']}-{seed}-s{seat}.jsonl"))
    return out


def _append_timing(run_dir: Path, entry: dict) -> None:
    with (run_dir / TIMINGS_FILE).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")


def format_summary(summary: dict) -> str:
    lines = [f"run {summary['runId']}: {summary['completedMatches']}/{summary['plannedMatches']} matches"]
    for c in summary["configs"]:
        interval = c["winRateInterval95"]
        agreement = c["baselineAgreement"]
        lines.append(
            f"  {c['label']}: W-L-D {c['wins']}-{c['losses']}-{c['draws']}"
            + (f" (+{c['noResult']} no result)" if c["noResult"] else "")
            + (f", win rate {c['winRate']:.3f} [{interval[0]:.3f}, {interval[1]:.3f}]" if interval else "")
            + (f", agreement {agreement['rate']:.3f}" if agreement else ", agreement n/a")
            + f", fallbacks {c['fallbacks']['total']}"
            + (f", p50/p95 {c['latencyMs']['p50']}/{c['latencyMs']['p95']} ms" if c["latencyMs"]["p50"] is not None
               else ""))
    return "\n".join(lines)


async def run(args, setup, *, worker_factory=None) -> int:
    """Play every missing match of the plan, then summarise. ``worker_factory(model)`` replaces
    ``make_worker`` (tests only)."""
    run_dir = args.output_root / args.run_id
    plan = build_plan(args, setup)
    existing = read_plan(run_dir)
    if existing is not None and existing != plan:
        raise ValueError(f"{run_dir / PLAN_FILE} holds a different plan (configurations, seeds, setup or "
                         "limits); choose another --run-id or repeat the original command")
    write_json_atomic(run_dir / PLAN_FILE, plan)
    matches_dir = run_dir / MATCHES_DIR
    jobs = schedule(plan)
    todo = [job for job in jobs if not (matches_dir / job[3]).exists()]
    print(f"run {args.run_id}: {len(plan['configs'])} configurations x {plan['matchesPerConfig']} matches; "
          f"{len(jobs) - len(todo)} already done, {len(todo)} to play -> {run_dir}", file=sys.stderr, flush=True)
    done = len(jobs) - len(todo)
    factory = worker_factory or (lambda model, budget: make_worker(
        model, response_timeout=watchdog_seconds(budget)))
    with EngineWorker(REPO_ROOT, node=args.node) as engine:
        # One worker per model directory, loaded only when that model still has matches to play.
        for model in dict.fromkeys(config["model"] for config in plan["configs"]):
            pending = [job for job in todo if job[0]["model"] == model]
            if not pending:
                continue
            worker = factory(model, max(job[0]["budgetMs"] for job in pending))
            print(f"Loading and warming {model}...", file=sys.stderr, flush=True)
            started = time.monotonic()
            await worker.start()
            _append_timing(run_dir, {"kind": "load", "model": model,
                                     "wallMs": round((time.monotonic() - started) * 1000, 1)})
            try:
                for config, seed, seat, name in pending:
                    worker.response_timeout = watchdog_seconds(config["budgetMs"])
                    info = model_info(model, prompt_version=config["promptVersion"])
                    runners = [PolicyRunner(max_decision_ms=config["budgetMs"]) for _ in range(2)]
                    runners[seat] = PolicyRunner(MLXPolicy(worker, info=info), max_decision_ms=config["budgetMs"])
                    names = ["baseline", "baseline"]
                    names[seat] = "mlx"
                    started = time.monotonic()
                    rows = await play_match(engine, setup.for_seed(seed), runners, policy_names=names,
                                            max_decisions=args.max_decisions, max_turns=args.max_turns)
                    wall = round((time.monotonic() - started) * 1000, 1)
                    write_match_record(matches_dir / name, rows)
                    _append_timing(run_dir, {"kind": "match", "record": name, "wallMs": wall})
                    done += 1
                    result = rows[-1]
                    side = ("win" if result["winnerSeat"] == seat else "loss") if result["winnerSeat"] is not None \
                        else result["status"]
                    print(f"[{done}/{len(jobs)}] {config['label']} {seed} model seat {seat}: {side} "
                          f"({result['status']}, {result['turns']} turns, {result['decisions']} decisions) "
                          f"{wall / 1000:.1f}s", file=sys.stderr, flush=True)
                    write_summary(run_dir)
            finally:
                await worker.close()
    summary = write_summary(run_dir)
    print(format_summary(summary))
    print(f"summary -> {run_dir / 'summary.json'}")
    errors = sum(c["statuses"].get("engine_error", 0) for c in summary["configs"])
    return 0 if errors == 0 else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-id", required=True,
                        help="names the run directory; re-running with the same id resumes it")
    parser.add_argument("--model", action="append", default=[],
                        help="local model directory for the mlx seat (repeat to compare models)")
    parser.add_argument("--prompt-version", action="append", choices=PROMPT_VERSIONS,
                        help=f"prompt the model is given (repeat to compare; default {PROMPT_VERSION})")
    parser.add_argument("--budget-ms", action="append", type=int,
                        help=f"per-decision budget (repeat to compare; default {DEFAULT_DECISION_BUDGET_MS})")
    parser.add_argument("--matches", type=int, default=20,
                        help="matches per configuration, even: each seed once per seat (default 20)")
    parser.add_argument("--seed", default="strength", help="seed prefix; seeds are <seed>-0, <seed>-1, ...")
    parser.add_argument("--setup", type=Path, help="JSON with content and initialization; default: fixed Demo decks")
    parser.add_argument("--max-decisions", type=int, default=DEFAULT_MAX_DECISIONS)
    parser.add_argument("--max-turns", type=int, default=DEFAULT_MAX_TURNS)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT,
                        help="runs go to <output-root>/<run-id>/ (default local/strength)")
    parser.add_argument("--summarize-only", action="store_true",
                        help="re-summarise an existing run from its records; play nothing")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if not RUN_ID_RE.match(args.run_id):
        parser.error("--run-id must be 1-80 letters, digits, '.', '_' or '-'")
    if not args.output_root.is_absolute():
        args.output_root = REPO_ROOT / args.output_root
    if args.summarize_only:
        run_dir = args.output_root / args.run_id
        if not run_dir.is_dir():
            parser.error(f"no run at {run_dir}")
        summary = write_summary(run_dir)
        print(format_summary(summary))
        print(f"summary -> {run_dir / 'summary.json'}")
        return 0
    if not args.model:
        parser.error("give at least one --model")
    if args.matches < 2 or args.matches % 2:
        parser.error("--matches must be a positive even number (each seed is played once per seat)")
    if not SEED_PREFIX_RE.match(args.seed):
        parser.error("--seed must be 1-80 letters, digits, '.', '_' or '-'")
    if args.max_decisions < 1 or args.max_turns < 0:
        parser.error("--max-decisions must be positive, --max-turns nonnegative")
    for budget in args.budget_ms or []:
        try:
            check_budget_ms(budget)
        except ValueError as exc:
            parser.error(f"--budget-ms: {exc}")
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("An mlx seat requires native arm64 Python on Apple Silicon macOS")
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    setup = load_setup_file(args.setup) if args.setup else load_default_setup(REPO_ROOT, node=args.node)
    try:
        return asyncio.run(run(args, setup))
    except (FileExistsError, ValueError) as exc:
        print(f"{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
