#!/usr/bin/env python3
"""Tests for the local assistant's card and rules tools and their loopback Tools page.

Why: the assistant's model gets every card and rule fact from these tools, so a
tool that guessed between same-named cards, dropped an erratum, ignored a
filter, misreported which search ran, or let a bad argument through would put
a wrong fact in front of the model looking authoritative. Each test runs a
tool on the committed snapshot in ``data/processed/`` (no model, no network,
no index build) and checks a fact that can be read off that data by hand. The
page tests call the app in process through FastAPI's TestClient (fastapi and
httpx) and parse the page's inline script with node.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from games.cyberpunk import config
from games.cyberpunk.assistant import tools
from games.cyberpunk.assistant.tools import (LEXICAL_METHOD, TOOLS, call_tool, card_interactions, find_card,
                                             get_card, get_rule, search_cards, search_rules, tool_specs)
from games.cyberpunk.assistant_app import ASSISTANT_HTML, build_assistant_app, host_allowed
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.io import read_jsonl

CTX: dict = {}
LOCAL = {"host": "127.0.0.1:8767"}


def ok(result: dict) -> dict:
    assert result["ok"] is True, result
    assert result["rules_version"] == RULES_VERSION
    json.dumps(result)  # JSON-serialisable, or this raises
    return result["result"]


def refused(result: dict, kind: str) -> dict:
    assert result["ok"] is False and result["error_kind"] == kind, result
    assert result["error"] and result["rules_version"] == RULES_VERSION
    json.dumps(result)
    return result


def test_find_card_reports_every_shared_name_and_never_guesses():
    result = find_card("V")
    found = ok(result)
    assert found["match_kind"] == "name" and found["ambiguous"] is True
    assert [m["slug"] for m in found["matches"]] == ["v-corporate-exile", "v-roamer-of-the-badlands", "v-streetkid"]
    assert {m["subname"] for m in found["matches"]} == {"Corporate Exile", "Roamer of the Badlands", "Streetkid"}
    assert result["sources"]["card_slugs"] == [m["slug"] for m in found["matches"]]
    # Every shared name in the snapshot comes back ambiguous with all of its cards.
    cards = read_jsonl(config.CARD_DATABASE_PATH)
    names = {}
    for card in cards:
        names.setdefault(card["name"], set()).add(card["id"])
    shared = {n: s for n, s in names.items() if len(s) > 1}
    assert len(shared) == 16, len(shared)
    for name, slugs in shared.items():
        hit = ok(find_card(name))
        assert hit["ambiguous"] and {m["slug"] for m in hit["matches"]} == slugs, name


def test_find_card_exact_partial_accent_and_none():
    exact = ok(find_card("v: streetkid"))
    assert exact["match_kind"] == "display_name" and not exact["ambiguous"]
    assert [m["slug"] for m in exact["matches"]] == ["v-streetkid"]
    by_slug = ok(find_card("kiroshi-optics"))
    assert by_slug["match_kind"] == "slug" and by_slug["matches"][0]["slug"] == "kiroshi-optics"
    accentless = ok(find_card("judy alvarez"))
    assert accentless["ambiguous"] and all(m["name"] == "Judy Álvarez" for m in accentless["matches"])
    partial = ok(find_card("streetk"))
    assert partial["match_kind"] == "partial" and [m["slug"] for m in partial["matches"]] == ["v-streetkid"]
    nothing = ok(find_card("no such card anywhere"))
    assert nothing["matches"] == [] and nothing["match_kind"] == "none" and not nothing["ambiguous"]
    capped = ok(find_card("a", limit=3))
    assert len(capped["matches"]) == 3 and capped["truncated"] and capped["count"] > 3


def test_get_card_returns_facts_with_errata_attached():
    result = get_card("nocturne-op55-n1")
    card = ok(result)
    assert card["card"]["slug"] == "nocturne-op55-n1" and card["card"]["card_type"] == "Program"
    for field in ("name", "subname", "display_name", "card_type", "color", "cost", "power", "ram", "keywords",
                  "keywords_referenced", "timing_triggers", "text", "text_markup", "legality", "printings"):
        assert field in card["card"], field
    errata = read_jsonl(config.ERRATA_PATH)
    expected = [e for e in errata if e["card_id"] == "nocturne-op55-n1"]
    assert len(expected) == 1 and card["has_errata"] is True
    assert [e["id"] for e in card["errata"]] == [expected[0]["id"]] == result["sources"]["errata_ids"]
    assert card["errata"][0]["text"] == expected[0]["text"] and card["errata"][0]["supersedes_printed_text"]
    assert "supersede" in card["errata_note"]
    # The rendered text carries the erratum last, after the printed text it overrides.
    rendered = card["text_with_errata"]
    assert rendered.rindex("ERRATA") > rendered.index("Rules text:")
    assert rendered.rstrip().endswith("This supersedes the printed text above.")
    # Every erratum in the snapshot reaches its card.
    for entry in errata:
        assert any(e["id"] == entry["id"] for e in ok(get_card(entry["card_id"]))["errata"]), entry["id"]
    plain = ok(get_card("v-streetkid"))
    assert plain["has_errata"] is False and plain["errata"] == [] and "errata_note" not in plain
    assert plain["card"]["keywords"] == ["Go Solo"] and plain["card"]["timing_triggers"] == ["Call"]


def test_unknown_slug_and_bad_arguments_fail_closed():
    missing = refused(get_card("no-such-card"), "not_found")
    assert "find_card" in missing["error"] and missing["sources"]["card_slugs"] == []
    near = refused(get_card("nocturne"), "not_found")
    assert near["did_you_mean"] == ["nocturne-op55-n1"]
    refused(get_card("V: Streetkid"), "invalid_arguments")  # a name is not a slug
    refused(call_tool("get_card", {}), "invalid_arguments")
    refused(call_tool("get_card", {"slug": 7}), "invalid_arguments")
    refused(call_tool("get_card", {"slug": "v-streetkid", "extra": 1}), "invalid_arguments")
    refused(call_tool("get_card", ["v-streetkid"]), "invalid_arguments")
    refused(call_tool("search_cards", {"cost_min": True}), "invalid_arguments")
    refused(call_tool("search_cards", {"color": "Purple"}), "invalid_arguments")
    refused(call_tool("search_cards", {"cost_min": 5, "cost_max": 2}), "invalid_arguments")
    refused(call_tool("search_cards", {"text": "   "}), "invalid_arguments")
    refused(call_tool("search_rules", {"query": "the of"}), "invalid_arguments")
    refused(call_tool("search_rules", {"query": "blocker", "k": 0}), "invalid_arguments")
    refused(call_tool("get_rule", {"rule_id": "nine"}), "invalid_arguments")
    refused(call_tool("card_interactions", {"slug_a": "v-streetkid", "slug_b": "nope"}), "not_found")
    refused(call_tool("delete_everything", {}), "unknown_tool")
    refused(call_tool(None, {}), "unknown_tool")


def test_search_cards_filters_match_the_snapshot():
    cards = read_jsonl(config.CARD_DATABASE_PATH)

    def slugs(result):
        return [c["slug"] for c in ok(result)["cards"]]

    red_blockers = sorted(c["id"] for c in cards if c["color"] == "Red" and "Blocker" in c["keywords"])
    assert red_blockers and slugs(search_cards(color="Red", keyword="Blocker")) == red_blockers
    mid_units = sorted(c["id"] for c in cards if c["card_type"] == "Unit" and c["cost"] is not None
                       and 2 <= c["cost"] <= 3 and c["power"] is not None and c["power"] >= 3)
    assert slugs(search_cards(card_type="Unit", cost_min=2, cost_max=3, power_min=3, limit=200)) == mid_units
    refers = sorted(c["id"] for c in cards if "Blocker" in c["keywords_referenced"])
    assert refers and slugs(search_cards(referenced_keyword="Blocker")) == refers
    assert not set(refers) & set(slugs(search_cards(keyword="Blocker"))), "referenced keywords are not printed ones"
    defeated = sorted(c["id"] for c in cards if "Defeated" in c["timing_triggers"])
    assert len(defeated) == 7 and slugs(search_cards(timing_trigger="Defeated")) == defeated
    braindance = sorted(c["id"] for c in cards if "braindance" in c["text"].casefold())
    assert braindance and slugs(search_cards(text="BRAINDANCE", limit=200)) == braindance
    programs = ok(search_cards(card_type="Program", power_min=0))
    assert programs["count"] == 0, "a Program has no power, so a power filter excludes it"
    everything = ok(search_cards(limit=10))
    assert everything["count"] == len(cards) and everything["truncated"] and len(everything["cards"]) == 10


def test_get_rule_with_section_context():
    result = get_rule("9.9")
    rule = ok(result)
    assert rule["rule"]["id"] == "9.9" and "[BLOCKER]" in rule["rule"]["text"]
    assert rule["rule"]["section"] == "9. ATTACK, FIGHT, AND STEAL"
    assert [p["title"] for p in rule["path"]] == ["ATTACK, FIGHT, AND STEAL", "React Step"]
    assert [c["id"] for c in rule["children"]] == ["9.9.1"]
    assert result["sources"]["rule_ids"][0] == "9.9"
    glossary = ok(get_rule("11.24."))  # a trailing period, as cited in prose
    assert glossary["rule"]["id"] == "11.24" and [p["title"] for p in glossary["path"]][-1] == "Effect Keywords"
    assert [c["id"] for c in glossary["children"]] == ["11.24.1", "11.24.2", "11.24.3"]
    referencing = ok(get_rule("1.14.1"))
    assert referencing["references"] == [{"id": "11.5", "title": "Draw", "kind": "rule", "numbered": True}]
    assert any(r["id"] == "1.14.1" for r in ok(get_rule("11.5"))["referenced_by"])
    missing = refused(get_rule("9.9.9"), "not_found")
    assert missing["nearest_existing"] == "9.9"


def test_search_rules_falls_back_to_lexical_and_says_so():
    assert not config.CORPUS_INDEX_PATH.exists(), "an index now exists: this test must cover the embedding path"
    result = search_rules("when can a blocker redirect an attack", k=3)
    found = ok(result)
    assert found["method"] == LEXICAL_METHOD and "no corpus index" in found["fallback_reason"]
    assert 1 <= len(found["results"]) <= 3
    top_rule_ids = {r for hit in found["results"] for r in hit["rule_ids"]}
    assert "11.24.1" in top_rule_ids or "9.9" in top_rule_ids, found["results"]
    assert result["sources"]["chunk_ids"] == [h["chunk_id"] for h in found["results"]]
    scores = [h["score"] for h in found["results"]]
    assert scores == sorted(scores, reverse=True)
    assert search_rules("when can a blocker redirect an attack", k=3) == result, "lexical search is deterministic"
    errata_hit = ok(search_rules("Nocturne artist errata", k=5))
    assert any(h["source"] == "errata" and h["card_slug"] == "nocturne-op55-n1" for h in errata_hit["results"])


def test_card_interactions_lists_rules_only():
    result = card_interactions("v-streetkid", "kiroshi-optics")
    report = ok(result)
    v, optics = report["cards"]
    assert v["printed_keywords"] == ["Go Solo"] and v["timing_triggers"] == ["Call"]
    assert v["rules_by_term"]["Go Solo"]["defining"][0] == "11.25"
    assert v["rules_by_term"]["Call"]["defining"][0] == "11.18"
    assert optics["errata"] and result["sources"]["errata_ids"] == [e["id"] for e in optics["errata"]]
    assert result["sources"]["card_slugs"] == ["v-streetkid", "kiroshi-optics"]
    assert set(report["rule_titles"]) == set(result["sources"]["rule_ids"])
    assert "judgment" in report["note"]
    # Two Blocker cards share the Blocker rules, including where rule 9.9 mentions it.
    blockers = [c["slug"] for c in ok(search_cards(keyword="Blocker"))["cards"]][:2]
    shared = ok(card_interactions(*blockers))
    assert "Blocker" in shared["shared_terms"]
    assert {"11.24", "11.24.1", "9.9"} <= set(shared["shared_rule_ids"])
    # Every card's keyword and trigger fields agree with the markup helpers the tool uses.
    for card in read_jsonl(config.CARD_DATABASE_PATH):
        side = ok(card_interactions(card["id"], card["id"]))["cards"][0]
        assert side["printed_keywords"] == card["keywords"], card["id"]
        assert side["referenced_keywords"] == card["keywords_referenced"], card["id"]
        assert side["timing_triggers"] == card["timing_triggers"], card["id"]
    # Every keyword, trigger and symbol has a defining glossary rule in the snapshot.
    for term in ("Adrenaline", "Go Solo", "Quick", "Blocker", "Play", "Call", "Attack", "Defeated", "Spend"):
        assert tools.term_rules(term)["defining"], term


def test_registry_schemas_are_valid_and_match_the_callables():
    assert list(TOOLS) == ["find_card", "get_card", "search_cards", "get_rule", "search_rules", "card_interactions"]
    specs = tool_specs()
    json.dumps(specs)
    for spec in specs:
        assert spec["type"] == "function"
        fn = spec["function"]
        assert set(fn) == {"name", "description", "parameters"} and fn["description"]
        params = fn["parameters"]
        assert params["type"] == "object" and params["additionalProperties"] is False
        assert set(params["required"]) <= set(params["properties"])
        for name, prop in params["properties"].items():
            assert prop["type"] in ("string", "integer"), (fn["name"], name)
            if "pattern" in prop:
                re.compile(prop["pattern"])
            if "enum" in prop:
                assert prop["enum"] and all(isinstance(v, str) for v in prop["enum"])
    try:
        import jsonschema
    except ImportError:
        jsonschema = None
    if jsonschema is not None:
        for spec in specs:
            jsonschema.Draft202012Validator.check_schema(spec["function"]["parameters"])
    assert TOOLS["search_cards"].parameters["properties"]["color"]["enum"] == ["Blue", "Green", "Red", "Yellow"]


def test_tools_code_respects_the_boundaries():
    source = (REPO_ROOT / "games/cyberpunk/assistant/tools.py").read_text(encoding="utf-8")
    # No runtime dispatch on a card name and no hard-coded format.
    assert not re.search(r"""\[["']name["']\]\s*==\s*["']""", source)
    assert not re.search(r"""\b(standard|format)\b\s*==""", source, re.I)
    for path in (REPO_ROOT / "harness").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "games.cyberpunk.assistant" not in text, f"{path} imports from games/"


def test_page_is_self_contained_and_its_script_parses():
    response = CTX["client"].get("/", headers=LOCAL)
    assert response.status_code == 200 and "Cyberpunk TCG assistant" in response.text
    assert not re.search(r"""(src|href)\s*=\s*["']?(https?:)?//""", ASSISTANT_HTML)
    assert "<script src" not in ASSISTANT_HTML and "@import" not in ASSISTANT_HTML
    assert "<link" not in ASSISTANT_HTML
    blocks = re.findall(r"<script>(.*?)</script>", ASSISTANT_HTML, re.S)
    assert len(blocks) == 1, "the assistant page lost its script block"
    proc = subprocess.run([CTX["node"], "-e", "new Function(require('fs').readFileSync(0, 'utf8'))"],
                          input=blocks[0], capture_output=True, text=True)
    assert proc.returncode == 0, f"assistant page script does not parse:\n{proc.stderr[:600]}"


def test_routes_list_and_run_tools():
    client = CTX["client"]
    listing = client.get("/api/tools", headers=LOCAL).json()
    assert listing["rulesVersion"] == RULES_VERSION
    assert [t["name"] for t in listing["tools"]] == list(TOOLS)
    assert all(t["parameters"]["type"] == "object" for t in listing["tools"])
    run = client.post("/api/tools/find_card", json={"query": "V"}, headers=LOCAL)
    assert run.status_code == 200 and run.json() == find_card("V")
    bad = client.post("/api/tools/get_card", json={"slug": 3}, headers=LOCAL)
    assert bad.status_code == 400 and bad.json()["ok"] is False and bad.json()["error_kind"] == "invalid_arguments"
    missing = client.post("/api/tools/get_card", json={"slug": "no-such-card"}, headers=LOCAL)
    assert missing.status_code == 404 and missing.json()["ok"] is False
    unknown = client.post("/api/tools/rm_rf", json={}, headers=LOCAL)
    assert unknown.status_code == 404 and unknown.json()["error_kind"] == "unknown_tool"
    not_object = client.post("/api/tools/get_card", content=b"[1]", headers={**LOCAL, "content-type":
                                                                              "application/json"})
    assert not_object.status_code == 400 and not_object.json()["ok"] is False
    garbage = client.post("/api/tools/get_card", content=b"{nope", headers=LOCAL)
    assert garbage.status_code == 400 and garbage.json()["ok"] is False


def test_host_check_refuses_a_foreign_host_and_origin():
    client = CTX["client"]
    for host in ("127.0.0.1:8767", "localhost:8767", "[::1]:8767", "localhost"):
        assert client.get("/api/tools", headers={"host": host}).status_code == 200, host
    for host in ("evil.example:8767", "attacker.test", "192.168.1.5:8767", "0.0.0.0:8767", ""):
        response = client.get("/api/tools", headers={"host": host})
        assert response.status_code == 403, host
        assert client.post("/api/tools/find_card", json={"query": "V"}, headers={"host": host}).status_code == 403
    cross = client.post("/api/tools/find_card", json={"query": "V"},
                        headers={**LOCAL, "origin": "http://evil.example"})
    assert cross.status_code == 403
    same = client.post("/api/tools/find_card", json={"query": "V"}, headers={**LOCAL, "origin": "http://127.0.0.1:8767"})
    assert same.status_code == 200
    assert host_allowed("evil.example", None, lan=True), "LAN mode is guarded by the token instead"
    assert not host_allowed("localhost.evil.example", None, lan=False)


def test_token_applies_off_loopback():
    with TestClient(build_assistant_app(token="sekret", lan=True)) as guarded:
        assert guarded.get("/api/tools").status_code == 401
        assert guarded.post("/api/tools/find_card", json={"query": "V"}).status_code == 401
        assert guarded.get("/api/tools", headers={"x-token": "sekret"}).status_code == 200
        assert guarded.get("/?t=sekret").status_code == 200
        assert guarded.get("/api/tools").status_code == 200, "token cookie was not kept"


def run(node: str) -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["node"] = node
    with TestClient(build_assistant_app()) as client:
        CTX["client"] = client
        for test in tests:
            test()
            print(f"OK  {test.__name__}")
    print(f"PASS assistant tools: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    run(args.node)


if __name__ == "__main__":
    main()
