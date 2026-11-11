"""Deck tools for the local chat assistant: deck facts from code, strategy from the model.

Why: a deckbuilding answer needs numbers a model cannot be trusted to work out
from memory or by counting a pasted list -- whether a deck is legal and which
rule it breaks, its cost curve, RAM budget against usage, which public decks
it resembles and which cards are played alongside a card. These tools supply
those facts from the dated snapshot (``data/processed/card_database.jsonl`` and
the 272 public decks in ``data/raw/decks/``) and stop there: no tool here says
whether a deck is good, what to cut or what beats it. That judgment belongs to
the model, and it is labelled as judgment.

Design rules, each one load-bearing:

  - A card's identity is its slug. ``parse_deck`` maps each pasted name with
    ``tools._match_cards`` and accepts only an exact, single match (slug,
    full name or name). A shared name ("V") or a partial or unknown name is
    reported with its candidates and the deck is left unresolved; a tool
    asked to work on an unresolved deck refuses rather than guessing.
  - Construction rules come from ``deckbuilding.py`` unchanged (``validate``
    and ``describe``). The format is read from the deck record (or given by
    the caller) and reported as given; nothing here assumes one.
  - Copies of one slug in one zone are merged before validation, so "2 X" on
    two lines is four copies and the copy limit sees four.
  - Archetypes are ``archetypes.cluster`` over the public decks at its default
    threshold, computed once, deterministically, and cached. They describe
    which public decks are built alike; they are not a judgment of strength.
  - Every deck-taking tool accepts a deck dict (as ``parse_deck`` returns it),
    a public ``deck_id`` or pasted ``text``, so a model can chain the tools.

The tools register themselves in ``tools.TOOLS`` (see the end of
``tools.py``); this module never dispatches on a card's name.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from functools import lru_cache
from typing import Any

from games.cyberpunk import archetypes, deckbuilding
from games.cyberpunk.assistant.tools import (SLUG_PATTERN, Tool, ToolError, _card_summary, _int, _match_cards,
                                             _object, _sources, cards_by_slug, errata_by_slug)
from games.cyberpunk.config import DECKS_DIR

__all__ = ["DECK_TOOLS", "public_decks", "public_deck_index", "parse_deck_text", "load_deck", "ARCHETYPE_MIN_SIZE"]

DECK_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
FORMAT_CODE_PATTERN = r"^[a-z0-9][a-z0-9-]{0,39}$"
MAX_TEXT = 10000
MAX_LINES = 300
MAX_QUANTITY = 99
ZONES = (deckbuilding.LEGEND_ZONE, deckbuilding.DECK_ZONE)
# The official builder's curve has eight buckets, the last being "7 or more";
# reproduced so the profile can be compared with a public deck's own stats.
CURVE_BUCKETS = 8
# ``scripts/cluster_decks.py --min-size`` default: a group of fewer than three
# public decks is not called an archetype, and the ids (arch-01, ...) number
# only the groups at or above it, in ``archetypes.cluster`` order.
ARCHETYPE_MIN_SIZE = 3
DECK_KEYS = frozenset({"name", "format", "source", "zones", "counts"})
ENTRY_KEYS = frozenset({"card_slug", "quantity", "display_name"})
EXACT_MATCH_KINDS = ("slug", "display_name", "name")
DATA_NOTE = "Facts from the snapshot only; whether the deck is good, or what to change, is a judgment this tool does not make."


# Public decks, loaded once -------------------------------------------------------------


@lru_cache(maxsize=1)
def public_decks() -> tuple[dict, ...]:
    """The public deck records, sorted by file name (the deck id). ``_index.json`` and ``_salt.json`` are not decks."""
    paths = sorted(p for p in DECKS_DIR.glob("*.json") if not p.name.startswith("_"))
    if not paths:
        raise ValueError(f"no public decks under {DECKS_DIR}")
    return tuple(json.loads(p.read_text(encoding="utf-8")) for p in paths)


@lru_cache(maxsize=1)
def public_decks_by_id() -> dict[str, dict]:
    out = {d["id"]: d for d in public_decks()}
    if len(out) != len(public_decks()):
        raise ValueError(f"{DECKS_DIR} has duplicate deck ids")
    return out


@lru_cache(maxsize=1)
def public_counts() -> tuple[Counter, ...]:
    return tuple(archetypes.deck_counts(d) for d in public_decks())


@lru_cache(maxsize=1)
def _archetype_model() -> dict:
    """Similarity matrix, clusters and archetype records over the public decks, computed once.

    ``archetypes.cluster`` is deterministic (ordered by size then first member),
    and decks are ordered by id, so the same snapshot always yields the same ids.
    """
    decks, counts = public_decks(), list(public_counts())
    index = cards_by_slug()
    matrix = archetypes.similarity_matrix(counts)
    clusters = archetypes.cluster(matrix, archetypes.DEFAULT_THRESHOLD)
    records, cluster_of = [], {}
    for n, members in enumerate(c for c in clusters if len(c) >= ARCHETYPE_MIN_SIZE):
        arch_id = f"arch-{n + 1:02d}"
        colours = Counter("/".join(sorted(archetypes.colour_identity(decks[i], index))) for i in members)
        legends = Counter(s for i in members for s in archetypes.legend_slugs(decks[i]))
        core = archetypes.core_cards(members, counts, archetypes.DEFAULT_CORE_SHARE)
        records.append({"id": arch_id, "size": len(members),
                        "cohesion": round(archetypes.cohesion(members, matrix), 4),
                        "colour_identities": dict(sorted(colours.items(), key=lambda kv: (-kv[1], kv[0]))),
                        "legends": [{"slug": s, "decks": k} for s, k in sorted(legends.items(),
                                                                               key=lambda kv: (-kv[1], kv[0]))],
                        "core_cards": [{"slug": s, "display_name": index[s]["display_name"], "share": round(sh, 4)}
                                       for s, sh in core],
                        "deck_ids": [decks[i]["id"] for i in members], "members": list(members)})
    for record in records:
        for i in record["members"]:
            cluster_of[i] = record["id"]
    small = {i: len(c) for c in clusters if len(c) < ARCHETYPE_MIN_SIZE for i in c}
    return {"clusters": clusters, "records": records, "cluster_of": cluster_of, "small_cluster_size": small}


def _deck_colours(record: dict) -> list[str]:
    return sorted(archetypes.colour_identity(record, cards_by_slug()))


def public_deck_index() -> list[dict]:
    """One line per public deck for a picker: id, name, format, Legends' colours, size. Sorted by name, then id."""
    out = []
    for d in public_decks():
        fmt = d.get("format") or {}
        out.append({"id": d["id"], "name": d.get("name"), "format": fmt.get("name") or fmt.get("code"),
                    "colours": _deck_colours(d), "card_count": d.get("card_count"),
                    "is_valid": d.get("is_valid")})
    out.sort(key=lambda r: ((r["name"] or "").casefold(), r["id"]))
    return out


