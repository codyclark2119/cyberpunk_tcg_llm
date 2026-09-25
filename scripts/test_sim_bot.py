#!/usr/bin/env python3
"""Offline HTTP and policy-boundary regression tests for the simulator bot.

Uses synthetic v1alpha1 requests, including the guide's roll/end example. These
are contract probes, not gold gameplay labels or evidence of playing strength.
Requires fastapi and httpx; no model, database, local engine or network calls.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import io
import json
import logging
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.sim_bot import BotProfile, BotService, build_app


def request(**changes):
    actions = [
        {"actionId": "act_001", "source": "die", "label": "ROLL D12", "type": "roll_die",
         "payload": {"dieId": "die_player2_1"}, "sourceDieId": "die_player2_1"},
        {"actionId": "act_002", "source": "primary", "label": "END TURN",
         "type": "end_turn", "payload": {}},
    ]
    return {"apiVersion": "v1alpha1", "event": "state_sync", "requestId": "request-1",
            "matchId": "ABC123", "sequence": 17, "status": "acting", "playerId": "player2",
            "botId": BotProfile.bot_id, "deadlineMs": 3000, "prompt": "Choose an action.",
            "snapshot": {"game": {}, "players": {}, "controls": {}},
            "turn": {"number": 4, "round": 2, "step": "play", "stage": "player_turn"},
            "pending": None, "waitReason": None, "metadata": {"rulesVersion": "server-current"},
            "legalActions": actions, "possibleActions": copy.deepcopy(actions), **changes}


def ready_request(**changes):
    return {"apiVersion": "v1alpha1", "game": "cyberpunk-tcg-sim", "check": "ready", **changes}


@asynccontextmanager
async def client(service=None, **kwargs):
    import httpx
    transport = httpx.ASGITransport(app=build_app(service, **kwargs))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as value:
        yield value


async def test_ready_reports_configured_profile():
    service = BotService(BotProfile("community.test", "Test Bot", "1.2.3"))
    async with client(service) as http:
        response = await http.post("/ready", json=ready_request(extra="ignored"))
    assert response.status_code == 200
    assert response.json() == {"ok": True, "ready": True, "botId": "community.test",
                               "name": "Test Bot", "version": "1.2.3", "apiVersions": ["v1alpha1"]}


async def test_ready_rejects_incompatible_checks():
    async with client() as http:
        for changes in ({"apiVersion": "v2"}, {"game": "another-game"}, {"check": "other"}):
            response = await http.post("/ready", json=ready_request(**changes))
            assert response.status_code == 400 and response.json()["ok"] is False


async def test_guide_example_returns_only_current_id():
    async with client() as http:
        response = await http.post("/sync", json=request())
    assert response.status_code == 200
    assert response.json() == {"ok": True, "actionId": "act_001", "requestId": "request-1"}


async def test_possible_actions_alias_without_legal_actions():
    body = request()
    del body["legalActions"]
    async with client() as http:
        response = await http.post("/sync", json=body)
    assert response.json()["actionId"] == "act_001"


async def test_legal_actions_override_divergent_alias():
    body = request(possibleActions=[{"actionId": "stale", "type": "roll_die"}])
    async with client() as http:
        response = await http.post("/sync", json=body)
    assert response.json()["actionId"] == "act_001"


async def test_empty_or_malformed_authority_never_uses_alias():
    async with client() as http:
        for actions in ([], None, {}, "actions"):
            response = await http.post("/sync", json=request(legalActions=actions))
            assert response.status_code == 400 and response.json()["ok"] is False
            assert "actionId" not in response.json()


async def test_waiting_and_finished_do_not_invoke_policy():
    async def fail(_decision):
        raise AssertionError("non-acting request called policy")
    async with client(BotService(policy=fail)) as http:
        for status in ("waiting", "finished"):
            body = request(status=status, legalActions=None)
            del body["deadlineMs"]
            response = await http.post("/sync", json=body)
            assert response.status_code == 200
            assert response.json() == {"ok": True, "actionId": None, "requestId": "request-1"}


async def test_unknown_snapshot_and_action_fields_are_additive():
    body = request(snapshot={"future": {"knownCard": "visible-to-this-seat"}}, newField=True)
    body["legalActions"] = [{"actionId": "future-id", "type": "new-action-type", "future": [1, 2]}]
    async with client() as http:
        response = await http.post("/sync", json=body)
    assert response.json()["actionId"] == "future-id"


async def test_missing_optional_context_is_tolerated():
    body = request()
    for key in ("prompt", "turn", "pending", "metadata", "waitReason", "possibleActions"):
        del body[key]
    async with client() as http:
        response = await http.post("/sync", json=body)
    assert response.json()["ok"] is True


async def test_invalid_envelopes_fail_closed():
    async with client() as http:
        for changes in ({"apiVersion": "v2"}, {"event": "other"}, {"botId": "another-bot"},
                        {"requestId": ""}, {"matchId": None}, {"playerId": 3}, {"sequence": True},
                        {"sequence": -1}, {"status": "unknown"}, {"deadlineMs": False},
                        {"deadlineMs": 0}, {"deadlineMs": -1}, {"deadlineMs": "3000"},
                        {"snapshot": []}, {"metadata": None}, {"turn": []}, {"prompt": {}}):
            response = await http.post("/sync", json=request(**changes))
            assert response.status_code == 400, changes
            assert response.json()["ok"] is False, changes


async def test_malformed_or_duplicate_actions_fail_closed():
    async with client() as http:
        for actions in ([None], [{}], [{"actionId": ""}], [{"actionId": []}],
                        [{"actionId": "a"}, {"actionId": "a"}],
                        [{"actionId": "a", "type": {}}], [{"actionId": "a", "source": []}]):
            response = await http.post("/sync", json=request(legalActions=actions))
            assert response.status_code == 400, actions


async def test_invalid_json_is_a_contract_error():
    async with client() as http:
        for body in (b"", b"{", b"null", b"[]", b'"text"', b"\xff", b'{"a": NaN}', b'{"a": Infinity}'):
            for endpoint in ("/ready", "/sync"):
                response = await http.post(endpoint, content=body)
                assert response.status_code == 400, (endpoint, body)
                assert response.json()["ok"] is False


async def test_request_body_limit_is_enforced():
    async with client(max_body_bytes=100) as http:
        response = await http.post("/sync", content=b" " * 101)
    assert response.status_code == 400 and "too large" in response.json()["error"]


async def test_nested_base_path_routes():
    async with client(base_path="/bots/cyberpunk/") as http:
        assert (await http.post("/bots/cyberpunk/ready", json=ready_request())).json()["ready"]
        assert (await http.post("/bots/cyberpunk/sync", json=request())).json()["actionId"] == "act_001"
        assert (await http.post("/sync", json=request())).status_code == 404
        assert (await http.get("/bots/cyberpunk/ready")).status_code == 405


async def test_baseline_is_stable_under_retries_and_reordering():
    service = BotService()
    body = request(legalActions=[{"actionId": "b", "type": "play_card"},
                                 {"actionId": "a", "type": "play_card"}])
    for _ in range(3):
        result = await service.sync(body)
        assert result["actionId"] == "a"
        body["legalActions"].reverse()


async def test_only_action_and_setup_pending_choices():
    service = BotService()
    assert (await service.sync(request(legalActions=[{"actionId": "only"}])))["actionId"] == "only"
    for source in ("setup", "pending"):
        actions = request()["legalActions"] + [{"actionId": "choice", "source": source}]
        assert (await service.sync(request(legalActions=actions)))["actionId"] == "choice"


async def test_baseline_keeps_playing_when_concession_is_offered():
    for kind in ("concede", "surrender"):
        actions = [{"actionId": "concession", "type": kind},
                   {"actionId": "continue", "type": "end_turn"}]
        result = await BotService().sync(request(legalActions=actions))
        assert result["actionId"] == "continue"


async def test_policy_gets_visible_context_and_can_choose_another_action():
    seen = []
    async def policy(decision):
        seen.append(decision)
        return "act_002"
    body = request(snapshot={"players": {"player2": {"knownCards": ["own-card"]}}},
                   pending={"type": "choice"}, hiddenEngineState="not forwarded")
    result = await BotService(policy=policy).sync(body)
    assert result["actionId"] == "act_002"
    assert seen[0].snapshot == body["snapshot"] and seen[0].pending == body["pending"]
    assert seen[0].match_id == "ABC123" and seen[0].player_id == "player2"
    assert seen[0].sequence == 17 and seen[0].deadline_ms == 3000
    assert not hasattr(seen[0], "hiddenEngineState")


async def test_policy_cannot_mutate_authoritative_ids_or_input():
    async def policy(decision):
        decision.legal_actions[0]["actionId"] = "forged"
        decision.snapshot["secret"] = "changed"
        return "forged"
    body = request()
    before = copy.deepcopy(body)
    result = await BotService(policy=policy).sync(body)
    assert result["actionId"] == "act_001" and body == before


async def test_invalid_policy_outputs_use_current_fallback():
    for invalid in ("stale-id", "", None, [], {}, True):
        async def policy(_decision):
            return invalid
        result = await BotService(policy=policy).sync(request())
        assert result["actionId"] == "act_001", invalid


async def test_failed_or_cancelled_policy_falls_back():
    for error in (RuntimeError("private prompt must not leak"), asyncio.CancelledError()):
        async def policy(_decision):
            raise error
        async with client(BotService(policy=policy)) as http:
            response = await http.post("/sync", json=request())
        assert response.status_code == 200 and response.json()["actionId"] == "act_001"


async def test_timeout_cancels_inference_and_returns_fallback():
    cancelled = asyncio.Event()
    async def policy(_decision):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    service = BotService(policy=policy, max_decision_ms=30)
    # A generous outer bound detects a hang without making scheduler speed a game rule.
    result = await asyncio.wait_for(service.sync(request()), timeout=1)
    assert result["actionId"] == "act_001"
    await asyncio.wait_for(cancelled.wait(), timeout=1)


async def test_request_deadline_caps_larger_service_limit():
    cancelled = asyncio.Event()
    async def policy(_decision):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    result = await asyncio.wait_for(BotService(policy=policy).sync(request(deadlineMs=30)), timeout=1)
    assert result["actionId"] == "act_001"
    await asyncio.wait_for(cancelled.wait(), timeout=1)


async def test_exhausted_deadline_does_not_start_policy():
    calls = []
    async def policy(_decision):
        calls.append(1)
        return "act_002"
    result = await BotService(policy=policy).sync(request(deadlineMs=10), started=time.monotonic() - 1)
    assert result["actionId"] == "act_001" and calls == []


async def test_busy_policy_capacity_falls_back_without_queueing():
    entered, release = asyncio.Event(), asyncio.Event()
    async def policy(_decision):
        entered.set()
        await release.wait()
        return "act_002"
    service = BotService(policy=policy, max_policy_calls=1)
    first = asyncio.create_task(service.sync(request()))
    await asyncio.wait_for(entered.wait(), timeout=1)
    second = await service.sync(request(requestId="second"))
    assert second["actionId"] == "act_001"
    release.set()
    assert (await first)["actionId"] == "act_002"


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
    service = BotService(policy=policy, max_policy_calls=1, max_decision_ms=30)
    try:
        result = await asyncio.wait_for(service.sync(request()), timeout=1)
        assert result["actionId"] == "act_001"
        await asyncio.wait_for(cancelled.wait(), timeout=1)
        result = await service.sync(request(requestId="second"))
        assert result["actionId"] == "act_001" and len(calls) == 1
    finally:
        release.set()
        await asyncio.wait_for(finished.wait(), timeout=1)
        await asyncio.sleep(0)
    assert not service._tasks


async def test_concurrent_matches_and_later_requests_never_reuse_ids():
    async def policy(decision):
        await asyncio.sleep(0)
        return decision.legal_actions[-1]["actionId"]
    async with client(BotService(policy=policy)) as http:
        bodies = [request(matchId=f"match-{i}", requestId=f"req-{i}", sequence=i,
                          legalActions=[{"actionId": f"current-{i}"}]) for i in range(20)]
        responses = await asyncio.gather(*(http.post("/sync", json=body) for body in bodies))
        for i, response in enumerate(responses):
            assert response.json()["actionId"] == f"current-{i}"
        later = request(sequence=18, requestId="request-2", legalActions=[{"actionId": "next"}])
        assert (await http.post("/sync", json=later)).json()["actionId"] == "next"


async def test_logs_include_identifiers_without_private_input():
    logger = logging.getLogger("cyberpunk.sim_bot")
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    old_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    try:
        await BotService().sync(request(snapshot={"private-card": "never-log-this"}, prompt="private-prompt"))
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)
    record = json.loads(output.getvalue())
    assert (record["requestId"], record["matchId"], record["actionId"]) == ("request-1", "ABC123", "act_001")
    assert record["selection"] == "baseline" and record["elapsedMs"] >= 0
    assert "never-log-this" not in output.getvalue() and "private-prompt" not in output.getvalue()


async def test_configuration_and_profile_cli():
    for path in ("relative", "/a//b", "//host", "/a/../b", "/{dynamic}", "/a?b"):
        try:
            build_app(base_path=path)
        except ValueError:
            pass
        else:
            raise AssertionError(f"bad path accepted: {path}")
    for settings in ({"max_decision_ms": 0}, {"max_policy_calls": False}):
        try:
            BotService(**settings)
        except ValueError:
            pass
        else:
            raise AssertionError(f"bad config accepted: {settings}")
    result = subprocess.run([sys.executable, str(REPO_ROOT / "scripts/serve_sim_bot.py"),
                             "--profile-url", "https://example.test/cyberpunk", "--bot-id", "community.test"],
                            capture_output=True, text=True, check=True, cwd=REPO_ROOT.parent)
    profile = json.loads(result.stdout)
    assert profile["botId"] == "community.test" and profile["url"].endswith("/cyberpunk")
    assert profile["apiVersions"] == ["v1alpha1"]


async def run_tests():
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        await test()
        print(f"OK  {test.__name__}")
    print(f"PASS simulator bot: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    asyncio.run(run_tests())


if __name__ == "__main__":
    main()
