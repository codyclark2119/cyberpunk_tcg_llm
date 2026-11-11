#!/usr/bin/env python3
"""Tests for the local assistant's deck tools and their place on the Tools page.

Why: a deckbuilding answer stands on these numbers. A parser that picked one of
three cards called "V", a validator fed a deck whose duplicate lines were not
merged, a cost curve off by one bucket or an archetype id that changed between
runs would each hand the model a wrong fact that looks authoritative. Every
test here runs on the committed snapshot (``data/processed/`` and the public
decks in ``data/raw/decks/``), with no model and no network, and checks a fact
that can be read off that data by hand or recomputed independently: the
official deckbuilder's own ``stats`` block on every public deck is the
independent label for the profile. The page tests call the app in process
through FastAPI's TestClient (fastapi and httpx).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from games.cyberpunk import archetypes, config
from games.cyberpunk.assistant import decks
from games.cyberpunk.assistant.tools import (TOOLS, archetype_of, call_tool, check_deck, deck_profile, parse_deck,
                                             played_with, similar_decks)
from games.cyberpunk.assistant_app import ASSISTANT_HTML, build_assistant_app
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.io import read_jsonl

CTX: dict = {}
LOCAL = {"host": "127.0.0.1:8767"}
FIRST_DECK = "000d7834-39de-4a46-8016-965bc6914e34"  # "Chippin' In", the first deck file by name


def ok(result: dict) -> dict:
    assert result["ok"] is True, json.dumps(result)[:1500]
    assert result["rules_version"] == RULES_VERSION
    json.dumps(result)
    return result["result"]


def refused(result: dict, kind: str) -> dict:
    assert result["ok"] is False and result["error_kind"] == kind, json.dumps(result)[:1500]
    assert result["error"] and result["rules_version"] == RULES_VERSION
    json.dumps(result)
    return result


def raw_decks() -> list[dict]:
    """The public decks read straight from disk, independently of the tool's loader."""
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(config.DECKS_DIR.glob("*.json"))
            if not p.name.startswith("_")]


def card_index() -> dict:
    return {c["id"]: c for c in read_jsonl(config.CARD_DATABASE_PATH)}


def deck_dict(legends: dict, main: dict) -> dict:
    return {"zones": [{"zone_code": "legends", "cards": [{"card_slug": s, "quantity": q} for s, q in legends.items()]},
                      {"zone_code": "deck", "cards": [{"card_slug": s, "quantity": q} for s, q in main.items()]}]}


# A small deck whose numbers are worked out by hand below, from the card database:
#   Legends: V: Streetkid (Red RAM 2), Rogue Amendiares (Yellow RAM 2), Kerry Eurodyne (Yellow RAM 2)
#   3 La Llorona   Red Unit    cost 3 power 3 RAM 1 Blocker
#   2 Valentino    Red Unit    cost 3 power 4 RAM 2 (mentions Blocker)
#   1 Satori       Red Gear    cost 2         RAM 1
#   3 Detonate     Red Program cost 1         RAM 2 Quick
#   3 Kiroshi      Yellow Gear cost 1         RAM 1 [Attack], has an erratum
#   2 Bombus       Yellow Unit cost 2 power 0 RAM 2 Blocker
SMALL = deck_dict({"v-streetkid": 1, "rogue-amendiares-preem-solo": 1, "kerry-eurodyne-axe-attitude-audience": 1},
                  {"la-llorona-ghost-of-the-past": 3, "valentino-guerrera": 2, "satori-sword-of-saburo": 1,
                   "detonate": 3, "kiroshi-optics": 3, "secondhand-bombus": 2})