# Normalised decks ----------------------------------------------------------------------


def _format_of(value: Any) -> dict | None:
    if value is None:
        return None
    if isinstance(value, str):
        if not re.fullmatch(FORMAT_CODE_PATTERN, value):
            raise ToolError("invalid_arguments", f"format {value!r} must be a lower-case format code.")
        return {"code": value, "name": None}
    if isinstance(value, dict) and set(value) <= {"code", "name", "id"}:
        code, name = value.get("code"), value.get("name")
        if (code is None or isinstance(code, str)) and (name is None or isinstance(name, str)) and (code or name):
            return {"code": code, "name": name}
    raise ToolError("invalid_arguments", "format must be a format code string or {'code', 'name'}.")


def _deck(zones: dict[str, list[dict]], *, name: str | None, fmt: dict | None, source: dict) -> dict:
    return {"name": name, "format": fmt, "source": source,
            "zones": [{"zone_code": z, "cards": zones.get(z, [])} for z in ZONES],
            "counts": {z: deckbuilding.total_cards(zones.get(z, [])) for z in ZONES}}


def _merge(entries: list[tuple[str, int]]) -> list[dict]:
    """(slug, quantity) pairs to entries, one per slug, in first-seen order, quantities summed."""
    totals: dict[str, int] = {}
    for slug, quantity in entries:
        totals[slug] = totals.get(slug, 0) + quantity
    return [{"card_slug": s, "quantity": q} for s, q in totals.items()]


def _unknown_slugs(slugs) -> list[str]:
    index = cards_by_slug()
    return sorted({s for s in slugs if s not in index})


