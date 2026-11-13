"""One chat turn: the model chooses tools, code supplies every fact, and the turn leaves a trace.

``run_turn`` renders the system prompt, the kept history and the user's message,
asks the model, and parses its ``<tool_call>`` blocks strictly. Each block is
read in one of two forms, chosen per block from its own text and never by model
name: Qwen3's JSON ``{"name": ..., "arguments": {...}}``, or the XML form the
Qwen3.5-family chat template asks for, ``<function=NAME>`` holding one
``<parameter=KEY>value</parameter>`` per argument (see ``_parse_xml_block``). A
block that does not parse, an unknown tool or bad arguments go back to the model
as a tool error and never run (the registry's ``call_tool`` validates before
running). At most ``MAX_TOOL_CALLS``
calls run per turn, malformed ones included. A reply asking for more calls than
remain runs the ones that fit, in order, and each one past the cap goes back to
the model as a ``cap_exceeded`` tool error, so it can answer from what it has
(until 2026-11-13 the whole reply was refused: a 27B model asking for two calls
with one left lost both and the answer). A reply asking for any call once none
remain ends the turn with a clear message (``tool_cap``).

Before each model step a ``PromptGuard`` keeps the prompt under the worker's
token cap (the model's ``prompt_token_limit``): when the estimate is over, the
oldest tool results are replaced by a short note, oldest first, never the
system prompt, the question or the latest results, and a ``kind: "context"``
trace step names what was dropped. The estimate is pessimistic, so a prompt
still over it with nothing left to drop goes to the worker anyway. A worker
refusal (``prompt_too_large``, with the real token count) recalibrates the
estimate and drops more. When a refused prompt has nothing more to drop, the
turn ends with ``context_full`` and a clear message
instead of a model error (a 27B quiz run lost a question to that on
2026-11-13, after four searches that returned long Tournament Rules rows).
``<think>`` blocks are stripped from the answer and kept in the trace; a tool
call written inside thinking is not a call.

The model is anything with ``async generate(messages, tools, *, max_tokens,
enable_thinking) -> dict`` returning the chat worker's reply fields (``ok``,
``text``, ``finishReason``, token counts, ``elapsedMs``), so tests drive the
loop with a scripted fake. Nothing here branches on the question's text.

Before the first model step, unless ``preload=False``, the loop runs the
automatic context step (``preload.py``): ``search_rules`` on the question and
``get_card`` / ``find_card`` for each card name in it, added to the
conversation as one assistant tool-call message and its tool messages, within a
character budget. Those steps open the trace with ``auto: true``; they do not
count against ``MAX_TOOL_CALLS``. The question text reaches only that step (the
search query and the card-name linker); ``preload_text`` replaces it there, so
the scorer can link and search the question and its choices without its
answer-format instructions.

Thinking is on by default (``DEFAULT_THINKING``) with a larger generation limit
(``DEFAULT_THINKING_MAX_TOKENS``, 2048) than without (1024). A step cut off
inside ``<think>`` has no answer at all, and a thought over several retrieved
rules plus the answer can plausibly pass 1024 tokens; 2048 doubles the room.
That is an estimate, not a measurement: the scorer's ``hit_length`` flag on the
Mac runs will show whether it is enough.

``MAX_TOKENS_LIMIT`` (16384) is the ceiling a caller may ask for per step, the
same number as the chat worker's own ``MAX_TOKENS_LIMIT``. It was 4096 until
2026-11-12, when larger models (Qwen3-Next-80B, Qwen3.8-27B) thought past 4096
tokens on quiz questions and an 8192 run was refused. 16384 leaves room to try
8192 and one doubling past it on the Mac's memory; it is a ceiling, not a
default, so the defaults above (and every run measured with them) are unchanged.

``max_tool_calls`` (default ``MAX_TOOL_CALLS``) is stated to the model in the
system prompt and in the cap message, so a run with another cap tells the model
the cap it actually has. At the default the rendered prompt is exactly
``SYSTEM_PROMPT``; ``system_prompt(n)`` renders it for another cap.

A deck the user loaded in the page's deck panel reaches the model as data, not
as a question: ``build_messages`` appends a labelled ``<loaded_deck>`` block to
the system message holding the deck dict exactly as ``parse_deck`` returned it,
so the model can pass it unchanged as the ``deck`` argument of any deck tool.
With no deck loaded the system message is the bare prompt.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from games.cyberpunk.assistant.flow import game_flow_outline
from games.cyberpunk.assistant.preload import DEFAULT_PRELOAD_CHARS, DEFAULT_PRELOAD_K
from games.cyberpunk.assistant.preload import preload as run_preload
from games.cyberpunk.assistant.tools import TOOLS, call_tool, tool_specs, validate_args
from games.cyberpunk.prompts import RULES_VERSION, TOURNAMENT_RULES_VERSION

# v5 (2026-11-13): the preload adds implied-rule get_rule steps, search_rules cuts passages at 1,500
# characters, and get_rule takes an ``offset``; the system prompt's wording is unchanged.
# v6 (2026-11-13): the system prompt gains timeline guidance (place each event by turn, phase and attack step;
# name each card's area and state; check the asked-about timing window is open) and the game flow outline
# generated from the rules snapshot (flow.py). Why: on the v5 quiz runs both Qwen3-8B and Qwen3.8-27B missed
# questions with the right rule already retrieved because they misplaced events in the game's flow.
ASSISTANT_PROMPT_VERSION = "assistant-chat-v6"
MAX_TOOL_CALLS = 6
MAX_TOOL_CALLS_LIMIT = 16           # the most a run may allow (scripts/eval_assistant.py --max-tool-calls)
MAX_TOKENS_LIMIT = 16384            # per model step; same as scripts/mlx_chat_worker.py (see the docstring)
DEFAULT_MAX_TOKENS = 1024           # per model step, thinking off
DEFAULT_THINKING_MAX_TOKENS = 2048  # per model step, thinking on (see the module docstring)
DEFAULT_THINKING = True
DEFAULT_PRELOAD = True
SOURCE_KEYS = ("card_slugs", "rule_ids", "errata_ids", "deck_ids", "chunk_ids")


def system_prompt(max_tool_calls: int = MAX_TOOL_CALLS) -> str:
    """The system prompt stating ``max_tool_calls``; at the default it is exactly ``SYSTEM_PROMPT``.

    It is the guidance (``guidance_prompt``) followed by the game flow outline (``flow.game_flow_outline``):
    rule lines from the snapshot, the same for every question, so they sit in the fixed prefix, which the
    ``PromptGuard`` never drops.
    """
    return f"{guidance_prompt(max_tool_calls)}\n\n{game_flow_outline()}"


def guidance_prompt(max_tool_calls: int = MAX_TOOL_CALLS) -> str:
    """The system prompt's hand-written part: what to answer from, how to cite, and how to read the game's flow."""
    return f"""You answer questions about Cyberpunk TCG, a card game that launched in 2026 and is in open beta. You know nothing true about it: anything you seem to remember is wrong or invented.
