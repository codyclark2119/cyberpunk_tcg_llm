#!/usr/bin/env python3
"""Tests for the local assistant's chat loop, its MLX chat worker's pure parts, and the chat route.

Why: the loop is the only thing between the model and the tools. A parser that
ran a call written inside <think>, half-ran a truncated call, executed an
unknown tool or bad arguments, looped past the tool-call cap, or leaked
thinking into the answer would let the model act on, or show, something no
tool supplied. Every test here drives the loop with a scripted fake model (no
mlx, no weights, no network) on the committed snapshot, so it runs on Linux.
The worker script's rendering, request checks and generation loop are tested
with a fake tokenizer and stream; the chat client is tested against a tiny
stand-in worker process speaking the same protocol. Example questions are
test inputs only: the loop must behave the same whatever the question says.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import dataclasses
import importlib.util
import json
import re
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from games.cyberpunk.assistant import tools
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, CAP_MESSAGE, MAX_TOOL_CALLS, SYSTEM_PROMPT,
                                            parse_tool_calls, run_turn, split_thinking)
from games.cyberpunk.assistant.mlx_chat import chat_worker_command
from games.cyberpunk.assistant_app import ChatService, build_assistant_app
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.chat_worker import CHAT_PROTOCOL, ChatWorker, ChatWorkerError

LOCAL = {"host": "127.0.0.1:8767"}


def load_worker_module():
    spec = importlib.util.spec_from_file_location("mlx_chat_worker", REPO_ROOT / "scripts/mlx_chat_worker.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def call(name: str, **arguments) -> str:
    return f'<tool_call>\n{json.dumps({"name": name, "arguments": arguments})}\n</tool_call>'


class ScriptedModel:
    """Returns the scripted texts in order and records every message list it was given."""

    def __init__(self, texts, *, finish="stop"):
        self.texts = list(texts)
        self.finish = finish
        self.seen: list[list[dict]] = []
        self.tools_seen: list[list[dict]] = []

    async def generate(self, messages, tools_, *, max_tokens, enable_thinking):
        self.seen.append(copy.deepcopy(messages))
        self.tools_seen.append(tools_)
        if not self.texts:
            raise AssertionError("the loop asked the model more often than scripted")
        text = self.texts.pop(0)
        return {"ok": True, "text": text, "finishReason": self.finish, "promptTokens": 100,
                "generationTokens": 10, "elapsedMs": 5.0}


class LoopingModel:
    """Asks for find_card forever."""

    def __init__(self, per_reply: int = 1):
        self.calls = 0
        self.per_reply = per_reply

    async def generate(self, messages, tools_, *, max_tokens, enable_thinking):
        self.calls += 1
        return {"ok": True, "text": "\n".join([call("find_card", query="V")] * self.per_reply),
                "finishReason": "stop"}


def turn(history, message, model, **kwargs):
    return asyncio.run(run_turn(history, message, model, **kwargs))


def tool_steps(result):
    return [s for s in result.trace if s["kind"] == "tool"]


class CountRuns:
    """Wraps every tool's run so a test can prove that nothing executed."""

    def __enter__(self):
        self.count = 0
        self.saved = dict(tools.TOOLS)
        for name, tool in self.saved.items():
            def counted(args, original=tool.run):
                self.count += 1
                return original(args)
            tools.TOOLS[name] = dataclasses.replace(tool, run=counted)
        return self

    def __exit__(self, *exc):
        tools.TOOLS.update(self.saved)


# Parsing -------------------------------------------------------------------------------


def test_parse_single_and_multiple_tool_calls():
    calls, rest = parse_tool_calls(call("find_card", query="V"))
    assert rest == "" and len(calls) == 1
    assert calls[0].name == "find_card" and calls[0].arguments == {"query": "V"} and calls[0].error is None
    text = "Let me check.\n" + call("get_card", slug="v-streetkid") + "\n" + call("get_rule", rule_id="9.2")
    calls, rest = parse_tool_calls(text)
    assert [c.name for c in calls] == ["get_card", "get_rule"] and rest == "Let me check."
    assert all(c.error is None for c in calls)


