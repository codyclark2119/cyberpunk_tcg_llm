"""The gameplay Golden Rules (rules 2.1-2.10.2) as one compact block for the system prompt.

Why: on 2026-11-13 the 8B 4-bit model scored 30-31 of 40 on mixed quizzes, and
in 8 of 10 repeated misses the answering rule was already in its context. It
treated effect text as a cost, read "the rules do not explicitly permit it" as
No, and missed that card text beats the rules. The Golden Rules (section 2) say
those things directly, so prompt ``assistant-chat-v7`` puts them in front of
the model on every question, read from the committed snapshot rather than
paraphrased.

The cut is structural. Section 2's children are unnumbered subsection headings
("Resolve as Much as Possible", ..., "Negative Numbers", "Respect Your Rival");
the numbered rules hang under them. Every rule under the headings before
``STOP_HEADING`` is gameplay; "Respect Your Rival" (2.11 onward) is conduct:
civility, personal space and hygiene, which answer no rules question. The
selection must equal ``GOLDEN_RULE_IDS`` exactly, so a snapshot refresh that
adds, removes or reorders a Golden Rule, or moves the conduct heading, fails
loudly here instead of quietly changing the prompt. EXAMPLE blocks are dropped
(they are the bulk of the text and the model reads rules, not stories); each
rule keeps its own id prefix so the model can cite it.

Fail-closed: a missing section, a missing stop heading, a selection that is not
the pinned list, or EXAMPLE text that survives stripping raises ``ValueError``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterable

from games.cyberpunk.config import RULES_PATH
from harness.core.io import read_jsonl

SECTION_ID = "2"
SECTION_TITLE = "GOLDEN RULES"
STOP_HEADING = "Respect Your Rival"
GOLDEN_RULE_IDS = ("2.1", "2.1.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.10.1",
                   "2.10.2")
HEADER = "Golden Rules (Comprehensive Rules 2.1-2.10.2, examples omitted):"


def strip_examples(text: str) -> str:
    """The rule text without its ``> **EXAMPLE:**`` paragraphs, whitespace collapsed to one line."""
    kept = [p for p in text.split("\n\n") if not p.lstrip().startswith(">")]
    line = " ".join(" ".join(kept).split())
    if "EXAMPLE" in line:
        raise ValueError(f"EXAMPLE text survived stripping: {line[:80]!r}")
    return line


def select(rows: Iterable[dict]) -> list[dict]:
    """The gameplay Golden Rules in file order: every rule under section 2's headings before ``STOP_HEADING``."""
    rows = list(rows)
    section = [r for r in rows if r.get("id") == SECTION_ID]
    if len(section) != 1 or section[0].get("title") != SECTION_TITLE:
        raise ValueError(f"rule section {SECTION_ID} ({SECTION_TITLE}) is missing or not unique")
    headings = [r for r in rows if r.get("parent") == SECTION_ID]
    titles = [h.get("text") for h in headings]
    if titles.count(STOP_HEADING) != 1:
        raise ValueError(f"section {SECTION_ID} has no single {STOP_HEADING!r} heading to cut at: {titles}")
    gameplay = {h["id"] for h in headings[:titles.index(STOP_HEADING)]}
    kept: set[str] = set(gameplay)
    selected = []
    for row in rows:  # file order is document order; a child always follows its parent
        if row.get("parent") in kept:
            kept.add(row["id"])
            if row.get("kind") == "rule":
                selected.append(row)
    ids = tuple(r["id"] for r in selected)
    if ids != GOLDEN_RULE_IDS:
        raise ValueError(f"Golden Rules selection changed: expected {GOLDEN_RULE_IDS}, got {ids}")
    return selected


def golden_rules_block(rows: Iterable[dict]) -> str:
    """The header line and one line per Golden Rule, each starting with its own id."""
    lines = [HEADER]
    for row in select(rows):
        text = strip_examples(row["text"])
        if not text.startswith(row["id"] + ". "):
            raise ValueError(f"rule {row['id']} text does not start with its id: {text[:40]!r}")
        lines.append(text)
    return "\n".join(lines)


@lru_cache(maxsize=1)
def snapshot_block() -> str:
    """The block built from the committed ``data/processed/rules.jsonl``."""
    return golden_rules_block(read_jsonl(RULES_PATH))
