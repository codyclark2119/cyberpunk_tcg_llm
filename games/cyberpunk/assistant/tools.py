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
callable. The deck tools live in ``decks.py`` and join it at the end of this
module. ``tool_specs()`` renders it as OpenAI-style function specs, the shape
Qwen3's native chat template takes in its ``tools`` argument.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from games.cyberpunk import markup
from games.cyberpunk.assistant import retrieval
from games.cyberpunk.chunking import card_to_text
from games.cyberpunk.config import (CARD_DATABASE_PATH, CORPUS_INDEX_PATH, ERRATA_CHUNKS_PATH,
                                    ERRATA_PATH, REPO_ROOT, RULE_SECTIONS_PATH, RULES_CHUNKS_PATH,
                                    RULES_PATH)
from games.cyberpunk.errata import normalize_name
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.io import read_jsonl

__all__ = ["TOOLS", "Tool", "call_tool", "tool_specs", "validate_args", "find_card", "get_card", "search_cards",
           "get_rule", "search_rules", "card_interactions", "parse_deck", "check_deck", "deck_profile",
           "similar_decks", "archetype_of", "played_with", "LEXICAL_METHOD", "EMBEDDING_METHOD", "HYBRID_METHOD",
           "LEGACY_CHUNK_METHOD", "retrieval_methods", "index_status", "rule_docs"]

LEXICAL_METHOD = "lexical-bm25-rules"   # rule-level BM25 (retrieval.LexicalIndex)
EMBEDDING_METHOD = "embedding"          # the rules index alone (measured by eval_retrieval.py only)
HYBRID_METHOD = "hybrid"                # lexical + embedding, reciprocal rank fusion
LEGACY_CHUNK_METHOD = "lexical-bm25-chunks"  # the pre-2026-11-12 chunk BM25, kept as the measured baseline
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


def _sources(card_slugs=(), rule_ids=(), errata_ids=(), chunk_ids=(), deck_ids=()) -> dict:
    def ordered(values):
        return list(dict.fromkeys(v for v in values if v))
    return {"card_slugs": ordered(card_slugs), "rule_ids": ordered(rule_ids), "errata_ids": ordered(errata_ids),
            "chunk_ids": ordered(chunk_ids), "deck_ids": ordered(deck_ids)}


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
# The ranking itself lives in ``retrieval.py``; this wires it to the snapshot and the optional index.

# The embedding index ``scripts/build_rules_index.py`` writes. A module attribute so tests can point it
# at a temporary file; the default is the configured corpus index path (a git-ignored build artifact).
RULES_INDEX_PATH: Path = CORPUS_INDEX_PATH
HYBRID_POOL = 50  # candidates from each ranking that go into the fusion


@lru_cache(maxsize=1)
def rule_docs() -> tuple[dict, ...]:
    """The rule-level retrieval corpus: every rule row plus the errata chunks (``retrieval.build_rule_docs``)."""
    return retrieval.build_rule_docs(rules(), _rows(ERRATA_CHUNKS_PATH))


@lru_cache(maxsize=1)
def lexical_index() -> retrieval.LexicalIndex:
    terms = markup.KEYWORDS + markup.TIMING_TRIGGERS + markup.SYMBOLS
    return retrieval.LexicalIndex(rule_docs(), {t: term_rules(t)["defining"] for t in terms},
                                  keywords=markup.KEYWORDS, plain_word_terms=markup.TIMING_TRIGGERS + markup.SYMBOLS)


def lexical_search(query: str, k: int) -> list[dict]:
    """Rule-level BM25 (``retrieval.LexicalIndex``); deterministic, ties broken by rule number."""
    return lexical_index().search(query, k)


@lru_cache(maxsize=1)
def legacy_chunk_index() -> retrieval.LegacyChunkBM25:
    return retrieval.LegacyChunkBM25(tuple(_rows(RULES_CHUNKS_PATH)) + tuple(_rows(ERRATA_CHUNKS_PATH)))


