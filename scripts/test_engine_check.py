"""Tests for the assistant's ``engine_check`` tool (games/cyberpunk/assistant/engine_oracle.py).

Why: the tool reports what the game engine offered in recorded positions, and its whole value is that it
never says more than the index holds. These tests recompute every verdict straight from
``data/oracle/positions-v1.jsonl`` (independently of the tool's matching code), check that an "offered"
example names an action the engine actually listed for that exact card instance, and pin the refusals.
No engine worker runs here: the index is the engine's record (``scripts/test_engine_positions.py`` checks it
against the engine).

Usage:
    python scripts/test_engine_check.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from games.cyberpunk.assistant import engine_oracle  # noqa: E402
from games.cyberpunk.assistant.tools import TOOLS, call_tool  # noqa: E402

ROWS = {r["position_id"]: r for r in engine_oracle.index()}


def ok(args: dict) -> dict:
    out = call_tool("engine_check", args)
    assert out["ok"], out
    return out["result"]


def refused(args: dict, kind: str) -> None:
    out = call_tool("engine_check", args)
    assert not out["ok"] and out["error_kind"] == kind, (args, out)


def independent_counts(kind: str, area: str, card: str, *, state=None, step=None, lagging=None) -> tuple[int, int]:
    """(offered, not offered) per friendly copy of ``card``, computed directly from the index rows."""
    yes = no = 0
    for row in ROWS.values():
        if step and row["step"] != step:
            continue
        sources = {o["source_public_id"] for o in row["offered"] if o["kind"] == kind}
        for c in row["facts"]["cards"]:
            if (c["slug"], c["side"], c["area"]) != (card, "friendly", area):
                continue
            if (state and c["state"] != state) or (lagging is not None and c["lagging"] != lagging):
                continue
            if c["public_id"] in sources:
                yes += 1
            else:
                no += 1
    return yes, no


def test_registered_with_a_short_description_and_the_index_identity():
    assert "engine_check" in TOOLS and len(TOOLS["engine_check"].description) <= 160
    engine = json.loads(engine_oracle.MANIFEST_PATH.read_text())["engine"]
    assert all(r["engine"] == engine for r in ROWS.values()), "the index and its manifest name one engine"
    assert ok({"play": "sell", "card": "floor-it"})["engine"]["artifactHash"] == engine["artifactHash"]


def test_counts_and_verdicts_match_an_independent_recount():
    cases = [("attack", "DECLARE_ATTACK", "battlefield", "psycho-squad", {}),
             ("attack", "DECLARE_ATTACK", "battlefield", "psycho-squad", {"state": "spent"}),
             ("attack", "DECLARE_ATTACK", "battlefield", "psycho-squad",
              {"state": "ready", "step": "main", "lagging": False}),
             ("play_from_hand", "PLAY_CARD", "hand", "kiroshi-optics", {}),
             ("sell", "SELL_CARD", "hand", "floor-it", {"step": "react"}),
             ("block", "DECLARE_BLOCKER", "battlefield", "psycho-squad", {})]
    for play, kind, area, card, f in cases:
        args = {"play": play, "card": card}
        if "state" in f:
            args["card_state"] = f["state"]
        if "step" in f:
            args["step"] = f["step"]
        if "lagging" in f:
            args["lagging"] = "yes" if f["lagging"] else "no"
        result = ok(args)
        yes, no = independent_counts(kind, area, card, **f)
        assert (result["offered_count"], result["not_offered_count"]) == (yes, no), (args, result["matched"], yes, no)
        expected = ("no_position" if not yes + no else "depends" if yes and no
                    else "offered" if yes else "not_offered")
        assert result["verdict"] == expected, (args, result["verdict"], expected)
    # The filters narrow to a settled answer in both directions.
    assert ok({"play": "attack", "card": "psycho-squad", "card_state": "spent"})["verdict"] == "not_offered"
    assert ok({"play": "attack", "card": "psycho-squad", "card_state": "ready", "step": "main",
               "lagging": "no"})["verdict"] == "offered"


def test_offered_examples_name_an_action_the_engine_listed_for_that_copy():
    for args in ({"play": "attack", "card": "psycho-squad"}, {"play": "sell", "card": "floor-it"},
                 {"play": "play_from_hand", "card": "kiroshi-optics"},
                 {"play": "attack_target", "card": "field-operator", "target": "evelyn-parker-scheming-siren"}):
        result = ok(args)
        assert result["positions"], args
        ids = [p["position_id"] for p in result["positions"]]
        assert len(ids) == len(set(ids)), "an example position is listed once"
        for example in result["positions"]:
            row = ROWS[example["position_id"]]
            assert example["state_hash"] == row["state_hash"] and example["step"] == row["step"]
            card = example["card"]
            assert card["side"] == "friendly" and card["slug"] == args["card"]
            assert card in [{k: c[k] for k in card} for c in row["facts"]["cards"]], "facts come from the row"
            listed = {o["action_id"]: o for o in row["offered"]}
            if example["offered"] is None:
                assert not any(o["source_public_id"] == card["public_id"]
                               and o["kind"] == engine_oracle.PLAY_KINDS[args["play"]][0]
                               and (args["play"] != "attack_target" or any(
                                   t.get("public_id") == example["target"]["public_id"]
                                   for t in o.get("attack_targets", [])))
                               for o in row["offered"]), example["position_id"]
                continue
            action = listed[example["offered"]["action_id"]]
            assert action["source_public_id"] == card["public_id"] and action["label"] == example["offered"]["label"]
            if args["play"] == "attack_target":
                target = example["target"]
                assert target["side"] == "rival" and target["slug"] == args["target"]
                assert target["public_id"] in [t.get("public_id") for t in action["attack_targets"]]


def test_depends_shows_both_sides_and_only_observed_fact_values():
    result = ok({"play": "attack", "card": "psycho-squad"})
    assert result["verdict"] == "depends"
    sides = {p["offered"] is not None for p in result["positions"]}
    assert sides == {True, False}, "depends gives an offered and a not-offered example"
    split = {s["fact"]: s["never_offered_when"] for s in result["facts_that_split"]}
    assert split.get("step") == ["react"] and split.get("card state") == ["spent"], split
    # Each listed value really was never seen with an offered match.
    assert ok({"play": "attack", "card": "psycho-squad", "step": "react"})["offered_count"] == 0
    assert ok({"play": "attack", "card": "psycho-squad", "card_state": "spent"})["offered_count"] == 0
    settled = ok({"play": "block", "card": "psycho-squad"})
    assert settled["verdict"] == "not_offered" and settled["facts_that_split"] == []
    assert any("why an action was not offered" in n for n in result["not_visible"])


def test_attack_target_filters_on_the_target():
    pair = {"play": "attack_target", "card": "field-operator", "target": "evelyn-parker-scheming-siren"}
    spent = ok({**pair, "target_state": "spent"})
    assert spent["offered_count"] > 0
    ready = ok({**pair, "target_state": "ready"})
    assert ready["offered_count"] == 0, "the engine never offered a ready target in these positions"


def test_refusals():
    refused({"play": "attack", "card": "no-such-card"}, "not_found")
    refused({"play": "attack", "card": "Psycho Squad"}, "invalid_arguments")
    refused({"play": "fly", "card": "psycho-squad"}, "invalid_arguments")
    refused({"play": "attack", "card": "psycho-squad", "target": "delamain-cab"}, "invalid_arguments")
    refused({"play": "attack_target", "card": "psycho-squad"}, "invalid_arguments")
    refused({"play": "attack", "card": "psycho-squad", "target_state": "spent"}, "invalid_arguments")
    refused({"play": "attack", "card": "psycho-squad", "limit": 9}, "invalid_arguments")
    # A real card the Demo games never play: refused, with the instruction to say the engine did not check it.
    out = call_tool("engine_check", {"play": "attack", "card": "misty-olszewski-mender-of-broken-spirits"})
    assert not out["ok"] and out["error_kind"] == "no_position" and "engine did not check it" in out["error"]


def main() -> int:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS engine check: {len(tests)}/{len(tests)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