def test_pasted_list_with_a_shared_name_reports_candidates_and_never_guesses():
    text = "Legends\n1 V\n1 Rogue Amendiares - Preem Solo\n1x Kerry Eurodyne: Axe, Attitude, Audience\n\nDeck\n" \
           "3x Kiroshi Optics\n2 streetk\n1 Nothing Like This Card\n"
    result = parse_deck(text=text)
    report = ok(result)
    assert report["resolved"] is False and report["deck"] is None
    by_line = {u["line"]: u for u in report["unresolved"]}
    assert set(by_line) == {2, 8, 9}
    v = by_line[2]
    assert v["status"] == "ambiguous" and v["zone"] == "legends" and v["quantity"] == 1
    assert [c["slug"] for c in v["candidates"]] == ["v-corporate-exile", "v-roamer-of-the-badlands", "v-streetkid"]
    # A unique partial match is still not taken: only an exact name resolves.
    assert by_line[8]["status"] == "partial_match" and [c["slug"] for c in by_line[8]["candidates"]] == ["v-streetkid"]
    assert by_line[9]["status"] == "unknown" and by_line[9]["candidates"] == []
    assert [c["slug"] for c in report["cards"]] == ["rogue-amendiares-preem-solo",
                                                     "kerry-eurodyne-axe-attitude-audience", "kiroshi-optics"]
    assert any("slug" in n for n in report["notes"])
    # Every tool that takes the same text refuses it, carrying the candidates.
    for name in ("check_deck", "deck_profile", "similar_decks", "archetype_of"):
        refusal = refused(call_tool(name, {"text": text}), "unresolved_cards")
        assert [u["line"] for u in refusal["unresolved"]] == [2, 8, 9], name
    # Every shared name in the snapshot is ambiguous in a pasted list too.
    names = Counter(c["name"] for c in card_index().values())
    for name in (n for n, k in names.items() if k > 1):
        line = ok(parse_deck(text=f"1 {name}"))["unresolved"]
        assert len(line) == 1 and line[0]["status"] == "ambiguous" and len(line[0]["candidates"]) == names[name], name


def test_pasted_list_forms_resolve_and_merge():
    text = "# my deck\nLegends (3)\n- V - Streetkid\nRogue Amendiares: Preem Solo x1\n1 kerry-eurodyne-axe-attitude-audience" \
           "\nMain deck:\n3 La Llorona: Ghost of the Past\n2x Valentino Guerrera\n1 Satori: Sword of Saburo\n" \
           "Detonate x3\n3 × Kiroshi Optics\n1 Secondhand Bombus\n1 secondhand bombus\n"
    report = ok(parse_deck(text=text))
    assert report["resolved"] and report["unresolved"] == []
    deck = report["deck"]
    assert deck["zones"] == SMALL["zones"], deck["zones"]  # the two Bombus lines merge to 2
    assert deck["counts"] == {"legends": 3, "deck": 14} and deck["source"] == {"kind": "text"}
    assumed = [c["slug"] for c in report["cards"] if c["quantity_assumed"]]
    assert assumed == ["v-streetkid"]
    # Without headers, Legend cards go to the Legends zone by card type, and the parse says so.
    flat = ok(parse_deck(text="1 V: Streetkid\n3 Detonate\n1 Rogue Amendiares: Preem Solo", format="standard"))
    zones = {z["zone_code"]: [e["card_slug"] for e in z["cards"]] for z in flat["deck"]["zones"]}
    assert zones == {"legends": ["v-streetkid", "rogue-amendiares-preem-solo"], "deck": ["detonate"]}
    assert flat["deck"]["format"] == {"code": "standard", "name": None}
    assert any("card type" in n for n in flat["notes"])


