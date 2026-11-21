#!/usr/bin/env python3
"""Offline smoke/integration tests for the TypeScript engine adapter.

Usage:
    python scripts/test_engine_adapter.py [--app-root .]

The test consumes the committed Demo matrix fixture and drives this
repository's Node engine worker. It does not duplicate any game rules in Python.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.engine_adapter import EngineProtocolError, EngineWorker, choose_action_id
from games.cyberpunk.local_match import load_setup_file

SCENARIO_LEGENDS = (
    ["jackie-welles-pour-one-out-for-me", "saburo-arasaka-stubborn-patriarch", "yorinobu-arasaka-embracing-destruction"],
    ["goro-takemura-hands-unclean", "v-corporate-exile", "viktor-vektor-sit-down-and-relax"],
)


def scenario(**edits):
    """A composeScenario description: seat 0 has a ready Unit with Gear, seat 1 a spent Unit."""
    players = [{
        "field": [{"card": "field-operator", "readiness": "READY", "gear": ["dying-night-v-s-pistol"]}],
        "legends": [{"card": slug, "face": "DOWN", "readiness": "READY"} for slug in legends],
        "hand": [], "trash": [], "deck": [], "gigs": [{"die": "D6", "value": 3}], "eddies": {"ready": 2, "spent": 0},
    } for legends in SCENARIO_LEGENDS]
    players[1]["field"] = [{"card": "corpo-security", "readiness": "SPENT"}]
    value = {"seed": "adapter-scenario", "activeSeat": 0, "players": players}
    value.update(edits)
    return value


def check_scenario(worker: EngineWorker, app_root: Path, node: str) -> int:
    """composeScenario through the worker: a valid MAIN state the other ops accept, and structured refusals."""
    content = load_setup_file(app_root / "tests" / "fixtures" / "constructed-reference-decks.v1.json", node=node, app_root=app_root).content
    state = worker.compose_scenario(content=content, scenario=scenario())
    assert state["timing"]["step"] == "MAIN"
    actor = state["match"]["playerOrder"][0]
    actions = worker.list_legal_actions(content=content, state=state, actor_id=actor)
    attacker = state["players"][actor]["zones"]["BATTLEFIELD"][0]
    assert any(a["action"]["kind"] == "DECLARE_ATTACK" and a["action"].get("cardInstanceId") == attacker for a in actions)
    bad = scenario()
    bad["players"][1]["hand"] = ["no-such-card"]
    try:
        worker.compose_scenario(content=content, scenario=bad)
    except EngineProtocolError as exc:
        assert exc.errors == [{"code": "UNKNOWN_CARD", "message": "no-such-card is not in the content bundle", "path": "players[1].hand[0]"}], exc.errors
    else:
        raise AssertionError("an unknown card was accepted")
    return len(actions)


def load_probe(app_root: Path):
    path = app_root / "tests" / "fixtures" / "demo-matrix-empty-draw-replay.v1.json"
    if not path.is_file():
        raise FileNotFoundError(f"missing regenerated Demo matrix fixture: {path}")
    replay = json.loads(path.read_text(encoding="utf-8"))
    positions = replay.get("positions") or []
    if not positions:
        raise AssertionError("Demo replay contains no strategic positions")
    position = positions[0]
    state = position["state"]
    actor = state["match"]["playerOrder"][position["actingSeat"]]
    return replay["content"], position, actor


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app-root", default=REPO_ROOT, type=Path)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    app_root = args.app_root.resolve()
    content, position, actor = load_probe(app_root)

    with EngineWorker(app_root, node=args.node) as worker:
        public = worker.model_input(content=content, state=position["state"], actor_id=actor)
        assert public["schemaVersion"] == 2
        assert public["observation"] == position["observation"]
        expected_ids = [a["actionId"] for a in position["legalActions"]]
        actual_ids = [a["actionId"] for a in public["legalActions"]]
        assert actual_ids == expected_ids
        assert len(actual_ids) >= 2

        serialized = json.dumps(public, sort_keys=True)
        for forbidden in ("actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"):
            assert f'"{forbidden}"' not in serialized, forbidden

        chosen = choose_action_id(public, lambda _observation, actions: actions[0]["actionId"])
        assert chosen == actual_ids[0]
        transition = worker.apply_action(content=content, state=position["state"], actor_id=actor, action_id=chosen)
        assert transition["kind"] == "transition"
        assert isinstance(transition.get("state"), dict)
        assert isinstance(transition.get("events"), list)
        assert isinstance(transition.get("stateHash"), str)

        try:
            worker.apply_action(content=content, state=position["state"], actor_id=actor, action_id="0" * 64)
        except EngineProtocolError as exc:
            assert "UNKNOWN_ACTION_ID" in str(exc)
        else:
            raise AssertionError("unknown actionId was accepted")

        try:
            choose_action_id(public, lambda _observation, _actions: "0" * 64)
        except ValueError as exc:
            assert "not offered" in str(exc)
        else:
            raise AssertionError("unoffered actionId was accepted by Python boundary")

        scenario_actions = check_scenario(worker, app_root, args.node)

    print(f"PASS modelInputV2 adapter: {len(actual_ids)} legal actions, actionId-only transition")
    print(f"PASS composeScenario adapter: {scenario_actions} legal actions at MAIN, structured refusal")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
