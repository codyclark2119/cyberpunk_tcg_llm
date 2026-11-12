"""Multiple-choice eval sets, their review notes and scored runs: the read side shared by the scorer and the page.

A multiple-choice set is a gold file under ``data/gold/`` (see
``data/gold/SCHEMA.md``): one question per line with lettered ``choices``, a
``correct`` letter or null (null = unscored) and ``known_incorrect`` letters. A
person wrote and keyed it, so nothing here ever writes to ``data/gold/``.

Review notes live beside the runs, in ``eval/notes/<set stem>.jsonl`` (one
``{"id", "note"}`` row per question), written atomically with
``write_jsonl_atomic``. A run is ``eval/runs/<name>.jsonl`` written by
``scripts/eval_assistant.py``: a header row, one row per question and a summary
row. ``load_mc_set`` validates strictly, so a malformed set fails before any
model time is spent on it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from games.cyberpunk.config import REPO_ROOT
from harness.core.io import file_sha256, read_jsonl, write_jsonl_atomic

GOLD_DIR = REPO_ROOT / "data/gold"
RUNS_DIR = REPO_ROOT / "eval/runs"
NOTES_DIR = REPO_ROOT / "eval/notes"
SET_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.jsonl$")
RUN_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
LETTER_RE = re.compile(r"^[A-Z]$")
MAX_NOTE_CHARS = 4000
OUTCOMES = ("correct", "wrong", "unanswered", "unscored")


class EvalSetError(ValueError):
    """A set file that is not a valid multiple-choice set."""


def load_mc_set(path: Path) -> list[dict]:
    """Every item of a multiple-choice set, validated; raises ``EvalSetError`` on any defect."""
    try:
        rows = read_jsonl(Path(path), missing_ok=False)
    except (OSError, ValueError) as exc:
        raise EvalSetError(f"{Path(path).name}: unreadable: {exc}") from None
    if not rows:
        raise EvalSetError(f"{Path(path).name}: no items")
    seen = set()
    for n, row in enumerate(rows, 1):
        where = f"{Path(path).name} line {n}"
        if not isinstance(row, dict):
            raise EvalSetError(f"{where}: not an object")
        item_id = row.get("id")
        if not isinstance(item_id, str) or not item_id or item_id in seen:
            raise EvalSetError(f"{where}: missing or duplicate id")
        seen.add(item_id)
        if not isinstance(row.get("question"), str) or not row["question"].strip():
            raise EvalSetError(f"{where}: missing question")
        choices = row.get("choices")
        if not isinstance(choices, list) or len(choices) < 2:
            raise EvalSetError(f"{where}: needs at least two choices")
        letters = []
        for choice in choices:
            if (not isinstance(choice, dict) or not isinstance(choice.get("letter"), str)
                    or not LETTER_RE.match(choice["letter"]) or not isinstance(choice.get("text"), str)):
                raise EvalSetError(f"{where}: each choice needs an uppercase letter and text")
            letters.append(choice["letter"])
        if len(set(letters)) != len(letters):
            raise EvalSetError(f"{where}: duplicate choice letter")
        correct = row.get("correct")
        if correct is not None and correct not in letters:
            raise EvalSetError(f"{where}: correct must be one of {letters} or null")
        known = row.get("known_incorrect", [])
        if not isinstance(known, list) or any(k not in letters for k in known) or correct in known:
            raise EvalSetError(f"{where}: known_incorrect must be choice letters other than the key")
    return rows


def list_sets(gold_dir: Path = GOLD_DIR) -> list[dict]:
    """The multiple-choice sets in ``gold_dir`` (files that are not MC sets are skipped)."""
    out = []
    for path in sorted(Path(gold_dir).glob("*.jsonl")):
        if not SET_NAME_RE.match(path.name):
            continue
        try:
            items = load_mc_set(path)
        except EvalSetError:
            continue
        out.append({"name": path.name, "items": len(items),
                    "scored": sum(1 for i in items if i.get("correct") is not None),
                    "sha256": file_sha256(path)})
    return out


def set_path(name: str, gold_dir: Path = GOLD_DIR) -> Path:
    if not isinstance(name, str) or not SET_NAME_RE.match(name):
        raise EvalSetError("not a set name")
    path = Path(gold_dir) / name
    if not path.is_file():
        raise FileNotFoundError(name)
    return path


# Review notes ---------------------------------------------------------------------------------


def notes_path(set_name: str, notes_dir: Path = NOTES_DIR) -> Path:
    if not SET_NAME_RE.match(set_name):
        raise EvalSetError("not a set name")
    return Path(notes_dir) / set_name


def read_notes(set_name: str, notes_dir: Path = NOTES_DIR) -> dict[str, str]:
    rows = read_jsonl(notes_path(set_name, notes_dir))
    return {r["id"]: r["note"] for r in rows if isinstance(r, dict) and isinstance(r.get("id"), str)
            and isinstance(r.get("note"), str)}


def write_note(set_name: str, item_id: str, note: str, *, gold_dir: Path = GOLD_DIR,
               notes_dir: Path = NOTES_DIR) -> dict[str, str]:
    """Set (or, with empty text, remove) one question's note; the sidecar is rewritten atomically."""
    items = load_mc_set(set_path(set_name, gold_dir))
    if item_id not in {i["id"] for i in items}:
        raise KeyError(item_id)
    if not isinstance(note, str) or len(note) > MAX_NOTE_CHARS:
        raise EvalSetError(f"a note is text of at most {MAX_NOTE_CHARS} characters")
    path = notes_path(set_name, notes_dir)
    if Path(gold_dir).resolve() in path.resolve().parents:
        raise EvalSetError("notes never go under the gold directory")
    notes = read_notes(set_name, notes_dir)
    if note.strip():
        notes[item_id] = note
    else:
        notes.pop(item_id, None)
    order = [i["id"] for i in items]
    write_jsonl_atomic(path, [{"id": k, "note": notes[k]} for k in sorted(notes, key=order.index)])
    return notes


