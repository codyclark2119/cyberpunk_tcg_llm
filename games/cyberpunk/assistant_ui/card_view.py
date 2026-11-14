"""Card tiles for the assistant page: a display payload per slug, built only from the card-fact tools.

Why: the page used to show a cited card as its raw slug and, on click, a JSON-ish
list of facts. A tile (name, cost, type line, stats, keyword chips, the card text
with its keywords and timing triggers marked) reads like the card, and the page
can show it without parsing card markup in JavaScript. Nothing here is new card
knowledge: the facts and errata come from ``tools._get_card`` (the same function
the ``get_card`` tool runs) and the text segments from ``markup.classify`` over the
card's own ``text_markup``.

Errata in this snapshot are prose notes about a printing or reminder text, not a
replacement text, so the tile keeps the printed text's segments and carries each
erratum beside it (``errata``), flagged by ``has_errata``; the page shows a badge
and the errata under the text.

A brace span ``markup.classify`` does not know stays visible as text, braces and
all, the way ``markup.to_plain_text`` leaves it: an unknown token must never
disappear from what a person reads.
"""

from __future__ import annotations

from games.cyberpunk.assistant import tools
from games.cyberpunk.markup import MARKUP_RE, MD_LINK_RE, classify, unescape_markdown

__all__ = ["card_tile", "card_tiles", "text_segments", "MAX_BATCH", "CardNotFound"]

MAX_BATCH = 24
# markup.classify's category -> the tile's segment kind.
_KINDS = {"keyword": "keyword", "timing_trigger": "trigger", "symbol": "symbol", "rule_reference": "rule"}


class CardNotFound(LookupError):
    def __init__(self, slug: str, message: str, did_you_mean: list[str]):
        super().__init__(message)
        self.slug = slug
        self.did_you_mean = did_you_mean


def _plain(text: str) -> str:
    """Bare markdown links reduced to their labels, as ``markup.to_plain_text`` does."""
    return MD_LINK_RE.sub(lambda m: unescape_markdown(m.group("label")).strip(), text)


def text_segments(markup: str | None) -> list[dict]:
    """``[{kind, value}]`` covering all of ``markup``: text, keyword, trigger, symbol or rule.

    A keyword, trigger or symbol's value is its name without brackets (``to_plain_text``
    writes it as ``[Name]``); a rule reference is its number; a braced link its label; an
    unknown span stays as text with its braces. Adjacent text pieces are merged."""
    out: list[dict] = []

    def add(kind: str, value: str) -> None:
        if not value:
            return
        if kind == "text" and out and out[-1]["kind"] == "text":
            out[-1]["value"] += value
        else:
            out.append({"kind": kind, "value": value})

    text = markup or ""
    pos = 0
    for match in MARKUP_RE.finditer(text):
        add("text", _plain(text[pos:match.start()]))
        token = match.group(1)
        category = classify(token)
        if category in _KINDS:
            add(_KINDS[category], token)
        elif category == "link":
            add("text", _plain(token))
        else:
            add("text", match.group(0))
        pos = match.end()
    add("text", _plain(text[pos:]))
    return out


def card_tile(slug: str) -> dict:
    """The tile payload for one slug, or ``CardNotFound`` with ``get_card``'s suggestions."""
    try:
        result, _ = tools._get_card({"slug": slug})
    except tools.ToolError as exc:
        raise CardNotFound(slug, str(exc), list(exc.extra.get("did_you_mean") or [])) from None
    card = result["card"]
    return {"slug": card["slug"], "display_name": card["display_name"], "name": card["name"],
            "subname": card.get("subname"), "card_type": card["card_type"], "color": card["color"],
            "cost": card.get("cost"), "power": card.get("power"), "ram": card.get("ram"),
            "classifications": list(card.get("classifications") or []),
            "keywords": list(card.get("keywords") or []),
            "timing_triggers": list(card.get("timing_triggers") or []),
            "rarity": card.get("rarity"), "set": card.get("set"),
            "text": card.get("text") or "", "segments": text_segments(card.get("text_markup")),
            "has_errata": result["has_errata"],
            "errata": [{"id": e["id"], "heading": e["heading"], "variant": e.get("variant"), "text": e["text"]}
                       for e in result["errata"]],
            "errata_note": result.get("errata_note")}


def card_tiles(slugs: list[str]) -> tuple[list[dict], list[dict]]:
    """Tiles for ``slugs`` in order (duplicates dropped) and the misses with their suggestions."""
    distinct = list(dict.fromkeys(slugs))
    if len(distinct) > MAX_BATCH:
        raise ValueError(f"at most {MAX_BATCH} slugs per request, got {len(distinct)}")
    found, missing = [], []
    for slug in distinct:
        try:
            found.append(card_tile(slug))
        except CardNotFound as exc:
            missing.append({"slug": slug, "did_you_mean": exc.did_you_mean})
    return found, missing