def _default_embedder(model_id: str):
    """``texts -> vectors`` with the index's own model; needs mlx_embeddings (Apple Silicon)."""
    from harness.core.rag.index import embed_texts, load_model
    model, tokenizer = load_model(model_id)
    return lambda texts: embed_texts(model, tokenizer, list(texts))


# ``model_id -> (texts -> vectors)``. Tests replace it with a fake; embedders are cached per model id.
EMBEDDER_FACTORY: Callable[[str], Callable] = _default_embedder
_EMBEDDERS: dict = {}
_INDEX_CACHE: dict = {}


def _embedder(model_id: str):
    key = (EMBEDDER_FACTORY, model_id)
    if key not in _EMBEDDERS:
        _EMBEDDERS[key] = EMBEDDER_FACTORY(model_id)
    return _EMBEDDERS[key]


def _index_label(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def embedding_index() -> tuple[retrieval.EmbeddingIndex | None, str | None]:
    """(index, None) when the rules index exists and matches the corpus, else (None, why not)."""
    path = RULES_INDEX_PATH
    label = _index_label(path)
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None, f"no rules index at {label} (build it on the Mac with scripts/build_rules_index.py)"
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if key not in _INDEX_CACHE:
        try:
            from harness.core.rag.index import read_index
            _INDEX_CACHE.clear()
            _INDEX_CACHE[key] = (retrieval.EmbeddingIndex(read_index(path), rule_docs(), label), None)
        except retrieval.IndexUnavailable as exc:
            _INDEX_CACHE[key] = (None, str(exc))
        except Exception as exc:  # an unreadable file is a fallback with a reason, never a crash
            _INDEX_CACHE[key] = (None, f"{label} is unreadable ({type(exc).__name__}: {exc})"[:300])
    return _INDEX_CACHE[key]


def index_status() -> dict:
    """What the Eval tab shows: where the index is, whether search_rules will use it, and why not."""
    index, reason = embedding_index()
    return {"path": _index_label(RULES_INDEX_PATH), "exists": RULES_INDEX_PATH.exists(), "usable": index is not None,
            "reason": reason, "model_id": index.model_id if index else None, "documents": len(rule_docs()),
            "fingerprint": retrieval.corpus_fingerprint(rule_docs())}


def embedding_search(query: str, n: int) -> list[tuple[str, float]]:
    """(doc_id, cosine) best first; raises ``IndexUnavailable`` or the embedder's error when it cannot run."""
    index, reason = embedding_index()
    if index is None:
        raise retrieval.IndexUnavailable(reason)
    vectors = _embedder(index.model_id)([query])
    return index.ranking(vectors[0], n)


def _docs_by_id() -> dict[str, dict]:
    return {d["doc_id"]: d for d in rule_docs()}


def hybrid_search(query: str, k: int) -> list[dict]:
    """Reciprocal rank fusion of the lexical and embedding rankings (each cut at ``HYBRID_POOL``)."""
    lexical = [h["doc_id"] for h in lexical_search(query, HYBRID_POOL)]
    embedded = [doc_id for doc_id, _ in embedding_search(query, HYBRID_POOL)]
    docs = _docs_by_id()
    lexical_set, embedded_set = set(lexical), set(embedded)
    return [{**docs[doc_id], "score": round(score, 6),
             "matched_by": [m for m, ids in (("lexical", lexical_set), ("embedding", embedded_set)) if doc_id in ids]}
            for doc_id, score in retrieval.rrf([lexical, embedded])[:k]]


def _passage(hit: dict) -> dict:
    """One search_rules result: a rule (or erratum) with its number, heading path, section and text."""
    if "doc_id" not in hit:  # a legacy chunk
        return {"chunk_id": hit["chunk_id"], "source": hit.get("source"), "score": hit.get("score"),
                "section": hit.get("section"), "rule_ids": [r for r in hit.get("rule_ids") or () if _is_numbered(r)],
                "card_slug": hit.get("card_id"), "text": hit["text"]}
    passage = {"chunk_id": hit["doc_id"], "source": hit["source"], "score": hit.get("score"),
               "section": hit.get("section"), "rule_ids": [hit["rule_id"]] if hit["rule_id"] and
               _is_numbered(hit["rule_id"]) else [], "path": hit.get("context") or None,
               "card_slug": hit.get("card_id"), "text": hit["text"]}
    if hit.get("matched_by"):
        passage["matched_by"] = hit["matched_by"]
    return passage


def retrieval_methods() -> dict[str, dict]:
    """Every ranking ``scripts/eval_retrieval.py`` can score: ``{name: {"search": fn or None, "reason"}}``.

    ``search(query, k)`` returns passages shaped like search_rules results.
    The embedding and hybrid entries carry ``search=None`` and the reason when
    no usable index or embedding model is available here.
    """
    index, reason = embedding_index()
    if index is not None:
        try:
            _embedder(index.model_id)
        except Exception as exc:
            index, reason = None, f"embedding model unavailable ({type(exc).__name__}: {exc})"[:300]

    def wrap(fn):
        return lambda query, k: [_passage(h) for h in fn(query, k)]

    def embedding_only(query, k):
        docs = _docs_by_id()
        return [{**docs[d], "score": s} for d, s in embedding_search(query, k)]

    available = index is not None
    return {LEGACY_CHUNK_METHOD: {"search": wrap(legacy_chunk_index().search), "reason": None},
            LEXICAL_METHOD: {"search": wrap(lexical_search), "reason": None},
            EMBEDDING_METHOD: {"search": wrap(embedding_only) if available else None, "reason": reason},
            HYBRID_METHOD: {"search": wrap(hybrid_search) if available else None, "reason": reason}}


def _search_rules(args: dict):
    query, k = args["query"].strip(), args.get("k", 5)
    if not retrieval.tokens(query):
        raise ToolError("invalid_arguments", "query has no searchable words.")
    method, fallback_reason, hits = HYBRID_METHOD, None, None
    try:
        hits = hybrid_search(query, k)
    except retrieval.IndexUnavailable as exc:
        fallback_reason = str(exc)
    except Exception as exc:  # no embedding model here, or it failed: report it and answer lexically
        fallback_reason = f"embedding model unavailable ({type(exc).__name__}: {exc})"[:300]
    if hits is None:
        method, hits = LEXICAL_METHOD, lexical_search(query, k)
    results = [_passage(h) for h in hits]
    result = {"query": query, "method": method, "k": k, "results": results}
    if fallback_reason:
        result["fallback_reason"] = fallback_reason
    errata_ids = [r["chunk_id"] for r in results if str(r["chunk_id"]).startswith("errata:")]
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

# The deck tools (``decks.py``) build on the helpers above and join the same
# registry. Imported here, after everything they use is defined; the package's
# ``__init__`` imports this module first, so this order holds whichever module
# a caller imports.
from games.cyberpunk.assistant.decks import DECK_TOOLS  # noqa: E402

TOOLS.update((t.name, t) for t in DECK_TOOLS)

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


def parse_deck(**source: Any) -> dict:
    """``parse_deck(text=...)``, ``parse_deck(deck_id=...)`` or ``parse_deck(deck=...)``."""
    return call_tool("parse_deck", _given(**source))


def check_deck(**source: Any) -> dict:
    return call_tool("check_deck", _given(**source))


def deck_profile(**source: Any) -> dict:
    return call_tool("deck_profile", _given(**source))


def similar_decks(k: int | None = None, **source: Any) -> dict:
    return call_tool("similar_decks", _given(k=k, **source))


def archetype_of(**source: Any) -> dict:
    return call_tool("archetype_of", _given(**source))


def played_with(slug: str, k: int | None = None) -> dict:
    return call_tool("played_with", _given(slug=slug, k=k))
