#!/usr/bin/env python3
"""Measure rules retrieval on the quiz: does search_rules return the rules a question needs?

Why: Cody's quiz (data/gold/quiz_mc_2026-11-12.jsonl) failed almost everywhere,
and reading the traces showed the model rarely saw the rule that settles the
question: ``search_rules`` returned section headings or one recurring rule.
Changing retrieval without a number would be guessing, so this scores every
retrieval method the assistant has on the same questions, before and after.

Expected rules come from ``eval/sets/quiz_mc_expected_rules_draft.jsonl``: one
row per quiz id with ``expected_rule_ids``. That file is a DRAFT written by
Claude and not reviewed by a person; it is a measurement aid, not gold, and
never training data. Rows with an empty list (tournament-policy and card-only
questions) are skipped and listed as skipped.

Query. Each question is queried as the scorer's ``eval-mc-v1`` wrapper
(``scripts/eval_assistant.py: question_message``) presents it to the model:
the question text and its lettered choice lines ("A. Yes"), cut from the
rendered message so a change to the wrapper shows up here too. The default
form drops the wrapper's two labels ("Question:", "Choices:") and its
instruction sentences; ``--query-form wrapper-block`` keeps the labels.

Hit rule (exact). A returned passage carries the numbered rule ids it contains
(a rule-level passage carries one; a legacy 1200-character chunk carries every
rule inside it; an erratum carries none). A returned id R matches an expected id
E when R == E, or R is E's numbering parent (E with its last ".n" removed), or
E is R's numbering parent. Only dotted numbers count, so a section heading
without a number never matches, and two levels apart (4 vs 4.12.1) is a miss.

Metrics, per method, over the scored questions:
  recall@k    fraction of questions with at least one matching id in the top k
              passages (k = 1, 5, 10)
  coverage@k  mean fraction of a question's expected ids matched in the top k
  chars@k     mean characters of text in the top k passages, because a chunk
              passage holds many rules and so gets credit for all of them; a
              recall gain bought with ten times the text is not the same gain.

Output is deterministic JSON (sorted keys, no timestamps) on stdout, and with
``--name`` also ``eval/reports/<name>.json`` (refused if it exists, unless
``--force``). Methods that cannot run here (no index, or no embedding model on
this machine) are listed with the reason instead of scored.

Usage:
    python scripts/eval_retrieval.py
    python scripts/eval_retrieval.py --name retrieval-quiz-2026-11-12 --force
    python scripts/eval_retrieval.py --methods lexical-bm25-rules --quiet
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from eval_assistant import EVAL_PROMPT_VERSION, question_message  # noqa: E402
from games.cyberpunk.assistant import tools  # noqa: E402
from games.cyberpunk.assistant.eval_store import RUN_NAME_RE, load_mc_set  # noqa: E402
from games.cyberpunk.prompts import RULES_VERSION  # noqa: E402
from harness.core.io import file_sha256, read_jsonl  # noqa: E402

REPORT_VERSION = "retrieval-recall-v1"
KIND = "retrieval-report"
KS = (1, 5, 10)
DEFAULT_EXPECTED = REPO_ROOT / "eval/sets/quiz_mc_expected_rules_draft.jsonl"
DEFAULT_QUESTIONS = REPO_ROOT / "data/gold/quiz_mc_2026-11-12.jsonl"
REPORTS_DIR = REPO_ROOT / "eval/reports"
NUMBERED_RE = re.compile(r"^\d+(?:\.\d+)*$")
MATCH_RULE = ("A returned rule id R matches an expected id E when R == E, or R is E's numbering parent, or E is R's "
              "numbering parent (one trailing '.n' apart). Only dotted rule numbers count.")
QUERY_FORMS = {
    "question-choices": "eval-mc-v1 question text and lettered choice lines, without the 'Question:'/'Choices:' labels "
                        "and the wrapper's instruction sentences",
    "wrapper-block": "eval-mc-v1 'Question:' line and 'Choices:' block verbatim, without the instruction sentences",
}


def query_for(item: dict, form: str = "question-choices") -> str:
    """The question and its choices as ``question_message`` (eval-mc-v1) renders them.

    ``wrapper-block`` is the rendered block verbatim, labels included.
    ``question-choices`` (the default) is the same text without the two labels
    "Question:" and "Choices:": they are wrapper scaffolding no model query
    carries, and "Choices" alone matches the effect-choice rules (10.31-10.33)
    on every question.
    """
    message = question_message(item)
    block = message[message.index("Question: "):message.index("\n\nExplain your reasoning")]
    if form == "wrapper-block":
        return block
    question, choices = block.split("\n\nChoices:\n", 1)
    return question[len("Question: "):] + "\n" + choices


def _parent(rule_id: str) -> str | None:
    return rule_id.rsplit(".", 1)[0] if "." in rule_id else None


def matches(returned: str, expected: str) -> bool:
    if not (NUMBERED_RE.match(returned) and NUMBERED_RE.match(expected)):
        return False
    return returned == expected or returned == _parent(expected) or expected == _parent(returned)


def load_expected(path: Path, questions: dict[str, dict]) -> list[dict]:
    rows = read_jsonl(path, missing_ok=False)
    seen = set()
    for row in rows:
        if row.get("id") not in questions:
            raise SystemExit(f"{path.name}: {row.get('id')!r} is not a question in the quiz set")
        if row["id"] in seen:
            raise SystemExit(f"{path.name}: duplicate id {row['id']}")
        seen.add(row["id"])
        ids = row.get("expected_rule_ids")
        if not isinstance(ids, list) or not all(isinstance(i, str) and NUMBERED_RE.match(i) for i in ids):
            raise SystemExit(f"{path.name}: {row['id']}: expected_rule_ids must be a list of rule numbers")
        unknown = [i for i in ids if i not in tools.rules_by_id()]
        if unknown:
            raise SystemExit(f"{path.name}: {row['id']}: not in the rules snapshot: {', '.join(unknown)}")
        if not ids and not row.get("reason"):
            raise SystemExit(f"{path.name}: {row['id']}: an empty expected list needs a reason")
    return rows


def score_item(expected: list[str], passages: list[dict]) -> dict:
    first_hit = None
    found_by_k = {}
    for k in KS:
        returned = [r for p in passages[:k] for r in p.get("rule_ids") or ()]
        found = sorted({e for e in expected if any(matches(r, e) for r in returned)},
                       key=lambda s: [int(x) for x in s.split(".")])
        found_by_k[k] = found
    for rank, passage in enumerate(passages, 1):
        if any(matches(r, e) for r in passage.get("rule_ids") or () for e in expected):
            first_hit = rank
            break
    return {"first_hit_rank": first_hit, "found": {f"@{k}": found_by_k[k] for k in KS},
            "chars": {f"@{k}": sum(len(p.get("text") or "") for p in passages[:k]) for k in KS},
            "top": [{"chunk_id": p["chunk_id"], "rule_ids": list(p.get("rule_ids") or [])[:12]}
                    for p in passages[:max(KS)]]}


def score_method(search, scored: list[tuple[dict, dict]], form: str) -> dict:
    per_item = []
    for row, item in scored:
        passages = search(query_for(item, form), max(KS))
        per_item.append({"id": row["id"], "expected": row["expected_rule_ids"],
                         **score_item(row["expected_rule_ids"], passages)})
    n = len(per_item)
    summary = {}
    for k in KS:
        hits = sum(1 for p in per_item if p["first_hit_rank"] is not None and p["first_hit_rank"] <= k)
        summary[f"recall@{k}"] = round(hits / n, 4) if n else None
        summary[f"hits@{k}"] = hits
        summary[f"coverage@{k}"] = round(sum(len(p["found"][f"@{k}"]) / len(p["expected"]) for p in per_item) / n,
                                         4) if n else None
        summary[f"chars@{k}"] = round(sum(p["chars"][f"@{k}"] for p in per_item) / n, 1) if n else None
    return {"available": True, **summary, "items": per_item}


def build_report(expected_path: Path, questions_path: Path, wanted: list[str] | None,
                 form: str = "question-choices") -> dict:
    questions = {item["id"]: item for item in load_mc_set(questions_path)}
    rows = load_expected(expected_path, questions)
    scored = [(row, questions[row["id"]]) for row in rows if row["expected_rule_ids"]]
    skipped = [{"id": row["id"], "reason": row.get("reason", "")} for row in rows if not row["expected_rule_ids"]]
    available = tools.retrieval_methods()
    names = wanted or list(available)
    unknown = [m for m in names if m not in available]
    if unknown:
        raise SystemExit(f"unknown method(s): {', '.join(unknown)} (known: {', '.join(available)})")
    methods = {}
    for name in names:
        method = available[name]
        if method["search"] is None:
            methods[name] = {"available": False, "reason": method["reason"]}
        else:
            methods[name] = score_method(method["search"], scored, form)
    return {"kind": KIND, "report_version": REPORT_VERSION, "rules_version": RULES_VERSION,
            "eval_prompt_version": EVAL_PROMPT_VERSION, "query_form": form, "query_form_text": QUERY_FORMS[form], "match_rule": MATCH_RULE,
            "expected_set": _rel(expected_path), "expected_sha256": file_sha256(expected_path),
            "expected_status": sorted({row.get("status", "") for row in rows}),
            "questions": _rel(questions_path), "questions_sha256": file_sha256(questions_path),
            "ks": list(KS), "scored": len(scored), "skipped": skipped, "methods": methods}


def summary_table(report: dict) -> str:
    lines = [f"{'method':<24} " + " ".join(f"{'R@' + str(k):>6}" for k in KS) + f" {'chars@10':>9}"]
    for name, m in report["methods"].items():
        if not m["available"]:
            lines.append(f"{name:<24} unavailable: {m['reason']}")
            continue
        lines.append(f"{name:<24} " + " ".join(f"{m[f'recall@{k}']:>6.3f}" for k in KS) + f" {m['chars@10']:>9.0f}")
    return "\n".join(lines)


def _rel(path: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def write_report(report: dict, path: Path, force: bool) -> None:
    if path.exists() and not force:
        raise SystemExit(f"{_rel(path)} exists; pass --force to replace it")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(dumps(report))
    os.replace(tmp, path)


def dumps(report: dict) -> str:
    return json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--expected", type=Path, default=DEFAULT_EXPECTED, help="expected-rules draft set")
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS, help="the multiple-choice set")
    parser.add_argument("--methods", default="", help="comma-separated methods (default: every method)")
    parser.add_argument("--query-form", choices=list(QUERY_FORMS), default="question-choices")
    parser.add_argument("--name", default="", help="also write <reports-dir>/<name>.json")
    parser.add_argument("--reports-dir", type=Path, default=REPORTS_DIR)
    parser.add_argument("--force", action="store_true", help="replace an existing report of this name")
    parser.add_argument("--quiet", action="store_true", help="print the summary table instead of the JSON")
    args = parser.parse_args(argv)
    if args.name and not RUN_NAME_RE.match(args.name):
        parser.error("--name must be letters, digits, '.', '_' or '-', starting with a letter or digit")
    wanted = [m.strip() for m in args.methods.split(",") if m.strip()] or None
    report = build_report(args.expected, args.questions, wanted, args.query_form)
    if args.name:
        write_report(report, args.reports_dir / f"{args.name}.json", args.force)
    if args.quiet:
        print(summary_table(report))
        if args.name:
            print(f"wrote {_rel(args.reports_dir / (args.name + '.json'))}")
    else:
        sys.stdout.write(dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
