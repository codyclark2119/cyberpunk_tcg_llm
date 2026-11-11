"""One chat turn: the model chooses tools, code supplies every fact, and the turn leaves a trace.

``run_turn`` renders the system prompt, the kept history and the user's message,
asks the model, and parses Qwen3's native ``<tool_call>{"name": ..., "arguments":
{...}}</tool_call>`` blocks strictly. A block that is not valid JSON, an unknown
tool or bad arguments go back to the model as a tool error and never run (the
registry's ``call_tool`` validates before running). At most ``MAX_TOOL_CALLS``
calls run per turn, malformed ones included; a model reply whose calls would go
past the cap runs none of them and ends the turn with a clear message.
``<think>`` blocks are stripped from the answer and kept in the trace; a tool
call written inside thinking is not a call.

The model is anything with ``async generate(messages, tools, *, max_tokens,
enable_thinking) -> dict`` returning the chat worker's reply fields (``ok``,
``text``, ``finishReason``, token counts, ``elapsedMs``), so tests drive the
loop with a scripted fake. Nothing here branches on the question's text.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from games.cyberpunk.assistant.tools import TOOLS, call_tool, tool_specs
from games.cyberpunk.prompts import RULES_VERSION

ASSISTANT_PROMPT_VERSION = "assistant-chat-v1"
MAX_TOOL_CALLS = 6
DEFAULT_MAX_TOKENS = 1024
SOURCE_KEYS = ("card_slugs", "rule_ids", "errata_ids", "deck_ids", "chunk_ids")

SYSTEM_PROMPT = f"""You answer questions about Cyberpunk TCG, a trading card game that launched in 2026 and is in open beta.
You do not know this game. Anything you seem to remember about it is wrong or invented, and some of its terms mean the opposite of what they mean in other card games.

Rules for every answer:
- Every card fact (cost, power, RAM, colour, type, keywords, text, errata) and every rule must come from a tool result in this conversation. If no tool gave you a fact, do not state it.
- A card's identity is its slug, never its name: several cards share a name. When find_card reports a match as ambiguous, ask which card is meant or answer for each; never pick one silently.
- Errata override a card's printed text.
- Cite what you used: card slugs in backticks (for example `v-streetkid`) and rule numbers (for example rule 9.2.3).
- Deck legality, curves and similar decks come from the deck tools; pass a pasted deck list to parse_deck first.
- Strategy, combos and matchups are judgment, not facts. Label them as judgment and base them on tool results.
- If the tools cannot answer, say so plainly.
- Call at most {MAX_TOOL_CALLS} tools per question. Keep the answer short.