def test_public_decks_round_trip_and_validate_clean():
    raw = raw_decks()
    assert len(raw) == 272 and len(decks.public_decks()) == 272
    index = card_index()
    for record in raw:
        via_id = ok(parse_deck(deck_id=record["id"]))
        deck = via_id["deck"]
        assert deck["source"]["deck_id"] == record["id"] and deck["name"] == record.get("name")
        assert deck["format"] == {"code": record["format"]["code"], "name": record["format"]["name"]}
        for zone in ("legends", "deck"):
            want = Counter()
            for z in record["zones"]:
                if z["zone_code"] == zone:
                    for e in z["cards"]:
                        want[e["card_slug"]] += e["quantity"]
            got = {e["card_slug"]: e["quantity"] for z in deck["zones"] if z["zone_code"] == zone for e in z["cards"]}
            assert got == dict(want), (record["id"], zone)
        # The deck dict chains into check_deck, and so does the same list pasted by display name.
        checked = ok(check_deck(deck=deck))
        assert checked["legal"] is True and checked["violations"] == [] and checked["rule_slugs"] == [], record["id"]
        assert checked["format"]["code"] == record["format"]["code"]
        text = "\n".join(["Legends"] + [f"{e['quantity']} {index[e['card_slug']]['display_name']}"
                                        for e in deck["zones"][0]["cards"]]
                         + ["Deck"] + [f"{e['quantity']}x {index[e['card_slug']]['display_name']}"
                                       for e in deck["zones"][1]["cards"]])
        pasted = ok(parse_deck(text=text))
        assert pasted["resolved"] and pasted["deck"]["zones"] == deck["zones"], record["id"]
    by_id = ok(check_deck(deck_id=FIRST_DECK))
    assert by_id["official_is_valid"] is True and by_id["summary"]["deck_count"] == 40


def test_illegal_deck_reports_each_rule_slug():
    index = card_index()
    # Two Red Legends (budget Red 4, nothing else), four copies of a card, and a
    # Yellow card the Legends supply no RAM for.
    bad = deck_dict({"v-streetkid": 1, "royce-psycho-on-the-edge": 1},
                    {"la-llorona-ghost-of-the-past": 4, "kiroshi-optics": 3})
    result = check_deck(deck=bad)
    report = ok(result)
    assert report["legal"] is False
    assert report["rule_slugs"] == ["legend-count", "deck-size", "max-copies", "ram-limit"], report["rule_slugs"]
    ram = next(v for v in report["violations"] if v["rule"] == "ram-limit")
    assert "Yellow needs RAM 1 but the Legends supply 0" in ram["detail"]
    assert report["summary"]["ram_budget"] == {"Red": 4}
    assert "official_is_valid" not in report
    # Two lines of the same card are merged first, so the copy limit sees all of them.
    split = deck_dict({"v-streetkid": 1, "rogue-amendiares-preem-solo": 1, "kerry-eurodyne-axe-attitude-audience": 1},
                      {"detonate": 2})
    split["zones"][1]["cards"].append({"card_slug": "detonate", "quantity": 2})
    assert "max-copies" in ok(check_deck(deck=split))["rule_slugs"]
    text = "Legends\n1 V: Streetkid\n1 Royce: Psycho on the Edge\nDeck\n2 Detonate\n2 Detonate\n"
    assert ok(check_deck(text=text))["rule_slugs"] == ["legend-count", "deck-size", "max-copies"]
    # Same-named Legends, three of them: unique names is its own rule.
    goros = deck_dict({"goro-takemura-hands-unclean": 1, "goro-takemura-vengeful-bodyguard": 1,
                       "jackie-welles-mama-s-favorite": 1}, {"la-llorona-ghost-of-the-past": 1})
    names = ok(check_deck(deck=goros))["rule_slugs"]
    assert "legend-unique-names" in names and "legend-count" not in names
    assert index["goro-takemura-hands-unclean"]["name"] == index["goro-takemura-vengeful-bodyguard"]["name"]
    # The small hand-built deck breaks only the size rule.
    assert ok(check_deck(deck=SMALL))["rule_slugs"] == ["deck-size"]