# Runs -----------------------------------------------------------------------------------------


def summarize(records: list[dict]) -> dict:
    """Score over scored items, unanswered count and tool-use rate, from a run's item rows."""
    counts = {o: sum(1 for r in records if r.get("outcome") == o) for o in OUTCOMES}
    scored = counts["correct"] + counts["wrong"] + counts["unanswered"]
    used = sum(1 for r in records if r.get("tools_called"))
    return {"items": len(records), "scored": scored, **counts,
            "score": round(counts["correct"] / scored, 4) if scored else None,
            "known_incorrect_hits": sum(1 for r in records if r.get("known_incorrect_hit")),
            "tool_use": used, "tool_use_rate": round(used / len(records), 4) if records else None}


def read_run(name: str, runs_dir: Path = RUNS_DIR) -> list[dict]:
    if not isinstance(name, str) or not name.endswith(".jsonl") or not RUN_NAME_RE.match(name[:-6]):
        raise EvalSetError("not a run name")
    path = Path(runs_dir) / name
    if not path.is_file():
        raise FileNotFoundError(name)
    rows = read_jsonl(path, missing_ok=False)
    if not rows or rows[0].get("kind") != "header":
        raise EvalSetError("first row is not a run header")
    return rows


def list_runs(runs_dir: Path = RUNS_DIR) -> list[dict]:
    out = []
    for path in sorted(Path(runs_dir).glob("*.jsonl")):
        entry: dict = {"name": path.name}
        try:
            rows = read_run(path.name, runs_dir)
            header = rows[0]
            entry.update({k: header.get(k) for k in ("set", "model", "adapter", "thinking", "preload", "fake",
                                                    "eval_prompt_version", "assistant_prompt_version",
                                                    "rules_version")})
            entry["summary"] = summarize([r for r in rows if r.get("kind") == "item"])
        except (EvalSetError, FileNotFoundError, ValueError, AttributeError) as exc:
            entry["error"] = f"unreadable run: {exc}"[:200]
        out.append(entry)
    return out


# Retrieval reports ------------------------------------------------------------------------------
# ``scripts/eval_retrieval.py --name X`` writes ``eval/reports/X.json`` (kind "retrieval-report"): recall of
# each search_rules method against the unreviewed expected-rules draft. Other report kinds in the same
# directory are skipped.

REPORTS_DIR = REPO_ROOT / "eval/reports"
RETRIEVAL_REPORT_KIND = "retrieval-report"
RETRIEVAL_SUMMARY_KEYS = ("recall@1", "recall@5", "recall@10", "coverage@10", "chars@10")


def read_retrieval_report(name: str, reports_dir: Path = REPORTS_DIR) -> dict:
    if not isinstance(name, str) or not name.endswith(".json") or not RUN_NAME_RE.match(name[:-5]):
        raise EvalSetError("not a report name")
    path = Path(reports_dir) / name
    if not path.is_file():
        raise FileNotFoundError(name)
    report = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(report, dict) or report.get("kind") != RETRIEVAL_REPORT_KIND:
        raise EvalSetError("not a retrieval report")
    return report


def list_retrieval_reports(reports_dir: Path = REPORTS_DIR) -> list[dict]:
    """Every retrieval report, newest name last, with each method's recall (or why it was unavailable)."""
    out = []
    for path in sorted(Path(reports_dir).glob("*.json")):
        try:
            report = read_retrieval_report(path.name, reports_dir)
        except EvalSetError:
            continue  # another kind of report
        except (OSError, ValueError) as exc:
            out.append({"name": path.name, "error": f"unreadable report: {exc}"[:200]})
            continue
        methods = {}
        for method, m in (report.get("methods") or {}).items():
            methods[method] = ({k: m.get(k) for k in RETRIEVAL_SUMMARY_KEYS} | {"available": True}
                               if m.get("available") else {"available": False, "reason": m.get("reason")})
        out.append({"name": path.name, "rules_version": report.get("rules_version"),
                    "query_form": report.get("query_form"), "expected_set": report.get("expected_set"),
                    "expected_status": report.get("expected_status"), "scored": report.get("scored"),
                    "methods": methods})
    return out