Warning: some terms here are the reverse of other card games. In these rules an attack spends a friendly ready Unit (rule 9.1), and a spent rival Unit is a valid attack target (rule 9.3.2.1). Where the rules text and your expectations differ, the rules text is right.

- Answer only from tool results in this conversation, including the ones looked up before you were asked, and the GAME FLOW rule lines below.
- If no tool result is relevant, say the snapshot does not cover it. Do not guess.
- Tournament procedure, penalties, deck registration, event policy: use the Tournament Rules (TR 3.4.2), cite them. Anything in neither is not covered.
- Cite rule numbers (rule 9.3.2.1) and card slugs in backticks (`v-streetkid`).
- A card's identity is its slug; several cards share a name. If find_card says ambiguous, ask which card or answer for each.
- Errata override printed card text.
- Give a pasted deck list to parse_deck first. Label strategy as judgment.
- Before answering, place every event in the question on the game timeline (GAME FLOW below): whose turn, which phase, which attack step. Name each card's area (hand, deck, Legends area, field, Eddies area, trash) and state (face-up or face-down, ready or spent, Lag).
- Check that the timing window the question asks about is actually open at that point. A state such as spent applies in whatever area the card is in.
- At most {max_tool_calls} tool calls per question. Keep the answer short.

Snapshot {RULES_VERSION}, TR {TOURNAMENT_RULES_VERSION}. Prompt {ASSISTANT_PROMPT_VERSION}."""


SYSTEM_PROMPT = system_prompt(MAX_TOOL_CALLS)


def default_max_tokens(enable_thinking: bool) -> int:
    return DEFAULT_THINKING_MAX_TOKENS if enable_thinking else DEFAULT_MAX_TOKENS


def tool_specs_sha256() -> str:
    """Hash of the tool specs exactly as the model receives them, for run headers."""
    canonical = json.dumps(tool_specs(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


THINK_RE = re.compile(r"<think>(.*?)</think>", re.S)
TOOL_CALL_RE = re.compile(r"<tool_call>(.*?)</tool_call>", re.S)
XML_FUNCTION_OPEN_RE = re.compile(r"<function=([^<>\n]*)>")
XML_PARAMETER_OPEN_RE = re.compile(r"<parameter=([^<>\n]*)>")
XML_FUNCTION_CLOSE, XML_PARAMETER_CLOSE = "</function>", "</parameter>"
JSON_CALL_HINT = "<tool_call>{\"name\": <tool>, \"arguments\": {...}}</tool_call>"
XML_CALL_HINT = "<tool_call>\n<function=<tool>>\n<parameter=<name>>\n<value>\n</parameter>\n</function>\n</tool_call>"


def cap_message(max_tool_calls: int = MAX_TOOL_CALLS) -> str:
    return (f"Stopped: the model asked for more than {max_tool_calls} tool calls for one question, so this turn "
            "has no answer. The tool results so far are in the trace. Try a narrower question.")


CAP_MESSAGE = cap_message(MAX_TOOL_CALLS)
EMPTY_MESSAGE = "The model returned no answer text."


class ChatModel(Protocol):
    async def generate(self, messages: list[dict], tools: list[dict], *, max_tokens: int,
                       enable_thinking: bool) -> dict: ...


@dataclass
class ToolCall:
    """One parsed ``<tool_call>`` block; ``error`` is set when it must not run.

    ``format`` is the form the block was written in: ``"json"`` or ``"xml"``.
    """
    name: str | None
    arguments: Any
    raw: str
    error: str | None = None
    format: str = "json"


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
    preload: bool = False
    auto_calls: int = 0
    max_tokens: int = DEFAULT_MAX_TOKENS

    def to_dict(self) -> dict:
        return {"ok": self.ok, "answer": self.answer, "stopReason": self.stop_reason, "error": self.error,
                "toolCalls": self.tool_calls, "autoToolCalls": self.auto_calls, "preload": self.preload,
                "maxTokens": self.max_tokens, "sources": self.sources, "trace": self.trace,
                "elapsedMs": self.elapsed_ms, "promptVersion": ASSISTANT_PROMPT_VERSION,
                "rulesVersion": RULES_VERSION, "tournamentRulesVersion": TOURNAMENT_RULES_VERSION}


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
    object ``arguments``, and nothing else, or one XML ``<function=NAME>``
    element (``_parse_xml_block``); the form is read per block, so one reply
    may mix them. An unclosed ``<tool_call>`` is a
    malformed call too, so a truncated call is reported, never half-run.
    """
    calls = []
    for match in TOOL_CALL_RE.finditer(text):
        calls.append(_parse_block(match.group(1)))
    rest = TOOL_CALL_RE.sub("", text)
    if "<tool_call>" in rest:
        rest, _, tail = rest.partition("<tool_call>")
        tail = tail.strip()
        form = "xml" if not tail.startswith("{") and XML_FUNCTION_OPEN_RE.search(tail) else "json"
        calls.append(ToolCall(None, None, tail, "unclosed <tool_call> block (output cut off?)", form))
    return calls, rest.replace("</tool_call>", "").strip()


