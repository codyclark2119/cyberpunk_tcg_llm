"""The game flow outline: turn order, attack steps, game areas and card states, generated from the rules.

Why: the v5 quiz runs (2026-11-13) missed questions with the right rule already
retrieved, because the models did not know how a game of Cyberpunk TCG moves.
One placed a Legend's ``[DEFEATED]`` trigger inside the React Step (a defeat
happens in the Fight Step, after the React Step has passed, rules 9.14-9.17);
both read "spent" on a Legend as "already on the field" (Legends sit in the
Legends area and are spent there to pay 1 eddie, rule 5.7.2). Those are not
missing rules; they are missing flow. This module gives the model the shape of
the game -- whose turn, which phase, which attack step, which area a card is in
and what its state means -- as an outline of the rules' own lines, each kept
with its rule id so the model can cite it and call ``get_rule`` for the rest.

Nothing here is hand-written game prose. Lines are selected from
``data/processed/rules.jsonl`` by the rule tree's structure:

  - Turn order (section 8) and attack (section 9): every top-level rule, i.e.
    a numbered rule whose parent is the section itself or one of its unnumbered
    subsection headings ("Start Phase", "React Step", ...), grouped under that
    heading in document order. A top-level rule that introduces an ordered
    sequence (its text says "in order" / "in this order") also brings its
    direct children, the steps (8.6.1-8.6.5, 9.3.1-9.3.4, 8.16.1-8.16.2).
    Heading rules ("8.12. ### Call a Legend ...") are shown by their title.
  - Game areas (section 5): each area is a numbered heading under section 5
    ("### Legends Area"). Its direct children are filtered first: lines that
    only give the area another name, say who may see, look at or count it, or
    say it has no size limit (``AREA_SKIP_RE``) are not flow. Of the rest the
    area shows its first line (what it holds) and every later line that says
    what you may or can do there (``AREA_ACTION_RE``: 5.7.2, 5.7.5, 5.7.6).
  - Card states (section 3): the direct children of section 3's "Orientation"
    heading that define a state term (open with the quoted term: face-up,
    face-down, ready, spent), then Lag, reached by following the field area's
    Lag line (5.6.4) along its "See Lag" link to the glossary entry (11.3) and
    taking that entry's whole subtree.

The only names this module pins are in ``ANCHORS``: the four section titles,
the "Orientation" heading, the five attack-step headings in their order and the
Lag link (one rule id, 5.6.4, whose text must still mention Lag and link to an
entry titled "Lag"). Each is checked against the snapshot and a missing or
renamed one raises ``FlowOutlineError`` instead of producing a quietly
different outline; so does an area left with no lines. A snapshot refresh that
moves them has to move this file too.

Each line is ``<id> <text>``: the rule's own text with its number, markdown,
"See ..." cross-references and example blocks removed, keeping whole sentences
while the line fits ``LINE_CHARS``. The first sentence is always kept whole up
to ``FIRST_SENTENCE_CHARS``; only a longer one is cut on a word boundary and
marked with an ellipsis. Why so short: the outline is about 90 lines and
every model step reads it, and rule ids alone cost several tokens each (Qwen
tokenizes digits one at a time), so it is held to about 6,000 characters,
roughly 1,500 tokens; ``get_rule`` has the full text of any line.

The outline is deterministic: same rows in, same text out. It never contains a
card name: it is built from sections 3, 5, 8, 9 and the Lag glossary entry,
none of which names a card (a test checks it against every card name in the
snapshot).

Placement: the outline goes in the system prompt, after the guidance. It is the
same for every question, so it belongs in the fixed prefix; the ``PromptGuard``
never drops the system prompt (it would drop a preloaded tool result), and the
prefix is identical on every model step.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from functools import lru_cache

LINE_CHARS = 90             # per line of rule text, after the id
FIRST_SENTENCE_CHARS = 100  # a first sentence up to this long is kept whole (see ``clean``)

# Every name this module relies on, checked against the snapshot (see the docstring).
ANCHORS = {
    "sections": {"3": "CARD INFORMATION", "5": "GAME AREAS", "8": "TURN ORDER", "9": "ATTACK, FIGHT, AND STEAL"},
    "orientation_heading": "Orientation",
    # The attack's steps in rule order; the outline is meaningless if one is missing or they reorder.
    "attack_steps": ("Declare the Attack", "React Step", "Fight Step", "Steal Step", "Ending an Attack"),
    # The field area's Lag line and the glossary entry it links to ("See Lag").
    "lag_line": "5.6.4",
    "lag_entry_title": "Lag",
}

ORDERED_LIST_RE = re.compile(r"\bin (?:this )?order\b", re.I)
AREA_SKIP_RE = re.compile(r"referred to as|\bpublic\b|\bhidden\b|\bview\b|\blook at\b|know the number|\bno limit\b",
                          re.I)
AREA_ACTION_RE = re.compile(r"\b(?:you may|you can|can[’']t|cannot)\b", re.I)
DEFINITION_RE = re.compile(r"[“\"][^”\"]+[”\"] refers to ")
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z“\"(])")
NUMBER_PREFIX_RE = re.compile(r"^\d+(?:\.\d+)*\.\s*")
HEADING_RE = re.compile(r"^#+\s*")
EXAMPLE_RE = re.compile(r"\n\s*>.*$", re.S)  # a "> **EXAMPLE:**" block after the rule
SEE_RE = re.compile(r"\s*\bSee [^.]*\.")  # "See TURN ORDER > Main Phase." cross-references
MARKDOWN_RE = re.compile(r"[*_`]")
SPACE_RE = re.compile(r"\s+")


class FlowOutlineError(ValueError):
    """The snapshot no longer has a structure the outline relies on."""


def _numbered(rule_id: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+)*", rule_id))


def clean(text: str, limit: int = LINE_CHARS, first_limit: int = FIRST_SENTENCE_CHARS) -> str:
    """One rule's text as an outline line: no number, markdown, example or "See ..." link, cut to fit.

    Whole sentences are kept while the line stays within ``limit`` characters; the
    first sentence is always kept whole up to ``first_limit`` (a rule's first
    sentence is its statement: "... as 1 €$ each, whether face-up or face-down."),
    and only a first sentence longer than that is cut on a word boundary and ends
    in "…". Later sentences that do not fit are dropped unmarked (the outline's
    header says lines keep only their leading sentences).
    """
    text = NUMBER_PREFIX_RE.sub("", text.strip())
    text = EXAMPLE_RE.sub("", text)
    text = HEADING_RE.sub("", text)
    text = SEE_RE.sub("", text)
    text = MARKDOWN_RE.sub("", text)
    text = SPACE_RE.sub(" ", text).strip()
    if len(text) <= limit:
        return text
    sentences = SENTENCE_RE.split(text)
    kept = sentences[0]
    if len(kept) > first_limit:
        kept = kept[:first_limit - 1]
        kept = kept[:kept.rfind(" ")].rstrip(" ,;:.") if " " in kept else kept
    else:  # dropped sentences are not marked: the outline's header says lines keep only leading sentences
        for sentence in sentences[1:]:
            if len(kept) + len(sentence) + 1 > limit:
                break
            kept = f"{kept} {sentence}"
        return kept
    return kept + "…"


def _heading_text(row: dict) -> str:
    """A rule that opens with a heading ('8.11. ### Sell for Turn ...') is shown by its title alone."""
    body = NUMBER_PREFIX_RE.sub("", row["text"].strip())
    return row["title"] if body.startswith("#") else body


class _Tree:
    def __init__(self, rows: Iterable[dict]):
        self.rows = list(rows)
        self.by_id = {r["id"]: r for r in self.rows}
        self.children: dict[str | None, list[dict]] = {}
        for r in self.rows:  # file order is document order
            self.children.setdefault(r.get("parent"), []).append(r)

    def get(self, rule_id: str) -> dict:
        if rule_id not in self.by_id:
            raise FlowOutlineError(f"rule {rule_id} is not in the snapshot")
        return self.by_id[rule_id]

    def kids(self, rule_id: str) -> list[dict]:
        return self.children.get(rule_id, [])


def _line(row: dict) -> str:
    return f"{row['id']} {clean(_heading_text(row))}"


def _check_sections(tree: _Tree) -> None:
    for sid, title in ANCHORS["sections"].items():
        row = tree.get(sid)
        if row.get("title") != title:
            raise FlowOutlineError(f"section {sid} is titled {row.get('title')!r}, expected {title!r}")


def _section_groups(tree: _Tree, sid: str) -> list[tuple[str | None, list[dict]]]:
    """(heading title or None, its top-level rules) for a section, in document order."""
    groups: list[tuple[str | None, list[dict]]] = []
    loose = [r for r in tree.kids(sid) if _numbered(r["id"])]
    if loose:
        groups.append((None, loose))
    for heading in tree.kids(sid):
        if heading["kind"] == "section" and not _numbered(heading["id"]):
            groups.append((heading["title"], [r for r in tree.kids(heading["id"]) if _numbered(r["id"])]))
    return groups


def _steps(tree: _Tree, sid: str, label: str) -> list[str]:
    out = [f"{label} ({sid}):"]
    for title, rows in _section_groups(tree, sid):
        if title:
            out.append(f"[{title}]")
        for row in rows:
            out.append(_line(row))
            if ORDERED_LIST_RE.search(NUMBER_PREFIX_RE.sub("", row["text"]).strip()):
                out.extend(" " + _line(child) for child in tree.kids(row["id"]))
    return out


def _check_attack_steps(tree: _Tree) -> None:
    headings = [title for title, _ in _section_groups(tree, "9") if title]
    want = list(ANCHORS["attack_steps"])
    if [h for h in headings if h in want] != want:
        raise FlowOutlineError(f"section 9's step headings are {headings}, expected {want} in that order")


def _areas(tree: _Tree) -> list[str]:
    out = ["GAME AREAS (5):"]
    for area in tree.kids("5"):
        if not (_numbered(area["id"]) and area["text"].split(" ", 1)[-1].lstrip().startswith("#")):
            continue
        lines = [row for row in tree.kids(area["id"]) if not AREA_SKIP_RE.search(row["text"])]
        if not lines:
            raise FlowOutlineError(f"area {area['id']} has no lines left after the skip filter")
        # The area's first remaining line says what it holds; later ones only when they say what you may do there.
        out.append(f"[{area['title']}] {_line(lines[0])}")
        out.extend(_line(row) for row in lines[1:] if AREA_ACTION_RE.search(row["text"]))
    if len(out) == 1:
        raise FlowOutlineError("section 5 has no area headings")
    return out


def _subtree(tree: _Tree, rule_id: str) -> list[dict]:
    out = []
    for child in tree.kids(rule_id):
        out.append(child)
        out.extend(_subtree(tree, child["id"]))
    return out


def _states(tree: _Tree) -> list[str]:
    out = ["CARD STATES (3, Lag):"]
    headings = [h for h in tree.kids("3") if h["kind"] == "section" and h["title"] == ANCHORS["orientation_heading"]]
    if len(headings) != 1:
        raise FlowOutlineError(f"section 3 has {len(headings)} {ANCHORS['orientation_heading']!r} headings, expected 1")
    # The state definitions: Orientation rules that open with the quoted term they define ("“Spent” refers to ...").
    out.extend(_line(r) for r in tree.kids(headings[0]["id"])
               if _numbered(r["id"]) and DEFINITION_RE.match(NUMBER_PREFIX_RE.sub("", r["text"])))
    lag_line = tree.get(ANCHORS["lag_line"])
    entries = [tree.get(ref) for ref in lag_line.get("refs") or ()
               if ref in tree.by_id and tree.by_id[ref].get("title") == ANCHORS["lag_entry_title"]]
    if len(entries) != 1 or "Lag" not in lag_line["text"]:
        raise FlowOutlineError(f"rule {ANCHORS['lag_line']} no longer links to one {ANCHORS['lag_entry_title']!r} entry")
    lagged = _subtree(tree, entries[0]["id"])
    if not lagged:
        raise FlowOutlineError(f"the Lag entry {entries[0]['id']} has no rules under it")
    out.append(f"[Lag {entries[0]['id']}]")
    out.extend(_line(r) for r in lagged)
    return out


def build_outline(rows: Iterable[dict]) -> str:
    """The outline text for these rule rows (``rules.jsonl`` records). Raises ``FlowOutlineError``."""
    tree = _Tree(rows)
    _check_sections(tree)
    _check_attack_steps(tree)
    lines = ["GAME FLOW: rule lines from the snapshot, by id, leading sentences only (… marks a cut); get_rule has the full text."]
    lines += _steps(tree, "8", "TURN ORDER")
    lines += _steps(tree, "9", "ATTACK")
    lines += _areas(tree)
    lines += _states(tree)
    return "\n".join(lines)


def outline_rule_ids(outline: str) -> list[str]:
    """The rule ids that open the outline's lines, in order (headings and labels excluded)."""
    return [m.group(1) for m in re.finditer(r"^\s*(?:\[[^\]]+\] )?(\d+(?:\.\d+)+) ", outline, re.M)]


@lru_cache(maxsize=1)
def game_flow_outline() -> str:
    """The outline for the committed comprehensive-rules snapshot."""
    from games.cyberpunk.assistant.tools import rules
    return build_outline(rules())