def test_profile_matches_a_hand_computed_deck():
    result = deck_profile(deck=SMALL)
    profile = ok(result)
    assert profile["counts"] == {"legends": 3, "deck": 14, "distinct_deck_cards": 6}
    assert profile["cost_curve"] == {"1": 6, "2": 3, "3": 5}
    assert profile["cost_curve_buckets"] == [0, 6, 3, 5, 0, 0, 0, 0]
    assert profile["average_cost"] == 1.93  # (6*1 + 3*2 + 5*3) / 14 = 27/14
    assert profile["average_unit_power"] == 2.43  # (3*3 + 2*4 + 2*0) / 7 = 17/7
    assert profile["colour_split"] == {"Red": 9, "Yellow": 5}
    assert profile["type_split"] == {"Unit": 7, "Gear": 4, "Program": 3}
    assert profile["ram"] == {"Red": {"budget": 2, "usage": 2, "headroom": 0},
                              "Yellow": {"budget": 4, "usage": 2, "headroom": 2}}
    assert profile["ram_over_budget"] == []
    assert profile["keywords_printed"] == {"Blocker": 5, "Quick": 3}
    assert profile["keywords_referenced"] == {"Blocker": 2}
    assert profile["timing_triggers"] == {"Attack": 3}
    assert [c["slug"] for c in profile["cards_with_errata"]] == ["kiroshi-optics"]
    assert result["sources"]["errata_ids"] == profile["cards_with_errata"][0]["errata_ids"]
    assert [l["slug"] for l in profile["legends"]] == ["v-streetkid", "rogue-amendiares-preem-solo",
                                                        "kerry-eurodyne-axe-attitude-audience"]
    assert "judgment" in profile["note"]
    over = ok(deck_profile(deck=deck_dict({"v-streetkid": 1}, {"kiroshi-optics": 1})))
    assert over["ram_over_budget"] == ["Yellow"] and over["ram"]["Yellow"]["headroom"] == -1


def test_profile_agrees_with_the_official_builder_stats_on_every_public_deck():
    for record in raw_decks():
        stats = record["stats"]
        profile = ok(deck_profile(deck_id=record["id"]))
        assert profile["cost_curve_buckets"] == stats["costCurve"], record["id"]
        assert profile["colour_split"] == stats["colorDistribution"], record["id"]
        assert profile["ram"] and {c: v["budget"] for c, v in profile["ram"].items() if v["budget"]} == \
            stats["ramBudget"], record["id"]
        assert {c: v["usage"] for c, v in profile["ram"].items() if c in stats["ramUsage"]} == stats["ramUsage"]
        types = profile["type_split"]
        assert (types.get("Unit", 0), types.get("Program", 0), types.get("Gear", 0)) == \
            (stats["unitCount"], stats["programCount"], stats["gearCount"]), record["id"]
        assert profile["counts"]["deck"] == stats["deckCount"] and profile["counts"]["legends"] == stats["legendCount"]
        assert abs(profile["average_cost"] - stats["avgCost"]) <= 0.051, record["id"]


def test_similar_decks_returns_the_deck_itself_first():
    for record in raw_decks():
        found = ok(similar_decks(deck_id=record["id"], k=3))
        first = found["decks"][0]
        assert first["deck_id"] == record["id"] and first["is_source_deck"] and first["similarity"] == 1.0
        sims = [d["similarity"] for d in found["decks"]]
        assert sims == sorted(sims, reverse=True) and len(found["decks"]) == 3
    # A deck dict with no public id still finds its public twin at similarity 1.
    twin = ok(parse_deck(deck_id=FIRST_DECK))["deck"]
    anonymous = {"zones": twin["zones"]}
    result = similar_decks(deck=anonymous, k=1)
    assert ok(result)["decks"][0]["deck_id"] == FIRST_DECK and not ok(result)["decks"][0]["is_source_deck"]
    assert result["sources"]["deck_ids"] == [FIRST_DECK]
    # Recomputed by hand for the runner-up.
    counts = [archetypes.deck_counts(d) for d in raw_decks()]
    own = archetypes.deck_counts(next(d for d in raw_decks() if d["id"] == FIRST_DECK))
    second = ok(similar_decks(deck_id=FIRST_DECK, k=2))["decks"][1]
    expected = max(archetypes.similarity(own, c) for d, c in zip(raw_decks(), counts) if d["id"] != FIRST_DECK)
    assert second["similarity"] == round(expected, 4)


