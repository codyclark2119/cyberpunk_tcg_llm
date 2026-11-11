#!/usr/bin/env python3
"""Tests for the local match runner against the real TypeScript engine worker.

Why: the runner is the only thing between the policy layer and the engine, so
it must play whole games, submit only engine-offered actionIds, stay
deterministic with baseline seats, fall back when a policy misbehaves and keep
hidden state out of both the policy input and the match record. The fixed Demo
decks and the engine are real; the "mlx" seat is a fake async policy. No model,
server or network is used. Needs node and installed npm dependencies.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import (MatchSetup, load_default_setup, load_setup_file, play_match,
                                         summarize, write_match_record)
from games.cyberpunk.sim_bot import PolicyRunner, baseline_action_id

FORBIDDEN_KEYS = ("actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId", "rng")
CTX: dict = {}


def baseline_pair():
    return [PolicyRunner(), PolicyRunner()]


async def play(setup, runners, names, **kwargs):
    decisions = []
    rows = await play_match(CTX["engine"], setup, runners, policy_names=names,
                            on_decision=decisions.append, **kwargs)
    return rows, decisions


async def full_baseline_game():
    if "game" not in CTX:
        CTX["game"] = await play(CTX["setup"].for_seed("test-local-match"), baseline_pair(),
                                 ["baseline", "baseline"])
    return CTX["game"]


async def test_default_setup_is_the_fixed_demo_pinned_to_this_engine():
    setup = CTX["setup"]
    assert setup.source == "demo" and setup.initialization["format"] == "DEMO_STARTER_V1"
    assert len(setup.initialization["decks"]) == 2
    assert set(setup.engine) == {"version", "artifactHash"} and len(setup.engine["artifactHash"]) == 64


async def test_for_seed_derives_seed_and_match_id_only():
    a, b = CTX["setup"].for_seed("x"), CTX["setup"].for_seed("x")
    assert a.initialization == b.initialization and a.initialization["seed"] == "x"
    assert uuid.UUID(a.initialization["matchId"]).version == 5
    assert a.initialization["matchId"] != CTX["setup"].for_seed("y").initialization["matchId"]
    assert a.initialization["decks"] == CTX["setup"].initialization["decks"] and a.content is CTX["setup"].content


async def test_baseline_game_plays_to_an_engine_outcome():
    rows, _ = await full_baseline_game()
    header, decisions, result = rows[0], rows[1:-1], rows[-1]
    assert header["kind"] == "match" and result["kind"] == "result"
    assert all(row["kind"] == "decision" for row in decisions) and len(decisions) > 20
    assert result["status"] == "finished" and result["detail"] is None, result
    assert {result["winnerSeat"], result["loserSeat"]} == {0, 1}
    assert result["reason"] in {"EMPTY_DRAW", "START_TURN_GIGS", "OVERTIME_GIGS"}
    assert result["decisions"] == len(decisions) and result["selections"] == {"baseline": len(decisions)}
    assert result["finalStateHash"] == decisions[-1]["stateHash"]
    assert [row["index"] for row in decisions] == list(range(len(decisions)))
    assert {row["seat"] for row in decisions} == {0, 1}


async def test_every_chosen_action_was_offered_by_the_engine():
    rows, offered = await full_baseline_game()
    decisions = rows[1:-1]
    assert len(offered) == len(decisions)
    for row, decision in zip(decisions, offered):
        assert row["actionId"] in decision.offered_ids
        assert row["offered"] == len(decision.legal_actions)
        assert row["actionId"] == baseline_action_id(decision.legal_actions)
        assert row["playerId"] == decision.player_id and row["index"] == decision.sequence


async def test_same_seed_replays_the_same_game():
    first, _ = await full_baseline_game()
    second, _ = await play(CTX["setup"].for_seed("test-local-match"), baseline_pair(), ["baseline", "baseline"])
    def trace(rows):
        return [(r["seat"], r["actionId"], r["stateHash"]) for r in rows[1:-1]]
    assert trace(first) == trace(second)
    assert first[-1]["finalStateHash"] == second[-1]["finalStateHash"]
    assert first[0]["initialStateHash"] == second[0]["initialStateHash"]
    other, _ = await play(CTX["setup"].for_seed("test-local-match-other"), baseline_pair(),
                          ["baseline", "baseline"], max_decisions=40)
    assert other[0]["initialStateHash"] != first[0]["initialStateHash"]


async def test_policies_see_only_public_input():
    seen = []

    async def spy(decision):
        seen.append(json.dumps({"snapshot": decision.snapshot, "actions": decision.legal_actions,
                                "pending": decision.pending, "turn": decision.turn}, sort_keys=True))
        return decision.legal_actions[0]["actionId"]

    await play(CTX["setup"].for_seed("test-public"), [PolicyRunner(spy), PolicyRunner(spy)],
               ["fake", "fake"], max_decisions=40)
    assert len(seen) == 40
    for text in seen:
        for key in FORBIDDEN_KEYS:
            assert f'"{key}"' not in text, key
        assert '"state"' not in text and '"events"' not in text


async def test_fake_mlx_seat_choices_are_applied():
    async def last(decision):
        return decision.legal_actions[-1]["actionId"]

    rows, offered = await play(CTX["setup"].for_seed("test-fake-mlx"), [PolicyRunner(), PolicyRunner(last)],
                               ["baseline", "mlx"], max_decisions=60)
    seat1 = [(row, d) for row, d in zip(rows[1:-1], offered) if row["seat"] == 1]
    assert seat1 and all(row["reason"] == "policy" and row["policy"] == "mlx" for row, _ in seat1)
    assert all(row["actionId"] == d.legal_actions[-1]["actionId"] for row, d in seat1)
    assert all(row["reason"] == "baseline" for row in rows[1:-1] if row["seat"] == 0)
    assert rows[-1]["status"] == "decision_cap" and rows[-1]["decisions"] == 60


async def test_non_offered_action_falls_back_to_baseline():
    async def rogue(_decision):
        return "0" * 64

    rows, offered = await play(CTX["setup"].for_seed("test-rogue"), [PolicyRunner(rogue), PolicyRunner(rogue)],
                               ["mlx", "mlx"], max_decisions=30)
    decisions = rows[1:-1]
    assert len(decisions) == 30 and rows[-1]["selections"] == {"invalid_action_fallback": 30}
    for row, decision in zip(decisions, offered):
        assert row["reason"] == "invalid_action_fallback"
        assert row["actionId"] == baseline_action_id(decision.legal_actions)


async def test_failing_and_slow_policies_fall_back():
    async def broken(_decision):
        raise RuntimeError("model crashed")

    async def slow(decision):
        await asyncio.sleep(1)
        return decision.legal_actions[0]["actionId"]

    rows, _ = await play(CTX["setup"].for_seed("test-broken"),
                         [PolicyRunner(broken), PolicyRunner(slow, max_decision_ms=100)],
                         ["mlx", "mlx"], max_decisions=12)
    reasons = {row["seat"]: row["reason"] for row in rows[1:-1]}
    assert reasons == {0: "policy_error_fallback", 1: "timeout_fallback"}, reasons


async def test_turn_cap_and_engine_errors_end_with_a_result_row():
    rows, _ = await play(CTX["setup"].for_seed("test-cap"), baseline_pair(), ["baseline", "baseline"],
                         max_turns=1)
    assert rows[-1]["status"] == "turn_cap" and rows[-1]["turns"] == 2
    bad = MatchSetup(CTX["setup"].content, {**CTX["setup"].initialization, "decks": []}, "test")
    rows, _ = await play(bad.for_seed("test-bad"), baseline_pair(), ["baseline", "baseline"])
    assert [row["kind"] for row in rows] == ["match", "result"]
    assert rows[-1]["status"] == "engine_error" and rows[-1]["detail"] and rows[-1]["finalStateHash"] is None


async def test_record_round_trips_without_hidden_state():
    rows, _ = await full_baseline_game()
    with tempfile.TemporaryDirectory() as tmp:
        path = write_match_record(Path(tmp) / "m.jsonl", rows)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert [json.loads(line) for line in lines] == rows
        try:
            write_match_record(path, rows)
        except FileExistsError:
            pass
        else:
            raise AssertionError("an existing match record was overwritten")
        write_match_record(path, rows[:2], force=True)
        assert len(path.read_text(encoding="utf-8").splitlines()) == 2
    header = rows[0]
    assert header["engine"] == dict(CTX["setup"].engine) and header["seed"] == "test-local-match"
    assert header["decks"] == CTX["setup"].initialization["decks"]
    assert set(rows[1]) == {"kind", "index", "turn", "step", "seat", "playerId", "policy", "offered",
                            "actionId", "label", "reason", "elapsedMs", "stateHash"}
    text = "\n".join(json.dumps(row) for row in rows)
    for key in (*FORBIDDEN_KEYS, "state", "events", "hand"):
        assert f'"{key}"' not in text, key


async def test_setup_file_accepts_a_replay_fixture_and_summary_counts():
    setup = load_setup_file(REPO_ROOT / "tests/fixtures/demo-matrix-empty-draw-replay.v1.json")
    assert setup.engine == CTX["setup"].engine and setup.source.startswith("file:")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "bad.json"
        path.write_text("{}", encoding="utf-8")
        try:
            load_setup_file(path)
        except ValueError:
            pass
        else:
            raise AssertionError("a setup without content/initialization was accepted")
    rows, _ = await full_baseline_game()
    summary = summarize([rows, rows])
    assert summary["matches"] == 2 and summary["statuses"] == {"finished": 2}
    assert summary["decisions"] == 2 * rows[-1]["decisions"] and summary["fallbacks"] == 0


async def run_tests(node):
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["setup"] = load_default_setup(REPO_ROOT, node=node)
    with EngineWorker(REPO_ROOT, node=node) as engine:
        CTX["engine"] = engine
        for test in tests:
            await test()
            print(f"OK  {test.__name__}")
    print(f"PASS local match runner: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    asyncio.run(run_tests(args.node))


if __name__ == "__main__":
    main()
