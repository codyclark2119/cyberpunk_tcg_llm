#!/usr/bin/env python3
"""Portable regression tests for local MLX orchestration, without model weights.

Real subprocesses exercise deadlines, late answers after a timeout, cancellation,
busy handling, restarts, protocol faults and shutdown. Injected tokenizers/generators cover prompt limits and output parsing.
These tests do not claim that Metal inference or gameplay strength was measured.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import dataclasses
import io
import json
import logging
import os
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from games.cyberpunk.sim_bot import Decision, PolicyRunner
from games.cyberpunk.sim_mlx import MLXPolicy, local_path, make_worker, watchdog_seconds
from games.cyberpunk.sim_prompt import build_choice_messages, parse_choice
from harness.core.local_worker import LocalWorker, MAX_LINE_BYTES, PROTOCOL, WorkerError
from benchmark_sim_bot import measure, summarize
from mlx_sim_worker import run_generation


def fake_worker(mode):
    def emit(record):
        print(json.dumps({"protocol": PROTOCOL, **record}), flush=True)
    if mode == "never_ready":
        time.sleep(20)
    if mode == "startup_error":
        emit({"event": "ready", "ok": False})
        return
    emit({"event": "ready", "ok": True})
    marker = os.environ.get("FAKE_WORKER_MARKER")
    if mode == "crash_once" and marker and os.path.exists(marker):
        mode = "good"  # The restarted process behaves.
    for line in sys.stdin:
        message = json.loads(line)
        if mode == "crash" or mode == "crash_once":
            if marker:
                Path(marker).touch()
            return
        if mode == "late_first":
            # Request 1 answers choice 0 after the budget; every later one answers choice 1.
            if message["id"] == 1:
                time.sleep(0.3)
            emit({"id": message["id"], "ok": True,
                  "text": '{"choice":0}' if message["id"] == 1 else '{"choice":1}'})
            continue
        if mode == "hang":
            time.sleep(20)
        if mode == "slow" or (mode == "slow_first" and message["id"] == 1):
            time.sleep(0.18)
        if mode == "oversized":
            print("x" * (MAX_LINE_BYTES + 1000), flush=True)
            continue
        if mode == "malformed":
            print("not json", flush=True)
            continue
        if mode == "stderr":
            print("private-card-never-log", file=sys.stderr, flush=True)
        if mode == "error":
            emit({"id": message["id"], "ok": False, "error": "prompt_too_large"})
            continue
        if mode == "environment":
            emit({"id": message["id"], "ok": True,
                  "offline": os.environ.get("HF_HUB_OFFLINE"),
                  "telemetry": os.environ.get("HF_HUB_DISABLE_TELEMETRY")})
            continue
        emit({"id": True if mode == "bool_id" else message["id"] + (1 if mode == "wrong_id" else 0),
              "protocol": "wrong" if mode == "wrong_protocol" else PROTOCOL,
              "ok": True, "text": 'secret invalid generated output' if mode == "invalid" else '{"choice":1}',
              "promptTokens": 123, "generationTokens": 6, "inferenceMs": 170 if mode == "slow" else 1})


def new_worker(mode="good", **kwargs):
    return LocalWorker([sys.executable, "-u", str(Path(__file__).resolve()), "--fake-worker", mode],
                       cwd=REPO_ROOT, startup_timeout=kwargs.pop("startup_timeout", 5),
                       response_timeout=kwargs.pop("response_timeout", 2), **kwargs)


@asynccontextmanager
async def running(mode="good", **kwargs):
    worker = new_worker(mode, **kwargs)
    try:
        await worker.start()
        yield worker
    finally:
        await worker.close()
    assert worker.process.returncode is not None


def smoke_decision():
    """Synthetic two-action probe for the worker boundary (moved here from the benchmark,
    which now measures real engine positions)."""
    return Decision(request_id="smoke-1", match_id="synthetic-smoke", sequence=1,
                    player_id="player2", deadline_ms=3000, prompt="Choose an action.",
                    snapshot={"game": {}, "players": {}, "controls": {}}, legal_actions=[
                        {"actionId": "smoke-roll", "source": "die", "label": "ROLL D12",
                         "type": "roll_die", "payload": {"dieId": "die_player2_1"}},
                        {"actionId": "smoke-end", "source": "primary", "label": "END TURN",
                         "type": "end_turn", "payload": {}}])


def body(**changes):
    return dataclasses.replace(smoke_decision(), **changes)


async def expect_error(awaitable, kind=WorkerError):
    try:
        await awaitable
    except kind:
        return
    raise AssertionError("expected error")


async def test_prompt_preserves_visible_fields_without_mutating_request():
    source = body(snapshot={"knownCard": "私有カード", "unknownFutureField": [1, 2]},
                  pending={"kind": "choice"}, metadata={"rulesVersion": "current"})
    before = copy.deepcopy(source)
    messages = build_choice_messages(source)
    position = messages[1]["content"]
    # local-choice-v3 renders text; unrecognized fields are rendered, never dropped.
    for shown in ("knownCard: \"私有カード\"", "unknownFutureField: [1, 2]", "Pending: {kind=choice}",
                  "Metadata: {rulesVersion=current}", "Note: \"Choose an action.\""):
        assert shown in position, shown
    for hidden in ("smoke-1", "synthetic-smoke", "smoke-roll", "smoke-end"):
        assert hidden not in position, hidden
    actions = position.split("\nActions:\n")[1].splitlines()
    assert actions[0].startswith("0: ") and "ROLL D12" in actions[0] and "die_player2_1" in actions[0]
    assert actions[1].startswith("1: ") and "END TURN" in actions[1] and source == before


async def test_choice_parser_rejects_ambiguous_or_forged_outputs():
    assert parse_choice(' {"choice":1} \n', 2) == 1
    for value in ('{"choice":true}', '{"choice":1.0}', '{"choice":-1}', '{"choice":2}',
                  '{"choice":0,"choice":1}', '{"choice":1,"explanation":"x"}',
                  '```json\n{"choice":0}\n```', '0', 'null', '[]', '{"actionId":"smoke-roll"}',
                  '<think>x</think>{"choice":1}', '{"choice":0} trailing', 'x' * 1025, None):
        try:
            parse_choice(value, 2)
        except (ValueError, TypeError):
            continue
        raise AssertionError(f"accepted invalid output: {value!r}")


async def test_valid_model_choice_reaches_runner_and_worker_closes():
    worker = new_worker()
    try:
        await worker.start()
        selection = await PolicyRunner(MLXPolicy(worker)).choose(body())
        assert (selection.action_id, selection.reason) == ("smoke-end", "policy")
    finally:
        await worker.close()
    assert worker.process.returncode is not None


async def test_action_mapping_is_request_local_across_reordering():
    async with running() as worker:
        runner = PolicyRunner(MLXPolicy(worker))
        assert (await runner.choose(body())).action_id == "smoke-end"
        actions = [dict(action) for action in reversed(body().legal_actions)]
        assert (await runner.choose(body(legal_actions=actions))).action_id == "smoke-roll"
        actions[1]["actionId"] = "fresh-next-match"
        assert (await runner.choose(body(match_id="other", legal_actions=actions))).action_id == "fresh-next-match"


def fresh(n):
    return body(request_id=f"fresh-{n}", sequence=n + 1,
                legal_actions=[{"actionId": f"fresh-{n}-a"}, {"actionId": f"fresh-{n}-b"}])


async def test_one_slow_answer_costs_one_timeout_then_model_choices_not_a_cascade():
    # The 2026-11-11 Mac run: one timeout was followed by a run of worker_busy fallbacks.
    async with running("slow_first") as worker:
        runner = PolicyRunner(MLXPolicy(worker), max_decision_ms=100)
        first = await runner.choose(body())
        assert (first.action_id, first.reason, first.error) == ("smoke-roll", "timeout_fallback", "timeout")
        assert worker.busy  # Still generating the late answer.
        later = [await runner.choose(fresh(n)) for n in range(4)]
        assert [s.reason for s in later] == ["policy"] * 4 and all(s.error is None for s in later), later
        assert [s.action_id for s in later] == [f"fresh-{n}-b" for n in range(4)]
        assert worker._serial == 5 and worker.late_replies_discarded == 1


async def test_late_answer_is_never_applied_to_the_next_decision():
    async with running("late_first") as worker:
        runner = PolicyRunner(MLXPolicy(worker), max_decision_ms=100)
        assert (await runner.choose(body())).reason == "timeout_fallback"
        # Request 1's late reply says choice 0; the next decision must get its own (choice 1).
        nxt = await runner.choose(fresh(0))
        assert (nxt.action_id, nxt.reason) == ("fresh-0-b", "policy")
        assert worker.last_reply["id"] == 2 and worker.late_replies_discarded == 1


async def test_request_after_abandoned_exchange_waits_and_gets_its_own_reply():
    # Without the policy's prepare step, the worker itself drains the abandoned exchange.
    async with running("late_first") as worker:
        task = asyncio.create_task(worker.request({"messages": []}))
        while not worker.busy:
            await asyncio.sleep(0)
        task.cancel()
        await expect_error(task, asyncio.CancelledError)
        assert worker.busy and worker.available
        reply = await worker.request({"messages": []})
        assert reply["id"] == 2 and reply["text"] == '{"choice":1}'
        assert worker.late_replies_discarded == 1


async def test_dead_worker_restarts_once_per_match_and_is_recorded():
    with tempfile.TemporaryDirectory() as directory:
        os.environ["FAKE_WORKER_MARKER"] = str(Path(directory) / "crashed")
        try:
            async with running("crash_once") as worker:
                policy = MLXPolicy(worker)
                runner = PolicyRunner(policy)
                runner.begin_match()
                first = await runner.choose(body())
                assert (first.reason, first.error, first.worker_event) == (
                    "policy_error_fallback", "worker_unavailable", None)
                second = await runner.choose(body())
                assert (second.reason, second.error, second.worker_event) == ("policy", None, "worker_restarted")
                assert worker.restarts == 1 and worker._serial == 2
        finally:
            del os.environ["FAKE_WORKER_MARKER"]
    async with running("crash") as worker:
        runner = PolicyRunner(MLXPolicy(worker))
        runner.begin_match()
        events = [await runner.choose(body()) for _ in range(3)]
        assert [s.worker_event for s in events] == [None, "worker_restarted", None]
        assert all(s.reason == "policy_error_fallback" for s in events)
        assert [s.error for s in events] == ["worker_unavailable"] * 3
        assert worker.restarts == 1
        runner.begin_match()  # A new match gets one more restart.
        assert (await runner.choose(body())).worker_event == "worker_restarted" and worker.restarts == 2


async def test_failure_codes_name_why_each_fallback_happened():
    async with running("invalid") as worker:
        assert (await PolicyRunner(MLXPolicy(worker)).choose(body())).error == "invalid_output"
    async with running("error") as worker:
        assert (await PolicyRunner(MLXPolicy(worker)).choose(body())).error == "prompt_too_large"
    async with running("slow") as worker:
        # Two live callers still never queue on one worker: the second is told it is busy.
        policy = MLXPolicy(worker)
        a, b = await asyncio.gather(PolicyRunner(policy).choose(body()),
                                    PolicyRunner(policy).choose(fresh(0)))
        assert {a.error, b.error} == {None, "worker_busy"}
    async with running() as worker:
        await worker.close()
        selection = await PolicyRunner(MLXPolicy(worker)).choose(body())
        assert (selection.error, selection.worker_event) == ("worker_unavailable", None)


async def test_watchdog_follows_the_budget():
    assert watchdog_seconds(10_000) == 30.0 and watchdog_seconds(20_000) == 60.0


async def test_parallel_calls_never_queue_multiple_generations():
    async with running("slow") as worker:
        results = await asyncio.gather(*(worker.request({"messages": []}) for _ in range(8)),
                                       return_exceptions=True)
        assert sum(isinstance(result, dict) for result in results) == 1
        assert sum(isinstance(result, WorkerError) for result in results) == 7
        assert worker._serial == 1


async def test_invalid_model_output_falls_back_without_logging_text():
    capture = io.StringIO()
    handler = logging.StreamHandler(capture)
    logger = logging.getLogger("cyberpunk.sim_mlx")
    previous = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    try:
        async with running("invalid") as worker:
            result = await PolicyRunner(MLXPolicy(worker)).choose(body(snapshot={"private": "secret card"}))
            assert result.action_id == "smoke-roll"
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous)
    assert '"reason": "invalid_output"' in capture.getvalue()
    assert "secret" not in capture.getvalue()


async def test_worker_error_falls_back_and_worker_remains_usable():
    async with running("error") as worker:
        assert (await PolicyRunner(MLXPolicy(worker)).choose(body())).action_id == "smoke-roll"
        assert worker.available and not worker.busy


async def assert_fault_stops_worker(mode):
    async with running(mode) as worker:
        await expect_error(worker.request({"messages": []}))
        assert not worker.available and worker.process.returncode is not None
        assert (await PolicyRunner(MLXPolicy(worker)).choose(body())).action_id == "smoke-roll"


async def test_wrong_correlation_id_stops_worker():
    await assert_fault_stops_worker("wrong_id")
    await assert_fault_stops_worker("bool_id")


async def test_wrong_protocol_stops_worker():
    await assert_fault_stops_worker("wrong_protocol")


async def test_malformed_reply_stops_worker():
    await assert_fault_stops_worker("malformed")


async def test_oversized_reply_stops_worker_without_pipe_deadlock():
    async with asyncio.timeout(5):
        await assert_fault_stops_worker("oversized")


async def test_worker_crash_stops_inference_and_preserves_baseline():
    await assert_fault_stops_worker("crash")


async def test_hard_watchdog_kills_hung_worker():
    async with running("hang", response_timeout=0.05) as worker:
        await expect_error(worker.request({"messages": []}))
        assert not worker.available and worker.process.returncode is not None


async def test_startup_timeout_cleans_up_child():
    worker = new_worker("never_ready", startup_timeout=0.1)
    try:
        await expect_error(worker.start(), TimeoutError)
        assert worker.process.returncode is not None
    finally:
        await worker.close()


async def test_startup_failure_cleans_up_child():
    worker = new_worker("startup_error")
    try:
        await expect_error(worker.start())
        assert not worker.available and worker.process.returncode is not None
    finally:
        await worker.close()


async def test_close_cancels_inflight_generation_and_reaps_child():
    worker = new_worker("hang")
    await worker.start()
    task = asyncio.create_task(worker.request({"messages": []}))
    while not worker.busy:
        await asyncio.sleep(0)
    await worker.close()
    await expect_error(task, asyncio.CancelledError)
    assert worker.process.returncode is not None
    await worker.close()


async def test_local_worker_forces_offline_environment():
    async with running("environment") as worker:
        reply = await worker.request({"messages": []})
        assert reply["offline"] == "1" and reply["telemetry"] == "1"


async def test_stderr_cannot_corrupt_protocol():
    async with running("stderr") as worker:
        assert (await worker.request({"messages": []}))["ok"] is True


async def test_oversized_input_keeps_worker_available():
    async with running() as worker:
        await expect_error(worker.request({"messages": ["x" * MAX_LINE_BYTES]}))
        assert worker.available and not worker.busy
        assert (await worker.request({"messages": []}))["id"] == 1


class Tokenizer:
    def __init__(self, count):
        self.count = count
    def apply_chat_template(self, messages, **kwargs):
        assert kwargs == {"tokenize": True, "add_generation_prompt": True,
                          "enable_thinking": False, "return_dict": False}
        return list(range(self.count))


async def test_prompt_limit_rejects_whole_position_without_truncation():
    def forbidden(*args, **kwargs):
        raise AssertionError("oversized prompt reached generation")
    result = run_generation(None, Tokenizer(11), [], stream_fn=forbidden, sampler=None,
                            max_prompt_tokens=10, max_tokens=16)
    assert result == {"ok": False, "error": "prompt_too_large", "promptTokens": 11}


async def test_generation_uses_disabled_thinking_and_bounded_tokens():
    def generate(model, tokenizer, **kwargs):
        assert kwargs["max_tokens"] == 16 and kwargs["prompt"] == list(range(10))
        yield SimpleNamespace(text='{"choice":', generation_tokens=3, finish_reason=None)
        yield SimpleNamespace(text='1}', generation_tokens=5, finish_reason="stop")
    result = run_generation(None, Tokenizer(10), [], stream_fn=generate, sampler=None,
                            max_prompt_tokens=10, max_tokens=16)
    assert result["ok"] and parse_choice(result["text"], 2) == 1
    assert result["generationTokens"] == 5 and result["promptTokens"] == 10


async def test_length_limited_output_is_rejected_even_if_json_looks_complete():
    def generate(*args, **kwargs):
        yield SimpleNamespace(text='{"choice":1}', generation_tokens=16, finish_reason="length")
    result = run_generation(None, Tokenizer(10), [], stream_fn=generate, sampler=None,
                            max_prompt_tokens=10, max_tokens=16)
    assert result["ok"] is False and result["error"] == "incomplete_output" and "text" not in result


async def test_missing_model_and_adapter_paths_fail_before_process_launch():
    assert local_path("models/example") == REPO_ROOT / "models/example"
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        try:
            make_worker(str(root))
        except ValueError:
            pass
        else:
            raise AssertionError("empty model accepted")
        (root / "config.json").write_text("{}")
        (root / "model.safetensors").touch()
        worker = make_worker(str(root))
        assert worker.process is None
        for settings in ({"adapter": str(root / "missing")}, {"max_tokens": 0}, {"max_prompt_tokens": 32769}):
            try:
                make_worker(str(root), **settings)
            except ValueError:
                continue
            raise AssertionError("bad model options accepted")


async def test_benchmark_separates_model_decisions_from_fast_fallbacks():
    async with running() as worker:
        rows = await measure(worker, [body()], 2)
        assert summarize(rows)["modelDecisions"] == 2 and summarize(rows)["allModelDecisions"]
    async with running("slow") as worker:
        rows = await measure(worker, [body(deadline_ms=30)], 2)
        summary = summarize(rows)
        assert summary["fallbacks"] == 2 and not summary["allModelDecisions"]
        assert all(row["selection"] == "timeout_fallback" and row["inferenceMs"] == 170 for row in rows)
        assert all(row["error"] == "timeout" for row in rows) and summary["errors"] == {"timeout": 2}
        assert "snapshot" not in json.dumps(rows) and "text" not in json.dumps(rows)


async def test_benchmark_does_not_reuse_metrics_when_deadline_already_expired():
    async with running() as worker:
        rows = await measure(worker, [body(), body(deadline_ms=0.000001)], 1)
        assert rows[0]["promptTokens"] == 123
        assert rows[1]["selection"] == "deadline_fallback" and "promptTokens" not in rows[1]
        assert rows[1]["error"] == "deadline_exceeded" and rows[0]["error"] is None


async def test_benchmark_budget_is_configurable():
    async with running("slow") as worker:
        rows = await measure(worker, [body(deadline_ms=None)], 1, budget_ms=60)
        assert rows[0]["selection"] == "timeout_fallback"
        rows = await measure(worker, [body(deadline_ms=None)], 1, budget_ms=2000)
        assert rows[0]["selection"] == "policy"


async def run_tests():
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        async with asyncio.timeout(15):
            await test()
        print(f"OK  {test.__name__}")
    print(f"PASS local MLX bot: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fake-worker", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.fake_worker:
        fake_worker(args.fake_worker)
    else:
        asyncio.run(run_tests())


if __name__ == "__main__":
    main()