def _zone_entries(record: dict) -> dict[str, list[dict]]:
    return {deckbuilding.LEGEND_ZONE: deckbuilding.legend_entries(record),
            deckbuilding.DECK_ZONE: deckbuilding.deck_entries(record)}


def _from_record(record: dict) -> dict:
    zones = {z: _merge([(e["card_slug"], e.get("quantity", 1)) for e in entries])
             for z, entries in _zone_entries(record).items()}
    source = {"kind": "public_deck", "deck_id": record["id"], "official_is_valid": record.get("is_valid")}
    return _deck(zones, name=record.get("name"), fmt=_format_of(record.get("format")), source=source)


def _from_dict(deck: dict) -> dict:
    extra = sorted(set(deck) - DECK_KEYS)
    if extra:
        raise ToolError("invalid_arguments", f"deck has unknown keys {extra}; expected {sorted(DECK_KEYS)}.")
    raw_zones = deck.get("zones")
    if not isinstance(raw_zones, list):
        raise ToolError("invalid_arguments", "deck.zones must be a list of {'zone_code', 'cards'}.")
    zones: dict[str, list[tuple[str, int]]] = {}
    for zone in raw_zones:
        if not isinstance(zone, dict) or zone.get("zone_code") not in ZONES or not isinstance(zone.get("cards"), list):
            raise ToolError("invalid_arguments", f"each zone needs zone_code in {list(ZONES)} and a cards list.")
        if set(zone) - {"zone_code", "cards"}:
            raise ToolError("invalid_arguments", f"zone has unknown keys {sorted(set(zone) - {'zone_code', 'cards'})}.")
        for entry in zone["cards"]:
            if not isinstance(entry, dict) or set(entry) - ENTRY_KEYS:
                raise ToolError("invalid_arguments", f"each card entry is {{'card_slug', 'quantity'}}; got {entry!r}"[:300])
            slug, quantity = entry.get("card_slug"), entry.get("quantity")
            if not isinstance(slug, str) or not re.fullmatch(SLUG_PATTERN, slug):
                raise ToolError("invalid_arguments", f"card_slug {slug!r} is not a slug; use parse_deck for names."[:300])
            if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= MAX_QUANTITY:
                raise ToolError("invalid_arguments", f"quantity for {slug} must be an integer 1..{MAX_QUANTITY}.")
            zones.setdefault(zone["zone_code"], []).append((slug, quantity))
    unknown = _unknown_slugs(s for pairs in zones.values() for s, _ in pairs)
    if unknown:
        raise ToolError("not_found", f"{len(unknown)} card slug(s) are not in the snapshot: {unknown[:10]}. "
                        "Use find_card to resolve names.", unknown_slugs=unknown)
    name = deck.get("name")
    if name is not None and not isinstance(name, str):
        raise ToolError("invalid_arguments", "deck.name must be a string.")
    source = deck.get("source") if isinstance(deck.get("source"), dict) else {}
    kept = {k: source[k] for k in ("deck_id", "official_is_valid") if k in source}
    if "deck_id" in kept and not (isinstance(kept["deck_id"], str) and re.fullmatch(DECK_ID_PATTERN, kept["deck_id"])):
        raise ToolError("invalid_arguments", "deck.source.deck_id is not a deck id.")
    return _deck({z: _merge(p) for z, p in zones.items()}, name=name, fmt=_format_of(deck.get("format")),
                  source={"kind": "deck", **kept})


# Pasted text ---------------------------------------------------------------------------

HEADER_RE = re.compile(r"^(?:#+\s*|//\s*)?(legends?|deck|main(?:\s*deck)?)\s*(?:\(\s*\d+\s*\))?\s*:?\s*$", re.I)
COMMENT_RE = re.compile(r"^(?:#|//)")
BULLET_RE = re.compile(r"^[-*•]\s+")
QTY_PREFIX_RE = re.compile(r"^(\d{1,3})\s*[x×]?\s+(.+)$", re.I)
QTY_SUFFIX_RE = re.compile(r"^(.+?)\s+[x×]\s?(\d{1,3})$", re.I)