def test_archetypes_are_deterministic_and_members_find_their_own():
    first = decks._archetype_model()
    records = first["records"]
    assert len(records) == 20, len(records)  # the docstring's count at threshold 0.40, size >= 3
    assert [r["id"] for r in records] == [f"arch-{n:02d}" for n in range(1, 21)]
    sizes = [r["size"] for r in records]
    assert sizes == sorted(sizes, reverse=True) and sizes[0] == 27
    decks._archetype_model.cache_clear()
    again = decks._archetype_model()
    assert again["records"] == records, "archetype ids moved between two computations"
    top = records[0]
    member = top["deck_ids"][0]
    result = archetype_of(deck_id=member)
    found = ok(result)
    assert found["method"] == "member" and found["archetype"]["id"] == "arch-01"
    assert found["archetype"]["size"] == 27 and found["archetype"]["core_cards"]
    assert all(c["share"] >= archetypes.DEFAULT_CORE_SHARE for c in found["archetype"]["core_cards"])
    assert "strength" in found["note"]
    # Every member of every archetype gets its own archetype back.
    for record in records:
        for deck_id in record["deck_ids"]:
            assert ok(archetype_of(deck_id=deck_id))["archetype"]["id"] == record["id"], deck_id
    # A deck in no archetype says so.
    lone = ok(archetype_of(deck_id=FIRST_DECK))
    assert lone["archetype"] is None and lone["method"] == "member" and "fewer than" in lone["explanation"]
    assert len(lone["nearest"]) == 3
    # The same list without its public id is placed by nearest mean similarity.
    anonymous = {"zones": ok(parse_deck(deck_id=member))["deck"]["zones"]}
    nearest = ok(archetype_of(deck=anonymous))
    assert nearest["method"] == "nearest" and nearest["nearest"][0]["id"] == "arch-01"


def test_played_with_counts_and_is_deterministic():
    slug = "kiroshi-optics"
    first = played_with(slug, k=10)
    assert first == played_with(slug, k=10)
    decks._deck_slug_sets.cache_clear()
    assert first == played_with(slug, k=10), "co-occurrence changed after a reload"
    report = ok(first)
    raw = raw_decks()
    holding = [{e["card_slug"] for z in d["zones"] for e in z["cards"]} for d in raw]
    holding = [s for s in holding if slug in s]
    assert report["decks_with_card"] == len(holding) and report["corpus_size"] == 272
    together = Counter(s for deck in holding for s in deck if s != slug)
    expected = sorted(together.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    assert [(c["slug"], c["decks"]) for c in report["played_with"]] == expected
    top = report["played_with"][0]
    assert top["share"] == round(top["decks"] / len(holding), 4)
    assert sum(report["main_deck_copies"].values()) == len(holding)
    assert len(first["sources"]["deck_ids"]) == len(holding)
    legend = ok(played_with("v-streetkid", k=3))
    assert legend["decks_with_card"] > 0, "a Legend is counted from the Legends zone"


def test_bad_arguments_fail_closed():
    refused(call_tool("check_deck", {}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck_id": FIRST_DECK, "text": "1 Detonate"}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck_id": "not-a-deck"}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck_id": "00000000-0000-0000-0000-000000000000"}), "not_found")
    refused(call_tool("check_deck", {"deck_id": FIRST_DECK, "format": "standard"}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck": "a deck"}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck": {}}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck": {**SMALL, "evil": 1}}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck": deck_dict({"V: Streetkid": 1}, {})}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck": deck_dict({"v-streetkid": 0}, {})}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck": deck_dict({"v-streetkid": True}, {})}), "invalid_arguments")
    refused(call_tool("check_deck", {"deck": {"zones": [{"zone_code": "sideboard", "cards": []}]}}),
            "invalid_arguments")
    unknown = refused(call_tool("deck_profile", {"deck": deck_dict({"no-such-card": 1}, {})}), "not_found")
    assert unknown["unknown_slugs"] == ["no-such-card"]
    refused(call_tool("parse_deck", {"text": "   \n  "}), "invalid_arguments")
    refused(call_tool("parse_deck", {"text": "# only a comment\nLegends\n"}), "invalid_arguments")
    refused(call_tool("parse_deck", {"text": "1 Detonate\n" * 301}), "invalid_arguments")
    refused(call_tool("parse_deck", {"text": "1 Detonate", "format": "Standard!"}), "invalid_arguments")
    zero = ok(parse_deck(text="0 Detonate"))
    assert zero["unresolved"][0]["status"] == "bad_quantity"
    refused(call_tool("similar_decks", {"deck_id": FIRST_DECK, "k": 0}), "invalid_arguments")
    refused(call_tool("similar_decks", {"deck_id": FIRST_DECK, "k": "3"}), "invalid_arguments")
    refused(call_tool("played_with", {"slug": "no-such-card"}), "not_found")
    refused(call_tool("played_with", {"slug": "Kiroshi Optics"}), "invalid_arguments")
    refused(call_tool("played_with", {}), "invalid_arguments")
    refused(call_tool("archetype_of", {"deck_id": FIRST_DECK, "k": 3}), "invalid_arguments")


