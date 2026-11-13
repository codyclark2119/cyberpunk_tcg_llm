#!/usr/bin/env python3
"""Tests for search_rules retrieval: rule-level lexical search, the hybrid index path and the recall report.

Why: retrieval decides which rules the assistant's model ever sees, and on
Cody's quiz the old chunk search mostly showed it headings and one recurring
rule. Each behaviour the fix relies on is pinned here by calling the code, not
by reading committed output: every rule is indexed with its heading path,
heading-only rows lose to rules with a body, stemming and stopwords work, a
named keyword or trigger pulls up its glossary rules, ranking is deterministic
whatever order the rules arrive in, the recall script produces its documented
shape, the hybrid path fuses a (fake) embedding ranking and falls back with a
reason when the index is stale, and the Eval tab's retrieval routes and script
hold the page's rules (loopback Host only, no HTML injection, script parses).
The Tournament Rules rows ("TR 3.4.2") join the same index: each document
carries ``doc``, a filter removes rows without reordering, their ids sort
apart, and adding them leaves every comprehensive document as it was.

No model, no network, no real index: the embedding side runs on a fake
embedder writing a temporary index through ``harness.core.rag.index.write_index``.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from games.cyberpunk import config  # noqa: E402
from games.cyberpunk.assistant import retrieval, tools  # noqa: E402
from games.cyberpunk.assistant.tools import (HYBRID_METHOD, LEGACY_CHUNK_METHOD, LEXICAL_METHOD,  # noqa: E402
                                             search_rules)
from games.cyberpunk.assistant_app import ASSISTANT_HTML, ChatService, build_assistant_app  # noqa: E402
from harness.core.io import read_jsonl  # noqa: E402
from harness.core.rag.index import read_index, write_index  # noqa: E402

LOCAL = {"host": "127.0.0.1:8767"}
CTX: dict = {}
EXPECTED = REPO_ROOT / "eval/sets/quiz_mc_expected_rules_draft.jsonl"
QUIZ = REPO_ROOT / "data/gold/quiz_mc_2026-11-12.jsonl"
DIM = 256
HAND_RULE = "rule:5.4.5"  # "There is no limit to the number of cards allowed in your hand."


def scorer():
    if "scorer" not in CTX:
        spec = importlib.util.spec_from_file_location("eval_retrieval", REPO_ROOT / "scripts/eval_retrieval.py")
        module = importlib.util.module_from_spec(spec)
        sys.path.insert(0, str(REPO_ROOT / "scripts"))
        spec.loader.exec_module(module)
        CTX["scorer"] = module
    return CTX["scorer"]


def fake_embed(texts) -> np.ndarray:
    """Hashed bag of tokens, plus one planted direction: rule 5.4.5 and a "how big may my grip grow" query share e0.

    The plant makes the embedding side find a rule lexical search misses, so a
    fused result that contains it proves the fusion ran.
    """
    out = np.zeros((len(texts), DIM), dtype=np.float32)
    for row, text in enumerate(texts):
        if "no limit to the number of cards allowed in your hand" in text or text.startswith("how big may my grip grow"):
            out[row, 0] = 10.0
        for token in retrieval.tokens(text):
            out[row, 1 + int(hashlib.sha256(token.encode()).hexdigest(), 16) % (DIM - 1)] += 1.0
        out[row, DIM - 1] += 0.01  # never a zero vector
    return out


@contextlib.contextmanager
def fake_index(*, chunks=None, embedder=None, factory=None):
    """Point search_rules at a temporary index built from ``chunks`` (default: the current corpus)."""
    saved = (tools.RULES_INDEX_PATH, tools.EMBEDDER_FACTORY)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "rules_index.npz"
        chunks = retrieval.embedding_chunks(tools.rule_docs()) if chunks is None else chunks
        write_index(chunks, fake_embed([c["text"] for c in chunks]), path, "fake/hash-embedder")
        tools.RULES_INDEX_PATH = path
        tools.EMBEDDER_FACTORY = factory or (lambda model_id: embedder or fake_embed)
        tools._INDEX_CACHE.clear()
        tools._EMBEDDERS.clear()
        try:
            yield path
        finally:
            tools.RULES_INDEX_PATH, tools.EMBEDDER_FACTORY = saved
            tools._INDEX_CACHE.clear()
            tools._EMBEDDERS.clear()


@contextlib.contextmanager
def no_index():
    with tempfile.TemporaryDirectory() as tmp:
        saved = tools.RULES_INDEX_PATH
        tools.RULES_INDEX_PATH = Path(tmp) / "missing.npz"
        tools._INDEX_CACHE.clear()
        try:
            yield
        finally:
            tools.RULES_INDEX_PATH = saved
            tools._INDEX_CACHE.clear()


def top_ids(query: str, n: int = 3) -> list[str]:
    return [h["doc_id"] for h in tools.lexical_search(query, n)]


# Rule-level lexical index -----------------------------------------------------------------------


def test_rule_level_index_covers_all_rules_with_heading_paths():
    rows = read_jsonl(config.RULES_PATH)
    tournament = read_jsonl(config.TOURNAMENT_RULES_PATH)
    errata = read_jsonl(config.ERRATA_CHUNKS_PATH)
    docs = tools.rule_docs()
    assert len(rows) == 713 and len(tournament) == 87
    assert {d["rule_id"] for d in docs if d["source"] == "rule"} == {r["id"] for r in rows + tournament}
    assert sorted(d["doc_id"] for d in docs if d["source"] == "errata") == sorted(c["chunk_id"] for c in errata)
    assert len(docs) == len(rows) + len(tournament) + len(errata) == len(tools.lexical_index().docs)
    assert {d["doc"] for d in docs if d["rule_id"] in {r["id"] for r in tournament}} == {"tournament"}
    assert {d["doc"] for d in docs if d["source"] == "errata"} == {"errata"}
    by_id = {d["doc_id"]: d for d in docs}
    # Heading ancestors only: "Lag" names 11.3.1.1's topic; its sentence parent 11.3.1 is not in the path.
    assert by_id["rule:11.3.1.1"]["path"] == ["TERMS", "General Terms", "Lag"], by_id["rule:11.3.1.1"]["path"]
    assert by_id["rule:11.24.1"]["path"][-1] == "[BLOCKER]"
    assert by_id["rule:11.24"]["heading_only"] and by_id["rule:1"]["heading_only"]
    assert not by_id["rule:11.24.1"]["heading_only"] and not by_id["rule:5.4.5"]["heading_only"]
    assert by_id["rule:3.20"]["heading_only"], "a heading followed only by a figure caption has no body"
    # A rule found only through its heading path: the query word "lag" is not in 4.7's neighbour 11.3.1.2's
    # text ("Lagging Units can't activate [Spend Icon] effects") except through the stem and the path.
    assert "rule:11.3.1.2" in top_ids("lag spend icon effects", 3)


def test_heading_path_and_example_words_carry_their_weights():
    rows = [{"id": "11.3", "kind": "rule", "title": "Lag", "text": "11.3. ### Lag", "parent": None},
            {"id": "11.3.1", "kind": "rule", "title": "x", "parent": "11.3",
             "text": "11.3.1. Units can't attack.\n\n> **EXAMPLE:** A Unit played this turn."}]
    index = retrieval.LexicalIndex(retrieval.build_rule_docs(rows))
    child = index.tf[[d["doc_id"] for d in index.docs].index("rule:11.3.1")]
    assert child == {"11.3.1": 1.0, "unit": 1.0 + retrieval.EXAMPLE_WEIGHT, "attack": 1.0,
                     "example": retrieval.EXAMPLE_WEIGHT, "play": retrieval.EXAMPLE_WEIGHT,
                     "turn": retrieval.EXAMPLE_WEIGHT, "lag": retrieval.CONTEXT_WEIGHT}, child
    # The heading path finds a rule whose body never says the heading's word.
    assert [h["rule_id"] for h in index.search("lag", 5)] == ["11.3.1", "11.3"]
    # A rule that states something outranks one that only shows it in a short example.
    stolen = [{"id": "2.1", "kind": "rule", "title": "x", "parent": None,
               "text": "2.1. When an attack ends, a stolen Gig moves to the attacking player's Gig area and stays."},
              {"id": "2.2", "kind": "rule", "title": "x", "parent": None,
               "text": "2.2. Units fight.\n\n> **EXAMPLE:** A stolen Gig."},
              {"id": "2.3", "kind": "rule", "title": "x", "parent": None, "text": "2.3. About decks."}]
    ranked = retrieval.LexicalIndex(retrieval.build_rule_docs(stolen)).search("stolen gig", 3)
    assert [h["rule_id"] for h in ranked] == ["2.1", "2.2"], ranked


def test_heading_only_rows_are_never_top_for_a_body_query():
    for query, heading in (("Rarity", "rule:3.16"), ("Blocker", "rule:11.24"), ("What does Go Solo do?",
                                                                                  "rule:11.25")):
        hits = tools.lexical_search(query, 10)
        assert not hits[0]["heading_only"], (query, hits[0]["doc_id"])
        assert heading in [h["doc_id"] for h in hits], (query, "a heading row is down-weighted, not dropped")
    quiz = {i["id"]: i for i in read_jsonl(QUIZ)}
    for row in read_jsonl(EXPECTED):
        if row["expected_rule_ids"]:
            hit = tools.lexical_search(scorer().query_for(quiz[row["id"]]), 1)[0]
            assert not hit["heading_only"], (row["id"], hit["doc_id"])


def test_stemming_and_stopwords():
    for word, stem in (("lagging", "lag"), ("attacked", "attack"), ("gigs", "gig"), ("equipped", "equip"),
                       ("readied", "ready"), ("copies", "copy"), ("textboxes", "textbox"), ("called", "call"),
                       ("rules", "rule"), ("spent", "spent"), ("class", "class"), ("add", "add")):
        assert retrieval.stem(word) == stem, (word, retrieval.stem(word), stem)
    assert retrieval.tokens("Can I use a Unit's Blocker effect? Yes / No") == ["use", "unit", "blocker", "effect"]
    assert retrieval.tokens("See rule 11.24.3") == ["see", "rule", "11.24.3"], "rule numbers stay whole"
    assert retrieval.tokens("The") == [] and retrieval.tokens("Équipped") == ["equip"]
    # Stemming is what joins "stealing gigs" to the rule that defines stealing a Gig.
    assert "rule:6.7" in top_ids("stealing gigs from a rival", 3)


def test_named_term_pulls_up_its_defining_glossary_rules():
    defining = set(tools.term_rules("Quick")["defining"])
    assert tools.lexical_search("When does a Quick effect resolve?", 1)[0]["rule_id"] in defining
    assert tools.lexical_search("When does a Quick effect resolve?", 1)[0]["boosted_by"] == ["Quick"]
    play = set(tools.term_rules("Play")["defining"])
    assert tools.lexical_search("does my Play effect trigger when called", 1)[0]["rule_id"] in play
    keywords, plain = tools.markup.KEYWORDS, tools.markup.TIMING_TRIGGERS + tools.markup.SYMBOLS
    assert retrieval.query_terms("Can I play a card or attack on my rival's turn?", keywords, plain) == []
    assert retrieval.query_terms("its Play effect, [CALL], {Spend} and DEFEATED", keywords, plain) == [
        "Play", "Call", "Defeated", "Spend"]
    assert retrieval.query_terms("a go-solo legend with quick and blocker", keywords, plain) == [
        "Go Solo", "Quick", "Blocker"]


def test_ranking_is_deterministic_whatever_the_input_order():
    rows = read_jsonl(config.RULES_PATH)
    errata = read_jsonl(config.ERRATA_CHUNKS_PATH)
    forward = retrieval.build_rule_docs(rows, errata)
    backward = retrieval.build_rule_docs(list(reversed(rows)), list(reversed(errata)))
    assert forward == backward
    defining = {t: tools.term_rules(t)["defining"] for t in ("Blocker", "Quick")}
    a = retrieval.LexicalIndex(forward, defining, keywords=("Blocker", "Quick"))
    b = retrieval.LexicalIndex(tuple(reversed(backward)), defining, keywords=("Blocker", "Quick"))
    for query in ("when can a blocker redirect an attack", "gig dice", "Quick effect during the React step"):
        assert a.search(query, 10) == b.search(query, 10) == a.search(query, 10), query
    # Ties break on rule number, never on arrival order: two copies of one text rank 2.1 before 10.1.
    twins = [{"id": i, "kind": "rule", "title": "x", "text": f"{i}. Gigs are stolen.", "section": "s",
              "parent": None} for i in ("10.1", "2.1")]
    ranked = retrieval.LexicalIndex(retrieval.build_rule_docs(twins)).search("gigs stolen", 2)
    assert [h["rule_id"] for h in ranked] == ["2.1", "10.1"] and ranked[0]["score"] == ranked[1]["score"]
    assert search_rules("gig dice", k=4) == search_rules("gig dice", k=4)


# The recall report ------------------------------------------------------------------------------


def test_expected_rules_draft_is_a_labelled_draft():
    rows = read_jsonl(EXPECTED)
    quiz_ids = [i["id"] for i in read_jsonl(QUIZ)]
    assert [r["id"] for r in rows] == quiz_ids
    assert all(r["status"] == "draft" and r["authored_by"] == "Claude (unreviewed)" for r in rows)
    assert sum(1 for r in rows if r["expected_rule_ids"]) == 36
    empty = {r["id"][-2:] for r in rows if not r["expected_rule_ids"]}
    assert empty == {"03", "06", "15", "39"}, "only card-text questions have no expected rule"
    assert all(r.get("reason") for r in rows if not r["expected_rule_ids"])
    known = tools.rules_by_id()
    assert all(i in known for r in rows for i in r["expected_rule_ids"])
    # The policy questions are answered from the Tournament Rules; 18 and 21 from both documents.
    policy = {r["id"][-2:]: r["expected_rule_ids"] for r in rows if any(i.startswith("TR ") for i in r["expected_rule_ids"])}
    assert set(policy) == {"02", "07", "16", "18", "20", "21", "27", "38"}, policy
    assert policy["18"] == ["1.3", "TR 2.4.4"] and policy["21"] == ["7.3.3", "TR D.1"]


def test_recall_report_has_the_documented_shape():
    s = scorer()
    assert s.matches("4.12", "4.12") and s.matches("4.12", "4.12.1") and s.matches("4.12.1", "4.12")
    assert not s.matches("4", "4.12.1") and not s.matches("4.12.1", "4") and not s.matches("4.12", "4.13")
    assert not s.matches("rule-abc", "4.12") and not s.matches("4.1", "4.12"), "parent is by number, not prefix"
    assert s.matches("TR 3.4", "TR 3.4.2") and s.matches("TR A.1.2", "TR A.1") and s.matches("TR B", "TR B")
    assert not s.matches("3.4", "TR 3.4.2") and not s.matches("TR 3.4.2", "3.4.2") and not s.matches("TR 3.4", "3.4")
    item = {"id": "x", "question": "Can Units attack?", "choices": [{"letter": "A", "text": "Yes"},
                                                                    {"letter": "B", "text": "No"}]}
    assert s.query_for(item) == "Can Units attack?\nA. Yes\nB. No"
    assert s.query_for(item, "wrapper-block") == "Question: Can Units attack?\n\nChoices:\nA. Yes\nB. No"
    with no_index():
        report = s.build_report(s.DEFAULT_EXPECTED, s.DEFAULT_QUESTIONS, None)
        again = s.build_report(s.DEFAULT_EXPECTED, s.DEFAULT_QUESTIONS, None)
    assert s.dumps(report) == s.dumps(again), "the report is deterministic"
    assert report["kind"] == "retrieval-report" and report["report_version"] == "retrieval-recall-v1"
    assert report["scored"] == 36 and len(report["skipped"]) == 4 and report["ks"] == [1, 5, 10]
    assert report["rules_version"] == "2026-09-01" and report["tournament_rules_version"] == "2026-10-28"
    assert report["expected_status"] == ["draft"] and report["query_form"] == "question-choices"
    assert list(report["methods"]) == [LEGACY_CHUNK_METHOD, LEXICAL_METHOD, "embedding", HYBRID_METHOD]
    for name in (LEGACY_CHUNK_METHOD, LEXICAL_METHOD):
        m = report["methods"][name]
        assert m["available"] and len(m["items"]) == 36
        assert 0 <= m["recall@1"] <= m["recall@5"] <= m["recall@10"] <= 1
        assert m["hits@10"] == sum(1 for i in m["items"] if i["first_hit_rank"] and i["first_hit_rank"] <= 10)
        for i in m["items"]:
            assert set(i) == {"id", "expected", "first_hit_rank", "found", "chars", "top"}
            assert len(i["top"]) <= 10 and set(i["found"]) == {"@1", "@5", "@10"}
    for name in ("embedding", HYBRID_METHOD):
        assert report["methods"][name] == {"available": False, "reason": report["methods"][name]["reason"]}
        assert "no rules index" in report["methods"][name]["reason"]
    # Rule-level passages carry far less text than 1200-character chunks. Less so since the Tournament Rules
    # joined: some of their rows are long (TR A.2.2, the infraction list, is ~15k characters).
    assert report["methods"][LEXICAL_METHOD]["chars@10"] < report["methods"][LEGACY_CHUNK_METHOD]["chars@10"] / 2
    with tempfile.TemporaryDirectory() as tmp, no_index(), contextlib.redirect_stdout(None):
        argv = ["--name", "r1", "--reports-dir", tmp, "--methods", LEXICAL_METHOD, "--quiet"]
        assert s.main(argv) == 0
        written = json.loads((Path(tmp) / "r1.json").read_text())
        assert list(written["methods"]) == [LEXICAL_METHOD]
        try:
            s.main(argv)
            raise AssertionError("an existing report was overwritten without --force")
        except SystemExit as exc:
            assert "exists" in str(exc)
        assert s.main(argv + ["--force"]) == 0


# Hybrid retrieval and its fallback --------------------------------------------------------------


def test_tournament_rows_join_without_changing_the_comprehensive_documents():
    rows = read_jsonl(config.RULES_PATH)
    tournament = read_jsonl(config.TOURNAMENT_RULES_PATH)
    errata = read_jsonl(config.ERRATA_CHUNKS_PATH)
    alone = {d["doc_id"]: d for d in retrieval.build_rule_docs(rows, errata)}
    both = {d["doc_id"]: d for d in tools.rule_docs()}
    assert all(both[k] == v for k, v in alone.items()), "a comprehensive document changed"
    # Heading path: the document's name first, then its section titles (sections with a body included).
    assert both["rule:TR 3.4.2"]["path"] == ["Tournament Rules", "Tournament Play", "Game Procedure"]
    assert both["rule:TR A.1.2"]["path"] == ["Tournament Rules", "Penalties & Infractions", "Penalties"]
    # A Tournament Rules section with a body is content; one without is a heading. (In the comprehensive
    # rules every section is a heading, figure captions included: rule 5 above has a body and stays one.)
    assert not both["rule:TR B"]["heading_only"] and not both["rule:TR A.1"]["heading_only"]
    assert both["rule:TR 1"]["heading_only"] and both["rule:TR A"]["heading_only"]
    assert both["rule:5"]["heading_only"]
    # A "TR A.1.2." number is read as a rule number, as "9.2.3." is: a row that is only a number and a
    # heading line is a heading.
    lone = [{"id": "TR A.9", "doc": "tournament", "kind": "rule", "title": "Odd", "text": "TR A.9. ### Odd"},
            {"id": "TR A.8", "doc": "tournament", "kind": "rule", "title": "Odd", "text": "TR A.8. ### Odd\n\nA body."}]
    assert [d["heading_only"] for d in retrieval.build_rule_docs(lone)] == [False, True]
    # A capital letter opening a comprehensive row is not taken for an appendix number.
    assert retrieval.build_rule_docs([{"id": "x", "kind": "rule", "title": "x", "text": "Units fight."}])[0][
        "heading_only"] is False
    # Ids sort apart: comprehensive by number, its anchors, TR by number (digits before letters), TR anchors.
    order = ["rule:2.1", "rule:10.1", "rule:rule-abc", "rule:TR 2.9", "rule:TR 2.10", "rule:TR A.1",
             "rule:TR B", "rule:TR rule-abc", "errata:x:01"]
    assert sorted(reversed(order), key=retrieval.sort_key) == order
    # Determinism over both documents: arrival order changes nothing.
    forward = retrieval.build_rule_docs(rows + tournament, errata)
    backward = retrieval.build_rule_docs(list(reversed(tournament)) + list(reversed(rows)), list(reversed(errata)))
    assert forward == backward == tools.rule_docs()
    a, b = retrieval.LexicalIndex(forward), retrieval.LexicalIndex(tuple(reversed(backward)))
    for query in ("unsporting conduct penalty", "dice check at a competition event", "gig dice"):
        assert a.search(query, 10) == b.search(query, 10), query
        assert a.search(query, 10, ("tournament",)) == [h for h in a.search(query, 2000)
                                                        if h["doc"] == "tournament"][:10], query
    try:
        retrieval.build_rule_docs([{"id": "x", "kind": "rule", "title": "x", "text": "x", "doc": "policy"}])
        raise AssertionError("an unknown document name was accepted")
    except ValueError:
        pass


def test_rrf_fuses_rankings_deterministically():
    assert retrieval.rrf([["rule:1.1", "rule:1.2"], ["rule:1.2", "rule:1.3"]])[0][0] == "rule:1.2"
    tie = retrieval.rrf([["rule:10.1"], ["rule:2.1"]])
    assert [d for d, _ in tie] == ["rule:2.1", "rule:10.1"] and tie[0][1] == tie[1][1] == round(1 / 61, 9)


def test_hybrid_search_fuses_a_fake_embedding_ranking():
    query = "how big may my grip grow"
    with no_index():
        lexical = ok(search_rules(query, k=3))
        assert HAND_RULE not in [r["chunk_id"] for r in lexical["results"]], "the plant must be lexically missed"
    with fake_index():
        assert tools.index_status()["usable"] and tools.index_status()["model_id"] == "fake/hash-embedder"
        stored = read_index(tools.RULES_INDEX_PATH)
        assert np.allclose(np.linalg.norm(stored["embeddings"], axis=1), 1.0), "write_index normalises rows"
        result = search_rules(query, k=3)
        found = ok(result)
        assert found["method"] == HYBRID_METHOD and "fallback_reason" not in found
        hand = next(r for r in found["results"] if r["chunk_id"] == HAND_RULE)
        assert hand["rule_ids"] == ["5.4.5"] and "embedding" in hand["matched_by"] and hand["path"]
        assert result["sources"]["rule_ids"] == [i for r in found["results"] for i in r["rule_ids"]]
        assert search_rules(query, k=3) == result, "hybrid search is deterministic"
        methods = tools.retrieval_methods()
        assert methods["embedding"]["search"] and methods[HYBRID_METHOD]["search"]


def test_stale_or_unusable_index_falls_back_with_a_reason():
    chunks = retrieval.embedding_chunks(tools.rule_docs())
    edited = [dict(c, text=c["text"] + " (edited)") if c["chunk_id"] == "rule:1.1" else c for c in chunks]
    with fake_index(chunks=edited):
        found = ok(search_rules("when can a blocker redirect an attack", k=3))
        assert found["method"] == LEXICAL_METHOD and "stale" in found["fallback_reason"], found
        assert not tools.index_status()["usable"] and tools.retrieval_methods()[HYBRID_METHOD]["search"] is None
    with fake_index(chunks=chunks[:-1]):
        assert "stale" in ok(search_rules("blocker", k=2))["fallback_reason"]

    def no_model(model_id):
        raise ModuleNotFoundError("No module named 'mlx_embeddings'")
    with fake_index(factory=no_model):
        found = ok(search_rules("blocker", k=2))
        assert found["method"] == LEXICAL_METHOD and "embedding model unavailable" in found["fallback_reason"]
    with no_index():
        found = ok(search_rules("when can a blocker redirect an attack", k=3))
        assert found["method"] == LEXICAL_METHOD and "no rules index" in found["fallback_reason"]
    # An index built before the Tournament Rules joined (comprehensive rules and errata only) is stale.
    before = retrieval.build_rule_docs(tools.rules(), read_jsonl(config.ERRATA_CHUNKS_PATH))
    with fake_index(chunks=retrieval.embedding_chunks(before)):
        found = ok(search_rules("when can a blocker redirect an attack", k=3))
        assert found["method"] == LEXICAL_METHOD and "stale" in found["fallback_reason"], found
        assert tools.index_status()["documents"] == len(before) + 87


# The Eval tab's retrieval panel -----------------------------------------------------------------


def ok(result: dict) -> dict:
    assert result["ok"] is True, result
    json.dumps(result)
    return result["result"]


def test_retrieval_routes_and_actions():
    with tempfile.TemporaryDirectory() as tmp, no_index():
        reports = Path(tmp)
        s = scorer()
        with contextlib.redirect_stdout(None):
            s.main(["--name", "quiz-a", "--reports-dir", tmp, "--quiet"])
        (reports / "other.json").write_text(json.dumps({"kind": "something-else"}))
        app = build_assistant_app(chat=ChatService(object(), model_path="m"), reports_dir=reports)
        with TestClient(app) as client:
            overview = client.get("/api/eval/retrieval", headers=LOCAL).json()
            assert overview["index"]["usable"] is False and "no rules index" in overview["index"]["reason"]
            assert [r["name"] for r in overview["reports"]] == ["quiz-a.json"], "other report kinds are skipped"
            methods = overview["reports"][0]["methods"]
            assert methods[LEXICAL_METHOD]["available"] and set(methods[LEXICAL_METHOD]) == {
                "available", "recall@1", "recall@5", "recall@10", "coverage@10", "chars@10"}
            assert methods[HYBRID_METHOD]["available"] is False
            one = client.get("/api/eval/retrieval/quiz-a.json", headers=LOCAL)
            assert one.status_code == 200 and one.json()["report"]["scored"] == 36
            assert client.get("/api/eval/retrieval/nope.json", headers=LOCAL).status_code == 404
            for bad in ("other.json", "..%2Fx.json", "quiz-a.jsonl"):
                assert client.get("/api/eval/retrieval/" + bad, headers=LOCAL).status_code in (400, 404), bad
            for path in ("/api/eval/retrieval", "/api/eval/retrieval/quiz-a.json"):
                for host in ("evil.example:8767", "192.168.1.5:8767", ""):
                    assert client.get(path, headers={"host": host}).status_code == 403, (path, host)
                assert client.get(path, headers={**LOCAL, "origin": "http://evil.example"}).status_code == 403
            assert client.post("/api/run/build-rules-index", json={"values": {}},
                               headers={"host": "evil.example"}).status_code == 403
            runner = app.state.runner
            build = runner.actions_by_id["build-rules-index"]
            assert runner.build_cmd(build, {}) == [sys.executable, "scripts/build_rules_index.py"]
            measure = runner.actions_by_id["eval-retrieval"]
            assert runner.build_cmd(measure, {"name": "quiz-b"}) == [
                sys.executable, "scripts/eval_retrieval.py", "--name", "quiz-b", "--quiet", "--reports-dir", tmp]
            assert "--force" in runner.build_cmd(measure, {"name": "quiz-a", "force": True})
            for action, values in ((build, {"out": "/etc/x"}), (build, {"force": True}), (measure, {}),
                                   (measure, {"name": "--force"}), (measure, {"name": "../x"}),
                                   (measure, {"name": "quiz-a"}), (measure, {"name": "ok", "force": "yes"}),
                                   (measure, {"name": "ok", "methods": "x"})):
                try:
                    runner.build_cmd(action, values)
                    raise AssertionError(f"accepted {action['id']} {values}")
                except ValueError:
                    pass


def test_retrieval_panel_script_parses_and_renders_rows():
    blocks = re.findall(r"<script>(.*?)</script>", ASSISTANT_HTML, re.S)
    assert len(blocks) == 1
    script = blocks[0]
    proc = subprocess.run([CTX["node"], "-e", "new Function(require('fs').readFileSync(0, 'utf8'))"],
                          input=script, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[:600]
    for needle in ('id="retrBuildBtn"', 'id="retrMeasureBtn"', 'id="retrReports"', 'id="retrIndex"'):
        assert needle in ASSISTANT_HTML, needle
    panel = script[script.index("// Retrieval panel"):script.index("// Wiring")]
    for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"):
        assert banned not in panel, banned
    pure = script[script.index("// pure:start"):script.index("// pure:end")]
    report = {"methods": {"a": {"available": True, "recall@1": 0.5, "recall@5": 0.7667, "recall@10": 1,
                                "chars@10": 1475.4},
                          "b": {"available": False, "reason": "no rules index"}}}
    program = (f'"use strict";\n{pure}\nprocess.stdout.write(JSON.stringify([retrievalRows({json.dumps(report)}),'
               f'retrievalRows(null)]));')
    out = subprocess.run([CTX["node"], "-e", program], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[:600]
    rows, empty = json.loads(out.stdout)
    assert rows == [{"method": "a", "cells": ["50.0%", "76.7%", "100.0%", "1475"]},
                    {"method": "b", "cells": ["unavailable: no rules index"]}] and empty == []


def run(node: str) -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["node"] = node
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS assistant retrieval: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    run(args.node)


if __name__ == "__main__":
    main()
