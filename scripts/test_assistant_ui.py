#!/usr/bin/env python3
"""Tests for the local assistant page's chat UI: escaping, the deck panel, sessions, status and the trace.

Why: the page shows text written by a model and by tools whose data came from
outside (card text, deck names, pasted lists). One unescaped sink would let any
of it run script on a loopback page that can call every tool. The deck panel
hands a deck to the model with every question, so loading, replacing and
clearing it must change exactly what the model is sent, and nothing else. The
example chips are suggestions only; no code may branch on them. Everything here
uses a scripted fake model (no mlx, no weights, no network) on the committed
snapshot, FastAPI's TestClient, and node to run the page's DOM-free helpers.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from games.cyberpunk.assistant import tools
from games.cyberpunk.assistant.decks import public_deck_index
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, DECK_CONTEXT_CLOSE, DECK_CONTEXT_OPEN,
                                            MAX_TOOL_CALLS, SYSTEM_PROMPT, build_messages, run_turn)
from games.cyberpunk.assistant_app import (ASSISTANT_HTML, EXAMPLE_QUESTIONS, ChatService, build_assistant_app)
from games.cyberpunk.prompts import RULES_VERSION

LOCAL = {"host": "127.0.0.1:8767"}
CTX: dict = {}
HOSTILE = ['<img src=x onerror="alert(1)">', "<script>alert(1)</script>", "**<b onmouseover=x>bold</b>**",
           "`<svg/onload=alert(1)>`", "- <a href='javascript:x'>l</a>\n- ok", "1. </li><iframe>\n2. x",
           "a & b \" ' > <", "``<img>``", "`unclosed <img>", "**`<x>`**", "<<script>script>"]
ALLOWED_TAGS = re.compile(r"</?(p|ul|ol|li|strong|code)>|<br>")


def call(name: str, **arguments) -> str:
    return f'<tool_call>\n{json.dumps({"name": name, "arguments": arguments})}\n</tool_call>'


class ScriptedModel:
    """Returns scripted texts in order (a callable gets the messages) and records what it was sent."""

    def __init__(self, texts, *, finish="stop"):
        self.texts = list(texts)
        self.finish = finish
        self.seen: list[list[dict]] = []
        self.thinking: list[bool] = []

    async def generate(self, messages, tools_, *, max_tokens, enable_thinking):
        self.seen.append(copy.deepcopy(messages))
        self.thinking.append(enable_thinking)
        if not self.texts:
            raise AssertionError("the loop asked the model more often than scripted")
        text = self.texts.pop(0)
        if callable(text):
            text = text(messages)
        return {"ok": True, "text": text, "finishReason": self.finish, "promptTokens": 100,
                "generationTokens": 10, "elapsedMs": 5.0}


def loaded_deck_from(messages: list[dict]) -> dict:
    """What a model does with the deck block: read the JSON between the markers and take its deck."""
    system = messages[0]["content"]
    block = system.split(DECK_CONTEXT_OPEN, 1)[1].split(DECK_CONTEXT_CLOSE, 1)[0]
    return json.loads(block)["deck"]


def page_script() -> str:
    blocks = re.findall(r"<script>(.*?)</script>", ASSISTANT_HTML, re.S)
    assert len(blocks) == 1, "the assistant page lost its script block"
    return blocks[0]


def run_pure(expression: str, payload) -> object:
    """Evaluate ``expression`` (with ``input`` bound to payload) against the page's DOM-free helpers."""
    script = page_script()
    pure = script[script.index("// pure:start"):script.index("// pure:end")]
    program = (f'"use strict";\n{pure}\nconst input = JSON.parse(require("fs").readFileSync(0, "utf8"));\n'
               f"process.stdout.write(JSON.stringify({expression}));\n")
    proc = subprocess.run([CTX["node"], "-e", program], input=json.dumps(payload), capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[:800]
    return json.loads(proc.stdout)


def client_for(model=None, **kwargs) -> TestClient:
    """A page over ``model``; the preload is off unless a test asks for it, so turns hold only scripted steps."""
    kwargs.setdefault("preload", False)
    return TestClient(build_assistant_app(chat=ChatService(model, **kwargs)))


# The page ----------------------------------------------------------------------------------


def test_page_is_self_contained_and_its_script_parses():
    with client_for() as client:
        response = client.get("/", headers=LOCAL)
    assert response.status_code == 200 and response.text == ASSISTANT_HTML
    assert not re.search(r"""(src|href)\s*=\s*["']?(https?:)?//""", ASSISTANT_HTML)
    assert "<script src" not in ASSISTANT_HTML and "@import" not in ASSISTANT_HTML and "<link" not in ASSISTANT_HTML
    proc = subprocess.run([CTX["node"], "-e", "new Function(require('fs').readFileSync(0, 'utf8'))"],
                          input=page_script(), capture_output=True, text=True)
    assert proc.returncode == 0, f"assistant page script does not parse:\n{proc.stderr[:600]}"
    for needle in ('id="tabChat"', 'id="tabTools"', 'id="modelBadge"', 'id="snapshot"', 'id="thinkToggle"',
                   'id="chatNew"', 'id="deckPick"', 'id="deckClear"', 'id="sideBody"', "__EXAMPLES__"):
        assert (needle in ASSISTANT_HTML) is (needle != "__EXAMPLES__"), needle
    assert ASSISTANT_HTML.index('id="tabTools" hidden') > 0, "the Chat tab is the default"


def test_no_unescaped_html_sinks():
    script = page_script()
    sinks = re.findall(r"\.innerHTML\s*=\s*(.*)", script)
    assert sinks == ['mdToHtml(data.answer || data.error || "No answer.");'], sinks
    for banned in ("outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "srcdoc",
                   "javascript:"):
        assert banned not in script, banned


def test_markdown_subset_escapes_hostile_answers_and_tool_text():
    rendered = run_pure("input.map(mdToHtml)", HOSTILE)
    for source, html in zip(HOSTILE, rendered):
        leftover = ALLOWED_TAGS.sub("", html)
        assert "<" not in leftover and ">" not in leftover, (source, html)
    assert rendered[0] == "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>"
    assert rendered[2] == "<p><strong>&lt;b onmouseover=x&gt;bold&lt;/b&gt;</strong></p>"
    assert rendered[3] == "<p><code>&lt;svg/onload=alert(1)&gt;</code></p>"
    assert rendered[8] == "<p>`unclosed &lt;img&gt;</p>"
    subset = run_pure("mdToHtml(input)", "Intro line\n- **a**\n- `b`\n\n1. one\n2. two\n\nlast\nline")
    assert subset == ("<p>Intro line</p><ul><li><strong>a</strong></li><li><code>b</code></li></ul>"
                      "<ol><li>one</li><li>two</li></ol><p>last<br>line</p>")
    # A tool result carrying markup (card text, a deck name) is shown as text: the trace line is
    # plain text for textContent, and the answer path escapes it too.
    step = {"kind": "tool", "tool": "get_card", "ok": True, "summary": HOSTILE[0], "elapsedMs": 1.4,
            "result": {"card": {"text": HOSTILE[1]}}}
    line, html = run_pure("[stepLine(input), mdToHtml(JSON.stringify(input.result))]", step)
    assert line == f"get_card · ok · {HOSTILE[0]} · 1 ms"
    assert "<script>" not in html and "&lt;script&gt;" in html
    script = page_script()
    for helper in ("function traceRow", "function jsonPre", "function factsList", "function renderDeck",
                   "function sourceButtons", "function showSource"):
        body = script[script.index(helper):]
        body = body[:body.index("\n}\n")]
        assert "innerHTML" not in body, helper


# Status, sessions, thinking ----------------------------------------------------------------


def test_status_reports_snapshot_and_model_state():
    with client_for() as client:
        body = client.get("/api/status", headers=LOCAL).json()
    assert body["rulesVersion"] == RULES_VERSION and body["cardCount"] == len(tools.cards()) > 0
    assert body["tournamentRulesVersion"] == "2026-10-28"
    # The page's snapshot badge names both documents' dates.
    assert '"snapshot " + data.rulesVersion + " · tournament rules " + data.tournamentRulesVersion' in ASSISTANT_HTML
    assert body["promptVersion"] == ASSISTANT_PROMPT_VERSION and body["maxToolCalls"] == MAX_TOOL_CALLS
    assert body["model"]["configured"] is False and body["model"]["state"] == "none"

    class Broken:
        label = "broken"

        async def generate(self, *a, **k):
            return {"ok": False, "error": "worker_startup_failed"}

    with client_for(ScriptedModel(["Hi."])) as client:
        assert client.get("/api/status", headers=LOCAL).json()["model"]["state"] == "idle"
        client.post("/api/chat", json={"session": "s", "message": "hi"}, headers=LOCAL)
        assert client.get("/api/status", headers=LOCAL).json()["model"]["state"] == "ready"
    with client_for(Broken()) as client:
        client.post("/api/chat", json={"session": "s", "message": "hi"}, headers=LOCAL)
        model = client.get("/api/status", headers=LOCAL).json()["model"]
        assert model == {"configured": True, "label": "broken", "state": "error", "lastError": "worker_startup_failed",
                         "busy": False, "thinkingDefault": True, "preloadDefault": False, "maxTokens": None}


def test_new_chat_clears_history_but_keeps_the_deck():
    model = ScriptedModel(["One.", "Two.", "Three."])
    deck_id = public_deck_index()[0]["id"]
    with client_for(model) as client:
        assert client.post("/api/deck", json={"session": "s", "deck_id": deck_id}, headers=LOCAL).json()["loaded"]
        client.post("/api/chat", json={"session": "s", "message": "first"}, headers=LOCAL)
        second = client.post("/api/chat", json={"session": "s", "message": "second"}, headers=LOCAL).json()
        assert second["historyMessages"] == 4 and [m["role"] for m in model.seen[-1]][1:] == [
            "user", "assistant", "user"]
        reset = client.post("/api/chat/reset", json={"session": "s"}, headers=LOCAL).json()
        assert reset["ok"] and reset["historyMessages"] == 0 and reset["deck"]["legends"] == 3
        third = client.post("/api/chat", json={"session": "s", "message": "third"}, headers=LOCAL).json()
        assert [m["role"] for m in model.seen[-1]] == ["system", "user"] and third["historyMessages"] == 2
        assert DECK_CONTEXT_OPEN in model.seen[-1][0]["content"], "a new chat must not drop the loaded deck"
        assert client.post("/api/chat/reset", json={"session": "../x"}, headers=LOCAL).status_code == 400


def test_thinking_toggle_passes_through():
    model = ScriptedModel(["a", "b", "c"])
    with client_for(model, enable_thinking=True) as client:
        default = client.post("/api/chat", json={"session": "s", "message": "q"}, headers=LOCAL).json()
        off = client.post("/api/chat", json={"session": "s", "message": "q", "thinking": False}, headers=LOCAL).json()
        on = client.post("/api/chat", json={"session": "s", "message": "q", "thinking": True}, headers=LOCAL).json()
        bad = client.post("/api/chat", json={"session": "s", "message": "q", "thinking": "yes"}, headers=LOCAL)
        assert client.get("/api/status", headers=LOCAL).json()["model"]["thinkingDefault"] is True
    assert model.thinking == [True, False, True] and [default["thinking"], off["thinking"], on["thinking"]] == [
        True, False, True]
    assert bad.status_code == 400 and bad.json()["error_kind"] == "invalid_arguments"


def test_preload_toggle_reaches_the_route_and_auto_steps_show_distinctly():
    model = ScriptedModel(["a", "b", "c"])
    with client_for(model, preload=True) as client:
        assert client.get("/api/status", headers=LOCAL).json()["model"]["preloadDefault"] is True
        on = client.post("/api/chat", json={"session": "s", "message": "Is Sketchy Ripper a Unit?"},
                         headers=LOCAL).json()
        off = client.post("/api/chat", json={"session": "t", "message": "Is Sketchy Ripper a Unit?",
                                             "preload": False}, headers=LOCAL).json()
        bad = client.post("/api/chat", json={"session": "s", "message": "q", "preload": "no"}, headers=LOCAL)
        # A foreign Host is refused before any tool or the model runs, whatever the payload asks for.
        foreign = client.post("/api/chat", json={"session": "s", "message": "Sketchy Ripper", "preload": True},
                              headers={"host": "evil.example:8767"})
    assert bad.status_code == 400 and bad.json()["error_kind"] == "invalid_arguments"
    assert foreign.status_code == 403 and len(model.seen) == 2
    auto = [s for s in on["trace"] if s.get("auto")]
    implied = [s for s in auto if "implied" in s]
    assert on["preload"] is True and on["autoToolCalls"] == len(auto) and [s["tool"] for s in auto] == [
        "search_rules", "get_card"] + ["get_rule"] * len(implied)
    assert implied and on["trace"][:len(auto)] == auto and [m["role"] for m in model.seen[0]][:4] == ["system", "user", "assistant",
                                                                                   "tool"]
    assert off["preload"] is False and off["autoToolCalls"] == 0 and [m["role"] for m in model.seen[1]] == [
        "system", "user"]
    lines = run_pure("input.map(stepLine)", auto)
    assert lines[1].startswith("get_card · ok · linked \u201cSketchy Ripper\u201d · sent ") and " chars · " in lines[1]
    assert lines[0].startswith("search_rules · ok · sent "), lines
    # An implied-rule step says what in the data connects it (a Unit card's type: the Units rules).
    assert any(line.startswith("get_rule · ok · implied (card type of Unit) · ") for line in lines[2:]), lines
    script = page_script()
    assert 'preload: $("preloadToggle").checked' in script and '$("preloadToggle").checked = m.preloadDefault' in script
    assert '(step.auto ? " auto" : "")' in script and "details.step.auto" in ASSISTANT_HTML
    for needle in ('id="preloadToggle"', 'id="evalPreload"', 'id="thinkToggle"', 'id="evalThinking"'):
        assert ASSISTANT_HTML.count(needle) == 1, needle
    assert 'preload: $("evalPreload").checked' in script


# Deck panel --------------------------------------------------------------------------------


def test_deck_panel_flow_reaches_the_model_and_clears():
    first = public_deck_index()[0]
    expected = tools.call_tool("parse_deck", {"deck_id": first["id"]})["result"]["deck"]
    model = ScriptedModel([lambda messages: call("check_deck", deck=loaded_deck_from(messages)),
                           "Legal, per check_deck.", "No deck now."])
    with client_for(model) as client:
        loaded = client.post("/api/deck", json={"session": "s", "deck_id": first["id"]}, headers=LOCAL)
        assert loaded.status_code == 200, loaded.text
        body = loaded.json()
        assert body["ok"] and body["loaded"] and body["parse"]["result"]["deck"] == expected
        assert body["check"]["ok"] and body["check"]["result"]["legal"] is True
        assert body["profile"]["ok"] and body["profile"]["result"]["counts"]["legends"] == 3
        assert body["deck"] == {"name": first["name"], "format": first["format"], "legends": 3,
                                "deck": first["card_count"] - 3, "source": "public_deck"}
        # The next turn's model input carries the deck, and the model can pass it straight into a deck tool.
        answer = client.post("/api/chat", json={"session": "s", "message": "Is it legal?"}, headers=LOCAL).json()
        system = model.seen[0][0]["content"]
        assert system.startswith(SYSTEM_PROMPT) and system.count(DECK_CONTEXT_OPEN) == 1
        assert loaded_deck_from(model.seen[0]) == expected
        assert all(DECK_CONTEXT_OPEN not in m["content"] for m in model.seen[0][1:]), "the deck is not a question"
        step = [s for s in answer["trace"] if s["kind"] == "tool"][0]
        assert step["tool"] == "check_deck" and step["ok"] and step["result"]["legal"] is True
        assert step["result"] == tools.call_tool("check_deck", {"deck": expected})["result"]
        assert answer["deckInContext"]["name"] == first["name"]
        # An unresolved paste is reported with candidates and leaves the held deck alone.
        partial = client.post("/api/deck", json={"session": "s", "text": "Legends\n1 V\n3 No Such Card"},
                              headers=LOCAL).json()
        assert partial["ok"] and partial["loaded"] is False and partial["check"] is None
        statuses = {u["name"]: u for u in partial["parse"]["result"]["unresolved"]}
        assert statuses["V"]["status"] == "ambiguous" and len(statuses["V"]["candidates"]) == 3
        assert statuses["No Such Card"]["status"] == "unknown" and partial["deck"]["name"] == first["name"]
        # Clearing removes it from later turns.
        cleared = client.post("/api/deck/clear", json={"session": "s"}, headers=LOCAL).json()
        assert cleared == {"ok": True, "session": "s", "deck": None}
        later = client.post("/api/chat", json={"session": "s", "message": "And now?"}, headers=LOCAL).json()
        assert model.seen[-1][0] == {"role": "system", "content": SYSTEM_PROMPT}
        assert DECK_CONTEXT_OPEN not in json.dumps(model.seen[-1]) and later["deckInContext"] is None
        # Decks are per session.
        other = client.post("/api/deck", json={"session": "t", "deck_id": first["id"]}, headers=LOCAL).json()
        assert other["loaded"] and other["deck"]["name"] == first["name"]
        for bad, code in (({"session": "s", "text": "1 V", "deck_id": first["id"]}, 400),
                          ({"session": "s", "deck": expected}, 400), ({"session": "s"}, 400),
                          ({"session": "s", "deck_id": "00000000-0000-0000-0000-000000000000"}, 404),
                          ({"text": "1 V"}, 400)):
            response = client.post("/api/deck", json=bad, headers=LOCAL)
            assert response.status_code == code and response.json()["ok"] is False, (bad, response.text)


def test_deck_context_is_structured_and_absent_without_a_deck():
    deck = tools.call_tool("parse_deck", {"text": "Legends\n1 V: Streetkid"})["result"]["deck"]
    assert build_messages([], "q")[0] == {"role": "system", "content": SYSTEM_PROMPT}
    messages = build_messages([{"role": "user", "content": "earlier"}], "q", deck)
    assert [m["role"] for m in messages] == ["system", "user", "user"] and messages[-1]["content"] == "q"
    assert loaded_deck_from(messages) == deck and "deck argument" in messages[0]["content"]
    assert ASSISTANT_PROMPT_VERSION == "assistant-chat-v6"


# Trace and sources -------------------------------------------------------------------------


def test_trace_marks_the_cap_and_the_token_limit():
    class Looping:
        async def generate(self, *a, **k):
            return {"ok": True, "text": call("find_card", query="V"), "finishReason": "stop"}

    with client_for(Looping()) as client:
        capped = client.post("/api/chat", json={"session": "s", "message": "loop"}, headers=LOCAL).json()
    assert capped["stopReason"] == "tool_cap" and capped["toolCalls"] == MAX_TOOL_CALLS
    assert [s for s in capped["trace"] if s["kind"] == "tool"][-1]["errorKind"] == "cap_exceeded"
    with client_for(ScriptedModel(["A long answer"], finish="length")) as client:
        cut = client.post("/api/chat", json={"session": "s", "message": "q"}, headers=LOCAL).json()
    flags = run_pure("input.map((d) => answerFlags(d, 6))", [capped, cut])
    assert flags == [["hit the tool-call cap (6 calls)"], ["hit the token limit"]], flags
    lines = run_pure("input.trace.map(stepLine)", capped)
    assert lines[0].startswith("model · ok · ? tokens · asked for 1 tool call(s)")
    assert lines[-1] == "find_card · cap_exceeded · not run: tool-call cap reached · 0 ms"
    # The prompt guard's steps and stop show as such, never as a tool.
    full = {"stopReason": "context_full", "trace": [
        {"kind": "context", "ok": True, "action": "dropped", "dropped": [{"message": 3}, {"message": 4}],
         "estimatedTokens": 900, "estimatedTokensAfter": 700, "limit": 800},
        {"kind": "context", "ok": True, "action": "kept", "dropped": [], "estimatedTokens": 900, "limit": 800},
        {"kind": "context", "ok": False, "action": "full", "dropped": [], "estimatedTokens": 900, "limit": 800}]}
    assert run_pure("answerFlags(input, 6)", full) == ["ran out of model context"]
    assert run_pure("input.trace.map(stepLine)", full) == [
        "context · dropped 2 earlier tool result(s) · about 900 -> 700 tokens, limit 800",
        "context · over the estimate, nothing to drop; the worker decides · about 900 tokens, limit 800",
        "context · full · about 900 tokens, limit 800"]


def test_source_slug_click_returns_card_facts():
    model = ScriptedModel([call("find_card", query="V: Streetkid"), call("get_rule", rule_id="9.2"),
                           "`v-streetkid`, rule 9.2."])
    with client_for(model) as client:
        answer = client.post("/api/chat", json={"session": "s", "message": "q"}, headers=LOCAL).json()
        assert answer["sources"]["card_slugs"] == ["v-streetkid"] and "9.2" in answer["sources"]["rule_ids"]
        # What a click on the slug posts: the tool route, never the model.
        facts = client.post("/api/tools/get_card", json={"slug": "v-streetkid"}, headers=LOCAL)
        assert facts.status_code == 200 and facts.json() == tools.get_card("v-streetkid")
        assert facts.json()["result"]["card"]["display_name"] == "V: Streetkid"
        rule = client.post("/api/tools/get_rule", json={"rule_id": "9.2"}, headers=LOCAL).json()
        assert rule["ok"] and rule["result"]["rule"]["id"] == "9.2"
    assert len(model.seen) == 3, "a source click reached the model"
    script = page_script()
    assert 'showSource("get_card", {slug}, slug)' in script and 'postJson("/api/tools/" + encodeURIComponent(tool)' in script


# Example chips and the guard ---------------------------------------------------------------


def test_example_chips_are_suggestions_only():
    assert [label for label, _ in EXAMPLE_QUESTIONS] == ["Rules", "Deckbuilding", "Matchup", "Combo"]
    loop_source = (REPO_ROOT / "games/cyberpunk/assistant/loop.py").read_text(encoding="utf-8")
    app_source = (REPO_ROOT / "games/cyberpunk/assistant_app.py").read_text(encoding="utf-8")
    app_python = app_source[:app_source.index('ASSISTANT_HTML = r"""')]
    for _, question in EXAMPLE_QUESTIONS:
        assert question not in loop_source and app_python.count(question) == 1, question
        assert f'data-example="{question}"' in ASSISTANT_HTML
    # Named only in __all__, its definition and the HTML render: no route or helper reads it.
    assert app_source.count("EXAMPLE_QUESTIONS") == 3 and "EXAMPLE_QUESTIONS" not in loop_source
    # The script only copies a chip into the input box.
    script = page_script()
    wiring = script[script.index('document.querySelectorAll("#chips button")'):]
    wiring = wiring[:wiring.index("\n}\n")]
    assert "sendChat" not in wiring and "fetch" not in wiring and '$("chatInput").value = chip.dataset.example' in wiring
    traces = []
    for _, question in EXAMPLE_QUESTIONS:
        result = asyncio.run(run_turn([], question, ScriptedModel([call("find_card", query="V"), "Done."])))
        # The automatic steps search and link the question's own text; everything after them must not depend on it.
        traces.append([{k: v for k, v in s.items() if k not in ("elapsedMs", "step")} for s in result.trace
                       if not s.get("auto")])
    assert all(t == traces[0] for t in traces)


def test_host_check_applies_to_the_new_routes():
    model = ScriptedModel([])
    with client_for(model) as client:
        for method, path, body in (("get", "/api/status", None), ("post", "/api/chat/reset", {"session": "s"}),
                                   ("post", "/api/deck", {"session": "s", "text": "1 V"}),
                                   ("post", "/api/deck/clear", {"session": "s"}), ("get", "/", None)):
            send = getattr(client, method)
            kwargs = {"json": body} if body is not None else {}
            for host in ("evil.example:8767", "192.168.1.5:8767", ""):
                assert send(path, headers={"host": host}, **kwargs).status_code == 403, (path, host)
            cross = send(path, headers={**LOCAL, "origin": "http://evil.example"}, **kwargs)
            assert cross.status_code == 403, path
            assert send(path, headers=LOCAL, **kwargs).status_code == 200, path
    assert model.seen == []
    with TestClient(build_assistant_app(token="sekret", lan=True)) as guarded:
        assert guarded.get("/api/status").status_code == 401
        assert guarded.post("/api/deck", json={"session": "s", "text": "1 V"}).status_code == 401


def run(node: str) -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["node"] = node
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS assistant UI: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    run(args.node)


if __name__ == "__main__":
    main()