def test_tool_call_inside_thinking_is_not_a_call():
    thinking, body = split_thinking("<think>maybe " + call("get_card", slug="v-streetkid") + "</think>\nNo tools.")
    assert "get_card" in thinking and body.strip() == "No tools."
    assert parse_tool_calls(body) == ([], "No tools.")
    # Template opened <think> in the prompt, so only the close was generated.
    thinking, body = split_thinking("weighing it " + call("find_card", query="V") + "</think>Answer.")
    assert "find_card" in thinking and body == "Answer."
    # Cut off mid-thought: nothing after <think> is a call.
    thinking, body = split_thinking("Hi <think>still " + call("find_card", query="V"))
    assert body == "Hi " and "find_card" in thinking
    assert split_thinking("plain") == (None, "plain")
    assert split_thinking("<think>\n\n</think>\n\nOk") == (None, "\n\nOk")


def test_malformed_tool_calls_are_errors_not_calls():
    cases = {
        "<tool_call>{not json}</tool_call>": "not valid JSON",
        "<tool_call>[1, 2]</tool_call>": "JSON object",
        '<tool_call>{"arguments": {}}</tool_call>': "string 'name'",
        '<tool_call>{"name": "get_card", "arguments": "{\\"slug\\": \\"x\\"}"}</tool_call>': "must be a JSON object",
        '<tool_call>{"name": "get_card", "arguments": {}, "id": 1}</tool_call>': "unexpected keys",
        '<tool_call>{"name": "get_card", "arguments": {"slug": "v-str': "unclosed",
    }
    for text, problem in cases.items():
        calls, _ = parse_tool_calls(text)
        assert len(calls) == 1 and calls[0].error and problem in calls[0].error, (text, calls)
    calls, _ = parse_tool_calls('<tool_call>{"name": "find_card"}</tool_call>')
    assert calls[0].error is None and calls[0].arguments == {}, "omitted arguments mean none"


# The loop --------------------------------------------------------------------------------


def test_scripted_find_then_get_then_answer():
    model = ScriptedModel([
        call("find_card", query="V: Streetkid"),
        call("get_card", slug="v-streetkid"),
        "`v-streetkid` is a Legend; its facts are above.",
    ])
    result = turn([], "What does V: Streetkid do?", model)
    assert result.ok and result.stop_reason == "answer" and result.tool_calls == 2
    assert result.answer == "`v-streetkid` is a Legend; its facts are above."
    steps = tool_steps(result)
    assert [s["tool"] for s in steps] == ["find_card", "get_card"]
    assert steps[1]["arguments"] == {"slug": "v-streetkid"} and all(s["ok"] for s in steps)
    assert all(s["sources"]["card_slugs"] == ["v-streetkid"] for s in steps)
    assert "v-streetkid" in steps[1]["summary"] and all("elapsedMs" in s for s in steps)
    assert result.sources["card_slugs"] == ["v-streetkid"]
    assert [s["kind"] for s in result.trace] == ["model", "tool", "model", "tool", "model"]
    # What the model saw: system prompt, the question, then each call and its result in the template's shape.
    last = model.seen[-1]
    assert last[0] == {"role": "system", "content": SYSTEM_PROMPT} and last[1]["role"] == "user"
    assert last[2]["role"] == "assistant" and last[2]["tool_calls"] == [
        {"type": "function", "function": {"name": "find_card", "arguments": {"query": "V: Streetkid"}}}]
    assert last[3]["role"] == "tool" and json.loads(last[3]["content"]) == tools.find_card("V: Streetkid")
    assert json.loads(last[5]["content"]) == tools.get_card("v-streetkid")
    assert model.tools_seen[0] == tools.tool_specs()
    payload = result.to_dict()
    json.dumps(payload)
    assert payload["promptVersion"] == ASSISTANT_PROMPT_VERSION and payload["rulesVersion"] == RULES_VERSION


def test_unknown_tool_bad_args_and_malformed_go_back_as_errors_without_running():
    model = ScriptedModel([
        call("delete_everything", path="/") + call("get_card", slug=3) + call("get_card", slug="v-streetkid", x=1)
        + "<tool_call>{oops}</tool_call>",
        "I could not look that up.",
    ])
    with CountRuns() as counter:
        result = turn([], "anything", model)
    assert counter.count == 0, "a rejected call ran a tool"
    steps = tool_steps(result)
    assert [s["errorKind"] for s in steps] == ["unknown_tool", "invalid_arguments", "invalid_arguments",
                                               "malformed_tool_call"]
    assert not any(s["ok"] for s in steps) and result.tool_calls == 4
    replies = [json.loads(m["content"]) for m in model.seen[1] if m["role"] == "tool"]
    assert [r["error_kind"] for r in replies] == [s["errorKind"] for s in steps]
    assert all(r["ok"] is False and r["error"] for r in replies)
    assistant = [m for m in model.seen[1] if m["role"] == "assistant"][0]
    assert "{oops}" in assistant["content"], "the model should see its malformed block next to the error"
    assert result.ok and result.answer == "I could not look that up." and result.sources["card_slugs"] == []


