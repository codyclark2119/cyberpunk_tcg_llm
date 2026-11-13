"""Rules retrieval for ``search_rules``: rule-level BM25, an optional embedding index, and their fusion.

Why: the first ``search_rules`` ran BM25 over 74 chunks of up to 1200
characters with no stemming, and on Cody's quiz its top hit was often a section
heading or the same chunk (the one holding 4.5.3) whatever the question. A
chunk holds a dozen unrelated rules, so one shared word pulls the whole chunk
up and the model has to find the rule inside it. This module indexes the rules
one rule at a time instead:

  - **One document per rule** (all 713 rows of ``rules.jsonl``), its text
    prefixed by the titles of its section and parent headings, so "Lagging
    Units can't attack" is also found by "Lag". The heading prefix counts at
    ``CONTEXT_WEIGHT`` of a body word, and a word inside a rule's
    ``> **EXAMPLE:**`` block at ``EXAMPLE_WEIGHT`` (examples name cards that
    quiz questions name too, and would otherwise outrank the rule itself).
    Errata are documents too, as before.
  - **Two rules documents, one index.** The Tournament Rules rows
    (``tournament_rules.jsonl``, ids "TR 3.4.2", "TR A.1.2") are documents
    beside the comprehensive rules, each carrying ``doc`` ("comprehensive",
    "tournament", or "errata" for an erratum) so ``search_rules`` can filter.
    A tournament document's heading path starts with "Tournament Rules", so a
    query that says "tournament" leans toward that document without a rule.
  - **Pure heading rows are kept but heavily down-weighted.** A row whose text
    is only a heading ("11.24. ### [BLOCKER]", a section title) has no rule in
    it. In the comprehensive rules every ``section`` row counts as a heading;
    in the Tournament Rules a section with a body is content (the ban list is a
    section) and only a bodiless one (its text is its bare title) is a heading.
    A heading row keeps ``HEADING_WEIGHT`` of its score so it still surfaces for a
    query that is nothing but the heading's words, and never outranks a rule
    with a body for an ordinary question. Every rule stays in the index.
  - **Stopwords and light stemming**: a fixed English stopword list (including
    "yes" and "no", which every yes/no quiz question carries as its choices),
    and a deterministic suffix stripper (plural -s/-es/-ies, -ing, -ed, with
    doubled consonants undone), so "lagging", "attacked" and "Gigs" meet
    "lag", "attack" and "gig". No dependency; ``stem`` is the whole algorithm.
  - **Game terms point at their glossary rules.** When the query names a
    keyword (Blocker, Go Solo, Quick, Adrenaline) or a timing trigger or symbol
    (Play, Call, Attack, Defeated, Spend), the rules that define it -- the
    ``### [TERM]`` glossary heading and every rule under it, the same mapping
    ``card_interactions`` uses (``tools.term_rules``) -- get their score
    multiplied by ``1 + TERM_BOOST``. Keywords match in any case. Triggers and
    symbols are also ordinary English words ("play a card", "attack"), so they
    count only when written as game terms: ``[PLAY]``, ``{Play}``, all capitals,
    or capitalised before effect/trigger/ability/keyword/icon ("its Play effect").

Deterministic by construction: documents are sorted by a fixed key at build
time, so the order the rules arrive in changes nothing; scores are rounded
before ranking; ties break on that key. No randomness, no clock.

The embedding side (``EmbeddingIndex``, ``rrf``) is used only when an index
built by ``scripts/build_rules_index.py`` exists and its fingerprint matches
the current rule-level documents; ``tools.search_rules`` then fuses the two
rankings with reciprocal rank fusion. The embedding model itself is never
imported here.

``LegacyChunkBM25`` is the old chunk search, kept unchanged so
``scripts/eval_retrieval.py`` can keep reporting the baseline it replaced.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter
from typing import Iterable

__all__ = ["DOCS", "TOURNAMENT_PATH_ROOT", "STOPWORDS", "stem", "tokens", "query_terms", "build_rule_docs",
           "embedding_chunks", "LexicalIndex",
           "LegacyChunkBM25", "EmbeddingIndex", "IndexUnavailable", "rrf", "sort_key", "corpus_fingerprint",
           "CONTEXT_WEIGHT", "EXAMPLE_WEIGHT", "HEADING_WEIGHT", "TERM_BOOST", "RRF_K"]

CONTEXT_WEIGHT = 0.5   # a heading-prefix word counts half a body word
EXAMPLE_WEIGHT = 0.5   # a word in a "> **EXAMPLE:**" block counts half: it illustrates, the rule defines
HEADING_WEIGHT = 0.15  # a heading-only row keeps this share of its score
TERM_BOOST = 1.0       # a named term's defining rules score x2
RRF_K = 60             # the usual reciprocal-rank-fusion constant
DOCS = ("comprehensive", "tournament")  # the rules documents a row may belong to (its ``doc``)
TOURNAMENT_PATH_ROOT = "Tournament Rules"
BM25_K1, BM25_B = 1.5, 0.75

TOKEN_RE = re.compile(r"\d+(?:\.\d+)+|[a-z0-9]+")
STOPWORDS = frozenset("""
a about above after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing done down during each either else even ever every few for from further get gets
got had has have having he her here hers him his how i if in into is it its itself just let lets like may me might
more most much must my myself neither no nor not now of off on once one only or other our ours out over own per
please same shall she should so some such than that the their theirs them themselves then there these they this
those though through thus to too under until up upon us very was we were what when where whether which while who
whom whose why will with within without would yes yet you your yours s t d ll re ve m
""".split())

_HEADING_LINE_RE = re.compile(r"^\s*#+\s*")
# A leading rule number: "9.2.3." or a Tournament Rules "TR A.1.2." (the "TR " is required, so a
# comprehensive row that opens with a capital letter is never mistaken for an appendix number).
_RULE_NUMBER_RE = re.compile(r"^\s*(?:TR\s+[A-Z0-9]+(?:\.\d+)*\.?|\d+(?:\.\d+)*\.?)\s*")
_TR_NUMBERED_RE = re.compile(r"^TR (?:[A-Z]|\d+)(?:\.\d+)*$")
_FIGURE_LINE_RE = re.compile(r"^\s*\*?\s*fig(?:ure|\.)\s*\d+", re.I)
_EXAMPLE_RE = re.compile(r"^\s*>\s*\*\*EXAMPLES?:?\*\*", re.M)
_NUMBERED_RE = re.compile(r"^\d+(?:\.\d+)*$")
_VOWELS = set("aeiouy")


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def stem(word: str) -> str:
    """A light, deterministic suffix stripper (not Porter): plurals, -ing, -ed, doubled consonants."""
    if len(word) <= 3 or not word.isalpha():
        return word
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("sses"):
        return word[:-2]
    if word.endswith("es") and (word[-3] in "sxz" or word[-4:-2] in ("ch", "sh")):
        return word[:-2]
    if word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    for suffix in ("ing", "ed"):
        if word.endswith(suffix):
            base = word[:-len(suffix)]
            if len(base) < 3 or not _VOWELS & set(base):
                return word
            if suffix == "ed" and base.endswith("i"):
                return base[:-1] + "y"  # readied -> ready
            if len(base) > 3 and base[-1] == base[-2] and base[-1] not in "lsz":
                return base[:-1]       # lagging -> lag, equipped -> equip
            return base
    return word


def tokens(text: str) -> list[str]:
    """Folded, stopword-free, stemmed tokens. Dotted numbers (rule ids) stay whole."""
    folded = _fold(text).replace("’", "'")
    out = []
    for raw in TOKEN_RE.findall(folded):
        if raw in STOPWORDS:
            continue
        out.append(raw if "." in raw else stem(raw))
    return out


def sort_key(doc_id: str) -> tuple:
    """Fixed document order: numbered rules by number, then unnumbered headings, then the Tournament Rules
    (numbered by number, appendix letters after digits, then unnumbered), then errata, each by id."""
    if doc_id.startswith("rule:"):
        rule_id = doc_id[5:]
        if _NUMBERED_RE.match(rule_id):
            return (0, tuple(int(p) for p in rule_id.split(".")), "")
        if _TR_NUMBERED_RE.match(rule_id):
            return (2, tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in rule_id[3:].split(".")), "")
        if rule_id.startswith("TR "):
            return (3, (), rule_id)
        return (1, (), rule_id)
    return (4, (), doc_id)


# Documents -------------------------------------------------------------------------


def _body(text: str) -> str:
    """The rule text without its leading number, heading line or figure captions."""
    lines = _RULE_NUMBER_RE.sub("", text, count=1).split("\n")
    if lines and _HEADING_LINE_RE.match(lines[0]):
        lines = lines[1:]
    return "\n".join(line for line in lines if line.strip() and not _FIGURE_LINE_RE.match(line)).strip()


def _split_example(text: str) -> tuple[str, str]:
    """(rule statement, example block). Examples name cards and situations; the statement is the rule."""
    match = _EXAMPLE_RE.search(text)
    return (text, "") if match is None else (text[:match.start()], text[match.start():])


def _clean_title(title: str) -> str:
    first = title.split("\n", 1)[0]
    return _HEADING_LINE_RE.sub("", _RULE_NUMBER_RE.sub("", first, count=1)).strip()


def build_rule_docs(rules: Iterable[dict], errata_chunks: Iterable[dict] = ()) -> tuple[dict, ...]:
    """One document per rule row and per errata chunk, in ``sort_key`` order.

    A rule document: ``doc_id`` ("rule:<id>"), ``rule_id``, ``source`` "rule",
    ``doc`` ("comprehensive" or "tournament", from the row's ``doc``),
    ``section``, ``path`` (titles of its heading ancestors, outermost first;
    "Tournament Rules" first for that document), ``context`` (the path joined
    with " > "), ``text`` (the rule text as published), and ``heading_only``
    (no body besides a heading or a figure; see the module docstring).
    """
    rules = list(rules)
    by_id = {r["id"]: r for r in rules}
    # ``heading``: names a topic, so its title joins its descendants' paths (any section, or a bodiless row).
    heading = {r["id"]: r.get("kind") == "section" or not _body(r["text"]) for r in rules}
    docs = []
    for rule in rules:
        # Only heading ancestors (sections and "### Title" rows) name the rule's topic; a parent that is
        # itself a full-sentence rule is a separate document and would only add its words to every child.
        path, seen, parent = [], {rule["id"]}, rule.get("parent")
        while parent and parent in by_id and parent not in seen:
            seen.add(parent)
            if heading[parent]:
                path.append(_clean_title(by_id[parent]["title"]))
            parent = by_id[parent].get("parent")
        path = [p for p in reversed(path) if p]
        doc = rule.get("doc", "comprehensive")
        if doc not in DOCS:
            raise ValueError(f"rule {rule['id']!r} names an unknown document {doc!r}")
        if doc == "tournament":
            path = [TOURNAMENT_PATH_ROOT] + path
            # A bodiless row's text is its bare title (scripts/ingest.py); otherwise the body decides.
            heading_only = rule["text"] == rule["title"] or not _body(rule["text"])
        else:
            heading_only = heading[rule["id"]]
        docs.append({"doc_id": f"rule:{rule['id']}", "rule_id": rule["id"], "source": "rule", "doc": doc,
                     "section": rule.get("section"), "path": path, "context": " > ".join(path),
                     "text": rule["text"], "heading_only": heading_only, "card_id": None})
    for chunk in errata_chunks:
        docs.append({"doc_id": chunk["chunk_id"], "rule_id": None, "source": chunk.get("source", "errata"),
                     "doc": "errata",
                     "section": None, "path": [], "context": "", "text": chunk["text"], "heading_only": False,
                     "card_id": chunk.get("card_id")})
    ids = [d["doc_id"] for d in docs]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate document ids in the rules corpus")
    return tuple(sorted(docs, key=lambda d: sort_key(d["doc_id"])))


def embedding_chunks(docs: Iterable[dict]) -> list[dict]:
    """The ``{"chunk_id", "text"}`` records the embedding index is built from (heading path, then text)."""
    return [{"chunk_id": d["doc_id"], "text": (d["context"] + "\n" if d["context"] else "") + d["text"]}
            for d in docs]


def corpus_fingerprint(docs: Iterable[dict]) -> str:
    """Same hash as ``harness.core.rag.index.fingerprint`` over ``embedding_chunks(docs)``."""
    h = hashlib.sha256()
    for chunk in embedding_chunks(docs):
        h.update(chunk["chunk_id"].encode())
        h.update(chunk["text"].encode())
    return h.hexdigest()


# Game terms in a query --------------------------------------------------------------


def query_terms(query: str, keywords: Iterable[str], plain_word_terms: Iterable[str]) -> list[str]:
    """Game terms the query names, in vocabulary order (keywords first). See the module docstring."""
    found = []
    for term in keywords:
        if re.search(r"(?<![A-Za-z])" + re.escape(term).replace(r"\ ", r"[\s-]+") + r"(?![A-Za-z])", query, re.I):
            found.append(term)
    for term in plain_word_terms:
        word = re.escape(term)
        marked = (rf"[\[{{]\s*{word}(?:\s+icon)?\s*[\]}}]", rf"(?<![A-Za-z]){term.upper()}(?![A-Za-z])",
                  rf"(?<![A-Za-z]){term[0].upper()}{word[1:]}\s+(?:effects?|triggers?|abilit(?:y|ies)|keywords?|icons?)\b")
        if any(re.search(p, query, re.I if i == 0 else 0) for i, p in enumerate(marked)):
            found.append(term)
    return found


# Lexical index --------------------------------------------------------------------------


class LexicalIndex:
    """BM25 over rule-level documents with a weighted heading prefix, heading down-weighting and term boosts."""

    def __init__(self, docs: Iterable[dict], term_defining: dict[str, Iterable[str]] | None = None, *,
                 keywords: Iterable[str] = (), plain_word_terms: Iterable[str] = ()):
        self.docs = tuple(sorted(docs, key=lambda d: sort_key(d["doc_id"])))
        self.keywords, self.plain_word_terms = tuple(keywords), tuple(plain_word_terms)
        self.term_defining = {t: frozenset(ids) for t, ids in (term_defining or {}).items()}
        self.tf: list[dict[str, float]] = []
        self.lengths: list[float] = []
        df: Counter = Counter()
        for doc in self.docs:
            weights: dict[str, float] = {}
            statement, example = _split_example(doc["text"])
            for t in tokens(statement):
                weights[t] = weights.get(t, 0.0) + 1.0
            for t in tokens(example):
                weights[t] = weights.get(t, 0.0) + EXAMPLE_WEIGHT
            for t in tokens(doc["context"]):
                weights[t] = weights.get(t, 0.0) + CONTEXT_WEIGHT
            self.tf.append(weights)
            self.lengths.append(sum(weights.values()))
            df.update(weights.keys())
        self.df = dict(df)
        self.avg_length = sum(self.lengths) / max(len(self.docs), 1)

    def scores(self, query: str, docs: Iterable[str] | None = None) -> list[tuple[float, dict, list[str]]]:
        """(score, doc, boosted-by terms) for every document scoring above zero, best first.

        ``docs`` keeps only documents whose ``doc`` is in it. Statistics (idf,
        average length) stay those of the whole corpus, so a filter only
        removes rows and never reorders the ones it keeps.
        """
        wanted = None if docs is None else frozenset(docs)
        terms = list(dict.fromkeys(tokens(query)))
        named = query_terms(query, self.keywords, self.plain_word_terms)
        n = len(self.docs)
        scored = []
        for position, doc in enumerate(self.docs):
            if wanted is not None and doc["doc"] not in wanted:
                continue
            weights, length = self.tf[position], self.lengths[position]
            score = 0.0
            for term in terms:
                tf = weights.get(term)
                if not tf:
                    continue
                idf = math.log(1 + (n - self.df[term] + 0.5) / (self.df[term] + 0.5))
                score += idf * tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * length / self.avg_length))
            if score <= 0:
                continue
            if doc["heading_only"]:
                score *= HEADING_WEIGHT
            boosted = [t for t in named if doc["rule_id"] in self.term_defining.get(t, ())]
            if boosted:
                score *= 1 + TERM_BOOST
            scored.append((round(score, 9), position, doc, boosted))
        scored.sort(key=lambda s: (-s[0], s[1]))
        return [(score, doc, boosted) for score, _, doc, boosted in scored]

    def search(self, query: str, k: int, docs: Iterable[str] | None = None) -> list[dict]:
        return [{**doc, "score": round(score, 4), "boosted_by": boosted}
                for score, doc, boosted in self.scores(query, docs)[:k]]


class LegacyChunkBM25:
    """The pre-2026-11-12 ``search_rules``: BM25 over 1200-character chunks, short stopword list, no stemming.

    Kept only so the retrieval report can show the baseline it replaced; nothing
    in the assistant calls it.
    """

    STOPWORDS = frozenset(
        "a an and are as at be by can do does for from has have how i if in is it its may of on or that the their "
        "then there this to was what when where which while who will with you your".split())

    def __init__(self, chunks: Iterable[dict]):
        self.chunks = tuple(chunks)
        self.docs = tuple(Counter(self._tokens(c["text"])) for c in self.chunks)
        df: Counter = Counter()
        for doc in self.docs:
            df.update(doc.keys())
        self.df = dict(df)
        self.avg = sum(sum(d.values()) for d in self.docs) / max(len(self.docs), 1)

    def _tokens(self, text: str) -> list[str]:
        return [t for t in TOKEN_RE.findall(_fold(text)) if t not in self.STOPWORDS]

    def search(self, query: str, k: int) -> list[dict]:
        n = len(self.docs)
        terms = list(dict.fromkeys(self._tokens(query)))
        scored = []
        for position, doc in enumerate(self.docs):
            length = sum(doc.values())
            score = 0.0
            for term in terms:
                tf = doc.get(term, 0)
                if not tf:
                    continue
                idf = math.log(1 + (n - self.df[term] + 0.5) / (self.df[term] + 0.5))
                score += idf * tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * length / self.avg))
            if score > 0:
                scored.append((-round(score, 9), position))
        scored.sort()
        return [{**self.chunks[pos], "score": round(-neg, 4)} for neg, pos in scored[:k]]


# Embedding index and fusion --------------------------------------------------------------


class IndexUnavailable(Exception):
    """The embedding index cannot be used; the message says why (shown as the fallback reason)."""


class EmbeddingIndex:
    """A loaded rules index whose ids and fingerprint match the current documents."""

    def __init__(self, stored: dict, docs: tuple[dict, ...], label: str):
        expected_ids = [d["doc_id"] for d in docs]
        if stored.get("chunks_fingerprint") is None:
            raise IndexUnavailable(f"{label} has no corpus fingerprint; rebuild it with scripts/build_rules_index.py")
        if stored["chunks_fingerprint"] != corpus_fingerprint(docs) or stored["chunk_ids"] != expected_ids:
            raise IndexUnavailable(f"{label} is stale: it was not built from the current rule-level corpus "
                                   "(rebuild it with scripts/build_rules_index.py)")
        if not stored.get("model_id"):
            raise IndexUnavailable(f"{label} does not name its embedding model")
        self.embeddings = stored["embeddings"]
        self.ids = expected_ids
        self.model_id = stored["model_id"]

    def ranking(self, query_vector, n: int) -> list[tuple[str, float]]:
        import numpy as np
        vector = np.asarray(query_vector, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(vector))
        if vector.shape[0] != self.embeddings.shape[1] or not norm:
            raise IndexUnavailable(f"query vector of size {vector.shape[0]} does not fit the index "
                                   f"({self.embeddings.shape[1]}-dim)")
        sims = self.embeddings @ (vector / norm)
        order = sorted(range(len(self.ids)), key=lambda i: (-round(float(sims[i]), 6), sort_key(self.ids[i])))
        return [(self.ids[i], round(float(sims[i]), 6)) for i in order[:n]]


def rrf(rankings: Iterable[Iterable[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Reciprocal rank fusion: score(d) = sum over rankings of 1 / (k + rank). Ties break on ``sort_key``."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, 1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(((d, round(s, 9)) for d, s in scores.items()), key=lambda x: (-x[1], sort_key(x[0])))

