"""Card and rules tools for the local chat assistant: code supplies the facts.

Why: no base model knows Cyberpunk TCG (it launched in 2026 and is in open
beta), so anything a model "recalls" about a card or a rule is confabulated.
The assistant therefore splits the work: the model decides which tool to call
and judges strategy, and every card and rule fact it sees comes from one of
these tools, read from the dated snapshot in ``data/processed/``. The tools
make no strategic judgment of their own -- a filter is a filter, an
interaction report lists the rules both cards point to and stops there.

Design rules, each one load-bearing:

  - A card's identity is its slug. Sixteen names are shared (three cards are
    called "V"), so ``find_card`` returns every match and an ``ambiguous``
    flag, and never picks one. ``get_card`` only takes a slug.
  - Errata override printed text. They are attached to every card fact that
    ``get_card`` returns, with the override stated in the result, and the
    rendered card text puts them last (``chunking.card_to_text``).
  - Arguments are validated against each tool's JSON schema before the tool
    runs, and anything unexpected fails closed with an error dict, never a
    guess and never an exception for the caller to catch.
  - Every result names the card slugs, rule ids, errata ids and corpus chunks
    it used, and the ``rules_version`` of the snapshot, so an answer built on
    it can be traced back to its sources.
  - Nothing here dispatches on a card's name, and nothing assumes a format.

``TOOLS`` is the registry: name, description, JSON-schema parameters and the
callable. ``tool_specs()`` renders it as OpenAI-style function specs, the shape
Qwen3's native chat template takes in its ``tools`` argument.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from games.cyberpunk import markup
from games.cyberpunk.chunking import card_to_text
from games.cyberpunk.config import (CARD_DATABASE_PATH, CORPUS_CHUNKS_PATH, CORPUS_INDEX_PATH, ERRATA_CHUNKS_PATH,
                                    ERRATA_PATH, REPO_ROOT, RULE_SECTIONS_PATH, RULES_CHUNKS_PATH,
                                    RULES_PATH)
from games.cyberpunk.errata import normalize_name
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.io import read_jsonl

__all__ = ["TOOLS", "Tool", "call_tool", "tool_specs", "validate_args", "find_card", "get_card", "search_cards",
           "get_rule", "search_rules", "card_interactions", "LEXICAL_METHOD", "EMBEDDING_METHOD"]

LEXICAL_METHOD = "lexical-bm25"
EMBEDDING_METHOD = "embedding"
MAX_FIND_RESULTS = 25
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,159}$"
RULE_NUMBER_PATTERN = r"^\d+(?:\.\d+)*\.?$"
# Fields of a card record that are facts about the card itself (everything but
# the image URL, which the printings list carries per printing anyway).
CARD_FACT_FIELDS = ("id", "name", "subname", "display_name", "card_type", "color", "cost", "power", "ram",
                    "is_eddiable", "classifications", "keywords", "keywords_referenced", "timing_triggers",
                    "text", "text_markup", "flavor_text", "rarity", "set", "set_code", "print_number", "artist",
                    "legality", "printings")
ERRATA_NOTE = ("Errata supersede the card's printed text and characteristics at all levels of play; "
               "read each erratum as overriding the printed fields above it.")
INTERACTION_NOTE = ("Facts only: the rules each card's keywords, timing triggers and symbols point to, and the "
                    "ones they share. Whether or how the two cards combine is a judgment this tool does not make.")


class ToolError(Exception):
    """A tool refusing its input. ``kind`` is machine-readable, the message is for people and models."""

    def __init__(self, kind: str, message: str, **extra: Any):
        super().__init__(message)
        self.kind = kind
        self.extra = extra


# Data, loaded once ---------------------------------------------------------------


def _rows(path: Path) -> list[dict]:
    # missing_ok=False: a tool answering from an empty file would look like "no
    # such card" rather than "the snapshot is missing".
    return read_jsonl(path, missing_ok=False)


@lru_cache(maxsize=1)
def cards() -> tuple[dict, ...]:
    return tuple(_rows(CARD_DATABASE_PATH))


@lru_cache(maxsize=1)
def cards_by_slug() -> dict[str, dict]:
    out = {c["id"]: c for c in cards()}
    if len(out) != len(cards()):
        raise ValueError(f"{CARD_DATABASE_PATH} has duplicate slugs")
    return out


@lru_cache(maxsize=1)
def errata_by_slug() -> dict[str, tuple[dict, ...]]:
    known = cards_by_slug()
    out: dict[str, list[dict]] = {}
    for entry in _rows(ERRATA_PATH):
        # The build already refuses an erratum that joins no card; refusing here
        # too keeps a hand-edited file from silently dropping one.
        if entry.get("card_id") not in known:
            raise ValueError(f"erratum {entry.get('id')!r} joins no card in the snapshot")
        out.setdefault(entry["card_id"], []).append(entry)
    return {slug: tuple(entries) for slug, entries in out.items()}


@lru_cache(maxsize=1)
def rules() -> tuple[dict, ...]:
    return tuple(_rows(RULES_PATH))


@lru_cache(maxsize=1)
def rules_by_id() -> dict[str, dict]:
    return {r["id"]: r for r in rules()}


@lru_cache(maxsize=1)
def sections_by_id() -> dict[str, dict]:
    return {s["id"]: s for s in _rows(RULE_SECTIONS_PATH)}


@lru_cache(maxsize=1)
def rule_children() -> dict[str, tuple[str, ...]]:
    out: dict[str, list[str]] = {}
    for r in rules():
        if r.get("parent"):
            out.setdefault(r["parent"], []).append(r["id"])
    return {k: tuple(v) for k, v in out.items()}


@lru_cache(maxsize=1)
def rule_referenced_by() -> dict[str, tuple[str, ...]]:
    out: dict[str, list[str]] = {}
    for r in rules():
        for ref in r.get("refs") or ():
            out.setdefault(ref, []).append(r["id"])
    return {k: tuple(v) for k, v in out.items()}


@lru_cache(maxsize=1)
def lexical_chunks() -> tuple[dict, ...]:
    return tuple(_rows(RULES_CHUNKS_PATH)) + tuple(_rows(ERRATA_CHUNKS_PATH))


def snapshot_values(field: str) -> list[str]:
    """Distinct non-null values of a card field in the snapshot, sorted (for schema enums)."""
    return sorted({c[field] for c in cards() if c.get(field) is not None})


# Shared helpers --------------------------------------------------------------------


def _is_numbered(rule_id: str) -> bool:
    return re.fullmatch(r"\d+(?:\.\d+)*", rule_id) is not None


def _rule_brief(rule_id: str) -> dict:
    r = rules_by_id().get(rule_id)
    if r is not None:
        return {"id": rule_id, "title": r["title"], "kind": r["kind"], "numbered": bool(r.get("is_numbered"))}
    s = sections_by_id().get(rule_id)
    if s is not None:
        return {"id": rule_id, "title": s["title"], "kind": s["kind"], "numbered": _is_numbered(rule_id)}
    return {"id": rule_id, "title": None, "kind": "unresolved", "numbered": _is_numbered(rule_id)}


def _card_summary(card: dict) -> dict:
    return {"slug": card["id"], "display_name": card["display_name"], "name": card["name"],
            "subname": card.get("subname"), "card_type": card["card_type"], "color": card["color"],
            "cost": card.get("cost"), "power": card.get("power"), "ram": card.get("ram"),
            "keywords": list(card.get("keywords") or []), "timing_triggers": list(card.get("timing_triggers") or []),
            "has_errata": card["id"] in errata_by_slug()}


def _erratum_view(entry: dict) -> dict:
    return {"id": entry["id"], "heading": entry["heading"], "variant": entry.get("variant"),
            "section": entry.get("section"), "text": entry["text"], "supersedes_printed_text": True,
            "page_updated_at": entry.get("page_updated_at")}


def _require_card(slug: str) -> dict:
    card = cards_by_slug().get(slug)
    if card is None:
        suggestions = [m["slug"] for m in _match_cards(slug.replace("-", " "))[1][:5]]
        raise ToolError("not_found", f"No card has the slug {slug!r} in the {RULES_VERSION} snapshot. "
                        "Use find_card to resolve a name to a slug.", did_you_mean=suggestions)
    return card


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def _sources(card_slugs=(), rule_ids=(), errata_ids=(), chunk_ids=()) -> dict:
    def ordered(values):
        return list(dict.fromkeys(v for v in values if v))
    return {"card_slugs": ordered(card_slugs), "rule_ids": ordered(rule_ids), "errata_ids": ordered(errata_ids),
            "chunk_ids": ordered(chunk_ids)}


# find_card ---------------------------------------------------------------------------


def _match_cards(query: str) -> tuple[str, list[dict]]:
    """The best non-empty tier of matches for ``query``: slug, full name, name, then partial."""
    key = normalize_name(query)
    slug = query.strip().casefold()
    tiers: list[tuple[str, Callable[[dict], bool]]] = [
        ("slug", lambda c: c["id"] == slug),
        ("display_name", lambda c: bool(key) and normalize_name(c["display_name"]) == key),
        ("name", lambda c: bool(key) and normalize_name(c["name"]) == key),
        ("partial", lambda c: bool(key) and (key in normalize_name(c["display_name"])
                                             or key in normalize_name(c["id"]))),
    ]
    for kind, test in tiers:
        found = sorted((c for c in cards() if test(c)), key=lambda c: (c["display_name"], c["id"]))
        if found:
            return kind, [_card_summary(c) for c in found]
    return "none", []


def _find_card(args: dict):
    limit = args.get("limit", MAX_FIND_RESULTS)
    kind, matches = _match_cards(args["query"])
    shown = matches[:limit]
    result = {"query": args["query"], "match_kind": kind, "count": len(matches), "truncated": len(matches) > limit,
              "ambiguous": len(matches) > 1, "matches": shown}
    if len(matches) > 1:
        result["note"] = ("Several cards match. A card's identity is its slug: choose one by slug, or ask which "
                          "card is meant. Do not assume one.")
    elif not matches:
        result["note"] = "No card in the snapshot matches. Do not describe a card that is not here."
    return result, _sources(card_slugs=[m["slug"] for m in shown])


# get_card ----------------------------------------------------------------------------


def _get_card(args: dict):
    card = _require_card(args["slug"])
    errata = errata_by_slug().get(card["id"], ())
    facts = {field: card.get(field) for field in CARD_FACT_FIELDS}
    facts["slug"] = facts.pop("id")
    result = {"card": facts, "has_errata": bool(errata), "errata": [_erratum_view(e) for e in errata],
              "text_with_errata": card_to_text(card, list(errata))}
    if errata:
        result["errata_note"] = ERRATA_NOTE
    return result, _sources(card_slugs=[card["id"]], errata_ids=[e["id"] for e in errata])


# search_cards ------------------------------------------------------------------------


def _in_range(value, low, high) -> bool:
    if low is None and high is None:
        return True
    if value is None:
        return False
    return (low is None or value >= low) and (high is None or value <= high)


def _searchable_text(card: dict) -> str:
    parts = [card.get("text") or ""] + [e["text"] for e in errata_by_slug().get(card["id"], ())]
    return _fold("\n".join(parts))


def _search_cards(args: dict):
    for stat in ("cost", "power", "ram"):
        low, high = args.get(f"{stat}_min"), args.get(f"{stat}_max")
        if low is not None and high is not None and low > high:
            raise ToolError("invalid_arguments", f"{stat}_min ({low}) is greater than {stat}_max ({high}).")
    if "text" in args and not args["text"].strip():
        raise ToolError("invalid_arguments", "text must contain something other than whitespace.")
    needle = _fold(args["text"].strip()) if "text" in args else None
    limit = args.get("limit", 50)

    def keep(card: dict) -> bool:
        return all((
            "color" not in args or card["color"] == args["color"],
            "card_type" not in args or card["card_type"] == args["card_type"],
            _in_range(card.get("cost"), args.get("cost_min"), args.get("cost_max")),
            _in_range(card.get("power"), args.get("power_min"), args.get("power_max")),
            _in_range(card.get("ram"), args.get("ram_min"), args.get("ram_max")),
            "keyword" not in args or args["keyword"] in (card.get("keywords") or ()),
            "referenced_keyword" not in args or args["referenced_keyword"] in (card.get("keywords_referenced") or ()),
            "timing_trigger" not in args or args["timing_trigger"] in (card.get("timing_triggers") or ()),
            needle is None or needle in _searchable_text(card),
        ))

    found = sorted((c for c in cards() if keep(c)), key=lambda c: c["id"])
    shown = [_card_summary(c) for c in found[:limit]]
    filters = {k: v for k, v in args.items() if k != "limit"}
    result = {"filters": filters, "count": len(found), "truncated": len(found) > limit, "cards": shown,
              "note": "Keyword filters use printed keywords; referenced_keyword finds cards that mention a keyword "
                      "they do not have. text matches printed text and errata, case-insensitively."}
    return result, _sources(card_slugs=[c["slug"] for c in shown])


# get_rule ----------------------------------------------------------------------------


def _ancestors(rule: dict) -> list[dict]:
    chain = []
    seen = set()
    parent = rule.get("parent")
    while parent and parent not in seen:
        seen.add(parent)
        chain.append(_rule_brief(parent))
        node = rules_by_id().get(parent) or sections_by_id().get(parent)
        parent = node.get("parent") if node else None
    return list(reversed(chain))


def _get_rule(args: dict):
    rule_id = args["rule_id"].rstrip(".")
    rule = rules_by_id().get(rule_id)
    if rule is None:
        parts = rule_id.split(".")
        nearest = next((".".join(parts[:n]) for n in range(len(parts) - 1, 0, -1)
                        if ".".join(parts[:n]) in rules_by_id()), None)
        raise ToolError("not_found", f"Rule {rule_id} is not in the {RULES_VERSION} rules snapshot.",
                        nearest_existing=nearest)
    refs = [_rule_brief(ref) for ref in rule.get("refs") or ()]
    children = [_rule_brief(c) for c in rule_children().get(rule_id, ())]
    referenced_by = [_rule_brief(r) for r in rule_referenced_by().get(rule_id, ())]
    result = {"rule": {"id": rule_id, "kind": rule["kind"], "title": rule["title"], "text": rule["text"],
                       "section": rule["section"], "depth": rule.get("depth")},
              "path": _ancestors(rule), "children": children, "references": refs, "referenced_by": referenced_by}
    used = [rule_id] + [c["id"] for c in children] + [r["id"] for r in refs]
    return result, _sources(rule_ids=used)


# search_rules ------------------------------------------------------------------------

TOKEN_RE = re.compile(r"\d+(?:\.\d+)+|[a-z0-9]+")
STOPWORDS = frozenset(
    "a an and are as at be by can do does for from has have how i if in is it its may of on or that the their "
    "then there this to was what when where which while who will with you your".split())


def _tokens(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(_fold(text)) if t not in STOPWORDS]


@lru_cache(maxsize=1)
def _bm25_index() -> tuple[tuple[Counter, ...], dict[str, int], float]:
    docs = tuple(Counter(_tokens(c["text"])) for c in lexical_chunks())
    df: Counter = Counter()
    for doc in docs:
        df.update(doc.keys())
    avg = sum(sum(d.values()) for d in docs) / max(len(docs), 1)
    return docs, dict(df), avg


def lexical_search(query: str, k: int) -> list[dict]:
    """BM25 over the rule and errata chunks; ties broken by corpus order, so it is deterministic."""
    docs, df, avg = _bm25_index()
    n = len(docs)
    terms = list(dict.fromkeys(_tokens(query)))
    k1, b = 1.5, 0.75
    scored = []
    for position, doc in enumerate(docs):
        length = sum(doc.values())
        score = 0.0
        for term in terms:
            tf = doc.get(term, 0)
            if not tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * length / avg))
        if score > 0:
            scored.append((-round(score, 9), position))
    scored.sort()
    chunks = lexical_chunks()
    return [{**chunks[pos], "score": round(-neg, 4)} for neg, pos in scored[:k]]


def _search_rules(args: dict):
    query, k = args["query"].strip(), args.get("k", 5)
    if not _tokens(query):
        raise ToolError("invalid_arguments", "query has no searchable words.")
    method, fallback_reason, hits = LEXICAL_METHOD, None, None
    if CORPUS_INDEX_PATH.exists():
        try:
            from harness.core.rag.index import retrieve
            hits = retrieve(query, k, CORPUS_CHUNKS_PATH, CORPUS_INDEX_PATH)
            method = EMBEDDING_METHOD
        except Exception as exc:  # an unusable index must not take the tool down; it is reported instead
            fallback_reason = f"embedding retrieval unavailable ({type(exc).__name__}: {exc})"[:300]
    else:
        fallback_reason = f"no corpus index at {CORPUS_INDEX_PATH.relative_to(REPO_ROOT)}"
    if hits is None:
        hits = lexical_search(query, k)
    results = []
    for hit in hits:
        results.append({"chunk_id": hit["chunk_id"], "source": hit.get("source"), "score": hit.get("score"),
                        "section": hit.get("section"), "rule_ids": [r for r in hit.get("rule_ids") or ()
                                                                    if _is_numbered(r)],
                        "card_slug": hit.get("card_id"), "text": hit["text"]})
    result = {"query": query, "method": method, "k": k, "results": results}
    if fallback_reason:
        result["fallback_reason"] = fallback_reason
    errata_ids = [h["chunk_id"] for h in hits if str(h["chunk_id"]).startswith("errata:")]
    return result, _sources(card_slugs=[r["card_slug"] for r in results], rule_ids=[i for r in results
                                                                                     for i in r["rule_ids"]],
                            errata_ids=errata_ids, chunk_ids=[r["chunk_id"] for r in results])


# card_interactions ---------------------------------------------------------------------


def _term_pattern(term: str) -> re.Pattern:
    # The rules document writes a keyword or trigger as "[BLOCKER]" and the Spend
    # symbol as "[Spend Icon]"; card markup writes them as {Blocker} / {Spend}.
    return re.compile(r"\[\s*" + re.escape(term) + r"(?:\s+icon)?\s*\]", re.I)


def _descendants(rule_id: str) -> list[str]:
    out, stack = [], list(reversed(rule_children().get(rule_id, ())))
    while stack:
        current = stack.pop()
        out.append(current)
        stack.extend(reversed(rule_children().get(current, ())))
    return out


@lru_cache(maxsize=None)
def term_rules(term: str) -> dict[str, list[str]]:
    """Rules about one keyword, trigger or symbol, found in the rules text itself.

    ``defining``: the glossary heading for the term (a rule whose text is a
    ``### [TERM]`` heading) and every rule under it. ``mentioning``: any other
    rule that names the term in brackets. Derived from the document, so a new
    keyword's rules appear here once the snapshot has them.
    """
    pattern = _term_pattern(term)
    heading = re.compile(r"^\s*[\d.]+\s*#+\s*" + pattern.pattern, re.I)
    defining: list[str] = []
    for r in rules():
        if heading.match(r["text"]):
            defining += [r["id"]] + _descendants(r["id"])
    defining = list(dict.fromkeys(defining))
    mentioning = [r["id"] for r in rules() if r["id"] not in defining and pattern.search(r["text"])]
    return {"defining": defining, "mentioning": mentioning}


def _card_terms(card: dict) -> dict:
    text = card.get("text_markup") or ""
    symbols = list(dict.fromkeys(t for t, kind in markup.tokens(text) if kind == "symbol"))
    return {"printed_keywords": markup.printed_keywords(text), "referenced_keywords": markup.referenced_keywords(text),
            "timing_triggers": markup.printed_timing_triggers(text), "symbols": symbols,
            "rule_references": markup.rule_references(text)}


def _card_interactions(args: dict):
    a, b = _require_card(args["slug_a"]), _require_card(args["slug_b"])
    sides = []
    for card in (a, b):
        terms = _card_terms(card)
        all_terms = list(dict.fromkeys(terms["printed_keywords"] + terms["referenced_keywords"]
                                       + terms["timing_triggers"] + terms["symbols"]))
        by_term = {t: term_rules(t) for t in all_terms}
        rule_ids = list(dict.fromkeys([i for t in all_terms for group in by_term[t].values() for i in group]
                                      + terms["rule_references"]))
        errata = errata_by_slug().get(card["id"], ())
        sides.append({"slug": card["id"], "display_name": card["display_name"], "card_type": card["card_type"],
                      **terms, "terms": all_terms, "rules_by_term": by_term, "rule_ids": rule_ids,
                      "text": card.get("text"), "errata": [_erratum_view(e) for e in errata]})
    shared_terms = [t for t in sides[0]["terms"] if t in sides[1]["terms"]]
    shared_rules = [r for r in sides[0]["rule_ids"] if r in sides[1]["rule_ids"]]
    all_rules = list(dict.fromkeys(sides[0]["rule_ids"] + sides[1]["rule_ids"]))
    result = {"cards": sides, "shared_terms": shared_terms, "shared_rule_ids": shared_rules,
              "rule_titles": {r: _rule_brief(r)["title"] for r in all_rules}, "note": INTERACTION_NOTE}
    return result, _sources(card_slugs=[a["id"], b["id"]], rule_ids=all_rules,
                            errata_ids=[e["id"] for s in sides for e in s["errata"]])


# Registry, validation and dispatch ----------------------------------------------------


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict
    run: Callable[[dict], tuple[dict, dict]]

    def spec(self) -> dict:
        """OpenAI-style function spec; Qwen3's chat template renders a list of these."""
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": self.parameters}}


def _object(properties: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}


def _int(description: str, minimum: int = 0, maximum: int = 99) -> dict:
    return {"type": "integer", "minimum": minimum, "maximum": maximum, "description": description}


def _build_tools() -> dict[str, Tool]:
    slug = {"type": "string", "pattern": SLUG_PATTERN, "description": "A card slug, e.g. v-streetkid."}
    keyword = {"type": "string", "enum": list(markup.KEYWORDS)}
    tools = [
        Tool("find_card",
             "Resolve a card name or partial name to card slugs. Several cards share a name (three are called V), "
             "so this returns every match with its subname and an 'ambiguous' flag; it never picks one.",
             _object({"query": {"type": "string", "minLength": 1, "maxLength": 120,
                                "description": "Card name, partial name or slug."},
                      "limit": _int("Maximum matches to return.", 1, MAX_FIND_RESULTS)}, ["query"]),
             _find_card),
        Tool("get_card",
             "Full facts for one card by slug: type, colour, cost, power, RAM, keywords, triggers, printed text, "
             "printings, and any errata, which override the printed text.",
             _object({"slug": slug}, ["slug"]), _get_card),
        Tool("search_cards",
             "Find cards by structured filters (all optional, combined with AND): colour, card type, cost, power "
             "and RAM ranges, printed keyword, referenced keyword, timing trigger, text substring.",
             _object({"color": {"type": "string", "enum": snapshot_values("color")},
                      "card_type": {"type": "string", "enum": snapshot_values("card_type")},
                      "cost_min": _int("Minimum cost."), "cost_max": _int("Maximum cost."),
                      "power_min": _int("Minimum power."), "power_max": _int("Maximum power."),
                      "ram_min": _int("Minimum RAM."), "ram_max": _int("Maximum RAM."),
                      "keyword": {**keyword, "description": "A keyword the card has printed."},
                      "referenced_keyword": {**keyword, "description": "A keyword the card mentions but lacks."},
                      "timing_trigger": {"type": "string", "enum": list(markup.TIMING_TRIGGERS)},
                      "text": {"type": "string", "minLength": 1, "maxLength": 200,
                               "description": "Case-insensitive substring of the card text or its errata."},
                      "limit": _int("Maximum cards to return.", 1, 200)}, []),
             _search_cards),
        Tool("get_rule",
             "Look up one rule of the official rules by its number (e.g. 9.9 or 11.24.1), with its section, "
             "parent headings, sub-rules and cross-references.",
             _object({"rule_id": {"type": "string", "pattern": RULE_NUMBER_PATTERN, "maxLength": 20,
                                  "description": "Rule number, e.g. 9.2.3."}}, ["rule_id"]),
             _get_rule),
        Tool("search_rules",
             "Search the rules and errata text for passages relevant to a question. Returns the matching passages "
             "with their rule numbers and which search method ran.",
             _object({"query": {"type": "string", "minLength": 2, "maxLength": 500},
                      "k": _int("Number of passages to return.", 1, 20)}, ["query"]),
             _search_rules),
        Tool("card_interactions",
             "For two cards (by slug), list the rules their keywords, timing triggers and symbols point to and the "
             "ones they share. Facts only; it does not judge whether the cards combine well.",
             _object({"slug_a": slug, "slug_b": slug}, ["slug_a", "slug_b"]),
             _card_interactions),
    ]
    return {t.name: t for t in tools}


TOOLS: dict[str, Tool] = _build_tools()

_JSON_TYPES = {"string": str, "integer": int, "boolean": bool, "object": dict, "array": list}


def validate_args(schema: dict, args: Any) -> list[str]:
    """Check ``args`` against the JSON-schema subset the registry uses. Returns problems; empty means valid."""
    if not isinstance(args, dict):
        return ["arguments must be a JSON object"]
    problems = []
    props = schema.get("properties", {})
    for name in schema.get("required", []):
        if name not in args:
            problems.append(f"missing required argument {name!r}")
    if schema.get("additionalProperties") is False:
        for name in args:
            if name not in props:
                problems.append(f"unknown argument {name!r} (allowed: {', '.join(props) or 'none'})")
    for name, value in args.items():
        spec = props.get(name)
        if spec is None:
            continue
        expected = _JSON_TYPES[spec["type"]]
        if not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
            problems.append(f"{name} must be of type {spec['type']}")
            continue
        if "enum" in spec and value not in spec["enum"]:
            problems.append(f"{name} must be one of {spec['enum']}")
        if isinstance(value, int):
            if "minimum" in spec and value < spec["minimum"]:
                problems.append(f"{name} must be >= {spec['minimum']}")
            if "maximum" in spec and value > spec["maximum"]:
                problems.append(f"{name} must be <= {spec['maximum']}")
        if isinstance(value, str):
            if "minLength" in spec and len(value) < spec["minLength"]:
                problems.append(f"{name} must be at least {spec['minLength']} characters")
            if "maxLength" in spec and len(value) > spec["maxLength"]:
                problems.append(f"{name} must be at most {spec['maxLength']} characters")
            if "pattern" in spec and not re.search(spec["pattern"], value):
                problems.append(f"{name} does not match {spec['pattern']}")
    return problems


def _error(name: str, kind: str, message: str, **extra: Any) -> dict:
    return {"ok": False, "tool": name, "error": message, "error_kind": kind, **extra,
            "rules_version": RULES_VERSION, "sources": _sources()}


def call_tool(name: Any, args: Any = None) -> dict:
    """Validate and run one tool. Always returns a JSON-serialisable dict; never raises for bad input."""
    tool = TOOLS.get(name) if isinstance(name, str) else None
    if tool is None:
        return _error(str(name), "unknown_tool", f"No tool named {name!r}. Tools: {', '.join(TOOLS)}.")
    args = {} if args is None else args
    problems = validate_args(tool.parameters, args)
    if problems:
        return _error(name, "invalid_arguments", "; ".join(problems))
    try:
        result, sources = tool.run(args)
    except ToolError as exc:
        return _error(name, exc.kind, str(exc), **exc.extra)
    return {"ok": True, "tool": name, "rules_version": RULES_VERSION, "sources": sources, "result": result}


def tool_specs() -> list[dict]:
    return [t.spec() for t in TOOLS.values()]


def _given(**kwargs: Any) -> dict:
    return {k: v for k, v in kwargs.items() if v is not None}


def find_card(query: str, limit: int | None = None) -> dict:
    return call_tool("find_card", _given(query=query, limit=limit))


def get_card(slug: str) -> dict:
    return call_tool("get_card", {"slug": slug})


def search_cards(**filters: Any) -> dict:
    return call_tool("search_cards", _given(**filters))


def get_rule(rule_id: str) -> dict:
    return call_tool("get_rule", {"rule_id": rule_id})


def search_rules(query: str, k: int | None = None) -> dict:
    return call_tool("search_rules", _given(query=query, k=k))


def card_interactions(slug_a: str, slug_b: str) -> dict:
    return call_tool("card_interactions", {"slug_a": slug_a, "slug_b": slug_b})