def test_tool_call_cap():
    model = LoopingModel()
    with CountRuns() as counter:
        result = turn([], "loop", model)
    assert counter.count == MAX_TOOL_CALLS == 6 and result.tool_calls == 6
    assert model.calls == 7 and result.stop_reason == "tool_cap" and not result.ok
    assert result.answer == CAP_MESSAGE and "6 tool calls" in result.answer
    assert tool_steps(result)[-1]["errorKind"] == "cap_exceeded"
    # A single reply that would go past the cap runs none of its calls.
    batch = LoopingModel(per_reply=4)
    with CountRuns() as counter:
        result = turn([], "loop", batch)
    assert counter.count == 4 and result.tool_calls == 4 and result.stop_reason == "tool_cap"


def test_thinking_is_stripped_from_the_answer_and_kept_in_the_trace():
    model = ScriptedModel(["<think>I should look it up.</think>" + call("find_card", query="V"),
                           "<think>Three cards match.</think>\n\nThree cards are named V."])
    result = turn([], "Who is V?", model, enable_thinking=True)
    assert result.answer == "Three cards are named V." and "<think>" not in result.answer
    thoughts = [s["thinking"] for s in result.trace if s["kind"] == "model"]
    assert thoughts == ["I should look it up.", "Three cards match."]
    assert "<think>" not in json.dumps(model.seen[-1]), "earlier thinking must not be sent back"


def test_model_failure_empty_and_truncated_answers():
    class Broken:
        async def generate(self, *a, **k):
            return {"ok": False, "error": "worker_timeout"}
    failed = turn([], "x", Broken())
    assert not failed.ok and failed.stop_reason == "model_error" and "worker_timeout" in failed.answer
    empty = turn([], "x", ScriptedModel(["<think>hmm</think>"]))
    assert not empty.ok and empty.stop_reason == "empty"
    cut = turn([], "x", ScriptedModel(["A long answer"], finish="length"))
    assert cut.stop_reason == "length" and "cut off" in cut.answer


def test_loop_does_not_depend_on_the_question_text():
    script = [call("find_card", query="V"), call("get_rule", rule_id="9.2"), "Done."]
    traces = []
    for question in ("How do I attack?", "Is my deck legal?", "what about V", ""):
        result = turn([{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "ok"}],
                      question, ScriptedModel(script))
        traces.append([{k: v for k, v in s.items() if k != "elapsedMs"} for s in result.trace])
    assert all(t == traces[0] for t in traces)
    source = (REPO_ROOT / "games/cyberpunk/assistant/loop.py").read_text(encoding="utf-8")
    assert not re.search(r"user_message\s*(==|\.startswith|\.lower|\.casefold|in\b)|\bin\s+user_message", source)
    assert RULES_VERSION in SYSTEM_PROMPT and ASSISTANT_PROMPT_VERSION in SYSTEM_PROMPT


# Worker pure functions -------------------------------------------------------------------


