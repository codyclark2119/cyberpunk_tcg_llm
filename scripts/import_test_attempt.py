#!/usr/bin/env python3
"""Import an attempt at the official Cyberpunk TCG test as a multiple-choice gold set.

Why: the official test site ("Level 1 Basic Test") is the one external measure of
rules knowledge this game has, and it is written by the publisher, not by us. After
a submission it returns the attempt as JSON: every question's exact wording, its
options, the cards it links (by slug, so "Adam Smasher" names one card, not three)
and whether each submitted answer was right. It does not return the answer key or
the answers given. With the submitted answers (saved separately, one "N. X" line
per question, letters by option order), the flags recover the key:

  - a right answer is the key;
  - a wrong answer to a two-option question makes the other option the key, and the
    answer given goes in ``known_incorrect``;
  - a wrong answer with more options only rules that option out: the item is
    unscored (``correct: null``) with that option in ``known_incorrect``.

Letters are by option order (A is the first option), never by option id: the site's
ids are not letters (question 15 of the 2026-11-13 attempt uses "yes"/"no" as the
ids of "-1" and "0").

Everything is checked and fails closed: the attempt's shape, one answer per
question, each answer letter in range, every linked slug present in
``data/processed/card_database.jsonl`` (an unknown slug is an error naming it), and
the number of ``correct: true`` flags against ``result.correct_count``. Prompt and
option text are kept exactly as given; text carrying an HTML entity (``&#39;``,
``&quot;``) is refused, since it means a chat copy that was not decoded.

``--merge`` adds a later attempt to an existing set. A question already present (same
question uuid) must have the same text and options; its key must agree, or is filled
in where one attempt left it unscored. A conflict is an error and nothing is written.
Without ``--merge`` an existing output file is replaced only when the new bytes are
identical or with ``--force``. Output is deterministic (same input, same bytes) and
written with ``write_jsonl_atomic``.

It also prints how many of the attempt's questions each other gold set in the output
directory already holds, by normalised text (case, spacing, quotes and the keyword
brackets the chat copies lost). That is a report; it never fails.

The set is eval-only: never train on it.

Usage:
    python scripts/import_test_attempt.py \\
        --attempt data/raw/official_tests/official-test-attempt-2026-11-13.raw.json \\
        --answers data/raw/official_tests/official-test-attempt-2026-11-13.answers.txt \\
        --out data/gold/official_basic_test.jsonl
    python scripts/import_test_attempt.py --attempt <next>.raw.json --answers <next>.answers.txt \\
        --out data/gold/official_basic_test.jsonl --merge
    python scripts/import_test_attempt.py --attempt a.json --answers "A B A ..." --out x.jsonl
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.config import CARD_DATABASE_PATH  # noqa: E402
from harness.core.io import guard_shrink, read_jsonl, write_jsonl_atomic  # noqa: E402

ANSWER_KEY_BY = "official test result (Cody's attempt)"
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ENTITY_RE = re.compile(r"&(#\d+|#x[0-9a-fA-F]+|[A-Za-z]+);")
ANSWER_LINE_RE = re.compile(r"^\s*(\d+)\s*[.)]\s*([A-Za-z])\s*$")
INLINE_RE = re.compile(r"^[A-Za-z]([\s,]+[A-Za-z])*$")
QUESTION_KEYS = {"id", "kind", "prompt", "options", "cards", "correct"}


class AttemptError(ValueError):
    """An attempt, answer list or merge that cannot be imported."""


def _fail(message: str):
    raise AttemptError(message)


# Inputs -----------------------------------------------------------------------------------------


def parse_answers(text: str) -> list[str]:
    """The submitted letters, in question order, from "N. X" lines or an inline "A B C" list."""
    stripped = text.strip()
    if INLINE_RE.match(stripped):
        return [c.upper() for c in re.findall(r"[A-Za-z]", stripped)]
    letters = []
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        m = ANSWER_LINE_RE.match(line)
        if not m:
            _fail(f"answers line {n}: expected 'N. X', got {line.strip()!r}")
        if int(m.group(1)) != len(letters) + 1:
            _fail(f"answers line {n}: question {m.group(1)} out of order (expected {len(letters) + 1})")
        letters.append(m.group(2).upper())
    if not letters:
        _fail("no answers")
    return letters


def read_answers(value: str) -> list[str]:
    path = Path(value)
    if not INLINE_RE.match(value.strip()) or path.is_file():
        try:
            return parse_answers(path.read_text(encoding="utf-8"))
        except OSError as exc:
            _fail(f"cannot read answers file {value}: {exc}")
    return parse_answers(value)


def card_ids(path: Path = CARD_DATABASE_PATH) -> set[str]:
    return {row["id"] for row in read_jsonl(Path(path), missing_ok=False)}


def _text(value, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{where}: missing text")
    entity = ENTITY_RE.search(value)
    if entity:
        _fail(f"{where}: carries the HTML entity {entity.group()!r}; decode the saved attempt first")
    return value


def check_attempt(doc) -> dict:
    """The attempt object, its shape checked; raises ``AttemptError`` on any defect."""
    if not isinstance(doc, dict) or set(doc) != {"attempt"} or not isinstance(doc["attempt"], dict):
        _fail('the file must be {"attempt": {...}}')
    attempt = doc["attempt"]
    if not isinstance(attempt.get("id"), str) or not UUID_RE.match(attempt["id"]):
        _fail("attempt.id must be a uuid")
    if not isinstance(attempt.get("level"), int) or isinstance(attempt.get("level"), bool):
        _fail("attempt.level must be a number")
    if attempt.get("status") != "submitted":
        _fail(f"attempt.status is {attempt.get('status')!r}, not 'submitted'")
    result = attempt.get("result")
    if not isinstance(result, dict):
        _fail("attempt.result missing: the attempt was not scored")
    for key in ("correct_count", "scored_count", "pass_percent"):
        if not isinstance(result.get(key), int) or isinstance(result.get(key), bool):
            _fail(f"attempt.result.{key} must be a number")
    if not 1 <= result["pass_percent"] <= 100:
        _fail("attempt.result.pass_percent must be 1..100")
    questions = attempt.get("questions")
    if not isinstance(questions, list) or not questions:
        _fail("attempt.questions must be a non-empty list")
    if result["scored_count"] != len(questions):
        _fail(f"result.scored_count {result['scored_count']} != {len(questions)} questions")
    seen, prefixes = set(), set()
    for n, q in enumerate(questions, 1):
        where = f"question {n}"
        if not isinstance(q, dict) or set(q) != QUESTION_KEYS:
            _fail(f"{where}: expected exactly the keys {sorted(QUESTION_KEYS)}")
        if not isinstance(q["id"], str) or not UUID_RE.match(q["id"]) or q["id"] in seen:
            _fail(f"{where}: id must be a unique uuid")
        if q["id"][:8] in prefixes:
            _fail(f"{where}: id prefix {q['id'][:8]} repeats; item ids would collide")
        seen.add(q["id"])
        prefixes.add(q["id"][:8])
        if q["kind"] != "multiple_choice":
            _fail(f"{where}: kind {q['kind']!r} is not multiple_choice")
        _text(q["prompt"], where)
        options = q["options"]
        if not isinstance(options, list) or not 2 <= len(options) <= len(LETTERS):
            _fail(f"{where}: needs 2..26 options")
        for o in options:
            if not isinstance(o, dict) or set(o) != {"id", "text"} or not isinstance(o["id"], str) or not o["id"]:
                _fail(f"{where}: each option is {{id, text}}")
            _text(o["text"], f"{where} option {o['id']}")
        if len({o["id"] for o in options}) != len(options):
            _fail(f"{where}: duplicate option id")
        if not isinstance(q["cards"], list):
            _fail(f"{where}: cards must be a list")
        for link in q["cards"]:
            if (not isinstance(link, dict) or set(link) != {"text", "cards"} or not isinstance(link["text"], str)
                    or not isinstance(link["cards"], list) or not link["cards"]):
                _fail(f"{where}: each card link is {{text, cards: [...]}}")
            for card in link["cards"]:
                if not isinstance(card, dict) or not isinstance(card.get("slug"), str) or not card["slug"]:
                    _fail(f"{where}: each linked card needs a slug")
        if not isinstance(q["correct"], bool):
            _fail(f"{where}: correct must be true or false")
    flagged = sum(1 for q in questions if q["correct"])
    if flagged != result["correct_count"]:
        _fail(f"{flagged} questions are flagged correct but result.correct_count is {result['correct_count']}")
    return attempt


# Rows ---------------------------------------------------------------------------------------------


def derive_key(n_options: int, submitted: str, correct: bool) -> tuple[str | None, list[str]]:
    """(key letter or None, known_incorrect) from one submitted letter and its correct flag."""
    if correct:
        return submitted, []
    if n_options == 2:
        return ("B" if submitted == "A" else "A"), [submitted]
    return None, [submitted]


def build_rows(doc, answers: list[str], known_cards: set[str]) -> list[dict]:
    """The gold rows for one attempt, in question order."""
    attempt = check_attempt(doc)
    questions = attempt["questions"]
    if len(answers) != len(questions):
        _fail(f"{len(answers)} answers for {len(questions)} questions")
    submitted_on = str(attempt["result"].get("submitted_at") or "")[:10]
    source = (f"official Level {attempt['level']} {attempt.get('level_name') or 'test'}, attempt {attempt['id']}"
              + (f" (submitted {submitted_on})" if submitted_on else ""))
    rows = []
    for n, (q, letter) in enumerate(zip(questions, answers), 1):
        letters = list(LETTERS[:len(q["options"])])
        if letter not in letters:
            _fail(f"answer {n}: {letter!r} is not one of {letters}")
        slugs = []
        for link in q["cards"]:
            for card in link["cards"]:
                if card["slug"] not in known_cards:
                    _fail(f"question {n}: linked card {card['slug']!r} is not in the card database")
                if card["slug"] not in slugs:
                    slugs.append(card["slug"])
        key, known = derive_key(len(letters), letter, q["correct"])
        rows.append({
            "id": f"official-{q['id'][:8]}", "question": q["prompt"],
            "choices": [{"letter": l, "text": o["text"]} for l, o in zip(letters, q["options"])],
            "correct": key, "known_incorrect": known, "source": source, "answer_key_by": ANSWER_KEY_BY,
            "cards": slugs,
            "official": {"attempt_id": attempt["id"], "question_id": q["id"], "level": attempt["level"],
                         "option_ids": [o["id"] for o in q["options"]],
                         "pass_percent": attempt["result"]["pass_percent"]},
        })
    return rows


def merge_rows(existing: list[dict], new: list[dict]) -> list[dict]:
    """``existing`` with ``new`` merged in: known questions reconciled in place, new ones appended."""
    out = [json.loads(json.dumps(r)) for r in existing]
    by_qid = {}
    for row in out:
        official = row.get("official")
        if not isinstance(official, dict) or not isinstance(official.get("question_id"), str):
            _fail(f"existing row {row.get('id')!r} has no official.question_id; not an official-test set")
        by_qid[official["question_id"]] = row
    ids = {r["id"] for r in out}
    for row in new:
        qid = row["official"]["question_id"]
        old = by_qid.get(qid)
        if old is None:
            if row["id"] in ids:
                _fail(f"{row['id']}: id already used by another question")
            out.append(row)
            ids.add(row["id"])
            by_qid[qid] = row
            continue
        where = f"{old['id']} (question {qid})"
        if old["question"] != row["question"] or old["choices"] != row["choices"]:
            _fail(f"{where}: text or options differ between attempts")
        if old["official"].get("option_ids") != row["official"]["option_ids"]:
            _fail(f"{where}: option ids differ between attempts")
        if old.get("cards") != row["cards"]:
            _fail(f"{where}: linked cards differ between attempts")
        if old["correct"] is not None and row["correct"] is not None and old["correct"] != row["correct"]:
            _fail(f"{where}: key conflict: {old['correct']} in the set, {row['correct']} in this attempt")
        key = old["correct"] if old["correct"] is not None else row["correct"]
        letters = [c["letter"] for c in old["choices"]]
        known = [l for l in letters if l in set(old["known_incorrect"]) | set(row["known_incorrect"])]
        if key in known:
            _fail(f"{where}: key conflict: {key} is keyed by one attempt and marked wrong by another")
        if (key, known) != (old["correct"], old["known_incorrect"]) and row["source"] not in old["source"]:
            old["source"] = f"{old['source']}; {row['source']}"
        old["correct"], old["known_incorrect"] = key, known
    return out


# Overlap ------------------------------------------------------------------------------------------


def normalise(text: str) -> str:
    """Text for overlap matching: entities decoded, typographic quotes and keyword brackets dropped,
    spacing collapsed, case folded."""
    text = unicodedata.normalize("NFKC", html.unescape(text))
    text = text.translate({0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"', ord("["): None, ord("]"): None})
    return " ".join(text.split()).casefold()


def overlap_report(rows: list[dict], gold_dir: Path, exclude: Path | None = None) -> list[tuple[str, int, int]]:
    """(set name, questions of ``rows`` it holds by normalised text, its size) for each other set in ``gold_dir``."""
    ours = {normalise(r["question"]) for r in rows}
    report = []
    for path in sorted(Path(gold_dir).glob("*.jsonl")):
        if exclude is not None and path.resolve() == Path(exclude).resolve():
            continue
        try:
            theirs = read_jsonl(path)
        except (OSError, ValueError):
            continue
        texts = {normalise(r["question"]) for r in theirs if isinstance(r, dict) and isinstance(r.get("question"), str)}
        report.append((path.name, len(ours & texts), len(theirs)))
    return report


# CLI ----------------------------------------------------------------------------------------------


def _serialise(rows: list[dict]) -> bytes:
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows).encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--attempt", required=True, help="the attempt JSON the test site returned")
    parser.add_argument("--answers", required=True,
                        help='the submitted answers: a file of "N. X" lines, or inline letters "A B ..."')
    parser.add_argument("--out", required=True, help="gold set to write, e.g. data/gold/official_basic_test.jsonl")
    parser.add_argument("--merge", action="store_true", help="merge into an existing --out set")
    parser.add_argument("--force", action="store_true", help="replace a different existing --out without --merge")
    parser.add_argument("--card-db", default=str(CARD_DATABASE_PATH), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    out = Path(args.out)
    out = out if out.is_absolute() else REPO_ROOT / out
    try:
        try:
            doc = json.loads(Path(args.attempt).read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            _fail(f"cannot read attempt {args.attempt}: {exc}")
        rows = build_rows(doc, read_answers(args.answers), card_ids(Path(args.card_db)))
        if args.merge:
            if not out.is_file():
                _fail(f"--merge: {out} does not exist")
            rows = merge_rows(read_jsonl(out, missing_ok=False), rows)
    except AttemptError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    data = _serialise(rows)
    if out.is_file() and not args.merge and out.read_bytes() != data and not args.force:
        print(f"error: {out} exists with other content; pass --merge to add this attempt or --force to replace it",
              file=sys.stderr)
        return 1
    guard_shrink(out, len(rows), force=args.force, min_ratio=1.0, what="questions")
    if out.is_file() and out.read_bytes() == data:
        print(f"{out.name}: unchanged")
    else:
        write_jsonl_atomic(out, rows)
        print(f"Wrote {out}")
    keyed = sum(1 for r in rows if r["correct"] is not None)
    unscored = [r["id"] for r in rows if r["correct"] is None]
    print(f"{len(rows)} questions, {keyed} keyed, {len(unscored)} unscored"
          + (f" ({', '.join(unscored)})" if unscored else ""))
    print("Overlap with the other gold sets (by normalised question text):")
    for name, shared, size in overlap_report(rows, out.parent, exclude=out):
        print(f"  {name}: {shared} of these {len(rows)} questions already present ({size} rows in that set)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
