#!/usr/bin/env python3
"""Can the engine answer the card questions in Cody's quizzes and the official test? (plan section 7, stage 1)

Why: the assistant's ``engine_check`` never moved the quiz, partly because most card questions ask what an effect
does in one exact situation. Before giving the model a scenario tool, this measures the engine alone: for every
keyed card question there is one hand-written scenario in ``data/scenario/quiz-checks-v1.json`` (a setup, a few
steps and a *reading*: which offer, diff line or open choice in the report answers the question). The script runs
each on the real engine through ``games/cyberpunk/assistant/engine_scenario.py``, turns the reading into an answer
letter and compares it with the key in ``data/gold``.

The checks file is derived from eval questions. It holds no question text (the key and text stay in data/gold),
and it is never read by prompts, retrieval or training (``scripts/test_engine_scenario.py`` pins that only this
script and its test name it). Nothing here involves a model.

Readings, all over the tool's report (``after``/``step`` index the scenario's steps; ``after: -1`` is the start):

  - ``offered``: the engine offers ``action`` for ``card`` to the seat acting after that step;
  - ``offered_any``: it offers it to ``seat`` after any step from ``from`` on;
  - ``diff``: every regex in ``patterns`` matches some diff line of that step;
  - ``pending``: after that step a choice of ``choice_kind`` is open with an option matching ``option``;
  - ``out_of_reach``: no scenario can decide the question (``why`` says so); the scenario still runs as a record.

``preconditions`` are readings that must hold for the scenario to mean what it says (the setup did what it was
written for); if one fails, the outcome is ``setup_failed``. ``answers`` maps the reading to a letter.

Outcomes: ``agrees``, ``disagrees`` (the engine's answer differs from the key), ``setup_failed``, ``stopped`` (a step
was not offered), ``engine_error`` (the engine failed on the position), ``out_of_reach``; controls give ``control_ok``
or ``control_failed``.

The report (``data/scenario/quiz-checks-v1.report.json``) records the engine identity and the checks file's and
gold files' sha256. ``--check`` recomputes it and fails if anything but the engine identity differs, so an engine
change that flips an answer shows up.

Usage:
    python scripts/eval_engine_scenarios.py           # write the report
    python scripts/eval_engine_scenarios.py --check   # recompute and compare with the committed report
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from games.cyberpunk.assistant import engine_scenario as es  # noqa: E402
from games.cyberpunk.config import REPO_ROOT  # noqa: E402
from games.cyberpunk.engine_adapter import EngineWorker  # noqa: E402
from harness.core.io import read_jsonl  # noqa: E402

CHECKS_PATH = REPO_ROOT / "data/scenario/quiz-checks-v1.json"
REPORT_PATH = REPO_ROOT / "data/scenario/quiz-checks-v1.report.json"
GOLD_FILES = ("data/gold/quiz_mc_2026-11-12.jsonl", "data/gold/quiz_mc_2026-11-13.jsonl",
              "data/gold/official_basic_test.jsonl")
REPORT_VERSION = "engine-scenario-checks-report-v1"
OUTCOMES = ("agrees", "disagrees", "setup_failed", "stopped", "engine_error", "out_of_reach")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def gold_keys() -> dict[str, str]:
    """question id -> keyed letter, over the three gold files."""
    keys = {}
    for name in GOLD_FILES:
        for row in read_jsonl(REPO_ROOT / name, missing_ok=False):
            if row.get("correct"):
                keys[row["id"]] = row["correct"]
    return keys


def _entry_offers(report: dict, after: int) -> list[dict]:
    if after == -1:
        return report["start"]["offers"]["actions"]
    return report["steps"][after]["offers"]["actions"] if after < len(report["steps"]) else []


def evaluate_reading(reading: dict, report: dict) -> tuple[bool | None, list[str]]:
    """(the reading's value, evidence lines); None when the report never got that far."""
    kind = reading["kind"]
    steps = report["steps"]
    if kind == "offered":
        if reading["after"] >= len(steps):
            return None, []
        hits = [o for o in _entry_offers(report, reading["after"]) if o["kind"] == reading["action"]
                and ("card" not in reading or o.get("card") == reading["card"])]
        return bool(hits), [o["label"] for o in hits]
    if kind == "offered_any":
        if reading["from"] >= len(steps):
            return None, []
        hits = [f"after step {i}: {o['label']}" for i, st in enumerate(steps) if i >= reading["from"]
                and st["next_seat"] == reading["seat"] for o in st["offers"]["actions"]
                if o["kind"] == reading["action"] and o.get("card") == reading["card"]]
        return bool(hits), hits
    if kind == "diff":
        if reading["step"] >= len(steps):
            return None, []
        lines = steps[reading["step"]]["diff"]
        found = [next((line for line in lines if re.search(p, line)), None) for p in reading["patterns"]]
        return all(found), [f for f in found if f]
    if kind == "pending":
        if reading["step"] >= len(steps):
            return None, []
        pending = steps[reading["step"]]["pending"]
        if not pending or pending["kind"] != reading["choice_kind"]:
            return False, [json.dumps(pending)] if pending else []
        hits = [o for o in pending["options"] if re.search(reading["option"], o)]
        return bool(hits), hits
    raise ValueError(f"unknown reading kind {kind!r}")


def run_check(worker: EngineWorker, content: dict, check: dict, keys: dict[str, str]) -> dict:
    out = {"id": check["id"]}
    if "control_for" in check:
        out["control_for"] = check["control_for"]
    else:
        out["key"] = keys[check["id"]]
        for other in check.get("also", []):
            if keys.get(other) != out["key"]:
                raise SystemExit(f"error: {other} is keyed {keys.get(other)!r}, but {check['id']} is {out['key']!r}")
        if check.get("also"):
            out["also"] = check["also"]
    try:
        report = es.run_scenario(worker, content, check["setup"], check["steps"])
    except es.ScenarioError as exc:
        return {**out, "outcome": "engine_error" if exc.kind == "engine_error" else "setup_failed",
                "detail": f"{exc.kind}: {exc}"}
    stopped = report["stopped"]
    if stopped and stopped["reason"] == "engine_error":
        return {**out, "outcome": "engine_error", "detail": f"step {stopped['at']}: {stopped['message']}"}
    if stopped:
        return {**out, "outcome": "stopped", "detail": f"step {stopped['at']}: {stopped['reason']}: {stopped['message']}"}
    for pre in check.get("preconditions", []):
        value, evidence = evaluate_reading(pre, report)
        if not value:
            return {**out, "outcome": "setup_failed", "detail": f"precondition failed: {json.dumps(pre)}",
                    "evidence": evidence}
    reading = check["reading"]
    if reading["kind"] == "out_of_reach":
        last = report["steps"][-1]["diff"] if report["steps"] else []
        return {**out, "outcome": "out_of_reach", "detail": reading["why"], "evidence": last}
    value, evidence = evaluate_reading(reading, report)
    if value is None:
        return {**out, "outcome": "setup_failed", "detail": "the reading's step was never reached"}
    answer = check["answers"]["true" if value else "false"]
    if "control_for" in check:
        return {**out, "outcome": "control_ok" if answer else "control_failed", "reading": value, "evidence": evidence}
    return {**out, "reading": value, "engine_answer": answer,
            "outcome": "agrees" if answer == out["key"] else "disagrees", "evidence": evidence}


def evaluate(checks: dict, keys: dict[str, str]) -> dict:
    content, engine = es.reviewed_content(REPO_ROOT)
    with EngineWorker(REPO_ROOT) as worker:
        results = [run_check(worker, content, c, keys) for c in checks["checks"]]
    counts = collections.Counter(r["outcome"] for r in results if "control_for" not in r)
    questions = [r for r in results if "control_for" not in r]
    return {"report_version": REPORT_VERSION, "engine": engine,
            "checks": {"path": str(CHECKS_PATH.relative_to(REPO_ROOT)), "sha256": _sha256(CHECKS_PATH),
                       "version": checks["version"]},
            "gold": {name: _sha256(REPO_ROOT / name) for name in GOLD_FILES},
            "summary": {"questions": len(questions),
                        "question_ids_covered": sum(1 + len(r.get("also", [])) for r in questions),
                        **{o: counts[o] for o in OUTCOMES}},
            "results": results}


def report_text(report: dict) -> str:
    return json.dumps(report, indent=1, ensure_ascii=False) + "\n"


def _without_engine(text: str) -> dict:
    value = json.loads(text)
    value.pop("engine", None)
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=REPORT_PATH, help="report json (default: %(default)s)")
    parser.add_argument("--check", action="store_true", help="recompute and compare with --out (engine identity aside)")
    args = parser.parse_args(argv)
    checks = json.loads(CHECKS_PATH.read_text(encoding="utf-8"))
    report = evaluate(checks, gold_keys())
    s = report["summary"]
    print(f"{s['questions']} card questions ({s['question_ids_covered']} ids): "
          + ", ".join(f"{s[o]} {o.replace('_', ' ')}" for o in OUTCOMES))
    for r in report["results"]:
        if r["outcome"] not in ("agrees", "control_ok"):
            print(f"  {r['id']}: {r['outcome']}" + (f" ({r['detail']})" if r.get("detail") else "")
                  + (f" engine {r['engine_answer']} vs key {r['key']}" if r["outcome"] == "disagrees" else ""))
    text = report_text(report)
    if args.check:
        same = args.out.exists() and _without_engine(args.out.read_text(encoding="utf-8")) == _without_engine(text)
        print("up to date" if same else f"differs: {args.out.name}")
        return 0 if same else 1
    args.out.write_text(text, encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
