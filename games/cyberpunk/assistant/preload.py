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

Then, since 2026-11-13, ``get_rule`` on up to three rules the data itself
connects to what was sent (``implied_rules``: a hit's short sub-rules, one hop
along the "See X" links, the rules for each linked card's type). Quiz question
09 asks whether a Unit played this turn can attack and never says "lag"; its
search finds 9.3.1, whose sub-rule 9.3.1.1 says "Lagging Units can't attack.
See Lag." and links to the Lag entry 11.3. These steps come last, in what is
left of the budget, and are traced with ``implied``.

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

from games.cyberpunk.assistant.retrieval import tokens
from games.cyberpunk.assistant.tools import _is_numbered, call_tool, cards, rule_children, rules_by_id

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


# Implied rules ---------------------------------------------------------------------------

ALL_IMPLIED_KINDS = ("children", "see", "card_type")
# What ``implied_rules`` follows by default: all three. Measured on the quiz draft (2026-11-13,
# ``scripts/eval_retrieval.py --preload``), each alone and together; all three gave the highest coverage
# of the expected rules (0.634 against 0.611 without expansion) and none lowered recall. See the README.
IMPLIED_KINDS = ALL_IMPLIED_KINDS
MAX_IMPLIED = 3          # get_rule steps the expansion may add
CHILD_MAX_CHARS = 300    # a sub-rule this short is one statement ("9.3.1.1. Lagging Units can't attack. See Lag.")


def _card_type_rules(card_type: str) -> list[str]:
    """The numbered rules directly under the one heading titled with ``card_type``'s plural ("Units").

    The rules document has one such heading per card type (section 4, CARD TYPES); a type with no
    heading, or more than one, adds nothing.
    """
    want = tokens(card_type)
    found = [r["id"] for r in rules_by_id().values()
             if r.get("doc", "comprehensive") == "comprehensive" and r["kind"] == "section"
             and r.get("parent") and tokens(r["title"]) == want]
    if len(found) != 1:
        return []
    return [c for c in rule_children().get(found[0], ()) if c in rules_by_id() and _is_numbered(c)]


def implied_rules(rule_ids: list[str], card_types: list[str] = (), *,
                  kinds: tuple[str, ...] = IMPLIED_KINDS, limit: int = MAX_IMPLIED) -> list[tuple[str, dict]]:
    """Rules the data itself connects to ``rule_ids`` (search hits, best first), as (rule id, why).

    Only relations stored in the rules rows are followed, never the question:

      - ``children``: a hit's direct sub-rules of at most ``CHILD_MAX_CHARS``
        characters, in document order (9.3.1 "Choose a friendly ready Unit ...
        that can attack" -> 9.3.1.1 "Lagging Units can't attack. See Lag.");
      - ``see``: one hop along the ``refs`` of a hit or of such a child -- the
        "See Lag" links the rules text writes, which point at the glossary
        entry (9.3.1.1 -> 11.3 "### Lag"); the target's own refs are not
        followed, and a link to a whole section or an unnumbered heading is
        skipped (get_rule reads numbered rules);
      - ``card_type``: for each linked card's type, the rules under the one
        heading named for it (Unit -> 4.6-4.8, "Units enter the field with
        Lag").

    Each hit is expanded in turn (its children, each child's refs, then its
    own refs) before the next; card types come last. An id already among the
    hits or already added is skipped. At most ``limit`` ids. Deterministic: the
    order is the hits' order and the document's.
    """
    known = rules_by_id()
    seen = set(rule_ids)
    out: list[tuple[str, dict]] = []

    def add(rule_id: str, why: dict) -> None:
        # get_rule takes rule numbers only; a whole section ("See ATTACK, FIGHT, AND STEAL") is a chapter,
        # not a rule, and an unnumbered heading has no number to ask for.
        if (rule_id in known and rule_id not in seen and len(out) < limit and _is_numbered(rule_id)
                and known[rule_id]["kind"] != "section"):
            seen.add(rule_id)
            out.append((rule_id, why))

    for hit in rule_ids:
        if hit not in known:
            continue
        if "children" in kinds:
            for child in rule_children().get(hit, ()):
                if child in known and len(known[child]["text"]) <= CHILD_MAX_CHARS:
                    add(child, {"via": "sub-rule", "of": hit})
                    if "see" in kinds:
                        for ref in known[child].get("refs") or ():
                            add(ref, {"via": "see", "of": child})
        if "see" in kinds:
            for ref in known[hit].get("refs") or ():
                add(ref, {"via": "see", "of": hit})
    if "card_type" in kinds:
        for card_type in dict.fromkeys(card_types):
            for rule_id in _card_type_rules(card_type):
                add(rule_id, {"via": "card type", "of": card_type})
    return out


@dataclass
class AutoStep:
    tool: str
    arguments: dict
    result: dict
    elapsed_ms: float
    link: dict | None = None
    implied: dict | None = None  # for an implied-rule step: why the data connects it (``implied_rules``)
    content: str | None = None   # the tool message, when sent
    note: str | None = None      # what fitting changed, or why it was not sent
    sources: dict = field(default_factory=lambda: {k: [] for k in SOURCE_KEYS})

    @property
    def sent(self) -> bool:
        return self.content is not None


def _run(tool: str, arguments: dict, link: dict | None = None, implied: dict | None = None) -> AutoStep:
    started = time.monotonic()
    result = call_tool(tool, arguments)
    return AutoStep(tool, arguments, result, round((time.monotonic() - started) * 1000, 2), link, implied)


def _fit(steps: list[AutoStep], remaining: int) -> int:
    for step in steps:
        if not step.result.get("ok"):
            step.note = "tool error; not sent"
            continue
        content, step.note, sources = fit_result(step.result, remaining)
        if content is None:
            continue
        step.content, step.sources = content, sources
        remaining -= len(content)
    return remaining


def preload(text: str, *, k: int = DEFAULT_PRELOAD_K, budget: int = DEFAULT_PRELOAD_CHARS,
            implied: tuple[str, ...] = IMPLIED_KINDS, cards: list[str] | None = None) -> list[AutoStep]:
    """Run the automatic steps for ``text`` and fit their results into ``budget`` characters, in order.

    ``cards`` (slugs), when given, replaces the card-name linker: ``get_card`` runs on exactly those
    slugs, in order, each traced with ``link: {"slugs": [slug], "given": true}``. The eval passes an
    item's linked cards here (the official test names the card it means, where a name can be shared);
    ``[]`` means no card steps at all. None (the default, and always in chat) links names as above.

    After the search and the card steps, ``get_rule`` runs on each rule
    ``implied_rules`` connects to the search hits that were sent (and, with
    ``card_type``, to the sent cards' types), in that order, in what is left
    of the budget. ``implied=()`` turns the expansion off.
    """
    steps = [_run("search_rules", {"query": text.strip()[:SEARCH_QUERY_MAX], "k": k})]
    if cards is not None:  # the cards the item links, instead of the name linker
        for slug in cards:
            steps.append(_run("get_card", {"slug": slug}, {"slugs": [slug], "given": True}))
    else:
        for link in link_cards(text):
            info = {"span": link.span, "slugs": list(link.slugs), "ambiguous": link.ambiguous}
            if link.ambiguous:
                steps.append(_run("find_card", {"query": link.span}, info))
            else:
                steps.append(_run("get_card", {"slug": link.slugs[0]}, info))
    remaining = _fit(steps, budget)
    if not implied:
        return steps
    hits = [i for s in steps if s.tool == "search_rules" and s.sent for i in s.sources["rule_ids"]]
    types = [s.result["result"]["card"]["card_type"] for s in steps if s.tool == "get_card" and s.sent]
    extra = [_run("get_rule", {"rule_id": rule_id}, implied=why)
             for rule_id, why in implied_rules(hits, types, kinds=implied)]
    _fit(extra, remaining)
    return steps + extra