def test_worker_pure_functions_without_mlx():
    worker = load_worker_module()
    assert "mlx" not in sys.modules and "mlx_lm" not in sys.modules
    good = {"protocol": CHAT_PROTOCOL, "id": 1, "messages": [{"role": "user", "content": "hi"}],
            "tools": tools.tool_specs()}
    request, problem = worker.check_request(good)
    assert problem is None and request["max_tokens"] == worker.DEFAULT_MAX_TOKENS and request["enable_thinking"] is False
    with_calls = {**good, "messages": [*good["messages"], {"role": "assistant", "content": "", "tool_calls": [
        {"type": "function", "function": {"name": "find_card", "arguments": {"query": "V"}}}]},
        {"role": "tool", "content": "{}"}]}
    assert worker.check_request(with_calls)[1] is None
    for bad, why in ((dict(good, protocol="local-choice-v1"), "bad_envelope"), (dict(good, id="1"), "bad_envelope"),
                     (dict(good, messages=[]), "bad_messages"),
                     (dict(good, messages=[{"role": "root", "content": "x"}]), "bad_messages"),
                     (dict(good, messages=[{"role": "user", "content": "x", "tool_calls": []}]), "bad_messages"),
                     (dict(good, tools="all"), "bad_tools"), (dict(good, max_tokens=0), "bad_max_tokens"),
                     (dict(good, max_tokens=10 ** 6), "bad_max_tokens"),
                     (dict(good, enable_thinking="yes"), "bad_enable_thinking")):
        assert worker.check_request(bad) == (None, why), why

    class Tokenizer:
        def apply_chat_template(self, messages, **kwargs):
            self.kwargs = kwargs
            return list(range(7))

    tokenizer = Tokenizer()
    request["enable_thinking"] = True
    assert worker.render_prompt(tokenizer, request["messages"], request["tools"], enable_thinking=True) == list(range(7))
    assert tokenizer.kwargs == {"tools": request["tools"], "tokenize": True, "add_generation_prompt": True,
                                "enable_thinking": True, "return_dict": False}
    worker.render_prompt(tokenizer, request["messages"], [], enable_thinking=False)
    assert tokenizer.kwargs["tools"] is None and tokenizer.kwargs["enable_thinking"] is False

    def stream(model, tok, *, prompt, sampler, max_tokens):
        assert prompt == list(range(7)) and max_tokens == request["max_tokens"] and sampler == "greedy"
        for i, piece in enumerate(["<tool_call>", '{"name": "find_card", "arguments": {"query": "V"}}', "</tool_call>"]):
            yield SimpleNamespace(text=piece, generation_tokens=i + 1, finish_reason="stop" if i == 2 else None)

    reply = worker.run_generation(None, tokenizer, request, stream_fn=stream, sampler="greedy")
    assert reply["ok"] and reply["finishReason"] == "stop" and reply["generationTokens"] == 3
    assert reply["promptTokens"] == 7 and reply["elapsedMs"] >= 0
    assert parse_tool_calls(reply["text"])[0][0].arguments == {"query": "V"}
    too_big = worker.run_generation(None, tokenizer, request, stream_fn=stream, sampler="greedy", max_prompt_tokens=3)
    assert too_big == {"ok": False, "error": "prompt_too_large", "promptTokens": 7}

    line = (json.dumps(good) + "\n").encode()
    assert worker.handle_line(line, lambda r: {"ok": True, "text": "x"}) == ({"id": 1, "ok": True, "text": "x"}, True)
    assert worker.handle_line(line, lambda r: 1 / 0) == ({"id": 1, "ok": False, "error": "generation_failed"}, True)
    assert worker.handle_line((json.dumps(dict(good, max_tokens=0)) + "\n").encode(), None) == (
        {"id": 1, "ok": False, "error": "bad_max_tokens"}, True)
    assert worker.handle_line(b"{nope\n", None) == (None, False)
    assert worker.handle_line(b'{"protocol": "x"}', None) == (None, False)
    assert "mlx" not in sys.modules


FAKE_WORKER = r"""
import json, sys
P = "local-chat-v1"
mode = sys.argv[1]
print(json.dumps({"protocol": P, "event": "ready", "ok": mode != "fail"}), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    if mode == "hang":
        continue
    text = "echo:" + req["messages"][-1]["content"] + ":" + str(req["max_tokens"])
    print(json.dumps({"protocol": P, "id": req["id"], "ok": True, "text": text}), flush=True)
"""


def test_chat_client_against_a_stand_in_worker():
    async def scenario():
        with tempfile.TemporaryDirectory() as tmp:
            echo = ChatWorker([sys.executable, "-c", FAKE_WORKER, "echo"], cwd=Path(tmp))
            payload = {"messages": [{"role": "user", "content": "hi"}], "tools": [], "max_tokens": 9}
            first, second = await asyncio.gather(echo.request(payload), echo.request(payload))
            assert first["text"] == second["text"] == "echo:hi:9" and first["id"] != second["id"]
            assert echo.starts == 1 and echo.available
            await echo.close()
            assert not echo.available
            try:
                await echo.request(payload)
                raise AssertionError("closed worker answered")
            except ChatWorkerError as exc:
                assert exc.code == "worker_closed"
            hang = ChatWorker([sys.executable, "-c", FAKE_WORKER, "hang"], cwd=Path(tmp), response_timeout=0.5)
            try:
                await hang.request(payload)
                raise AssertionError("no timeout")
            except ChatWorkerError as exc:
                assert exc.code == "worker_timeout" and not hang.available
            await hang.close()
            failing = ChatWorker([sys.executable, "-c", FAKE_WORKER, "fail"], cwd=Path(tmp))
            try:
                await failing.request(payload)
                raise AssertionError("failed startup answered")
            except ChatWorkerError as exc:
                assert exc.code == "worker_startup_failed"
            await failing.close()
    asyncio.run(scenario())


