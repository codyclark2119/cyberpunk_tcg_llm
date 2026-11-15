#!/usr/bin/env python3
"""How often engine_check's verdict matches the engine on positions the catalog never saw.

Why: ``engine_check`` (games/cyberpunk/assistant/engine_oracle.py) answers "can this play be
made?" from the committed catalog ``data/oracle/positions-v1.jsonl``. Its verdicts are true of
the catalog by construction (``scripts/test_engine_check.py`` recounts them), but the model uses
them for situations it describes, which are not catalog positions. This measures that transfer:
``data/oracle/eval-positions-v1.jsonl`` holds positions the engine reached on the held-out seed
prefix ``engine-oracle-eval-v1`` (``build_oracle_positions.py --eval``), disjoint from the catalog
and from the LoRA's ``engine-tf-v1`` seeds. For every friendly card copy there, and every play the
tool knows, it asks the tool with all the facts it accepts filled from that position (step, the
card's ready/spent state, lagging and played this turn; for ``attack_target`` also the target's
state; for a card in hand, whether its cost can be paid now and whether a card was sold this turn)
and compares the verdict with what the engine actually offered for that exact copy.

Outcomes per question:

  - ``correct``: ``offered`` and the engine offered it, or ``not_offered`` and it did not;
  - ``wrong``: the opposite. Every wrong case is listed in the report with its position;
  - ``depends``: the catalog has both answers for these facts (the tool says so; not an error);
  - ``no_position``: the catalog has no match for these facts.

Python decides no legality here: the truth is the engine's offered-action list in each eval row,
and the verdict is the tool's. The report (``data/oracle/eval-fidelity-v1.json``) records both
indexes' sha256 and engine identity; ``--check`` recomputes it and fails if it differs.

Usage:
    python scripts/eval_engine_check.py           # write the report
    python scripts/eval_engine_check.py --check   # recompute and compare with the committed report
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from games.cyberpunk.assistant import engine_oracle  # noqa: E402
from games.cyberpunk.config import REPO_ROOT  # noqa: E402
from harness.core.io import read_jsonl  # noqa: E402

EVAL_INDEX = REPO_ROOT / "data/oracle/eval-positions-v1.jsonl"
EVAL_MANIFEST = REPO_ROOT / "data/oracle/eval-positions-v1.manifest.json"
REPORT_PATH = REPO_ROOT / "data/oracle/eval-fidelity-v1.json"
REPORT_VERSION = "engine-check-fidelity-v1"
OUTCOMES = ("correct", "wrong", "depends", "no_position")


def _yes_no(value: bool) -> str:
    return "yes" if value else "no"


def questions(row: dict) -> list[tuple[dict, bool]]:
    """(engine_check arguments, did the engine offer it) for every friendly copy and play at ``row``."""
    cards = row["facts"]["cards"]
    out = []
    for play, (kind, area) in engine_oracle.PLAY_KINDS.items():
        actions = [o for o in row["offered"] if o["kind"] == kind]
        for card in cards:
            if card["side"] != "friendly" or card["area"] != area:
                continue
            args = {"play": play, "card": card["slug"], "step": row["step"],
                    "lagging": _yes_no(card["lagging"]), "played_this_turn": _yes_no(card["played_this_turn"])}
            if card["state"]:
                args["card_state"] = card["state"]
            if area == "hand":
                args["affordable"] = _yes_no(card["affordable"])
                args["sold_this_turn"] = _yes_no(row["facts"]["sold_this_turn"] > 0)
            mine = [o for o in actions if o["source_public_id"] == card["public_id"]]
            if play != "attack_target":
                out.append((args, bool(mine)))
                continue
            for target in cards:
                if target["side"] != "rival" or target["area"] != "battlefield":
                    continue
                hit = any(t.get("public_id") == target["public_id"] for o in mine for t in o.get("attack_targets", []))
                with_target = {**args, "target": target["slug"]}
                if target["state"]:
                    with_target["target_state"] = target["state"]
                out.append((with_target, hit))
    return out


def outcome(verdict: str, truth: bool) -> str:
    if verdict in ("offered", "not_offered"):
        return "correct" if (verdict == "offered") == truth else "wrong"
    return verdict


def verdict_for(args: dict) -> str:
    try:
        return engine_oracle.engine_check(**args)["verdict"]
    except engine_oracle.OracleError as exc:
        if exc.kind == "no_position":
            return "no_position"
        raise


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluate(rows: list[dict]) -> dict:
    catalog_ids = {r["position_id"] for r in engine_oracle.index()}
    overlap = sorted({r["position_id"] for r in rows} & catalog_ids)
    if overlap:
        raise SystemExit(f"error: eval positions also in the catalog: {overlap[:5]}")
    counts: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    wrong = []
    cache: dict[str, str] = {}
    for row in rows:
        for args, truth in questions(row):
            key = json.dumps(args, sort_keys=True)
            if key not in cache:
                cache[key] = verdict_for(args)
            result = outcome(cache[key], truth)
            counts[args["play"]][result] += 1
            counts["all"][result] += 1
            if result == "wrong":
                wrong.append({"position_id": row["position_id"], "seed": row["seed"],
                              "decision_index": row["decision_index"], "arguments": args,
                              "verdict": cache[key], "engine_offered": truth})
    table = {}
    for play in ("all", *engine_oracle.PLAY_KINDS):
        c = counts.get(play, collections.Counter())
        answered = c["correct"] + c["wrong"]
        total = sum(c[o] for o in OUTCOMES)
        table[play] = {**{o: c[o] for o in OUTCOMES}, "questions": total,
                       "accuracy_when_answered": round(c["correct"] / answered, 4) if answered else None,
                       "answered_share": round(answered / total, 4) if total else None}
    eval_manifest = json.loads(EVAL_MANIFEST.read_text(encoding="utf-8"))
    return {"report_version": REPORT_VERSION,
            "catalog": {"index": str(engine_oracle.INDEX_PATH.relative_to(REPO_ROOT)),
                        "sha256": _sha256(engine_oracle.INDEX_PATH), "positions": len(catalog_ids),
                        "engine": engine_oracle.manifest()["engine"]},
            "eval": {"index": str(EVAL_INDEX.relative_to(REPO_ROOT)), "sha256": _sha256(EVAL_INDEX),
                     "positions": len(rows), "seeds": eval_manifest["seeds"], "engine": eval_manifest["engine"]},
            "distinct_questions": len(cache), "outcomes": table, "wrong": wrong}


def report_text(report: dict) -> str:
    return json.dumps(report, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=REPORT_PATH, help="report json (default: %(default)s)")
    parser.add_argument("--check", action="store_true", help="recompute and compare with --out")
    args = parser.parse_args(argv)
    rows = read_jsonl(EVAL_INDEX, missing_ok=False)
    report = evaluate(rows)
    text = report_text(report)
    a = report["outcomes"]["all"]
    print(f"{a['questions']} questions over {len(rows)} held-out positions: {a['correct']} correct, "
          f"{a['wrong']} wrong, {a['depends']} depends, {a['no_position']} no position; "
          f"accuracy when answered {a['accuracy_when_answered']}, answered {a['answered_share']}")
    if report["catalog"]["engine"] != report["eval"]["engine"]:
        print("error: the catalog and the eval positions name different engines", file=sys.stderr)
        return 1
    if args.check:
        same = args.out.exists() and args.out.read_text(encoding="utf-8") == text
        print("up to date" if same else f"differs: {args.out.name}")
        return 0 if same else 1
    args.out.write_text(text, encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