def _parse_block(raw: str) -> ToolCall:
    raw = raw.strip()
    if not raw.startswith("{") and XML_FUNCTION_OPEN_RE.search(raw):
        return _parse_xml_block(raw)
    return _parse_json_block(raw)


def _parse_json_block(raw: str) -> ToolCall:
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


def _xml_error(raw: str, message: str, name: str | None = None, arguments: Any = None) -> ToolCall:
    return ToolCall(name, arguments, raw, message, "xml")


def _strip_template_newlines(text: str) -> str:
    """Drop the one newline the template writes after ``<parameter=K>`` and the one before ``</parameter>``."""
    if text.startswith("\n"):
        text = text[1:]
    if text.endswith("\n"):
        text = text[:-1]
    return text


def _parse_xml_block(raw: str) -> ToolCall:
    """One XML-form block (``raw`` already stripped): exactly one ``<function=NAME>`` element, nothing around it.

    Parameters are converted with the tool's own schema from ``TOOLS``, the way
    the chat template rendered them: a string-typed parameter is its raw text
    (less the template's one leading and one trailing newline); any other type
    is JSON. A value that does not parse, or parses to the wrong type, an
    unknown function or parameter, a repeated parameter and any text outside
    the elements are errors. Range, length, pattern and required-argument
    checks stay with ``call_tool``, exactly as for a JSON call.
    """
    opened = XML_FUNCTION_OPEN_RE.match(raw)
    if opened is None:
        return _xml_error(raw, "tool call has text before <function=...>")
    if not raw.endswith(XML_FUNCTION_CLOSE):
        return _xml_error(raw, "tool call must end with </function> and have nothing after it")
    name = opened.group(1)
    tool = TOOLS.get(name)
    if tool is None:
        return _xml_error(raw, f"unknown function {name!r}", name)
    props = tool.parameters.get("properties", {})
    body = raw[opened.end():len(raw) - len(XML_FUNCTION_CLOSE)]
    texts: dict[str, str] = {}
    pos = 0
    while True:
        while pos < len(body) and body[pos].isspace():
            pos += 1
        if pos == len(body):
            break
        param = XML_PARAMETER_OPEN_RE.match(body, pos)
        if param is None:
            return _xml_error(raw, f"unexpected text inside <function={name}>: {body[pos:pos + 40]!r}", name)
        key = param.group(1)
        end = body.find(XML_PARAMETER_CLOSE, param.end())
        if end < 0:
            return _xml_error(raw, f"<parameter={key}> is not closed", name)
        if key in texts:
            return _xml_error(raw, f"parameter {key!r} given twice", name)
        texts[key] = _strip_template_newlines(body[param.end():end])
        pos = end + len(XML_PARAMETER_CLOSE)
    arguments: dict[str, Any] = {}
    for key, text in texts.items():
        spec = props.get(key)
        if spec is None:
            allowed = ", ".join(props) or "none"
            return _xml_error(raw, f"unknown parameter {key!r} for {name} (allowed: {allowed})", name, texts)
        if spec.get("type") == "string":
            arguments[key] = text
            continue
        try:
            value = json.loads(text)
        except (ValueError, RecursionError) as exc:
            return _xml_error(raw, f"parameter {key!r} is not valid JSON for type {spec.get('type')}: {exc}",
                              name, texts)
        if validate_args({"properties": {key: {"type": spec["type"]}}}, {key: value}):
            return _xml_error(raw, f"parameter {key!r} must be of type {spec['type']}", name, texts)
        arguments[key] = value
    return ToolCall(name, arguments, raw, None, "xml")


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
            "tournament_rules_version": TOURNAMENT_RULES_VERSION, "sources": {k: [] for k in SOURCE_KEYS}}


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


