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
import math
import re
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from games.cyberpunk.assistant import loop as loop_module
from games.cyberpunk.assistant import tools
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, CAP_MESSAGE, MAX_TOKENS_LIMIT, MAX_TOOL_CALLS,
                                            SYSTEM_PROMPT, cap_message, parse_tool_calls, run_turn, split_thinking,
                                            system_prompt)
from games.cyberpunk.assistant.mlx_chat import WorkerChatModel, chat_worker_command, make_chat_model
from games.cyberpunk.assistant_app import ChatService, build_assistant_app
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.chat_worker import (CHAT_PROTOCOL, DEFAULT_MAX_PROMPT_TOKENS, MAX_PROMPT_TOKENS_LIMIT, ChatWorker,
                                      ChatWorkerError, context_length, prompt_cap, step_timeout)

LOCAL = {"host": "127.0.0.1:8767"}


def load_worker_module():
    spec = importlib.util.spec_from_file_location("mlx_chat_worker", REPO_ROOT / "scripts/mlx_chat_worker.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def call(name: str, **arguments) -> str:
    return f'<tool_call>\n{json.dumps({"name": name, "arguments": arguments})}\n</tool_call>'


def xml_call(name: str, **arguments) -> str:
    """The Qwen3.5-family template's rendering: strings raw, everything else as JSON, one newline each side."""
    params = "".join(f"<parameter={key}>\n{value if isinstance(value, str) else json.dumps(value)}\n</parameter>\n"
                     for key, value in arguments.items())
    return f"<tool_call>\n<function={name}>\n{params}</function>\n</tool_call>"


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
    """One turn; the preload is off unless a test asks for it, so loop mechanics are tested alone."""
    kwargs.setdefault("preload", False)
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


def test_xml_tool_calls_parse_like_the_json_form():
    # Verbatim as the Qwen3.5-family template writes it: a string raw, an integer as JSON.
    text = ("<tool_call>\n<function=search_rules>\n<parameter=query>\nready unit attack\n</parameter>\n"
            "<parameter=k>\n5\n</parameter>\n</function>\n</tool_call>")
    (xml,), rest = parse_tool_calls(text)
    (js,), _ = parse_tool_calls(call("search_rules", query="ready unit attack", k=5))
    assert rest == "" and xml.error is None and xml.format == "xml" and js.format == "json"
    expected = ("search_rules", {"query": "ready unit attack", "k": 5})
    assert (xml.name, xml.arguments) == (js.name, js.arguments) == expected
    assert type(xml.arguments["k"]) is int
    # A string that looks like a number stays a string; an object parameter is JSON.
    (c,), _ = parse_tool_calls(xml_call("get_rule", rule_id="9"))
    assert c.error is None and c.arguments == {"rule_id": "9"}
    deck = {"legend": "v-streetkid", "cards": [{"slug": "x", "quantity": 3}]}
    (c,), _ = parse_tool_calls(xml_call("check_deck", deck=deck))
    assert c.error is None and c.arguments == {"deck": deck}
    # Only the template's one newline each side is removed: the rest of a multiline value is kept.
    value = "  line one\n\nline two  \n"
    (c,), _ = parse_tool_calls(xml_call("search_cards", text=value))
    assert c.error is None and c.arguments == {"text": value}
    (c,), _ = parse_tool_calls("<tool_call><function=find_card><parameter=query>V</parameter></function></tool_call>")
    assert c.error is None and c.arguments == {"query": "V"}, "the newlines are optional"
    (c,), _ = parse_tool_calls("<tool_call>\n<function=search_cards>\n</function>\n</tool_call>")
    assert c.error is None and c.arguments == {}
    # One reply may mix the forms; each block is read on its own.
    calls, rest = parse_tool_calls("Checking.\n" + call("find_card", query="V") + "\n"
                                   + xml_call("get_card", slug="v-streetkid"))
    assert [(c.name, c.arguments, c.format, c.error) for c in calls] == [
        ("find_card", {"query": "V"}, "json", None), ("get_card", {"slug": "v-streetkid"}, "xml", None)]
    assert rest == "Checking."


XML_BAD_CASES = {
    "bad integer": (xml_call("search_rules", query="attack", k="five"), "not valid JSON"),
    "wrong type": (xml_call("search_rules", query="attack", k="5.5"), "must be of type integer"),
    "bool for integer": (xml_call("find_card", query="V", limit="true"), "must be of type integer"),
    "unknown function": (xml_call("delete_everything", path="/"), "unknown function"),
    "unknown parameter": (xml_call("get_card", slug="v-streetkid", x="1"), "unknown parameter 'x'"),
    "duplicate parameter": ("<tool_call>\n<function=get_card>\n<parameter=slug>\na\n</parameter>\n"
                            "<parameter=slug>\nb\n</parameter>\n</function>\n</tool_call>", "given twice"),
    "stray text inside": ("<tool_call>\n<function=get_card>\nplease\n<parameter=slug>\nv-streetkid\n"
                          "</parameter>\n</function>\n</tool_call>", "unexpected text"),
    "stray text before": ("<tool_call>\nsure <function=get_card>\n<parameter=slug>\nv-streetkid\n"
                          "</parameter>\n</function>\n</tool_call>", "text before"),
    "stray text after": ("<tool_call>\n<function=get_card>\n<parameter=slug>\nv-streetkid\n"
                         "</parameter>\n</function>\nthanks\n</tool_call>", "nothing after"),
    "unclosed parameter": ("<tool_call>\n<function=get_card>\n<parameter=slug>\nv-streetkid\n</function>\n"
                           "</tool_call>", "not closed"),
    "unclosed block": ("<tool_call>\n<function=get_card>\n<parameter=slug>\nv-str", "unclosed"),
}


def test_malformed_xml_tool_calls_are_errors_not_calls():
    for label, (text, problem) in XML_BAD_CASES.items():
        calls, _ = parse_tool_calls(text)
        assert len(calls) == 1 and calls[0].error and problem in calls[0].error, (label, calls)
        assert calls[0].format == "xml", label


def test_malformed_xml_calls_go_back_to_the_model_with_their_raw_text():
    texts = [text for text, _ in XML_BAD_CASES.values()]
    for text in texts:
        model = ScriptedModel([text, "I could not look that up."])
        with CountRuns() as counter:
            result = turn([], "anything", model)
        assert counter.count == 0, ("a rejected XML call ran a tool", text)
        (step,) = tool_steps(result)
        assert step["errorKind"] == "malformed_tool_call" and step["ok"] is False and step["callFormat"] == "xml"
        (reply,) = [json.loads(m["content"]) for m in model.seen[1] if m["role"] == "tool"]
        assert reply["error_kind"] == "malformed_tool_call" and "<function=<tool>>" in reply["error"], reply
        assistant = [m for m in model.seen[1] if m["role"] == "assistant"][0]
        assert "tool_calls" not in assistant
        assert text.replace("<tool_call>", "").replace("</tool_call>", "").strip() in assistant["content"], \
            "the model should see the XML it wrote next to the error"
        assert result.ok and result.answer == "I could not look that up."
    # A JSON call keeps the JSON hint and records no callFormat, so JSON traces are unchanged.
    model = ScriptedModel(["<tool_call>{oops}</tool_call>", "No."])
    (step,) = tool_steps(turn([], "anything", model))
    assert "callFormat" not in step
    reply = json.loads(model.seen[1][-1]["content"])
    assert 'Write <tool_call>{"name": <tool>, "arguments": {...}}</tool_call> with one of' in reply["error"]


def test_scripted_xml_turn_runs_tools_and_answers():
    model = ScriptedModel([
        xml_call("find_card", query="V: Streetkid"),
        "Reading it.\n" + xml_call("get_card", slug="v-streetkid") + "\n" + call("search_rules", query="attack", k=2),
        "`v-streetkid` is a Legend; its facts are above.",
    ])
    with CountRuns() as counter:
        result = turn([], "What does V: Streetkid do?", model)
    assert counter.count == 3 and result.ok and result.stop_reason == "answer" and result.tool_calls == 3
    steps = tool_steps(result)
    assert [(s["tool"], s.get("callFormat")) for s in steps] == [
        ("find_card", "xml"), ("get_card", "xml"), ("search_rules", None)]
    assert all(s["ok"] for s in steps) and steps[2]["arguments"] == {"query": "attack", "k": 2}
    assert result.sources["card_slugs"][0] == "v-streetkid"
    last = model.seen[-1]
    # History goes back as structured tool_calls, which the template re-renders in its own form.
    assert last[2]["tool_calls"] == [
        {"type": "function", "function": {"name": "find_card", "arguments": {"query": "V: Streetkid"}}}]
    assert last[4] == {"role": "assistant", "content": "Reading it.", "tool_calls": [
        {"type": "function", "function": {"name": "get_card", "arguments": {"slug": "v-streetkid"}}},
        {"type": "function", "function": {"name": "search_rules", "arguments": {"query": "attack", "k": 2}}}]}
    assert json.loads(last[5]["content"]) == tools.get_card("v-streetkid")
    assert result.answer == "`v-streetkid` is a Legend; its facts are above."


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
    # A reply asking for more calls than remain runs the ones that fit; once none remain the turn stops.
    batch = LoopingModel(per_reply=4)
    with CountRuns() as counter:
        result = turn([], "loop", batch)
    assert counter.count == 6 and result.tool_calls == 6 and result.stop_reason == "tool_cap" and batch.calls == 3
    assert [s["errorKind"] for s in tool_steps(result)] == [None] * 6 + ["cap_exceeded"] * 6


def test_a_batch_past_the_cap_runs_the_calls_that_fit_and_refuses_the_rest():
    # Two calls asked for with one left (a 27B quiz run, 2026-11-13): the first runs, the second is refused and
    # reported back, and the model still gets to answer.
    model = ScriptedModel([call("find_card", query="V"), call("get_rule", rule_id="9.2") + call("find_card", query="Jackie"),
                           "The answer from what I have."])
    with CountRuns() as counter:
        result = turn([], "q", model, max_tool_calls=2)
    assert counter.count == 2 and result.tool_calls == 2 and result.ok and result.stop_reason == "answer"
    steps = tool_steps(result)
    assert [(s["tool"], s["ok"], s["errorKind"]) for s in steps] == [
        ("find_card", True, None), ("get_rule", True, None), ("find_card", False, "cap_exceeded")]
    last = model.seen[-1]
    assert [m["role"] for m in last[-3:]] == ["assistant", "tool", "tool"]
    assert [c["function"]["name"] for c in last[-3]["tool_calls"]] == ["get_rule", "find_card"]
    refused = json.loads(last[-1]["content"])
    assert refused["ok"] is False and refused["error_kind"] == "cap_exceeded" and "all 2 tool calls" in refused["error"]
    assert json.loads(last[-2]["content"])["ok"] is True, "the call that fit ran, in order"
    # Three asked with two left: two run in order, one refused; the cap's meaning is otherwise unchanged.
    model = ScriptedModel([call("find_card", query="V") + call("get_rule", rule_id="9.2") + call("get_rule", rule_id="9.3"),
                           "Done."])
    with CountRuns() as counter:
        result = turn([], "q", model, max_tool_calls=2)
    assert counter.count == 2 and [s["arguments"] for s in tool_steps(result) if s["ok"]] == [
        {"query": "V"}, {"rule_id": "9.2"}]
    assert tool_steps(result)[-1]["arguments"] == {"rule_id": "9.3"} and result.stop_reason == "answer"


class SizedModel(ScriptedModel):
    """A scripted model that counts its prompt as characters / 4 and, like the worker, refuses one over ``refuse_over``.

    With ``limit`` it also tells the loop its cap (``prompt_token_limit``), as ``WorkerChatModel`` does.
    """

    def __init__(self, texts, *, limit=None, refuse_over=None, report_cap=True):
        super().__init__(texts)
        self.refuse_over = refuse_over
        self.report_cap = report_cap
        self.sizes: list[int] = []
        if limit is not None:
            self.prompt_token_limit = lambda max_tokens: limit

    async def generate(self, messages, tools_, *, max_tokens, enable_thinking):
        size = loop_module._message_chars(messages, tools_) // 4
        self.sizes.append(size)
        if self.refuse_over is not None and size > self.refuse_over:
            refusal = {"ok": False, "error": "prompt_too_large", "promptTokens": size}
            return {**refusal, "maxPromptTokens": self.refuse_over} if self.report_cap else refusal
        reply = await super().generate(messages, tools_, max_tokens=max_tokens, enable_thinking=enable_thinking)
        return {**reply, "promptTokens": size}


GUARD_SCRIPT = [call("search_rules", query="attack a spent unit", k=10), call("search_rules", query="blocker", k=10),
                call("search_rules", query="lag ready", k=10), "Answer from the latest results."]
GUARD_QUESTION = "Can a Unit attack the turn it is played?"


def no_timing(trace):
    return [{k: v for k, v in step.items() if k != "elapsedMs"} for step in trace]


def test_prompt_guard_drops_the_oldest_tool_results_first():
    # Measure the run with no cap, then cap it just under what the last model step would be sent.
    free = SizedModel(list(GUARD_SCRIPT))
    reference = turn([], GUARD_QUESTION, free, preload=True)
    assert reference.ok and not [s for s in reference.trace if s["kind"] == "context"]
    estimate = math.ceil(loop_module._message_chars(free.seen[3], free.tools_seen[3]) / loop_module.CHARS_PER_TOKEN)
    capped = SizedModel(list(GUARD_SCRIPT), limit=estimate - 50)
    result = turn([], GUARD_QUESTION, capped, preload=True)
    assert result.ok and result.stop_reason == "answer" and len(capped.seen) == 4
    context = [s for s in result.trace if s["kind"] == "context"]
    assert len(context) == 1 and context[0]["ok"] and context[0]["action"] == "dropped"
    assert context[0]["reason"] == "estimate" and context[0]["limit"] == estimate - 50
    assert context[0]["estimatedTokens"] > estimate - 50 >= context[0]["estimatedTokensAfter"]
    # The step comes right before the model step it made room for.
    kinds = [s["kind"] for s in result.trace]
    assert kinds[-2:] == ["context", "model"] and kinds.count("model") == 4
    sent, before = capped.seen[3], free.seen[3]
    dropped = [d["message"] for d in context[0]["dropped"]]
    # Oldest first: the preload's results (right after the preload's assistant message at index 2) go first.
    assert dropped == list(range(3, 3 + len(dropped))) and before[2]["role"] == "assistant"
    for index in dropped:
        note = json.loads(sent[index]["content"])
        assert sent[index]["role"] == "tool" and note["error_kind"] == "dropped_for_context"
        assert f"({len(before[index]['content'])} characters)" in note["error"]
        assert context[0]["dropped"][dropped.index(index)]["tool"] == json.loads(before[index]["content"])["tool"]
    # Never the system prompt, the question, the model's own messages or the latest tool results.
    kept = [i for i in range(len(before)) if i not in dropped]
    assert [sent[i] for i in kept] == [before[i] for i in kept] and len(sent) == len(before)
    assert sent[-1] == before[-1] and sent[-1]["role"] == "tool" and sent[1]["content"] == GUARD_QUESTION
    # Deterministic: the same run gives the same trace.
    again = turn([], GUARD_QUESTION, SizedModel(list(GUARD_SCRIPT), limit=estimate - 50), preload=True)
    assert no_timing(again.trace) == no_timing(result.trace)


def test_prompt_guard_ends_the_turn_when_nothing_more_can_go():
    # Over the estimate with nothing to drop (only the latest results, the preload's, are there): the worker's
    # exact count decides, and its refusal ends the turn with a clear stop, not a model error.
    model = SizedModel(["never answered"], limit=10, refuse_over=10)
    result = turn([], GUARD_QUESTION, model, preload=True)
    assert model.seen == [] and len(model.sizes) == 1, "asked once, refused once"
    assert not result.ok and result.stop_reason == "context_full" and result.error is None
    assert "no longer fits the model's context" in result.answer and "10-token limit" in result.answer
    context = [s for s in result.trace if s["kind"] == "context"]
    assert [(s["ok"], s["action"], s["reason"]) for s in context] == [(True, "kept", "estimate"),
                                                                      (False, "full", "worker_refused")]
    assert result.trace[-1] == {**context[-1], "step": result.trace[-1]["step"]}
    assert all(not s["dropped"] for s in context), "the latest results are never dropped"
    # The estimate is pessimistic: when the worker accepts what the estimate would not, the answer stands.
    lenient = SizedModel(["Fine."], limit=10)
    result = turn([], GUARD_QUESTION, lenient, preload=True)
    assert result.ok and result.stop_reason == "answer" and len(lenient.seen) == 1


def test_prompt_guard_estimate_learns_from_reported_counts_and_only_tightens():
    specs = tools.tool_specs()
    messages = [{"role": "system", "content": "s" * 3000}, {"role": "user", "content": "q"}]
    chars = loop_module._message_chars(messages, specs)
    guard = loop_module.PromptGuard(None, specs)
    assert guard.estimate(messages) == math.ceil(chars / 3.0) and guard.fit(messages) is None, "no cap: no guard"
    guard.observe(messages, {"promptTokens": chars // 4})   # fewer tokens than 3 chars each: keep the safer 3.0
    assert guard.ratio == 3.0
    guard.observe(messages, {"promptTokens": chars // 2})   # more tokens than estimated: learn the tighter ratio
    assert guard.ratio == chars / (chars // 2) and guard.estimate(messages) == chars // 2
    for junk in (None, 0, -5, True, "9"):
        guard.observe(messages, {"promptTokens": junk})
    assert guard.ratio == chars / (chars // 2)
    refused = loop_module.PromptGuard(None, specs)
    step = refused.refused(messages, {"promptTokens": chars, "maxPromptTokens": 500})
    assert refused.limit == 500 and refused.ratio == 1.0 and step["ok"] is False and step["action"] == "full"


def test_a_worker_refusal_drops_more_and_asks_again():
    free = SizedModel(list(GUARD_SCRIPT))
    turn([], GUARD_QUESTION, free)
    hidden = free.sizes[3] - 100  # the worker's cap, unknown to the loop until it refuses
    model = SizedModel(list(GUARD_SCRIPT), refuse_over=hidden)
    result = turn([], GUARD_QUESTION, model)
    assert result.ok and result.stop_reason == "answer" and model.sizes[-1] <= hidden < model.sizes[-2]
    refused = [s for s in result.trace if s["kind"] == "model" and not s["ok"]]
    assert refused == [{"step": refused[0]["step"], "kind": "model", "ok": False, "error": "prompt_too_large",
                        "promptTokens": model.sizes[-2], "maxPromptTokens": hidden}]
    context = [s for s in result.trace if s["kind"] == "context"]
    assert context[0]["reason"] == "worker_refused" and context[0]["dropped"] and context[0]["limit"] == hidden
    assert context[0]["dropped"][0]["message"] == 3, "the first tool result goes first"
    # A refusal that does not name the cap still drops one more result per refusal until the worker accepts.
    quiet = SizedModel(list(GUARD_SCRIPT), refuse_over=hidden, report_cap=False)
    result = turn([], GUARD_QUESTION, quiet)
    assert result.ok and quiet.sizes[-1] <= hidden
    dropped = [d["message"] for s in result.trace if s["kind"] == "context" for d in s["dropped"]]
    assert dropped and dropped == sorted(dropped) and all(s["limit"] is None for s in result.trace
                                                          if s["kind"] == "context")
    # A refusal with nothing left to drop is a clear stop, not a model error.
    stuck = SizedModel(["never answered"], refuse_over=1)
    result = turn([], GUARD_QUESTION, stuck)
    assert result.stop_reason == "context_full" and result.error is None and len(stuck.sizes) == 1


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


def test_system_prompt_and_cap_message_state_the_effective_cap():
    # At the default the rendered prompt is the versioned SYSTEM_PROMPT, word for word.
    assert system_prompt() == system_prompt(MAX_TOOL_CALLS) == SYSTEM_PROMPT and cap_message() == CAP_MESSAGE
    assert f"At most {MAX_TOOL_CALLS} tool calls per question." in SYSTEM_PROMPT
    model = LoopingModel()
    with CountRuns() as counter:
        result = turn([], "Tell me about V.", model, max_tool_calls=2)
    assert counter.count == 2 and model.calls == 3 and result.stop_reason == "tool_cap"
    assert result.answer == cap_message(2) and "more than 2 tool calls" in result.answer
    seen = ScriptedModel(["Short answer."])
    turn([], "Q?", seen, max_tool_calls=10)
    prompt = seen.seen[0][0]["content"]
    assert prompt == system_prompt(10) != SYSTEM_PROMPT and "At most 10 tool calls per question." in prompt
    assert prompt.replace("At most 10 ", f"At most {MAX_TOOL_CALLS} ") == SYSTEM_PROMPT, "only the cap differs"
    assert f"Prompt {ASSISTANT_PROMPT_VERSION}." in prompt


# Worker pure functions -------------------------------------------------------------------


def test_worker_token_ceiling_is_16384_like_the_loop():
    worker = load_worker_module()
    assert worker.MAX_TOKENS_LIMIT == MAX_TOKENS_LIMIT == 16384
    assert worker.DEFAULT_MAX_TOKENS == 1024, "the ceiling moved, the default did not"
    good = {"protocol": CHAT_PROTOCOL, "id": 1, "messages": [{"role": "user", "content": "hi"}]}
    for value in (1, 4096, 4097, 8192, 16384):
        request, problem = worker.check_request({**good, "max_tokens": value})
        assert problem is None and request["max_tokens"] == value, value
    for value in (0, 16385, 10 ** 6, 8192.0, "8192", True):
        assert worker.check_request({**good, "max_tokens": value}) == (None, "bad_max_tokens"), value
    reply, keep = worker.handle_line((json.dumps({**good, "max_tokens": 16385}) + "\n").encode(), None)
    assert reply == {"id": 1, "ok": False, "error": "bad_max_tokens"} and keep




def test_worker_pure_functions_without_mlx():
    # Loading the worker must not import MLX itself. Compare before and after rather than
    # assert absence: on a Mac an earlier test may already have imported mlx.
    before = {name for name in sys.modules if name.split(".")[0] in ("mlx", "mlx_lm")}
    worker = load_worker_module()
    assert {name for name in sys.modules if name.split(".")[0] in ("mlx", "mlx_lm")} == before
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
    assert too_big == {"ok": False, "error": "prompt_too_large", "promptTokens": 7, "maxPromptTokens": 3}
    # The model's context also holds the answer: 7 prompt tokens + 1024 to generate do not fit in 1030.
    assert worker.run_generation(None, tokenizer, request, stream_fn=stream, sampler="greedy",
                                 context=1030)["maxPromptTokens"] == 6
    assert worker.run_generation(None, tokenizer, request, stream_fn=stream, sampler="greedy", context=1031)["ok"]

    line = (json.dumps(good) + "\n").encode()
    assert worker.handle_line(line, lambda r: {"ok": True, "text": "x"}) == ({"id": 1, "ok": True, "text": "x"}, True)
    assert worker.handle_line(line, lambda r: 1 / 0) == ({"id": 1, "ok": False, "error": "generation_failed"}, True)
    assert worker.handle_line((json.dumps(dict(good, max_tokens=0)) + "\n").encode(), None) == (
        {"id": 1, "ok": False, "error": "bad_max_tokens"}, True)
    assert worker.handle_line(b"{nope\n", None) == (None, False)
    assert worker.handle_line(b'{"protocol": "x"}', None) == (None, False)
    assert {name for name in sys.modules if name.split(".")[0] in ("mlx", "mlx_lm")} == before


def test_worker_prompt_cap_and_step_timeout_scale_with_the_model_and_max_tokens():
    worker = load_worker_module()
    assert worker.MAX_PROMPT_TOKENS == DEFAULT_MAX_PROMPT_TOKENS == 32768 and MAX_PROMPT_TOKENS_LIMIT == 131072
    # The context length comes from the model's own config.json, top level or under text_config.
    assert context_length({"max_position_embeddings": 40960}) == 40960
    assert context_length({"text_config": {"max_position_embeddings": 262144}}) == 262144
    assert context_length({"max_position_embeddings": 40960, "text_config": {"max_position_embeddings": 8}}) == 40960
    for bad in ({}, {"max_position_embeddings": True}, {"max_position_embeddings": "40960"},
                {"max_position_embeddings": 0}, {"text_config": "x"}):
        assert context_length(bad) is None, bad
    # The cap keeps room for the answer inside the context; with no context known it is the configured cap.
    assert prompt_cap(32768, 40960, 8192) == 32768 and prompt_cap(32768, 40960, 16384) == 24576
    assert prompt_cap(32768, 262144, 8192) == 32768 and prompt_cap(32768, None, 16384) == 32768
    assert prompt_cap(32768, 100, 200) == 1
    with tempfile.TemporaryDirectory() as tmp:
        assert worker.read_context_length(Path(tmp)) is None
        (Path(tmp) / "config.json").write_text(json.dumps({"text_config": {"max_position_embeddings": 65536}}))
        assert worker.read_context_length(Path(tmp)) == 65536
        (Path(tmp) / "model.safetensors").write_bytes(b"")
        command = chat_worker_command(tmp)
        assert command[command.index("--max-prompt-tokens") + 1] == "32768"
        assert chat_worker_command(tmp, max_prompt_tokens=131072)[-1] == "131072"
        for bad in (0, 131073):
            try:
                chat_worker_command(tmp, max_prompt_tokens=bad)
                raise AssertionError(f"prompt cap {bad} accepted")
            except ValueError as exc:
                assert "1..131072" in str(exc)
        model = make_chat_model(tmp)
        assert model.context == 65536 and model.prompt_token_limit(2048) == 32768
        assert model.prompt_token_limit(16384) == 32768 and model.timeout_for(8192) == 1349
        fixed = make_chat_model(tmp, response_timeout=42, max_prompt_tokens=1000)
        assert fixed.timeout_for(8192) == 42 and fixed.prompt_token_limit(64000) == 1000
    # The step timeout: the old 600 s at the default 2,048 tokens, then about 6.7 tokens/s plus 120 s.
    assert [step_timeout(n) for n in (1, 1024, 2048, 3200, 4096, 8192, 16384)] == [
        600, 600, 600, 600, 735, 1349, 2578]
    assert all(step_timeout(n) >= 120 + n / 8 for n in range(1, 16385, 97)), "slower than 8 tokens/s still fits"


def test_each_request_gets_its_own_timeout():
    async def scenario():
        with tempfile.TemporaryDirectory() as tmp:
            hang = ChatWorker([sys.executable, "-c", FAKE_WORKER, "hang"], cwd=Path(tmp), response_timeout=8)
            model = WorkerChatModel(hang, response_timeout=0.5)
            started = time.monotonic()
            reply = await model.generate([{"role": "user", "content": "hi"}], [], max_tokens=8192,
                                         enable_thinking=False)
            assert reply == {"ok": False, "error": "worker_timeout"}
            assert time.monotonic() - started < 6, "the per-step timeout, not the worker's own"
            await hang.close()
            echo = ChatWorker([sys.executable, "-c", FAKE_WORKER, "echo"], cwd=Path(tmp), response_timeout=0.001)
            reply = await WorkerChatModel(echo).generate([{"role": "user", "content": "hi"}], [], max_tokens=9,
                                                         enable_thinking=False)
            assert reply["ok"] and reply["text"] == "echo:hi:9", "scaled by max_tokens, not the tiny default"
            await echo.close()
    asyncio.run(scenario())


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
        assert command[2].endswith("scripts/mlx_chat_worker.py") and Path(command[command.index("--model") + 1]).resolve() == Path(tmp).resolve()  # macOS: /var is /private/var
        try:
            chat_worker_command(tmp, adapter=tmp)
            raise AssertionError("an adapter without adapter files was accepted")
        except ValueError as exc:
            assert "adapter_config.json" in str(exc)


# The chat route ----------------------------------------------------------------------------


def test_chat_route_with_a_fake_model_keeps_short_history():
    model = ScriptedModel([call("find_card", query="V"), "Three cards are named V.", "Ask by slug."])
    with TestClient(build_assistant_app(chat=ChatService(model, max_history_messages=2, preload=False))) as client:
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