def _resolve(name: str) -> tuple[str | None, str, list[dict]]:
    """(slug or None, status, candidates). Only an exact single match resolves; nothing is guessed."""
    kind, matches = _match_cards(name)
    candidates = [{"slug": m["slug"], "display_name": m["display_name"], "card_type": m["card_type"],
                   "color": m["color"]} for m in matches[:10]]
    if kind in EXACT_MATCH_KINDS and len(matches) == 1:
        return matches[0]["slug"], "resolved", candidates
    if kind in EXACT_MATCH_KINDS:
        return None, "ambiguous", candidates
    if kind == "partial":
        return None, "partial_match", candidates
    return None, "unknown", []


def parse_deck_text(text: str, fmt: Any = None) -> dict:
    """Parse a pasted list. Returns the parse report; ``deck`` is None unless every line resolved."""
    lines = text.splitlines()
    if len(lines) > MAX_LINES:
        raise ToolError("invalid_arguments", f"text has {len(lines)} lines; at most {MAX_LINES}.")
    section: str | None = None
    saw_header = False
    pairs: dict[str, list[tuple[str, int]]] = {z: [] for z in ZONES}
    resolved, unresolved, notes = [], [], []
    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line:
            continue
        header = HEADER_RE.match(line)
        if header:
            section = deckbuilding.LEGEND_ZONE if header.group(1).lower().startswith("legend") else deckbuilding.DECK_ZONE
            saw_header = True
            continue
        if COMMENT_RE.match(line):
            continue
        line = BULLET_RE.sub("", line)
        quantity, name, assumed = 1, line, True
        prefix, suffix = QTY_PREFIX_RE.match(line), QTY_SUFFIX_RE.match(line)
        if prefix:
            quantity, name, assumed = int(prefix.group(1)), prefix.group(2).strip(), False
        elif suffix:
            name, quantity, assumed = suffix.group(1).strip(), int(suffix.group(2)), False
        if not 1 <= quantity <= MAX_QUANTITY:
            unresolved.append({"line": number, "text": raw.strip(), "name": name, "quantity": quantity,
                               "zone": section, "status": "bad_quantity", "candidates": []})
            continue
        slug, status, candidates = _resolve(name)
        if slug is None:
            unresolved.append({"line": number, "text": raw.strip(), "name": name, "quantity": quantity,
                               "zone": section, "status": status, "candidates": candidates})
            continue
        card = cards_by_slug()[slug]
        zone, zone_from = section, "header"
        if zone is None:
            # No section headers: a Legend-type card goes to the Legends zone, anything else to the deck.
            zone = deckbuilding.LEGEND_ZONE if card["card_type"] == "Legend" else deckbuilding.DECK_ZONE
            zone_from = "card_type"
        pairs[zone].append((slug, quantity))
        resolved.append({"line": number, "name": name, "slug": slug, "display_name": card["display_name"],
                         "quantity": quantity, "quantity_assumed": assumed, "zone": zone, "zone_from": zone_from})
    if not saw_header and resolved:
        notes.append("No 'Legends' / 'Deck' headers: Legend cards were placed in the Legends zone by card type.")
    if any(r["quantity_assumed"] for r in resolved):
        notes.append("Lines without a count were read as 1 copy (see quantity_assumed).")
    misplaced = [r["slug"] for r in resolved if r["zone"] == deckbuilding.DECK_ZONE
                 and cards_by_slug()[r["slug"]]["card_type"] == "Legend"]
    if misplaced:
        notes.append(f"Legend cards listed under the deck section: {misplaced}.")
    if not resolved and not unresolved:
        raise ToolError("invalid_arguments", "text holds no card lines.")
    deck = None
    if not unresolved:
        deck = _deck({z: _merge(p) for z, p in pairs.items()}, name=None, fmt=_format_of(fmt),
                     source={"kind": "text"})
    elif any(u["status"] == "ambiguous" for u in unresolved):
        notes.append("Some names match several cards (a card's identity is its slug). Re-paste those lines with "
                     "the full name, e.g. 'V: Streetkid', or the slug.")
    return {"resolved": not unresolved, "deck": deck, "cards": resolved, "unresolved": unresolved, "notes": notes}


# Deck source arguments ----------------------------------------------------------------


def _source_args(args: dict) -> None:
    given = [k for k in ("deck", "deck_id", "text") if k in args]
    if len(given) != 1:
        raise ToolError("invalid_arguments", "Give exactly one of deck, deck_id or text"
                        + (f" (got {given})." if given else "."))
    if "format" in args and "text" not in args:
        raise ToolError("invalid_arguments", "format only applies to pasted text; a deck or deck_id carries its own.")


