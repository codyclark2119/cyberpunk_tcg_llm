#!/usr/bin/env python3
"""Portable regression tests for local MLX orchestration, without model weights.

Real subprocesses exercise deadlines, cancellation, busy handling, protocol faults
and shutdown. Injected tokenizers/generators cover prompt limits and output parsing.
These tests do not claim that Metal inference or gameplay strength was measured.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import io
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from games.cyberpunk.sim_bot import BotProfile, BotService, _decision, build_app
from games.cyberpunk.sim_mlx import MLXPolicy, local_path, make_worker
from games.cyberpunk.sim_prompt import build_choice_messages, parse_choice
from harness.core.local_worker import LocalWorker, MAX_LINE_BYTES, PROTOCOL, WorkerError
from benchmark_sim_bot import measure, smoke_request, summarize
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
    for line in sys.stdin:
        message = json.loads(line)
        if mode == "crash":
            return
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


def body(**changes):
    return {**smoke_request(), **changes}


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
    messages = build_choice_messages(_decision(source, BotProfile()))
    position = json.loads(messages[1]["content"])
    assert position["snapshot"] == source["snapshot"]
    assert position["pending"] == source["pending"] and position["metadata"] == source["metadata"]
    assert "requestId" not in position and "matchId" not in position
    assert "actionId" not in position["actions"][0]["action"]
    assert position["actions"][1]["choice"] == 1 and source == before


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


async def test_valid_model_choice_reaches_http_response_and_lifespan_closes():
    import httpx
    worker = new_worker()
    @asynccontextmanager
    async def lifespan(_app):
        try:
            await worker.start()
            yield
        finally:
            await worker.close()
    app = build_app(BotService(policy=MLXPolicy(worker)), lifespan=lifespan, base_path="/cyberpunk")
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://bot") as http:
            ready = await http.post("/cyberpunk/ready", json={"apiVersion": "v1alpha1",
                                      "game": "cyberpunk-tcg-sim", "check": "ready"})
            response = await http.post("/cyberpunk/sync", json=body())
            assert ready.json()["ready"] is True
            assert response.json()["actionId"] == "smoke-end"
    assert worker.process.returncode is not None


async def test_action_mapping_is_request_local_across_reordering():
    async with running() as worker:
        service = BotService(policy=MLXPolicy(worker))
        assert (await service.sync(body()))["actionId"] == "smoke-end"
        actions = list(reversed(body()["legalActions"]))
        assert (await service.sync(body(legalActions=actions)))["actionId"] == "smoke-roll"
        actions[1]["actionId"] = "fresh-next-match"
        assert (await service.sync(body(matchId="other", legalActions=actions)))["actionId"] == "fresh-next-match"


async def test_deadline_returns_fallback_and_drains_late_reply_before_reuse():
    async with running("slow_first") as worker:
        service = BotService(policy=MLXPolicy(worker))
        result = await service.sync(body(deadlineMs=30))
        assert result["actionId"] == "smoke-roll" and worker.busy
        # While the GPU is busy, another match falls back without queueing.
        other = body(matchId="other", legalActions=[{"actionId": "fresh-a"}, {"actionId": "fresh-b"}])
        assert (await service.sync(other))["actionId"] == "fresh-a"
        assert worker._serial == 1
        await worker.wait_idle()
        assert (await service.sync(other))["actionId"] == "fresh-b"
        assert worker._serial == 2


async def test_caller_cancellation_preserves_worker_until_response_drained():
    async with running("slow_first") as worker:
        task = asyncio.create_task(worker.request({"messages": []}))
        while not worker.busy:
            await asyncio.sleep(0)
        task.cancel()
        await expect_error(task, asyncio.CancelledError)
        assert worker.busy and worker.available
        await expect_error(worker.request({"messages": []}))
        await worker.wait_idle()
        assert (await worker.request({"messages": []}))["id"] == 2


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
            result = await BotService(policy=MLXPolicy(worker)).sync(body(snapshot={"private": "secret card"}))
            assert result["actionId"] == "smoke-roll"
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous)
    assert '"reason": "invalid_output"' in capture.getvalue()
    assert "secret" not in capture.getvalue()


async def test_worker_error_falls_back_and_worker_remains_usable():
    async with running("error") as worker:
        assert (await BotService(policy=MLXPolicy(worker)).sync(body()))["actionId"] == "smoke-roll"
        assert worker.available and not worker.busy


async def assert_fault_stops_worker(mode):
    async with running(mode) as worker:
        await expect_error(worker.request({"messages": []}))
        assert not worker.available and worker.process.returncode is not None
        assert (await BotService(policy=MLXPolicy(worker)).sync(body()))["actionId"] == "smoke-roll"


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
        rows = await measure(worker, [body()], 2, BotProfile())
        assert summarize(rows)["modelDecisions"] == 2 and summarize(rows)["allModelDecisions"]
    async with running("slow") as worker:
        rows = await measure(worker, [body(deadlineMs=30)], 2, BotProfile())
        summary = summarize(rows)
        assert summary["fallbacks"] == 2 and not summary["allModelDecisions"]
        assert all(row["selection"] == "timeout_fallback" and row["inferenceMs"] == 170 for row in rows)
        assert "snapshot" not in json.dumps(rows) and "text" not in json.dumps(rows)


async def test_cli_profile_works_without_mlx_or_model_download():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "scripts/serve_sim_bot.py"),
                             "--policy", "mlx", "--profile-url", "http://127.0.0.1:3100/cyberpunk"],
                            capture_output=True, text=True, check=True, cwd=REPO_ROOT.parent)
    profile = json.loads(result.stdout)
    assert profile["name"] == "Cyberpunk TCG AI (local MLX)" and profile["timeoutMs"] == 3000
    assert profile["version"] == "0.2.0"


async def test_benchmark_does_not_reuse_metrics_when_deadline_already_expired():
    async with running() as worker:
        rows = await measure(worker, [body(), body(deadlineMs=0.000001)], 1, BotProfile())
        assert rows[0]["promptTokens"] == 123
        assert rows[1]["selection"] == "deadline_fallback" and "promptTokens" not in rows[1]


async def test_nonacting_requests_never_start_inference():
    async with running() as worker:
        service = BotService(policy=MLXPolicy(worker))
        for status in ("waiting", "finished"):
            assert (await service.sync(body(status=status)))["actionId"] is None
        assert worker._serial == 0


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
