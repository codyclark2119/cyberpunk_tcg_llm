"""The automatic context step: tool results the model sees before it speaks.

Why: the quiz diagnosis (2026-11-12) found the 8B model often answered rules
questions without calling a tool, or called the wrong one, and then answered
from "memory" of a game it has never seen. So before the first model turn the
loop runs two things itself and puts their results in the conversation as tool
messages:

  - ``search_rules`` on the question text (``k`` configurable, default 5);
  - card linking: every span of the text that exactly matches a card's display
    name or name in the snapshot (longest match first, case-insensitive,
    punctuation-normalised, non-overlapping). A span naming exactly one card
    runs ``get_card`` on its slug; a shared name ("V" names three cards) runs
    ``find_card`` on the span, so the model gets the candidates and never a
    guess.

This is entity linking over data. Nothing here reads what the question means:
two questions naming the same cards in the same order get the same card steps
whatever else they say, and nothing outside the linker and the search query
looks at the text at all.

Results are added in order (rules first, then cards in the order they appear)
while they fit a character budget. A result first loses fields that carry no
rules content (``printings``, ``text_markup``, image URLs) and, when still too
long, its longest top-level list of records (search passages, name matches) is
shortened from the end, with the ids it no longer shows taken out of its
sources; one that still does not fit is not sent and is marked so in the trace. A sent result is
always whole JSON, never cut mid-string, so an erratum is never half-shown.
"""

from __future__ import annotations

import copy
import json
import re
import time
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache

from games.cyberpunk.assistant.tools import call_tool, cards

DEFAULT_PRELOAD_K = 5
DEFAULT_PRELOAD_CHARS = 8000
MAX_CARD_LINKS = 6
SEARCH_QUERY_MAX = 500  # search_rules' own maxLength
DROP_KEYS = ("printings", "text_markup", "image_url")
NEVER_TRIM = ("errata",)
SOURCE_KEYS = ("card_slugs", "rule_ids", "errata_ids", "deck_ids", "chunk_ids")
WORD_RE = re.compile(r"[^\W_]+")


def _fold(word: str) -> str:
    decomposed = unicodedata.normalize("NFKD", word)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def words(text: str) -> list[tuple[str, int, int]]:
    """(folded word, start, end) for each run of letters and digits; punctuation and spacing separate words."""
    return [(_fold(m.group()), m.start(), m.end()) for m in WORD_RE.finditer(text)]


@lru_cache(maxsize=1)
def name_index() -> dict[tuple[str, ...], tuple[str, ...]]:
    """Word tuple of every card's display name and name -> the slugs carrying it (sorted)."""
    index: dict[tuple[str, ...], set[str]] = {}
    for card in cards():
        for name in (card["display_name"], card["name"]):
            key = tuple(w for w, _, _ in words(name))
            if key:
                index.setdefault(key, set()).add(card["id"])
    return {key: tuple(sorted(slugs)) for key, slugs in index.items()}


@dataclass(frozen=True)
class Link:
    span: str               # the text as the user wrote it
    start: int
    slugs: tuple[str, ...]  # every card the span names; more than one means ambiguous

    @property
    def ambiguous(self) -> bool:
        return len(self.slugs) > 1


def link_cards(text: str, max_links: int = MAX_CARD_LINKS) -> list[Link]:
    """Card-name spans of ``text``: longest first, non-overlapping, returned in reading order.

    A name linked twice (or two spans resolving to the same slugs) is linked once.
    """
    index = name_index()
    longest = max((len(k) for k in index), default=0)
    found = words(text)
    candidates = []
    for i in range(len(found)):
        for length in range(min(longest, len(found) - i), 0, -1):
            key = tuple(w for w, _, _ in found[i:i + length])
            if key in index:
                candidates.append((length, i, index[key]))
                break  # the longest match at this start; shorter ones would only overlap it
    taken: set[int] = set()
    accepted = []
    for length, i, slugs in sorted(candidates, key=lambda c: (-c[0], c[1])):
        positions = set(range(i, i + length))
        if positions & taken:
            continue
        taken |= positions
        accepted.append(Link(text[found[i][1]:found[i + length - 1][2]], found[i][1], slugs))
    links, seen = [], set()
    for link in sorted(accepted, key=lambda l: l.start):
        if link.slugs in seen:
            continue
        seen.add(link.slugs)
        links.append(link)
    return links[:max_links]