Card and rules data: snapshot {RULES_VERSION}. Prompt version: {ASSISTANT_PROMPT_VERSION}."""

THINK_RE = re.compile(r"<think>(.*?)</think>", re.S)
TOOL_CALL_RE = re.compile(r"<tool_call>(.*?)</tool_call>", re.S)
CAP_MESSAGE = (f"Stopped: the model asked for more than {MAX_TOOL_CALLS} tool calls for one question, so this turn "
               "has no answer. The tool results so far are in the trace. Try a narrower question.")
EMPTY_MESSAGE = "The model returned no answer text."


class ChatModel(Protocol):
    async def generate(self, messages: list[dict], tools: list[dict], *, max_tokens: int,
                       enable_thinking: bool) -> dict: ...


@dataclass
class ToolCall:
    """One parsed ``<tool_call>`` block; ``error`` is set when it must not run."""
    name: str | None
    arguments: Any
    raw: str
    error: str | None = None


@dataclass
class TurnResult:
    ok: bool
    answer: str
    stop_reason: str
    trace: list[dict] = field(default_factory=list)
    tool_calls: int = 0
    sources: dict = field(default_factory=lambda: {k: [] for k in SOURCE_KEYS})
    elapsed_ms: float = 0.0
    error: str | None = None

    def to_dict(self) -> dict:
        return {"ok": self.ok, "answer": self.answer, "stopReason": self.stop_reason, "error": self.error,
                "toolCalls": self.tool_calls, "sources": self.sources, "trace": self.trace,
                "elapsedMs": self.elapsed_ms, "promptVersion": ASSISTANT_PROMPT_VERSION,
                "rulesVersion": RULES_VERSION}


def split_thinking(text: str) -> tuple[str | None, str]:
    """(thinking, the rest). Handles a closed block, a bare ``</think>`` and an unclosed ``<think>``."""
    thoughts = [m.strip() for m in THINK_RE.findall(text)]
    rest = THINK_RE.sub("", text)
    if "</think>" in rest:  # The template opened <think> in the prompt; only the close was generated.
        before, _, rest = rest.partition("</think>")
        thoughts.insert(0, before.replace("<think>", "").strip())
    if "<think>" in rest:  # Cut off mid-thought: everything after the open is thinking.
        rest, _, tail = rest.partition("<think>")
        thoughts.append(tail.strip())
    thinking = "\n\n".join(t for t in thoughts if t)
    return (thinking or None), rest


def parse_tool_calls(text: str) -> tuple[list[ToolCall], str]:
    """Tool calls in ``text`` (thinking already removed) and the text outside them.

    Strict: each block must be one JSON object with a string ``name`` and an
    object ``arguments``, and nothing else. An unclosed ``<tool_call>`` is a
    malformed call too, so a truncated call is reported, never half-run.
    """
    calls = []
    for match in TOOL_CALL_RE.finditer(text):
        calls.append(_parse_block(match.group(1)))
    rest = TOOL_CALL_RE.sub("", text)
    if "<tool_call>" in rest:
        rest, _, tail = rest.partition("<tool_call>")
        calls.append(ToolCall(None, None, tail.strip(), "unclosed <tool_call> block (output cut off?)"))
    return calls, rest.replace("</tool_call>", "").strip()


def _parse_block(raw: str) -> ToolCall:
    raw = raw.strip()
    try:
        value = json.loads(raw)
    except (ValueError, RecursionError) as exc:
        return ToolCall(None, None, raw, f"tool call is not valid JSON: {exc}")
    if not isinstance(value, dict):
        return ToolCall(None, None, raw, "tool call must be a JSON object")
    name, arguments = value.get("name"), value.get("arguments", {})
    extra = sorted(set(value) - {"name", "arguments"})
    if not isinstance(name, str) or not name:
        return ToolCall(None, arguments, raw, "tool call needs a string 'name'")
    if not isinstance(arguments, dict):
        return ToolCall(name, arguments, raw, "tool call 'arguments' must be a JSON object")
    if extra:
        return ToolCall(name, arguments, raw, f"tool call has unexpected keys: {', '.join(extra)}")
    return ToolCall(name, arguments, raw)


def summarize_result(result: dict, limit: int = 160) -> str:
    """A one-line, tool-agnostic summary for the trace."""
    if not result.get("ok"):
        text = f"{result.get('error_kind', 'error')}: {result.get('error', '')}"
    else:
        parts = []
        body = result.get("result") or {}
        if isinstance(body, dict) and isinstance(body.get("count"), int):
            parts.append(f"{body['count']} found")
        if isinstance(body, dict) and body.get("ambiguous") is True:
            parts.append("ambiguous")
        sources = result.get("sources") or {}
        for key, label in (("card_slugs", "cards"), ("rule_ids", "rules"), ("errata_ids", "errata"),
                           ("deck_ids", "decks")):
            values = sources.get(key) or []
            if values:
                shown = ", ".join(values[:4]) + (f" (+{len(values) - 4})" if len(values) > 4 else "")
                parts.append(f"{label}: {shown}")
        text = "; ".join(parts) or "ok"
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _tool_error(name: str | None, kind: str, message: str) -> dict:
    return {"ok": False, "tool": name, "error": message, "error_kind": kind, "rules_version": RULES_VERSION,
            "sources": {k: [] for k in SOURCE_KEYS}}


def _assistant_message(content: str, calls: list[ToolCall]) -> dict:
    """The assistant step as the chat template expects it: well-formed calls as ``tool_calls``.

    A malformed block cannot be a structured call, so its raw text stays in the
    content where the model can see what it wrote next to the error.
    """
    good = [c for c in calls if c.error is None]
    bad = [c for c in calls if c.error is not None]
    text = "\n".join([content] + [f"<tool_call>\n{c.raw}\n</tool_call>" for c in bad]).strip()
    message = {"role": "assistant", "content": text}
    if good:
        message["tool_calls"] = [{"type": "function", "function": {"name": c.name, "arguments": c.arguments}}
                                 for c in good]
    return message


def build_messages(history: list[dict], user_message: str) -> list[dict]:
    return [{"role": "system", "content": SYSTEM_PROMPT}, *history, {"role": "user", "content": user_message}]


async def run_turn(history: list[dict], user_message: str, model: ChatModel, *,
                   max_tool_calls: int = MAX_TOOL_CALLS, max_tokens: int = DEFAULT_MAX_TOKENS,
                   enable_thinking: bool = False) -> TurnResult:
    """Run one user turn to an answer, an error or the tool-call cap. ``history`` is not modified."""
    started = time.monotonic()
    messages = build_messages(history, user_message)
    specs = tool_specs()
    turn = TurnResult(ok=False, answer="", stop_reason="")
    step = 0

    def add(entry: dict):
        nonlocal step
        step += 1
        turn.trace.append({"step": step, **entry})

    while True:
        reply = await model.generate(messages, specs, max_tokens=max_tokens, enable_thinking=enable_thinking)
        if not isinstance(reply, dict) or reply.get("ok") is not True or not isinstance(reply.get("text"), str):
            error = reply.get("error", "model_error") if isinstance(reply, dict) else "model_error"
            add({"kind": "model", "ok": False, "error": error})
            turn.stop_reason, turn.error = "model_error", str(error)
            turn.answer = f"The local model failed ({error}); no answer."
            break
        thinking, body = split_thinking(reply["text"])
        calls, content = parse_tool_calls(body)
        add({"kind": "model", "ok": True, "thinking": thinking, "toolCallsRequested": len(calls),
             "finishReason": reply.get("finishReason"), "promptTokens": reply.get("promptTokens"),
             "generationTokens": reply.get("generationTokens"), "elapsedMs": reply.get("elapsedMs")})
        if not calls:
            turn.ok = bool(content)
            turn.answer = content or EMPTY_MESSAGE
            turn.stop_reason = "answer" if content else "empty"
            if content and reply.get("finishReason") == "length":
                turn.answer += "\n\n(The answer was cut off at the token limit.)"
                turn.stop_reason = "length"
            break
        if turn.tool_calls + len(calls) > max_tool_calls:
            for call in calls:
                add({"kind": "tool", "tool": call.name, "arguments": call.arguments, "ok": False,
                     "errorKind": "cap_exceeded", "summary": "not run: tool-call cap reached",
                     "sources": {k: [] for k in SOURCE_KEYS}, "elapsedMs": 0.0})
            turn.stop_reason, turn.answer = "tool_cap", CAP_MESSAGE
            break
        messages.append(_assistant_message(content, calls))
        for call in calls:
            turn.tool_calls += 1
            tool_started = time.monotonic()
            if call.error is not None:
                result = _tool_error(call.name, "malformed_tool_call",
                                     f"{call.error}. Write <tool_call>{{\"name\": <tool>, \"arguments\": {{...}}}}"
                                     f"</tool_call> with one of: {', '.join(TOOLS)}.")
            else:
                result = call_tool(call.name, call.arguments)  # validates; unknown or bad args never run
            elapsed = round((time.monotonic() - tool_started) * 1000, 2)
            sources = result.get("sources") or {}
            if result.get("ok"):
                for key in SOURCE_KEYS:
                    for value in sources.get(key) or []:
                        if value not in turn.sources[key]:
                            turn.sources[key].append(value)
            add({"kind": "tool", "tool": call.name, "arguments": call.arguments, "ok": bool(result.get("ok")),
                 "errorKind": result.get("error_kind"), "error": result.get("error"),
                 "summary": summarize_result(result), "sources": {k: list(sources.get(k) or []) for k in SOURCE_KEYS},
                 "elapsedMs": elapsed})
            messages.append({"role": "tool", "content": json.dumps(result, ensure_ascii=False,
                                                                   separators=(",", ":"))})
    turn.elapsed_ms = round((time.monotonic() - started) * 1000, 2)
    return turn