def load_deck(args: dict) -> tuple[dict, dict | None]:
    """The normalised deck the arguments name, and the text parse report if text was given.

    Refuses a pasted list that did not fully resolve: a deck missing a line, or
    holding a guessed card, would give wrong facts that look right.
    """
    _source_args(args)
    if "deck_id" in args:
        record = public_decks_by_id().get(args["deck_id"])
        if record is None:
            raise ToolError("not_found", f"No public deck has the id {args['deck_id']!r} in this snapshot.")
        return _from_record(record), None
    if "deck" in args:
        return _from_dict(args["deck"]), None
    text = args["text"]
    if not text.strip():
        raise ToolError("invalid_arguments", "text must contain a deck list.")
    report = parse_deck_text(text, args.get("format"))
    if report["deck"] is None:
        raise ToolError("unresolved_cards", f"{len(report['unresolved'])} line(s) of the list did not resolve to one "
                        "card; run parse_deck to see the candidates, then pass the deck with slugs.",
                        unresolved=report["unresolved"])
    return report["deck"], report


def _all_entries(deck: dict) -> list[dict]:
    return [e for zone in deck["zones"] for e in zone["cards"]]


def _deck_sources(deck: dict, deck_ids=()) -> dict:
    slugs = [e["card_slug"] for e in _all_entries(deck)]
    errata = [e["id"] for s in dict.fromkeys(slugs) for e in errata_by_slug().get(s, ())]
    own = [deck["source"]["deck_id"]] if deck["source"].get("deck_id") else []
    return _sources(card_slugs=slugs, errata_ids=errata, deck_ids=own + list(deck_ids))


# parse_deck ---------------------------------------------------------------------------


def _parse_deck(args: dict):
    _source_args(args)
    if "text" in args:
        if not args["text"].strip():
            raise ToolError("invalid_arguments", "text must contain a deck list.")
        report = parse_deck_text(args["text"], args.get("format"))
        sources = _sources(card_slugs=[c["slug"] for c in report["cards"]]
                           + [c["slug"] for u in report["unresolved"] for c in u["candidates"]])
        return report, sources
    deck, _ = load_deck(args)
    index = cards_by_slug()
    listed = [{"slug": e["card_slug"], "display_name": index[e["card_slug"]]["display_name"],
               "quantity": e["quantity"], "zone": z["zone_code"]} for z in deck["zones"] for e in z["cards"]]
    return {"resolved": True, "deck": deck, "cards": listed, "unresolved": [], "notes": []}, _deck_sources(deck)


# check_deck ---------------------------------------------------------------------------

RULES_CHECKED = [
    {"rule": "unknown-card", "detail": "every card is in the card database"},
    {"rule": "legend-count", "detail": f"exactly {deckbuilding.LEGEND_COUNT} Legends"},
    {"rule": "legend-unique-names", "detail": "the Legends have unique names"},
    {"rule": "deck-size", "detail": f"{deckbuilding.DECK_MIN}-{deckbuilding.DECK_MAX} cards, not counting Legends"},
    {"rule": "max-copies", "detail": f"no more than {deckbuilding.MAX_COPIES} copies of a card"},
    {"rule": "ram-limit", "detail": "in each colour, no card's RAM exceeds the sum of the Legends' RAM in it"},
]


def _check_deck(args: dict):
    deck, _ = load_deck(args)
    index = cards_by_slug()
    summary = deckbuilding.describe(deck, index)
    violations = summary.pop("violations")
    not_legal = sorted({e["card_slug"] for e in _all_entries(deck)
                        if index[e["card_slug"]].get("legality") != "legal"})
    result = {"legal": not violations, "violations": violations,
              "rule_slugs": list(dict.fromkeys(v["rule"] for v in violations)),
              "format": deck["format"], "summary": summary, "rules_checked": RULES_CHECKED,
              "cards_not_marked_legal": [{"slug": s, "legality": index[s].get("legality")} for s in not_legal],
              "note": "Construction rules from the official gameplay guide (deckbuilding.py). The format is "
                      "reported as the deck gives it; no format-specific restriction is modelled in this snapshot, "
                      "so a format's own ban list is not checked here."}
    if deck["source"].get("official_is_valid") is not None:
        result["official_is_valid"] = deck["source"]["official_is_valid"]
    return result, _deck_sources(deck)