def refused_message(max_tool_calls: int = MAX_TOOL_CALLS) -> str:
    return (f"Not run: this question has used all {max_tool_calls} tool calls. Answer from the tool results you "
            "already have.")


def _refused_step(call: ToolCall) -> dict:
    return {"kind": "tool", "tool": call.name, "arguments": call.arguments, "ok": False,
            "errorKind": "cap_exceeded", "summary": "not run: tool-call cap reached",
            "sources": {k: [] for k in SOURCE_KEYS}, "elapsedMs": 0.0}


# The prompt guard ---------------------------------------------------------------------------

CHARS_PER_TOKEN = 3.0  # a conservative estimate until the worker reports a real count (see PromptGuard)
DROPPED_NOTE = ("This earlier tool result ({chars} characters) was removed so the conversation fits the model's "
                "context. Call the tool again if you need it.")


def _message_chars(messages: list[dict], specs: list[dict]) -> int:
    """Characters of what the template renders: every message's content and tool calls, and the specs."""
    total = len(json.dumps(specs, ensure_ascii=False))
    for message in messages:
        total += len(message.get("content") or "") + 16  # role markers
        for call in message.get("tool_calls") or ():
            total += len(json.dumps(call, ensure_ascii=False))
    return total


class PromptGuard:
    """Keeps each model step's prompt under the worker's token cap by dropping the oldest tool results.

    ``limit`` is the cap (None: unknown, so only a worker refusal triggers
    dropping). The estimate is characters divided by a characters-per-token
    ratio: ``CHARS_PER_TOKEN`` (3.0, below what English prose and JSON
    tokenise to) until a model step reports ``promptTokens`` for a prompt of
    known size, then the smaller of the two. A refusal (``prompt_too_large``
    with the real ``promptTokens``) recalibrates the ratio from that exact
    count, takes the worker's ``maxPromptTokens`` as the limit when it gives
    one, and drops at least one more result.

    Only ``role: tool`` messages before the last assistant message are
    dropped, oldest first (the preload's results are the oldest); each keeps
    its place with a short note in place of its content, so the call it
    answers still has a result. The system prompt, the history, the question,
    the model's own messages and the latest tool results are never touched.
    """

    def __init__(self, limit: int | None, specs: list[dict]):
        self.limit = limit
        self.specs = specs
        self.ratio = CHARS_PER_TOKEN
        self.dropped: set[int] = set()  # message indices already replaced by a note (messages only grow)

    def estimate(self, messages: list[dict]) -> int:
        return math.ceil(_message_chars(messages, self.specs) / self.ratio)

    def observe(self, messages: list[dict], reply: dict) -> None:
        tokens = reply.get("promptTokens")
        if isinstance(tokens, int) and not isinstance(tokens, bool) and tokens > 0:
            self.ratio = min(self.ratio, _message_chars(messages, self.specs) / tokens)

    def _droppable(self, messages: list[dict]) -> list[int]:
        last_assistant = max((i for i, m in enumerate(messages) if m["role"] == "assistant"), default=-1)
        return [i for i, m in enumerate(messages[:last_assistant]) if m["role"] == "tool" and i not in self.dropped]

    def _drop(self, messages: list[dict], index: int) -> dict:
        message = messages[index]
        content = message["content"]
        try:
            tool = json.loads(content).get("tool")
        except (ValueError, AttributeError):
            tool = None
        self.dropped.add(index)
        messages[index] = {"role": "tool", "content": json.dumps(
            {"ok": False, "tool": tool, "error_kind": "dropped_for_context",
             "error": DROPPED_NOTE.format(chars=len(content))}, ensure_ascii=False, separators=(",", ":"))}
        return {"message": index, "tool": tool, "chars": len(content)}

    def _shrink(self, messages: list[dict], reason: str, at_least_one: bool) -> dict:
        before = self.estimate(messages)
        dropped = []
        for index in self._droppable(messages):
            over = self.limit is not None and self.estimate(messages) > self.limit
            if not over and (dropped or not at_least_one):
                break
            dropped.append(self._drop(messages, index))
        after = self.estimate(messages)
        fits = (self.limit is None or after <= self.limit) and (dropped or not at_least_one)
        return {"kind": "context", "ok": bool(fits), "action": "dropped" if dropped else "full", "reason": reason,
                "dropped": dropped, "estimatedTokens": before, "estimatedTokensAfter": after, "limit": self.limit}

    def fit(self, messages: list[dict]) -> dict | None:
        """A trace step when the estimate was over the cap (what was dropped), else None.

        The step is always ``ok``: the estimate is deliberately pessimistic, so
        a prompt still estimated over the cap with nothing left to drop
        (``action: "kept"``) goes to the worker anyway, whose exact count
        decides; only its refusal with nothing left to drop ends the turn.
        """
        if self.limit is None or self.estimate(messages) <= self.limit:
            return None
        step = self._shrink(messages, "estimate", at_least_one=False)
        return {**step, "ok": True, "action": "dropped" if step["dropped"] else "kept"}

    def refused(self, messages: list[dict], reply: dict) -> dict:
        tokens, limit = reply.get("promptTokens"), reply.get("maxPromptTokens")
        if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0:
            self.limit = limit
        if isinstance(tokens, int) and not isinstance(tokens, bool) and tokens > 0:
            self.ratio = min(self.ratio, _message_chars(messages, self.specs) / tokens)
        return self._shrink(messages, "worker_refused", at_least_one=True)


