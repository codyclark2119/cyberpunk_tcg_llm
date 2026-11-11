#!/usr/bin/env python3
"""Offline regression tests for the local action-selection policy layer.

Covers decision validation (only well-formed, uniquely identified offered actions
reach a policy), the deterministic baseline, and the runner's deadline, capacity,
timeout, invalid-output and failure fallbacks. Positions are synthetic probes,
not gold gameplay labels or evidence of playing strength. No model, server,
database, local engine or network call is used.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import dataclasses
import io
import json
import logging
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.sim_bot import (DEFAULT_DECISION_BUDGET_MS, MAX_DECISION_BUDGET_MS, Decision,
                                     DecisionError, PolicyRunner, baseline_action_id,
                                     check_budget_ms, decision_from_record)


def actions():
    return [
        {"actionId": "act_001", "source": "die", "label": "ROLL D12", "type": "roll_die",
         "payload": {"dieId": "die_player2_1"}, "sourceDieId": "die_player2_1"},
        {"actionId": "act_002", "source": "primary", "label": "END TURN",
         "type": "end_turn", "payload": {}},
    ]


def record(**changes):
    return {"requestId": "request-1", "matchId": "ABC123", "sequence": 17, "playerId": "player2",
            "deadlineMs": 3000, "prompt": "Choose an action.",
            "snapshot": {"game": {}, "players": {}, "controls": {}},
            "turn": {"number": 4, "round": 2, "step": "play", "stage": "player_turn"},
            "pending": None, "metadata": {"rulesVersion": "snapshot"},
            "legalActions": actions(), **changes}


def request(**changes):
    """A valid Decision; keyword changes use camelCase record keys."""
    return decision_from_record(record(**changes))


def rejects(build):
    try:
        build()
    except DecisionError:
        return True
    return False


async def test_roll_end_example_returns_current_id():
    selection = await PolicyRunner().choose(request())
    assert (selection.action_id, selection.reason) == ("act_001", "baseline")
    assert baseline_action_id(request().legal_actions) == "act_001"


async def test_record_requires_legal_actions_without_alias():
    body = record(possibleActions=actions())
    del body["legalActions"]
    assert rejects(lambda: decision_from_record(body))
    for value in (None, [], "record"):
        assert rejects(lambda: decision_from_record(value))


async def test_empty_or_malformed_action_lists_fail_closed():
    for value in ([], None, {}, "actions", ()):
        assert rejects(lambda: request(legalActions=value)), value


async def test_unknown_snapshot_and_action_fields_are_additive():
    decision = request(snapshot={"future": {"knownCard": "visible-to-this-seat"}}, newField=True,
                       legalActions=[{"actionId": "future-id", "type": "new-action-type", "future": [1, 2]}])
    assert (await PolicyRunner().choose(decision)).action_id == "future-id"


async def test_missing_optional_context_is_tolerated():
    body = record()
    for key in ("prompt", "turn", "pending", "metadata", "deadlineMs", "snapshot"):
        del body[key]
    decision = decision_from_record(body)
    assert decision.deadline_ms is None and decision.snapshot == {} and decision.prompt == ""
    assert (await PolicyRunner().choose(decision)).action_id == "act_001"


async def test_invalid_decision_fields_fail_closed():
    for changes in ({"requestId": ""}, {"matchId": None}, {"playerId": 3}, {"sequence": True},
                    {"sequence": -1}, {"deadlineMs": False}, {"deadlineMs": 0}, {"deadlineMs": -1},
                    {"deadlineMs": "3000"}, {"deadlineMs": float("nan")}, {"deadlineMs": float("inf")},
                    {"snapshot": []}, {"metadata": None}, {"turn": []}, {"prompt": {}}):
        assert rejects(lambda: request(**changes)), changes
    assert rejects(lambda: dataclasses.replace(request(), sequence=-1))


async def test_malformed_or_duplicate_actions_fail_closed():
    for value in ([None], [{}], [{"actionId": ""}], [{"actionId": []}],
                  [{"actionId": "a"}, {"actionId": "a"}],
                  [{"actionId": "a", "type": {}}], [{"actionId": "a", "source": []}]):
        assert rejects(lambda: request(legalActions=value)), value


async def test_runner_requires_a_validated_decision():
    try:
        await PolicyRunner().choose(record())
    except TypeError:
        return
    raise AssertionError("raw record accepted")


async def test_baseline_is_stable_under_retries_and_reordering():
    runner = PolicyRunner()
    offered = [{"actionId": "b", "type": "play_card"}, {"actionId": "a", "type": "play_card"}]
    for _ in range(3):
        assert (await runner.choose(request(legalActions=offered))).action_id == "a"
        offered.reverse()


async def test_only_action_and_setup_pending_choices():
    runner = PolicyRunner()
    assert (await runner.choose(request(legalActions=[{"actionId": "only"}]))).action_id == "only"
    for source in ("setup", "pending"):
        offered = actions() + [{"actionId": "choice", "source": source}]
        assert (await runner.choose(request(legalActions=offered))).action_id == "choice"


async def test_baseline_keeps_playing_when_concession_is_offered():
    for kind in ("concede", "surrender"):
        offered = [{"actionId": "concession", "type": kind},
                   {"actionId": "continue", "type": "end_turn"}]
        assert (await PolicyRunner().choose(request(legalActions=offered))).action_id == "continue"


async def test_policy_gets_visible_context_and_can_choose_another_action():
    seen = []
    async def policy(decision):
        seen.append(decision)
        return "act_002"
    decision = request(snapshot={"players": {"player2": {"knownCards": ["own-card"]}}},
                       pending={"type": "choice"}, hiddenEngineState="not forwarded")
    selection = await PolicyRunner(policy).choose(decision)
    assert (selection.action_id, selection.reason) == ("act_002", "policy")
    assert seen[0].snapshot == decision.snapshot and seen[0].pending == decision.pending
    assert seen[0].match_id == "ABC123" and seen[0].player_id == "player2"
    assert seen[0].sequence == 17 and seen[0].deadline_ms == 3000
    assert not hasattr(seen[0], "hiddenEngineState") and not hasattr(seen[0], "hidden_engine_state")


async def test_policy_cannot_mutate_authoritative_ids_or_input():
    async def policy(decision):
        decision.legal_actions[0]["actionId"] = "forged"
        decision.snapshot["secret"] = "changed"
        return "forged"
    decision = request()
    before = copy.deepcopy(decision)
    selection = await PolicyRunner(policy).choose(decision)
    assert selection.action_id == "act_001" and selection.reason == "invalid_action_fallback"
    assert decision == before


async def test_invalid_policy_outputs_use_current_fallback():
    for invalid in ("stale-id", "", None, [], {}, True):
        async def policy(_decision):
            return invalid
        selection = await PolicyRunner(policy).choose(request())
        assert selection.action_id == "act_001", invalid
        assert selection.reason == "invalid_action_fallback", invalid


async def test_failed_or_cancelled_policy_falls_back():
    for error in (RuntimeError("private prompt must not leak"), asyncio.CancelledError()):
        async def policy(_decision):
            raise error
        selection = await PolicyRunner(policy).choose(request())
        assert (selection.action_id, selection.reason) == ("act_001", "policy_error_fallback")


async def test_timeout_cancels_inference_and_returns_fallback():
    cancelled = asyncio.Event()
    async def policy(_decision):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    runner = PolicyRunner(policy, max_decision_ms=30)
    # A generous outer bound detects a hang without making scheduler speed a game rule.
    selection = await asyncio.wait_for(runner.choose(request()), timeout=1)
    assert (selection.action_id, selection.reason) == ("act_001", "timeout_fallback")
    await asyncio.wait_for(cancelled.wait(), timeout=1)


async def test_decision_deadline_caps_larger_runner_limit():
    cancelled = asyncio.Event()
    async def policy(_decision):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    selection = await asyncio.wait_for(PolicyRunner(policy).choose(request(deadlineMs=30)), timeout=1)
    assert selection.action_id == "act_001"
    await asyncio.wait_for(cancelled.wait(), timeout=1)


async def test_missing_deadline_uses_runner_limit():
    async def policy(_decision):
        await asyncio.Event().wait()
    body = record()
    del body["deadlineMs"]
    runner = PolicyRunner(policy, max_decision_ms=30)
    selection = await asyncio.wait_for(runner.choose(decision_from_record(body)), timeout=1)
    assert selection.reason == "timeout_fallback"


async def test_exhausted_deadline_does_not_start_policy():
    calls = []
    async def policy(_decision):
        calls.append(1)
        return "act_002"
    selection = await PolicyRunner(policy).choose(request(deadlineMs=10), started=time.monotonic() - 1)
    assert (selection.action_id, selection.reason) == ("act_001", "deadline_fallback") and calls == []


async def test_busy_policy_capacity_falls_back_without_queueing():
    entered, release = asyncio.Event(), asyncio.Event()
    async def policy(_decision):
        entered.set()
        await release.wait()
        return "act_002"
    runner = PolicyRunner(policy, max_policy_calls=1)
    first = asyncio.create_task(runner.choose(request()))
    await asyncio.wait_for(entered.wait(), timeout=1)
    second = await runner.choose(request(requestId="second"))
    assert (second.action_id, second.reason) == ("act_001", "busy_fallback")
    release.set()
    assert (await first).action_id == "act_002"


async def test_timed_out_policy_retains_capacity_until_it_exits():
    cancelled, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
    calls = []
    async def policy(_decision):
        calls.append(1)
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()  # Simulate slow cleanup without blocking the event loop.
        finally:
            finished.set()
        return "act_002"
    runner = PolicyRunner(policy, max_policy_calls=1, max_decision_ms=30)
    try:
        selection = await asyncio.wait_for(runner.choose(request()), timeout=1)
        assert selection.action_id == "act_001"
        await asyncio.wait_for(cancelled.wait(), timeout=1)
        selection = await runner.choose(request(requestId="second"))
        assert selection.action_id == "act_001" and len(calls) == 1
    finally:
        release.set()
        await asyncio.wait_for(finished.wait(), timeout=1)
        await asyncio.sleep(0)
    assert not runner._tasks


async def test_concurrent_matches_and_later_decisions_never_reuse_ids():
    async def policy(decision):
        await asyncio.sleep(0)
        return decision.legal_actions[-1]["actionId"]
    runner = PolicyRunner(policy)
    decisions = [request(matchId=f"match-{i}", requestId=f"req-{i}", sequence=i,
                         legalActions=[{"actionId": f"current-{i}"}]) for i in range(20)]
    selections = await asyncio.gather(*(runner.choose(decision) for decision in decisions))
    for i, selection in enumerate(selections):
        assert selection.action_id == f"current-{i}"
    later = request(sequence=18, requestId="request-2", legalActions=[{"actionId": "next"}])
    assert (await runner.choose(later)).action_id == "next"


async def test_logs_include_identifiers_without_private_input():
    logger = logging.getLogger("cyberpunk.sim_bot")
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    old_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    try:
        await PolicyRunner().choose(request(snapshot={"private-card": "never-log-this"},
                                            prompt="private-prompt"))
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)
    entry = json.loads(output.getvalue())
    assert (entry["requestId"], entry["matchId"], entry["actionId"]) == ("request-1", "ABC123", "act_001")
    assert entry["selection"] == "baseline" and entry["elapsedMs"] >= 0
    assert "never-log-this" not in output.getvalue() and "private-prompt" not in output.getvalue()


async def test_runner_configuration_is_validated():
    for settings in ({"max_decision_ms": 0}, {"max_decision_ms": 1.5}, {"max_policy_calls": False},
                     {"max_policy_calls": 0}):
        try:
            PolicyRunner(**settings)
        except ValueError:
            continue
        raise AssertionError(f"bad config accepted: {settings}")


async def test_default_budget_is_the_local_play_default_and_configurable():
    assert DEFAULT_DECISION_BUDGET_MS == 10_000
    assert PolicyRunner().max_decision_ms == DEFAULT_DECISION_BUDGET_MS
    assert PolicyRunner(max_decision_ms=1234).max_decision_ms == 1234
    assert check_budget_ms(500) == 500
    for bad in (0, -1, 1.5, True, "1000", MAX_DECISION_BUDGET_MS + 1):
        try:
            check_budget_ms(bad)
        except ValueError:
            continue
        raise AssertionError(f"bad budget accepted: {bad!r}")


async def test_fallbacks_carry_a_safe_failure_code():
    class Coded(RuntimeError):
        code = "worker_busy"

    class Unsafe(RuntimeError):
        code = "private prompt text"

    async def raises(exc):
        async def policy(_decision):
            raise exc
        return await PolicyRunner(policy).choose(request())

    assert (await raises(Coded())).error == "worker_busy"
    assert (await raises(Unsafe())).error == "policy_error"
    assert (await raises(RuntimeError("private"))).error == "policy_error"
    assert (await raises(asyncio.CancelledError())).error == "policy_cancelled"

    async def stale(_decision):
        return "stale-id"
    assert (await PolicyRunner(stale).choose(request())).error == "invalid_action"

    async def hang(_decision):
        await asyncio.Event().wait()
    assert (await PolicyRunner(hang, max_decision_ms=30).choose(request())).error == "timeout"

    async def good(_decision):
        return "act_002"
    ok = await PolicyRunner(good).choose(request())
    assert (ok.reason, ok.error, ok.worker_event) == ("policy", None, None)
    late = await PolicyRunner(good).choose(request(deadlineMs=10), started=time.monotonic() - 1)
    assert late.error == "deadline_exceeded"
    assert (await PolicyRunner().choose(request())).error is None


async def test_prepare_runs_before_the_budget_clock_and_reports_its_event():
    class Policy:
        def __init__(self):
            self.matches = 0
        def begin_match(self):
            self.matches += 1
        async def prepare(self):
            await asyncio.sleep(0.1)  # Longer than the budget: must not count against it.
            return "worker_restarted"
        async def __call__(self, _decision):
            return "act_002"
    policy = Policy()
    runner = PolicyRunner(policy, max_decision_ms=60)
    runner.begin_match()
    selection = await runner.choose(request(deadlineMs=None))
    assert policy.matches == 1
    assert (selection.reason, selection.worker_event) == ("policy", "worker_restarted")

    class Broken(Policy):
        async def prepare(self):
            raise RuntimeError("private")
    selection = await PolicyRunner(Broken()).choose(request())
    assert (selection.reason, selection.worker_event) == ("policy", "prepare_failed")


async def run_tests():
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        await test()
        print(f"OK  {test.__name__}")
    print(f"PASS policy layer: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    asyncio.run(run_tests())


if __name__ == "__main__":
    main()