# deck_profile -------------------------------------------------------------------------


def _sorted_counts(counter: Counter) -> dict:
    return dict(sorted(counter.items(), key=lambda kv: (-kv[1], str(kv[0]))))


def _deck_profile(args: dict):
    deck, _ = load_deck(args)
    index = cards_by_slug()
    legends, main = deckbuilding.legend_entries(deck), deckbuilding.deck_entries(deck)
    curve: Counter = Counter()
    buckets = [0] * CURVE_BUCKETS
    colours: Counter = Counter()
    types: Counter = Counter()
    printed: Counter = Counter()
    referenced: Counter = Counter()
    triggers: Counter = Counter()
    classifications: Counter = Counter()
    total_cost = unit_power = units = 0
    for entry in main:
        card, q = index[entry["card_slug"]], entry["quantity"]
        cost = card.get("cost") or 0
        curve[cost] += q
        buckets[min(cost, CURVE_BUCKETS - 1)] += q
        total_cost += cost * q
        colours[card["color"]] += q
        types[card["card_type"]] += q
        if card["card_type"] == "Unit" and card.get("power") is not None:
            unit_power += card["power"] * q
            units += q
        for kw in card.get("keywords") or ():
            printed[kw] += q
        for kw in card.get("keywords_referenced") or ():
            referenced[kw] += q
        for trigger in card.get("timing_triggers") or ():
            triggers[trigger] += q
        for c in card.get("classifications") or ():
            classifications[c] += q
    n_main = deckbuilding.total_cards(main)
    budget = deckbuilding.ram_budget(legends, index)
    usage = deckbuilding.ram_usage(main, index)
    ram = {c: {"budget": budget.get(c, 0), "usage": usage.get(c, 0), "headroom": budget.get(c, 0) - usage.get(c, 0)}
           for c in sorted(set(budget) | set(usage))}
    with_errata = []
    for slug in dict.fromkeys(e["card_slug"] for e in _all_entries(deck)):
        errata = errata_by_slug().get(slug, ())
        if errata:
            with_errata.append({"slug": slug, "display_name": index[slug]["display_name"],
                                "errata_ids": [e["id"] for e in errata]})
    legend_view = [{**_card_summary(index[e["card_slug"]]), "quantity": e["quantity"]} for e in legends]
    result = {
        "name": deck["name"], "format": deck["format"],
        "counts": {"legends": deckbuilding.total_cards(legends), "deck": n_main, "distinct_deck_cards": len(main)},
        "cost_curve": {str(k): v for k, v in sorted(curve.items())},
        "cost_curve_buckets": buckets,
        "average_cost": round(total_cost / n_main, 2) if n_main else None,
        "average_unit_power": round(unit_power / units, 2) if units else None,
        "colour_split": _sorted_counts(colours),
        "type_split": _sorted_counts(types),
        "ram": ram,
        "ram_over_budget": [c for c, v in ram.items() if v["headroom"] < 0],
        "keywords_printed": _sorted_counts(printed),
        "keywords_referenced": _sorted_counts(referenced),
        "timing_triggers": _sorted_counts(triggers),
        "classifications": _sorted_counts(classifications),
        "legends": legend_view,
        "cards_with_errata": with_errata,
        "note": "Counts are copies in the main deck (Legends excluded) unless stated. cost_curve_buckets[i] is "
                "the copies at cost i, the last bucket being 7 or more, as the official deckbuilder reports it. "
                "RAM usage is the largest single-card RAM per colour, budget the sum of the Legends' RAM. "
                + DATA_NOTE,
    }
    return result, _deck_sources(deck)


# similar_decks and archetype_of -------------------------------------------------------


def _deck_brief(i: int) -> dict:
    d = public_decks()[i]
    return {"deck_id": d["id"], "name": d.get("name"), "colours": _deck_colours(d),
            "legends": archetypes.legend_slugs(d)}


def _similarities(deck: dict) -> list[float]:
    counts = archetypes.deck_counts(deck)
    return [archetypes.similarity(counts, other) for other in public_counts()]