def _drop_keys(value):
    """``value`` without ``DROP_KEYS`` at any depth, and whether anything was dropped."""
    dropped = False
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key in DROP_KEYS:
                dropped = True
                continue
            out[key], inner = _drop_keys(item)
            dropped = dropped or inner
        return out, dropped
    if isinstance(value, list):
        out = []
        for item in value:
            kept, inner = _drop_keys(item)
            out.append(kept)
            dropped = dropped or inner
        return out, dropped
    return value, False


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _trimmable_list(result) -> list | None:
    """The longest list of records (two or more) directly under ``result``, other than ``NEVER_TRIM``.

    Only a top-level list of records is shortened (search passages, name
    matches, cards found): a nested list is part of one fact (a card's
    classifications), and errata are never dropped from the card they correct.
    """
    if not isinstance(result, dict):
        return None
    lists = [v for k, v in result.items() if k not in NEVER_TRIM and isinstance(v, list) and len(v) > 1
             and all(isinstance(item, dict) for item in v)]
    return max(lists, key=lambda v: len(_dumps(v)), default=None)


def sent_sources(data: dict) -> dict:
    """The ids of ``data["sources"]`` still named elsewhere in ``data`` (a shortened list drops its ids)."""
    body = _dumps({key: value for key, value in data.items() if key != "sources"})
    sources = data.get("sources") or {}
    return {key: [v for v in (sources.get(key) or []) if _dumps(v) in body] for key in SOURCE_KEYS}


def fit_result(result: dict, budget: int) -> tuple[str | None, str | None, dict]:
    """(tool-message JSON within ``budget`` chars or None, a note on what changed or None, the sources sent)."""
    data, dropped = _drop_keys(copy.deepcopy(result))
    omitted = 0
    while True:
        notes = ([f"dropped {', '.join(DROP_KEYS)}"] if dropped else []) + (
            [f"left out the last {omitted} list item(s)"] if omitted else [])
        if notes:
            data["context_note"] = ("Shortened for context: " + "; ".join(notes)
                                    + ". Call the tool for the full result.")
        if omitted:
            data["sources"] = sent_sources(data)
        content = _dumps(data)
        if len(content) <= budget:
            return content, ("; ".join(notes) or None), sent_sources(data)
        target = _trimmable_list(data.get("result"))
        if target is None:
            return None, "does not fit the context budget; not sent", {k: [] for k in SOURCE_KEYS}
        target.pop()
        omitted += 1


@dataclass
class AutoStep:
    tool: str
    arguments: dict
    result: dict
    elapsed_ms: float
    link: dict | None = None
    content: str | None = None   # the tool message, when sent
    note: str | None = None      # what fitting changed, or why it was not sent
    sources: dict = field(default_factory=lambda: {k: [] for k in SOURCE_KEYS})

    @property
    def sent(self) -> bool:
        return self.content is not None


def _run(tool: str, arguments: dict, link: dict | None = None) -> AutoStep:
    started = time.monotonic()
    result = call_tool(tool, arguments)
    return AutoStep(tool, arguments, result, round((time.monotonic() - started) * 1000, 2), link)


def preload(text: str, *, k: int = DEFAULT_PRELOAD_K, budget: int = DEFAULT_PRELOAD_CHARS) -> list[AutoStep]:
    """Run the automatic steps for ``text`` and fit their results into ``budget`` characters, in order."""
    steps = [_run("search_rules", {"query": text.strip()[:SEARCH_QUERY_MAX], "k": k})]
    for link in link_cards(text):
        info = {"span": link.span, "slugs": list(link.slugs), "ambiguous": link.ambiguous}
        if link.ambiguous:
            steps.append(_run("find_card", {"query": link.span}, info))
        else:
            steps.append(_run("get_card", {"slug": link.slugs[0]}, info))
    remaining = budget
    for step in steps:
        if not step.result.get("ok"):
            step.note = "tool error; not sent"
            continue
        content, step.note, sources = fit_result(step.result, remaining)
        if content is None:
            continue
        step.content, step.sources = content, sources
        remaining -= len(content)
    return steps