def test_model_directory_is_checked_before_anything_starts():
    with tempfile.TemporaryDirectory() as tmp:
        for model, adapter in ((tmp, None), (str(Path(tmp) / "missing"), None)):
            try:
                chat_worker_command(model, adapter=adapter)
                raise AssertionError("an empty model directory was accepted")
            except ValueError as exc:
                assert "config.json" in str(exc)
        (Path(tmp) / "config.json").write_text("{}")
        (Path(tmp) / "model.safetensors").write_bytes(b"")
        command = chat_worker_command(tmp)
        assert command[2].endswith("scripts/mlx_chat_worker.py") and command[command.index("--model") + 1] == tmp
        try:
            chat_worker_command(tmp, adapter=tmp)
            raise AssertionError("an adapter without adapter files was accepted")
        except ValueError as exc:
            assert "adapter_config.json" in str(exc)


# The chat route ----------------------------------------------------------------------------


def test_chat_route_with_a_fake_model_keeps_short_history():
    model = ScriptedModel([call("find_card", query="V"), "Three cards are named V.", "Ask by slug."])
    with TestClient(build_assistant_app(chat=ChatService(model, max_history_messages=2))) as client:
        first = client.post("/api/chat", json={"session": "s1", "message": "Who is V?"}, headers=LOCAL)
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["ok"] and body["answer"] == "Three cards are named V." and body["toolCalls"] == 1
        assert [s["tool"] for s in body["trace"] if s["kind"] == "tool"] == ["find_card"]
        assert body["sources"]["card_slugs"] == ["v-corporate-exile", "v-roamer-of-the-badlands", "v-streetkid"]
        assert body["historyMessages"] == 2 and body["rulesVersion"] == RULES_VERSION
        second = client.post("/api/chat", json={"session": "s1", "message": "Which one?"}, headers=LOCAL).json()
        assert second["answer"] == "Ask by slug."
        sent = model.seen[-1]
        assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
        assert sent[1]["content"] == "Who is V?" and sent[2] == {"role": "assistant",
                                                                  "content": "Three cards are named V."}
        for bad in ({"session": "s1"}, {"session": "../x", "message": "hi"}, {"session": "s1", "message": "  "},
                    {"session": "s1", "message": "x" * 9000}):
            response = client.post("/api/chat", json=bad, headers=LOCAL)
            assert response.status_code == 400 and response.json()["error_kind"] == "invalid_arguments", bad
        garbage = client.post("/api/chat", content=b"{nope", headers=LOCAL)
        assert garbage.status_code == 400


def test_chat_route_without_a_model_says_so():
    with TestClient(build_assistant_app()) as client:
        response = client.post("/api/chat", json={"session": "s1", "message": "hi"}, headers=LOCAL)
        assert response.status_code == 503
        body = response.json()
        assert body["ok"] is False and body["error_kind"] == "no_model" and "--model" in body["error"]


def test_chat_route_reports_a_model_failure():
    class Broken:
        closed = False

        async def generate(self, *a, **k):
            return {"ok": False, "error": "worker_startup_failed"}

        async def close(self):
            self.closed = True
    broken = Broken()
    with TestClient(build_assistant_app(chat=ChatService(broken))) as client:
        response = client.post("/api/chat", json={"session": "s1", "message": "hi"}, headers=LOCAL)
        assert response.status_code == 502 and response.json()["stopReason"] == "model_error"
        assert not broken.closed
    assert broken.closed, "stopping the server must stop the model worker"


def test_host_check_applies_to_chat():
    model = ScriptedModel([])
    with TestClient(build_assistant_app(chat=ChatService(model))) as client:
        for host in ("evil.example:8767", "192.168.1.5:8767", ""):
            response = client.post("/api/chat", json={"session": "s1", "message": "hi"}, headers={"host": host})
            assert response.status_code == 403, host
        cross = client.post("/api/chat", json={"session": "s1", "message": "hi"},
                            headers={**LOCAL, "origin": "http://evil.example"})
        assert cross.status_code == 403
    assert model.seen == [], "a refused request reached the model"
    with TestClient(build_assistant_app(token="sekret", lan=True, chat=ChatService(model))) as guarded:
        assert guarded.post("/api/chat", json={"session": "s1", "message": "hi"}).status_code == 401


def run() -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS assistant loop: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    run()


if __name__ == "__main__":
    main()