def _similar_decks(args: dict):
    deck, _ = load_deck({k: v for k, v in args.items() if k != "k"})
    k = args.get("k", 5)
    sims = _similarities(deck)
    own = deck["source"].get("deck_id")
    model = _archetype_model()
    counts = archetypes.deck_counts(deck)
    order = sorted(range(len(sims)), key=lambda i: (-sims[i], public_decks()[i]["id"] != own, public_decks()[i]["id"]))
    shown = []
    for i in order[:k]:
        other = public_counts()[i]
        shown.append({**_deck_brief(i), "similarity": round(sims[i], 4),
                      "shared_cards": len(set(counts) & set(other)),
                      "is_source_deck": public_decks()[i]["id"] == own,
                      "archetype": model["cluster_of"].get(i)})
    result = {"k": k, "corpus_size": len(sims), "decks": shown,
              "method": "weighted Jaccard over main-deck copy counts (archetypes.similarity); Legends excluded",
              "note": DATA_NOTE}
    return result, _deck_sources(deck, deck_ids=[d["deck_id"] for d in shown])


def _archetype_view(record: dict, core_limit: int = 12) -> dict:
    return {k: v for k, v in record.items() if k not in ("members", "core_cards", "deck_ids")} | {
        "core_cards": record["core_cards"][:core_limit], "core_card_count": len(record["core_cards"]),
        "example_deck_ids": record["deck_ids"][:5]}


def _archetype_of(args: dict):
    deck, _ = load_deck(args)
    model = _archetype_model()
    sims = _similarities(deck)
    own = deck["source"].get("deck_id")
    member = None
    if own in public_decks_by_id():
        i = next(n for n, d in enumerate(public_decks()) if d["id"] == own)
        if public_counts()[i] == archetypes.deck_counts(deck):
            member = i
    # Average linkage, the criterion ``archetypes.cluster`` merges on: the mean
    # similarity of this deck to each archetype's members.
    affinity = []
    for record in model["records"]:
        members = [i for i in record["members"] if i != member]
        if members:
            affinity.append((sum(sims[i] for i in members) / len(members), record))
    affinity.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    threshold = archetypes.DEFAULT_THRESHOLD
    if member is not None:
        arch_id = model["cluster_of"].get(member)
        method = "member"
        why = (f"This is public deck {own}; it falls in {arch_id}." if arch_id else
               f"This is public deck {own}; its cluster holds {model['small_cluster_size'].get(member, 1)} deck(s), "
               f"fewer than the {ARCHETYPE_MIN_SIZE} an archetype needs.")
    else:
        method = "nearest"
        best = affinity[0] if affinity else None
        arch_id = best[1]["id"] if best and best[0] >= threshold else None
        why = (f"Mean similarity to {arch_id}'s decks is {best[0]:.4f}, at or above the {threshold} threshold."
               if arch_id else f"No archetype's decks average {threshold} similarity to this deck.")
    records = {r["id"]: r for r in model["records"]}
    result = {"archetype": _archetype_view(records[arch_id]) if arch_id else None, "method": method,
              "explanation": why, "threshold": threshold, "min_size": ARCHETYPE_MIN_SIZE,
              "archetype_count": len(model["records"]), "corpus_size": len(public_decks()),
              "nearest": [{"id": r["id"], "size": r["size"], "mean_similarity": round(s, 4)}
                          for s, r in affinity[:3]],
              "note": "Archetypes are groups of public decks built alike (average-linkage clustering of weighted "
                      "Jaccard similarity), not a measure of strength. " + DATA_NOTE}
    shown = records[arch_id]["deck_ids"][:5] if arch_id else []
    return result, _deck_sources(deck, deck_ids=shown)


# played_with --------------------------------------------------------------------------


def _slugs_of(record: dict) -> set[str]:
    return {e["card_slug"] for entries in _zone_entries(record).values() for e in entries}


@lru_cache(maxsize=1)
def _deck_slug_sets() -> tuple[frozenset, ...]:
    return tuple(frozenset(_slugs_of(d)) for d in public_decks())