def test_deck_code_respects_the_boundaries():
    source = (REPO_ROOT / "games/cyberpunk/assistant/decks.py").read_text(encoding="utf-8")
    assert not re.search(r"""\[["']name["']\]\s*==\s*["']""", source), "dispatch on a card name"
    assert not re.search(r"""\b(standard|format)\b\s*==""", source, re.I), "a hard-coded format"
    assert "standard" not in source.casefold(), "a format name in the deck tools"
    for name in ("parse_deck", "check_deck", "deck_profile", "similar_decks", "archetype_of", "played_with"):
        assert name in TOOLS, name
        params = TOOLS[name].parameters
        assert params["additionalProperties"] is False
    for name in ("parse_deck", "check_deck", "deck_profile", "similar_decks", "archetype_of"):
        props = TOOLS[name].parameters["properties"]
        assert {"deck", "deck_id", "text"} <= set(props) and props["deck"]["type"] == "object", name


def test_routes_list_public_decks_and_run_deck_tools():
    client = CTX["client"]
    listing = client.get("/api/decks", headers=LOCAL)
    assert listing.status_code == 200
    body = listing.json()
    assert body["rulesVersion"] == RULES_VERSION and len(body["decks"]) == 272
    keys = [((d["name"] or "").casefold(), d["id"]) for d in body["decks"]]
    assert keys == sorted(keys)
    assert all(set(d) == {"id", "name", "format", "colours", "card_count", "is_valid"} for d in body["decks"])
    assert client.get("/api/decks", headers={"host": "evil.example"}).status_code == 403
    run = client.post("/api/tools/check_deck", json={"deck_id": FIRST_DECK}, headers=LOCAL)
    assert run.status_code == 200 and run.json() == check_deck(deck_id=FIRST_DECK)
    parsed = client.post("/api/tools/parse_deck", json={"text": "1 V"}, headers=LOCAL)
    assert parsed.status_code == 200 and parsed.json()["result"]["resolved"] is False
    unresolved = client.post("/api/tools/deck_profile", json={"text": "1 V"}, headers=LOCAL)
    assert unresolved.status_code == 400 and unresolved.json()["error_kind"] == "unresolved_cards"
    chained = client.post("/api/tools/deck_profile", json={"deck": SMALL}, headers=LOCAL)
    assert chained.status_code == 200 and chained.json()["result"]["counts"]["deck"] == 14
    missing = client.post("/api/tools/similar_decks", json={"deck_id": "00000000-0000-0000-0000-000000000000"},
                          headers=LOCAL)
    assert missing.status_code == 404
    tools = [t["name"] for t in client.get("/api/tools", headers=LOCAL).json()["tools"]]
    assert tools[-6:] == ["parse_deck", "check_deck", "deck_profile", "similar_decks", "archetype_of", "played_with"]
    # The page builds a textarea for pasted text and the deck dict, and a picker over /api/decks.
    for needle in ('fetch("/api/decks")', 'field === "deck_id"', 'el("textarea"', "Insert last parsed deck",
                   'spec.type === "object"'):
        assert needle in ASSISTANT_HTML, needle


def run() -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    with TestClient(build_assistant_app()) as client:
        CTX["client"] = client
        for test in tests:
            test()
            print(f"OK  {test.__name__}")
    print(f"PASS assistant deck tools: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    run()


if __name__ == "__main__":
    main()