DECK_CONTEXT_OPEN, DECK_CONTEXT_CLOSE = "<loaded_deck>", "</loaded_deck>"


def deck_context(deck: dict) -> str:
    """The loaded deck as a labelled block: one JSON object whose ``deck`` value goes straight into deck tools."""
    payload = json.dumps({"deck": deck}, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return ("Loaded deck: the user loaded this deck in the deck panel for this chat. It may or may not be what "
            "the question is about.\n"
            f"{DECK_CONTEXT_OPEN}\n{payload}\n{DECK_CONTEXT_CLOSE}\n"
            "To use it, pass the value of \"deck\" above unchanged as the deck argument of check_deck, "
            "deck_profile, similar_decks or archetype_of. It holds card slugs and quantities only; card facts "
            "still come from get_card.")


def build_messages(history: list[dict], user_message: str, deck: dict | None = None, *,
                   max_tool_calls: int = MAX_TOOL_CALLS) -> list[dict]:
    prompt = system_prompt(max_tool_calls)
    system = prompt if deck is None else f"{prompt}\n\n{deck_context(deck)}"
    return [{"role": "system", "content": system}, *history, {"role": "user", "content": user_message}]


async def run_turn(history: list[dict], user_message: str, model: ChatModel, *,
                   max_tool_calls: int = MAX_TOOL_CALLS, max_tokens: int | None = None,
                   enable_thinking: bool = DEFAULT_THINKING, deck: dict | None = None,
                   preload: bool = DEFAULT_PRELOAD, preload_text: str | None = None,
                   preload_k: int = DEFAULT_PRELOAD_K, preload_chars: int = DEFAULT_PRELOAD_CHARS,
                   max_prompt_tokens: int | None = None) -> TurnResult:
    """Run one user turn to an answer, an error or the tool-call cap. ``history`` is not modified.

    ``deck`` is the session's loaded deck (see ``deck_context``), or None.
    ``max_tokens`` defaults by thinking (``default_max_tokens``). ``preload``
    runs the automatic context step on ``preload_text`` (default: the message).
    ``max_prompt_tokens`` is the prompt cap the guard keeps to (default: the
    model's ``prompt_token_limit(max_tokens)`` when it has one; see ``PromptGuard``).
    """
    started = time.monotonic()
    max_tokens = default_max_tokens(enable_thinking) if max_tokens is None else max_tokens
    messages = build_messages(history, user_message, deck, max_tool_calls=max_tool_calls)
    specs = tool_specs()
    turn = TurnResult(ok=False, answer="", stop_reason="", preload=preload, max_tokens=max_tokens)
    step = 0

    def add(entry: dict):
        nonlocal step
        step += 1
        turn.trace.append({"step": step, **entry})

    def collect(sources: dict):
        for key in SOURCE_KEYS:
            for value in sources.get(key) or []:
                if value not in turn.sources[key]:
                    turn.sources[key].append(value)

    if preload:
        auto = run_preload(user_message if preload_text is None else preload_text, k=preload_k,
                           budget=preload_chars)
        sent = [a for a in auto if a.sent]
        if sent:
            messages.append({"role": "assistant", "content": "", "tool_calls": [
                {"type": "function", "function": {"name": a.tool, "arguments": a.arguments}} for a in sent]})
            messages.extend({"role": "tool", "content": a.content} for a in sent)
        for a in auto:
            turn.auto_calls += 1
            collect(a.sources)
            result = a.result
            entry = {"kind": "tool", "auto": True, "tool": a.tool, "arguments": a.arguments,
                     "ok": bool(result.get("ok")), "errorKind": result.get("error_kind"), "error": result.get("error"),
                     "summary": summarize_result(result), "sources": a.sources, "link": a.link, "sent": a.sent,
                     "contextChars": len(a.content or ""), "contextNote": a.note,
                     "result": result.get("result") if result.get("ok") else None, "elapsedMs": a.elapsed_ms}
            if a.implied is not None:  # an implied-rule step: what in the data connects it
                entry["implied"] = a.implied
            add(entry)

    if max_prompt_tokens is None:
        limit_of = getattr(model, "prompt_token_limit", None)
        max_prompt_tokens = limit_of(max_tokens) if callable(limit_of) else None
    guard = PromptGuard(max_prompt_tokens, specs)

    def context_full(estimate: int | None):
        known = f"about {estimate} tokens" if estimate else "the prompt"
        limit = f" of a {guard.limit}-token limit" if guard.limit else ""
        turn.stop_reason = "context_full"
        turn.answer = (f"Stopped: the conversation no longer fits the model's context ({known}{limit}) even with "
                       "every earlier tool result removed, so this turn has no answer. The tool results so far are "
                       "in the trace. Try a narrower question.")

    while True:
        fitted = guard.fit(messages)
        if fitted is not None:
            add(fitted)
        reply = await model.generate(messages, specs, max_tokens=max_tokens, enable_thinking=enable_thinking)
        if isinstance(reply, dict) and reply.get("error") == "prompt_too_large":
            # The worker counted the real prompt and refused it: learn its size, drop more, ask again.
            add({"kind": "model", "ok": False, "error": "prompt_too_large", "promptTokens": reply.get("promptTokens"),
                 "maxPromptTokens": reply.get("maxPromptTokens")})
            refit = guard.refused(messages, reply)
            add(refit)
            if not refit["ok"]:
                context_full(reply.get("promptTokens") if isinstance(reply.get("promptTokens"), int) else None)
                break
            continue
        if not isinstance(reply, dict) or reply.get("ok") is not True or not isinstance(reply.get("text"), str):
            error = reply.get("error", "model_error") if isinstance(reply, dict) else "model_error"
            add({"kind": "model", "ok": False, "error": error})
            turn.stop_reason, turn.error = "model_error", str(error)
            turn.answer = f"The local model failed ({error}); no answer."
            break
        guard.observe(messages, reply)
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
        remaining = max_tool_calls - turn.tool_calls
        if remaining <= 0:
            for call in calls:
                add(_refused_step(call))
            turn.stop_reason, turn.answer = "tool_cap", cap_message(max_tool_calls)
            break
        messages.append(_assistant_message(content, calls))
        for position, call in enumerate(calls):
            if position >= remaining:
                # Past the cap: the calls that fit ran, in order; this one is refused and the model told so.
                add(_refused_step(call))
                messages.append({"role": "tool", "content": json.dumps(
                    _tool_error(call.name, "cap_exceeded", refused_message(max_tool_calls)),
                    ensure_ascii=False, separators=(",", ":"))})
                continue
            turn.tool_calls += 1
            tool_started = time.monotonic()
            if call.error is not None:
                hint = XML_CALL_HINT if call.format == "xml" else JSON_CALL_HINT
                result = _tool_error(call.name, "malformed_tool_call",
                                     f"{call.error}. Write {hint} with one of: {', '.join(TOOLS)}.")
            else:
                result = call_tool(call.name, call.arguments)  # validates; unknown or bad args never run
            elapsed = round((time.monotonic() - tool_started) * 1000, 2)
            sources = result.get("sources") or {}
            if result.get("ok"):
                collect(sources)
            entry = {"kind": "tool", "tool": call.name, "arguments": call.arguments, "ok": bool(result.get("ok")),
                     "errorKind": result.get("error_kind"), "error": result.get("error"),
                     "summary": summarize_result(result),
                     "sources": {k: list(sources.get(k) or []) for k in SOURCE_KEYS},
                     "result": result.get("result") if result.get("ok") else None, "elapsedMs": elapsed}
            if call.format != "json":  # optional: absent for JSON calls, so their traces are unchanged
                entry["callFormat"] = call.format
            add(entry)
            messages.append({"role": "tool", "content": json.dumps(result, ensure_ascii=False,
                                                                   separators=(",", ":"))})
    turn.elapsed_ms = round((time.monotonic() - started) * 1000, 2)
    return turn