def _played_with(args: dict):
    slug, k = args["slug"], args.get("k", 15)
    index = cards_by_slug()
    if slug not in index:
        raise ToolError("not_found", f"No card has the slug {slug!r}. Use find_card to resolve a name to a slug.")
    sets = _deck_slug_sets()
    total = len(sets)
    holding = [i for i, s in enumerate(sets) if slug in s]
    together: Counter = Counter()
    for i in holding:
        together.update(s for s in sets[i] if s != slug)
    everywhere: Counter = Counter(s for deck in sets for s in deck)
    copies = Counter(public_counts()[i].get(slug, 0) for i in holding)
    ranked = sorted(together.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
    shown = [{"slug": s, "display_name": index[s]["display_name"], "card_type": index[s]["card_type"],
              "color": index[s]["color"], "decks": n, "share": round(n / len(holding), 4),
              "share_of_all_decks": round(everywhere[s] / total, 4)} for s, n in ranked]
    result = {"slug": slug, "display_name": index[slug]["display_name"], "corpus_size": total,
              "decks_with_card": len(holding), "share_of_all_decks": round(len(holding) / total, 4),
              "main_deck_copies": {str(c): n for c, n in sorted(copies.items())},
              "k": k, "played_with": shown,
              "note": "share is the fraction of the decks holding this card that also hold the other (either "
                      "zone); share_of_all_decks is that card's base rate, for comparison. " + DATA_NOTE}
    return result, _sources(card_slugs=[slug] + [s["slug"] for s in shown],
                            deck_ids=[public_decks()[i]["id"] for i in holding])


# Registry -----------------------------------------------------------------------------


def _deck_source_schema(with_format: bool = True) -> dict:
    props = {
        "deck": {"type": "object", "description": "A deck as parse_deck returns it: {'zones': [{'zone_code': "
                 "'legends' or 'deck', 'cards': [{'card_slug', 'quantity'}]}], optional 'name' and 'format'}."},
        "deck_id": {"type": "string", "pattern": DECK_ID_PATTERN,
                    "description": "The id of a public deck in the snapshot."},
        "text": {"type": "string", "minLength": 1, "maxLength": MAX_TEXT,
                 "description": "A pasted list, one card per line ('3 Name', '3x Name - Subname'); put the "
                                "Legends under a 'Legends' line and the rest under a 'Deck' line."},
    }
    if with_format:
        props["format"] = {"type": "string", "pattern": FORMAT_CODE_PATTERN,
                           "description": "Format code for pasted text, if known."}
    return props


ONE_OF = " Give exactly one of deck, deck_id or text."


def _build_deck_tools() -> list[Tool]:
    slug = {"type": "string", "pattern": SLUG_PATTERN, "description": "A card slug, e.g. v-streetkid."}
    return [
        Tool("parse_deck",
             "Turn a pasted deck list, a deck dict or a public deck id into a normalised deck of card slugs. Each "
             "name must match exactly one card; a shared or unknown name is reported with its candidates and never "
             "guessed." + ONE_OF,
             _object(_deck_source_schema(), []), _parse_deck),
        Tool("check_deck",
             "Check a deck against the deck construction rules (Legend count and names, deck size, copy limit, "
             "RAM) and return each violation with its rule slug, plus the deck's counts and RAM." + ONE_OF,
             _object(_deck_source_schema(), []), _check_deck),
        Tool("deck_profile",
             "Facts about a deck: cost curve, colour and card-type split, RAM budget against usage, printed and "
             "referenced keyword counts, timing-trigger counts, and which cards have errata." + ONE_OF,
             _object(_deck_source_schema(), []), _deck_profile),
        Tool("similar_decks",
             "The k public decks most similar to a deck (weighted Jaccard over main-deck copies), with their "
             "similarity and archetype." + ONE_OF,
             _object({**_deck_source_schema(), "k": _int("Number of decks to return.", 1, 50)}, []),
             _similar_decks),
        Tool("archetype_of",
             "Which archetype (group of public decks built alike) a deck belongs to or is nearest, with the "
             "archetype's core cards, Legends and colours. Grouping only, not a strength rating." + ONE_OF,
             _object(_deck_source_schema(), []), _archetype_of),
        Tool("played_with",
             "Cards most often played alongside a card (by slug) across the public decks: how many decks hold "
             "both, and each card's base rate.",
             _object({"slug": slug, "k": _int("Number of cards to return.", 1, 200)}, ["slug"]),
             _played_with),
    ]


DECK_TOOLS: list[Tool] = _build_deck_tools()
