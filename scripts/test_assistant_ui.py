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
from games.cyberpunk.assistant_app import (ASSISTANT_HTML, EXAMPLE_QUESTIONS, SESSION_RE, ChatService,
                                           build_assistant_app)
from games.cyberpunk.assistant_ui import UI_DIR, assemble_page
from games.cyberpunk.assistant_ui.card_view import MAX_BATCH, card_tile, text_segments
from games.cyberpunk.markup import to_plain_text
from games.cyberpunk.prompts import RULES_VERSION, TOURNAMENT_RULES_VERSION

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


def test_page_is_assembled_from_its_files_with_one_style_and_one_script():
    assert assemble_page(EXAMPLE_QUESTIONS) == ASSISTANT_HTML
    assert len(re.findall(r"<style>(.*?)</style>", ASSISTANT_HTML, re.S)) == 1
    assert ASSISTANT_HTML.count("<style") == 1 and ASSISTANT_HTML.count("<script") == 1
    for placeholder in ("__STYLE__", "__SCRIPT__", "__EXAMPLES__"):
        assert placeholder not in ASSISTANT_HTML, placeholder
    style = re.findall(r"<style>(.*?)</style>", ASSISTANT_HTML, re.S)[0]
    assert style == "\n" + (UI_DIR / "assistant.css").read_text(encoding="utf-8")
    assert page_script() == "\n" + (UI_DIR / "assistant.js").read_text(encoding="utf-8")


def test_theme_tokens_toggle_and_live_regions():
    style = re.findall(r"<style>(.*?)</style>", ASSISTANT_HTML, re.S)[0]
    # The project's cyberpunk palette is the default (dark) theme: acid accent, cyan labels.
    root = style[style.index(":root{"):]
    root = root[:root.index("}")]
    for token in ("--bg:#080b0d", "--panel:#11171a", "--line:#263238", "--ink:#f2f5f2", "--muted:#9aa8a2",
                  "--acid:#d8ff2f", "--accent:#d8ff2f", "--cyan:#47e8ff", "--warn:#ff6978"):
        assert token in root, token
    # The light variant: an explicit choice, or the system setting when nothing explicit is set.
    assert ':root[data-theme="light"]{' in style
    assert '@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){' in style
    assert ":focus-visible{outline:2px solid var(--accent)" in style
    assert ASSISTANT_HTML.count('id="themeToggle"') == 1
    toggle = ASSISTANT_HTML[ASSISTANT_HTML.index('id="themeToggle"') - 40:]
    assert toggle.index("<button") < toggle.index('id="themeToggle"') and 'type="button"' in toggle[:120]
    script = page_script()
    assert '$("themeToggle").addEventListener("click"' in script
    assert 'document.documentElement.setAttribute("data-theme", next)' in script
    # Storage is a convenience: every access is inside a try, and the page works without it.
    for access in ("localStorage.getItem(THEME_KEY)", "localStorage.setItem(THEME_KEY, next)"):
        assert script.count(access) == 1, access
        line = script[script.rindex("\n", 0, script.index(access)):script.index(access)]
        assert "try {" in line, access
    assert script.count("localStorage") == 2
    for element in ('<div id="chatLog" role="log" aria-live="polite">',
                    '<div class="status" id="chatStatus" role="status" aria-live="polite">'):
        assert ASSISTANT_HTML.count(element) == 1, element


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
    # The page shows the date the app reads from prompts.py, so a snapshot refresh needs no edit here.
    assert body["tournamentRulesVersion"] == TOURNAMENT_RULES_VERSION
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", TOURNAMENT_RULES_VERSION), TOURNAMENT_RULES_VERSION
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
    assert ASSISTANT_PROMPT_VERSION == "assistant-chat-v7"


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
    # The page's files hold a placeholder, never the questions or their name: assemble_page renders
    # whatever the app passes it.
    ui_source = "".join(f.read_text(encoding="utf-8") for f in sorted(UI_DIR.iterdir()) if f.is_file())
    assert "__EXAMPLES__" in ui_source and "EXAMPLE_QUESTIONS" not in ui_source
    for _, question in EXAMPLE_QUESTIONS:
        assert question not in loop_source and app_source.count(question) == 1, question
        assert question not in ui_source, question
        assert f'data-example="{question}"' in ASSISTANT_HTML
    # Named only in __all__, its definition and the HTML render: no route or helper reads it.
    assert app_source.count("EXAMPLE_QUESTIONS") == 3 and "EXAMPLE_QUESTIONS" not in loop_source
    assert "ASSISTANT_HTML = assemble_page(EXAMPLE_QUESTIONS)" in app_source
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


# Card tiles ---------------------------------------------------------------------------------

# A DOM stand-in for node: elements keep attributes, children and text, and any HTML-parsing API throws.
FAKE_DOM = r"""
class FakeNode {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(child) { this.children.push(child); return child; }
  set textContent(v) { this.children = [{text: String(v)}]; }
  get textContent() { return this.children.map((c) => c.text !== undefined ? c.text : c.textContent).join(""); }
  set innerHTML(v) { throw new Error("innerHTML used"); }
  set outerHTML(v) { throw new Error("outerHTML used"); }
  insertAdjacentHTML() { throw new Error("insertAdjacentHTML used"); }
}
const document = {createElement: (tag) => new FakeNode(tag), createTextNode: (t) => ({text: String(t)}),
                  write() { throw new Error("document.write used"); }};
function tree(n) { return n.text !== undefined ? {text: n.text} : {tag: n.tag, attrs: n.attrs, children: n.children.map(tree)}; }
"""


def run_tiles(expression: str, payload) -> object:
    """Evaluate ``expression`` against the page's tile builder (tile:start..tile:end) on FAKE_DOM."""
    script = page_script()
    region = script[script.index("// tile:start"):script.index("// tile:end")]
    program = (f'"use strict";\n{FAKE_DOM}\n{region}\nconst input = JSON.parse(require("fs").readFileSync(0, "utf8"));\n'
               f"process.stdout.write(JSON.stringify({expression}));\n")
    proc = subprocess.run([CTX["node"], "-e", program], input=json.dumps(payload), capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[:800]
    return json.loads(proc.stdout)


def _walk(node):
    yield node
    for child in node.get("children", []):
        yield from _walk(child)


def _text(node) -> str:
    return "".join(n["text"] for n in _walk(node) if "text" in n)


def _sample_cards():
    """Real cards from the snapshot, chosen by what they carry, never by name."""
    with_all = next(c for c in tools.cards() if c.get("keywords") and c.get("timing_triggers")
                    and c.get("cost") is not None and c.get("power") is not None and c.get("ram") is not None)
    with_errata = next(c for c in tools.cards() if c["id"] in tools.errata_by_slug())
    with_symbol = next(c for c in tools.cards() if "{" + "Spend}" in (c.get("text_markup") or ""))
    return with_all, with_errata, with_symbol


def test_card_tile_route_returns_the_payload():
    card, errata_card, _ = _sample_cards()
    with client_for() as client:
        response = client.get(f"/api/card/{card['id']}", headers=LOCAL)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["ok"] is True and body["card"] == card_tile(card["id"])
        tile = body["card"]
        for field in ("display_name", "name", "subname", "card_type", "color", "cost", "power", "ram", "rarity", "set"):
            assert tile[field] == card.get(field), field
        assert tile["slug"] == card["id"] and tile["text"] == card["text"]
        assert tile["classifications"] == card["classifications"] and tile["keywords"] == card["keywords"]
        assert tile["timing_triggers"] == card["timing_triggers"] and tile["has_errata"] is False
        assert {s["kind"] for s in tile["segments"]} >= {"text", "keyword", "trigger"}
        erratum = client.get(f"/api/card/{errata_card['id']}", headers=LOCAL).json()["card"]
        expected = tools.get_card(errata_card["id"])["result"]
        assert erratum["has_errata"] is True and erratum["errata_note"] == expected["errata_note"]
        assert [e["id"] for e in erratum["errata"]] == [e["id"] for e in expected["errata"]]
        assert [e["text"] for e in erratum["errata"]] == [e["text"] for e in expected["errata"]]
        # An unknown slug: 404 with get_card's own suggestions.
        bogus = card["id"][:-3]
        assert bogus not in tools.cards_by_slug()
        try:
            tools._require_card(bogus)
            raise AssertionError("a bogus slug resolved")
        except tools.ToolError as exc:
            suggestions = exc.extra["did_you_mean"]
        missing = client.get(f"/api/card/{bogus}", headers=LOCAL)
        assert missing.status_code == 404 and missing.json()["ok"] is False
        assert missing.json()["error"] == "not_found" and missing.json()["did_you_mean"] == suggestions
        assert card["id"] in suggestions
        # Both routes sit behind the Host check.
        for path in (f"/api/card/{card['id']}", f"/api/cards?slugs={card['id']}"):
            assert client.get(path, headers={"host": "evil.example:8767"}).status_code == 403, path
            assert client.get(path, headers={**LOCAL, "origin": "http://evil.example"}).status_code == 403, path


def test_card_tile_batch_route_keeps_order_reports_misses_and_caps():
    slugs = [c["id"] for c in tools.cards()]
    with client_for() as client:
        wanted = [slugs[2], "no-such-card", slugs[0], slugs[2]]
        body = client.get("/api/cards", params={"slugs": ",".join(wanted)}, headers=LOCAL).json()
        assert body["ok"] and [c["slug"] for c in body["cards"]] == [slugs[2], slugs[0]]
        assert body["cards"][0] == card_tile(slugs[2])
        assert [m["slug"] for m in body["missing"]] == ["no-such-card"]
        full = client.get("/api/cards", params={"slugs": ",".join(slugs[:MAX_BATCH])}, headers=LOCAL)
        assert full.status_code == 200 and len(full.json()["cards"]) == MAX_BATCH == 24
        over = client.get("/api/cards", params={"slugs": ",".join(slugs[:MAX_BATCH + 1])}, headers=LOCAL)
        assert over.status_code == 400 and over.json() == {**over.json(), "ok": False, "error": "too_many",
                                                           "limit": MAX_BATCH}
        # Repeats count once toward the cap.
        repeated = client.get("/api/cards", params={"slugs": ",".join([slugs[0]] * 40)}, headers=LOCAL).json()
        assert repeated["ok"] and len(repeated["cards"]) == 1
        for empty in ("", " , ,"):
            assert client.get("/api/cards", params={"slugs": empty}, headers=LOCAL).status_code == 400
    # The page asks for tiles in batches of the same size.
    assert f"const TILE_BATCH = {MAX_BATCH};" in page_script()


def test_tile_segments_cover_every_cards_text():
    script_checks = []
    for card in tools.cards():
        segments = card_tile(card["id"])["segments"]
        rebuilt = "".join(f"[{s['value']}]" if s["kind"] in ("keyword", "trigger", "symbol") else s["value"]
                          for s in segments)
        assert rebuilt == card["text"] == to_plain_text(card.get("text_markup") or ""), card["id"]
        assert all(s["value"] for s in segments) and all(
            a["kind"] != "text" or b["kind"] != "text" for a, b in zip(segments, segments[1:])), card["id"]
        script_checks.append(segments)
    # The page's own reading of segments agrees.
    assert run_pure("input.map(segmentsText)", script_checks) == [c["text"] for c in tools.cards()]


def test_unknown_token_stays_visible():
    segments = text_segments("{Mystery} then {Blocker}, {Play} pay {Spend} per {7.6} and {[GIGS](#rule-x)} or [A](b).")
    assert segments == [{"kind": "text", "value": "{Mystery} then "}, {"kind": "keyword", "value": "Blocker"},
                        {"kind": "text", "value": ", "}, {"kind": "trigger", "value": "Play"},
                        {"kind": "text", "value": " pay "}, {"kind": "symbol", "value": "Spend"},
                        {"kind": "text", "value": " per "}, {"kind": "rule", "value": "7.6"},
                        {"kind": "text", "value": " and GIGS or A."}]
    assert text_segments("") == [] and text_segments(None) == []
    assert text_segments("{}") == [{"kind": "text", "value": "{}"}]
    # Shown on a tile, the unknown token is still there as text.
    tile = run_tiles("tree(cardTile(input, true))", {"slug": "x", "display_name": "X", "color": "Mauve",
                                                    "segments": segments})
    assert "{Mystery} then " in _text(tile)


def test_tiles_build_without_html_sinks():
    script = page_script()
    region = script[script.index("// tile:start"):script.index("// tile:end")]
    for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "DOMParser"):
        assert banned not in region, banned
    for helper in ("function tileButton", "function showCard", "function showToolTiles", "function showPop",
                   "function fetchTiles", "function flushTiles", "function requestTile"):
        body = script[script.index(helper):]
        body = body[:body.index("\n}\n")]
        assert "innerHTML" not in body, helper
    cards = [card_tile(c["id"]) for c in _sample_cards()]
    hostile = {**cards[0], "display_name": HOSTILE[0], "color": '"><script>x</script>', "classifications": [HOSTILE[1]],
               "keywords": [HOSTILE[3]], "segments": [{"kind": "text", "value": HOSTILE[4]},
                                                       {"kind": "<b>", "value": HOSTILE[0]}],
               "errata": [{"heading": HOSTILE[2], "variant": None, "text": HOSTILE[1]}], "has_errata": True}
    built = run_tiles("input.map((c) => [tree(cardTile(c, true)), tree(cardTile(c, false))])", cards + [hostile])
    for card, (expanded, compact) in zip(cards + [hostile], built):
        assert expanded["tag"] == "article" and expanded["attrs"]["class"] == "tile expanded"
        assert compact["tag"] == "span" and compact["attrs"]["class"] == "tile compact"
        assert expanded["attrs"]["data-color"] == compact["attrs"]["data-color"] == card["color"]
        # A compact tile lives inside a button: phrasing elements only.
        assert {n["tag"] for n in _walk(compact) if "tag" in n} <= {"span", "b"}
        text = _text(expanded)
        assert card["display_name"] in text and _text(compact).startswith(card["display_name"])
        for value in card["keywords"] + card.get("timing_triggers", []):
            assert value in _text(compact), value
        if card is not hostile:
            assert segmentsText_py(card["segments"]).replace("[", "").replace("]", "") in text.replace("[", "").replace("]", "")
            classes = [n["attrs"].get("class") for n in _walk(expanded) if "tag" in n]
            assert ("tile-errata" in classes) is card["has_errata"] and ("tile-errlist" in classes) is card["has_errata"]
            if card.get("cost") is not None:
                assert any(n["attrs"].get("class") == "tile-cost" and _text(n) == str(card["cost"])
                           for n in _walk(compact) if "tag" in n)
    # Hostile strings arrive as text nodes, and an unknown segment kind gets a fixed class.
    expanded = built[-1][0]
    assert HOSTILE[0] in _text(expanded) and HOSTILE[4] in _text(expanded)
    assert all(n["attrs"].get("class") != "chip chip-<b>" for n in _walk(expanded) if "tag" in n)
    # Colour: every colour in the snapshot has a token in both themes, any other value is neutral,
    # and no card name or slug is written into the page's files.
    style = (UI_DIR / "assistant.css").read_text(encoding="utf-8")
    for colour in tools.snapshot_values("color"):
        assert f'.tile[data-color="{colour}"]{{--tile-accent:var(--c-{colour.lower()})}}' in style, colour
        assert style.count(f"--c-{colour.lower()}:") == 3, colour
    assert ".tile{--tile-accent:var(--c-none);" in style and style.count("--c-none:") == 3
    ui_source = "".join(f.read_text(encoding="utf-8") for f in sorted(UI_DIR.iterdir()) if f.is_file())
    for card in tools.cards():
        assert card["id"] not in ui_source, card["id"]


def segmentsText_py(segments) -> str:
    return "".join(f"[{s['value']}]" if s["kind"] in ("keyword", "trigger", "symbol") else s["value"] for s in segments)


def test_answer_links_only_cited_ids_and_stays_escaped():
    slug, other = tools.cards()[0]["id"], tools.cards()[1]["id"]
    sources = {"card_slugs": [slug, '"><img src=x onerror=alert(1)>', "bad id!"], "rule_ids": ["9.2", "TR 3.4.2"]}
    links = run_pure("citationLinks(input)", sources)
    assert links == {"cards": [slug], "rules": ["9.2", "TR 3.4.2"]}, links
    answer = (f"See `{slug}` and {slug}, not {other} or {slug}-x. Rule 9.2. applies; 19.2, 9.2.1 and 9.20 do not; "
              f"TR 3.4.2 too. <img src=x onerror=\"alert(1)\"> **{slug}** '9.2 &#39;9.2")
    html = run_pure("mdToHtml(input.answer, citationLinks(input.sources))", {"answer": answer, "sources": sources})
    card_link = f'<button type="button" class="cite" data-card="{slug}">{slug}</button>'
    assert html.count(card_link) == 3, html
    assert f"<code>{card_link}</code>" in html and f"<strong>{card_link}</strong>" in html
    assert f"{slug}-x" in html and f'data-card="{other}"' not in html
    rule_link = '<button type="button" class="cite" data-rule="9.2">9.2</button>'
    assert html.count(rule_link) == 3 and "Rule " + rule_link + "." in html
    assert " &#39;" + rule_link in html and "&amp;#39;" + rule_link in html
    # An escaped entity's own digits are never an id: a cited rule "39" stays out of "&#39;".
    entity = run_pure("mdToHtml(input, {cards: [], rules: ['39']})", "it's 39")
    assert entity == '<p>it&#39;s <button type="button" class="cite" data-rule="39">39</button></p>', entity
    for unlinked in ("19.2,", "9.2.1", "9.20"):
        assert unlinked in html.replace(rule_link, "@"), unlinked
    assert '<button type="button" class="cite" data-rule="TR 3.4.2">TR 3.4.2</button>' in html
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in html and "<img" not in html
    cite = re.compile(r'<button type="button" class="cite" data-(card|rule)="[A-Za-z0-9 .-]+">[A-Za-z0-9 .-]+</button>')
    leftover = ALLOWED_TAGS.sub("", cite.sub("", html))
    assert "<" not in leftover and ">" not in leftover, leftover
    # No sources (or the hostile answers with them) links nothing new and escapes as before.
    assert run_pure("mdToHtml(input)", answer) == run_pure("mdToHtml(input, null)", answer)
    assert "cite" not in run_pure("mdToHtml(input)", answer)
    rendered = run_pure("input.h.map((t) => mdToHtml(t, citationLinks(input.s)))", {"h": HOSTILE, "s": sources})
    assert rendered == run_pure("input.map(mdToHtml)", HOSTILE)
    # The answer sink runs inside withCitations with this turn's sources, and clicks open the side panel.
    script = page_script()
    turn = script[script.index("function showTurn"):]
    turn = turn[:turn.index("\n}\n")]
    assert "withCitations(data.sources, () => {" in turn
    assert run_pure("[withCitations({card_slugs: ['a-b']}, () => mdToHtml('a-b')), mdToHtml('a-b')]", None) == [
        '<p><button type="button" class="cite" data-card="a-b">a-b</button></p>', "<p>a-b</p>"]
    assert '$("chatLog").addEventListener("click"' in script and "showCard(cite.dataset.card)" in script
    assert 'showSource("get_rule", {rule_id: cite.dataset.rule}, "rule " + cite.dataset.rule)' in script


# Session persistence, the composer, copy and error handling ---------------------------------

# A DOM stand-in for the chat functions: elements by id with the properties those functions set,
# listeners that tests can fire, and storage that can be made to fail.
CHAT_DOM = r"""
class Node {
  constructor(tag, id) { this.tag = tag; this.id = id; this.attrs = {}; this.children = []; this.listeners = {};
    this.hidden = false; this.disabled = false; this.readOnly = false; this.value = ""; this.focused = 0;
    this.classList = {add() {}, remove() {}, toggle() {}}; this.dataset = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith("data-")) this.dataset[k.slice(5)] = String(v); }
  appendChild(child) { this.children.push(child); return child; }
  set textContent(v) { this.children = v === "" ? [] : [{text: String(v)}]; }
  get textContent() { return this.children.map((c) => c.text !== undefined ? c.text : c.textContent).join(""); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  focus() { this.focused += 1; }
  select() {}
  remove() {}
  scrollIntoView() {}
  querySelectorAll() { return []; }
}
const els = {};
const $ = (id) => els[id] || (els[id] = new Node("div", id));
function makeStorage(failing, limit) {
  const data = {};
  return {data, getItem(k) { if (failing) throw new Error("blocked"); return k in data ? data[k] : null; },
    setItem(k, v) { if (failing || (limit && String(v).length > limit)) throw new Error("quota"); data[k] = String(v); },
    removeItem(k) { if (failing) throw new Error("blocked"); delete data[k]; }};
}
const document = {createElement: (tag) => new Node(tag), createTextNode: (t) => ({text: String(t)}),
  body: new Node("body"), execCommand: () => true, querySelectorAll: () => []};
function tree(n) { return n.text !== undefined ? {text: n.text} : {tag: n.tag, attrs: n.attrs, children: n.children.map(tree)}; }
"""


def js_function(script: str, name: str) -> str:
    """One top-level function of the page script, by name, through its closing brace."""
    match = re.search(rf"^(async )?function {name}\(", script, re.M)
    assert match, name
    start = match.start()
    return script[start:script.index("\n}\n", start) + 3]


def js_const(script: str, name: str) -> str:
    match = re.search(rf"^(const|let) {name}\b.*$", script, re.M)
    assert match, name
    return match.group(0) + "\n"


def run_chat(functions, consts, body: str, payload=None, prelude: str = "") -> object:
    """Run ``body`` (an async block that sets ``out``) over the named page functions on CHAT_DOM."""
    script = page_script()
    pure = script[script.index("// pure:start"):script.index("// pure:end")]
    code = "".join(js_const(script, c) for c in consts) + "".join(js_function(script, f) for f in functions)
    program = (f'"use strict";\n{CHAT_DOM}\n{pure}\n{prelude}\n{code}\n'
               f'const input = JSON.parse(require("fs").readFileSync(0, "utf8"));\nlet out = null;\n'
               f"(async () => {{ {body} }})().then(() => process.stdout.write(JSON.stringify(out)),"
               f" (err) => {{ process.stderr.write(String(err && err.stack || err)); process.exit(1); }});\n")
    proc = subprocess.run([CTX["node"], "-e", program], input=json.dumps(payload), capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[:1200]
    return json.loads(proc.stdout)


STORE_FUNCS = ["newSession", "storeGet", "storeSet", "storeRemove", "storedJson", "loadSessionId", "rememberTurn",
               "forgetTurns"]


def test_storage_access_is_guarded_and_optional():
    script = page_script()
    # Every storage access, session or theme, is on a line that opens a try.
    for name in ("sessionStorage", "localStorage"):
        for match in re.finditer(name, script):
            line = script[script.rindex("\n", 0, match.start()):script.index("\n", match.start())]
            assert "try {" in line, line
    assert script.count("sessionStorage.") == 3 and script.count("localStorage") == 2
    for helper in ("function storeGet", "function storeSet", "function storeRemove"):
        assert script.count(helper) == 1, helper
    # With storage blocked the page still gets a valid session id and keeps nothing, without throwing.
    out = run_chat(STORE_FUNCS, ["SESSION_KEY"], """
      globalThis.sessionStorage = makeStorage(true);
      globalThis.keptTurns = [];
      const id = loadSessionId();
      out = {id, again: loadSessionId(), json: storedJson(LOG_KEY, "fallback")};
    """, prelude="")
    assert re.fullmatch(r"[0-9a-f]{24}", out["id"]) and out["id"] != out["again"] and out["json"] == "fallback"


def test_session_id_and_log_survive_a_reload_and_new_chat_clears_the_log():
    script = page_script()
    assert "const chatSession = loadSessionId();" in script and "newSession();\n" not in script.replace(
        "const fresh = newSession();\n", "")
    # The page's session id check and the server's agree.
    ids = ["abc", "a" * 64, "a" * 65, "", "a b", "../x", "x\n", "A-b_9", None, 7]
    assert run_pure("input.map(validSessionId)", ids) == [
        isinstance(i, str) and bool(SESSION_RE.match(i)) and "\n" not in i for i in ids]
    out = run_chat(STORE_FUNCS + ["el", "newChat", "showHeldDeck"], ["SESSION_KEY"], """
      globalThis.sessionStorage = makeStorage(false);
      globalThis.state = {busy: false, serverHistory: 0};
      globalThis.keptTurns = [];
      globalThis.postJson = async (url, body) => { posted.push([url, body]); return [null, {ok: true, deck: null}]; };
      const posted = [];
      const first = loadSessionId();
      globalThis.chatSession = first;
      for (let i = 0; i < 35; i++) rememberTurn("q" + i, {ok: true, answer: "a" + i, historyMessages: 8});
      const kept = JSON.parse(sessionStorage.data[LOG_KEY]);
      keptTurns = [];  // a reload
      const second = loadSessionId();
      const restored = capTurns(storedJson(LOG_KEY, []));
      $("chatLog").textContent = "log";
      await newChat();
      out = {first, second, kept: kept.map((t) => t.question), restored: restored.length,
             afterNew: sessionStorage.data[LOG_KEY] ?? null, idAfterNew: sessionStorage.data[SESSION_KEY], posted,
             log: $("chatLog").textContent, status: $("chatStatus").textContent, history: state.serverHistory};
    """, prelude="")
    assert out["first"] == out["second"] == out["idAfterNew"], "a reload must keep the server session"
    assert out["kept"] == [f"q{i}" for i in range(5, 35)] and out["restored"] == 30
    assert out["afterNew"] is None and out["log"] == "" and out["history"] == 0
    assert out["posted"] == [["/api/chat/reset", {"session": out["first"]}]]
    assert out["status"] == "New chat: history cleared.", out["status"]
    # Full storage drops the oldest kept turns until the rest fit.
    out = run_chat(STORE_FUNCS, ["SESSION_KEY"], """
      globalThis.sessionStorage = makeStorage(false, 400);
      globalThis.keptTurns = [];
      for (let i = 0; i < 10; i++) rememberTurn("q" + i, {ok: true, answer: "x".repeat(60)});
      out = JSON.parse(sessionStorage.data[LOG_KEY]).map((t) => t.question);
    """)
    assert 0 < len(out) < 10 and out[-1] == "q9", out
    # The pure helpers behind restore and the lost-session notice.
    turns = [{"question": "a", "data": {"historyMessages": 2}}, {"question": 5, "data": {}}, {"question": "b"},
             {"question": "c", "data": {"historyMessages": 4}}]
    assert run_pure("[capTurns(input).map((t) => t.question), lastHistory(input), lastHistory([]), capTurns(null)]",
                    turns) == [["a", "c"], 4, 0, []]
    cases = [[0, {"ok": True, "historyMessages": 2}], [4, {"ok": True, "historyMessages": 6}],
             [4, {"ok": True, "historyMessages": 2}], [8, {"ok": True, "historyMessages": 8}],
             [4, {"ok": False, "historyMessages": 4}], [4, {"ok": False, "historyMessages": 0}], [4, {"ok": False}]]
    assert run_pure("input.map(([h, d]) => sessionLost(h, d))", cases) == [False, False, True, False, False, True, False]
    # What the server does with a session it lost (a restart is a new app): a fresh, empty history,
    # which is exactly what sessionLost reads.
    with client_for(ScriptedModel(["One.", "Two."])) as client:
        one = client.post("/api/chat", json={"session": "kept", "message": "q"}, headers=LOCAL).json()
        two = client.post("/api/chat", json={"session": "kept", "message": "q"}, headers=LOCAL).json()
    with client_for(ScriptedModel(["Three."])) as restarted:
        three = restarted.post("/api/chat", json={"session": "kept", "message": "q"}, headers=LOCAL).json()
    assert run_pure("[sessionLost(input[0].historyMessages, input[1]), sessionLost(input[1].historyMessages, input[2])]",
                    [one, two, three]) == [False, True]
    turn = js_function(script, "sendChat")
    assert "sessionLost(state.serverHistory, data)" in turn and "rememberTurn(question, data)" in turn
    assert "The server no longer had this chat" in turn
    assert "restoreChat();" in js_function(script, "wirePage")


def test_new_chat_and_other_post_callers_surface_errors():
    out = run_chat(STORE_FUNCS + ["newChat", "showHeldDeck"], ["SESSION_KEY"], """
      globalThis.sessionStorage = makeStorage(false);
      globalThis.state = {busy: false, serverHistory: 4};
      globalThis.chatSession = "s";
      globalThis.keptTurns = [{question: "q", data: {}}];
      globalThis.postJson = async () => { throw new TypeError("Failed to fetch"); };
      $("chatLog").textContent = "log";
      await newChat();
      out = {status: $("chatStatus").textContent, log: $("chatLog").textContent, kept: keptTurns.length, h: state.serverHistory};
    """)
    assert out == {"status": "Could not start a new chat: TypeError: Failed to fetch. The log is unchanged.",
                   "log": "log", "kept": 1, "h": 4}, out
    script = page_script()
    # Each chat-page caller of postJson handles a rejected request itself.
    for name in ("newChat", "sendChat", "clearDeck", "showSource", "showDeck", "loadDeck", "saveNote", "startEval",
                 "startRetrJob"):
        body = js_function(script, name)
        assert "postJson(" in body and "try {" in body and "catch (err)" in body, name
    assert script.count("postJson(") == 10, "the definition and the callers above; a new caller needs a test here"


def test_composer_disables_send_while_pending_and_can_stop_waiting():
    script = page_script()
    funcs = ["setBusy", "startWaiting", "stopWaiting", "sendChat", "rememberTurn", "storeSet", "storeRemove"]
    out = run_chat(funcs, ["statusTimer"], """
      globalThis.sessionStorage = makeStorage(false);
      globalThis.LOG_KEY = "log";
      globalThis.state = {busy: false, serverHistory: 0, abort: null, waitTimer: null, maxToolCalls: 6};
      globalThis.keptTurns = [];
      globalThis.chatSession = "s1";
      globalThis.loadStatus = async () => {};
      const shown = [];
      globalThis.showTurn = (q, d) => shown.push(q);
      globalThis.showHeldDeck = () => {};
      let release = null;
      globalThis.postJson = (url, body, signal) => new Promise((resolve, reject) => {
        release = () => resolve([{status: 200}, {ok: true, answer: "A", historyMessages: 2, deckInContext: null}]);
        signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
      });
      $("chatInput").value = "first question";
      const pending = sendChat();
      const during = {send: $("chatSend").disabled, ro: $("chatInput").readOnly, stop: $("chatStop").hidden,
        timer: $("chatTimer").textContent, timerHidden: $("chatTimer").hidden, aborter: state.abort instanceof AbortController};
      await sendChat();  // a second send while pending does nothing
      state.abort.abort();
      await pending;
      const stopped = {send: $("chatSend").disabled, stop: $("chatStop").hidden, timer: $("chatTimer").hidden,
        status: $("chatStatus").textContent, focus: $("chatInput").focused, value: $("chatInput").value, shown: shown.length};
      const second = sendChat();
      release();
      await second;
      out = {during, stopped, after: {send: $("chatSend").disabled, value: $("chatInput").value, shown, focus: $("chatInput").focused,
        status: $("chatStatus").textContent, history: state.serverHistory}};
    """)
    assert out["during"] == {"send": True, "ro": True, "stop": False, "timer": "waiting 0 s", "timerHidden": False,
                             "aborter": True}, out
    assert out["stopped"]["send"] is False and out["stopped"]["stop"] is True and out["stopped"]["timer"] is True
    assert out["stopped"]["status"].startswith("Stopped waiting.") and out["stopped"]["focus"] == 1
    assert out["stopped"]["value"] == "first question" and out["stopped"]["shown"] == 0
    assert out["after"] == {"send": False, "value": "", "shown": ["first question"], "focus": 2, "status": "",
                            "history": 2}, out
    assert run_pure("[elapsedText(0), elapsedText(12999), elapsedText(-5)]", None) == [
        "waiting 0 s", "waiting 12 s", "waiting 0 s"]
    # Enter sends, Shift+Enter does not; the stop control aborts the pending fetch.
    wiring = js_function(script, "wirePage")
    assert 'if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }' in wiring
    assert '$("chatStop").addEventListener("click", () => { if (state.abort) state.abort.abort(); });' in wiring
    assert "new AbortController()" in js_function(script, "sendChat")
    assert "signal" in js_function(script, "postJson")
    for needle in ('id="chatStop" type="button" hidden', 'id="chatTimer" hidden'):
        assert ASSISTANT_HTML.count(needle) == 1, needle


def test_copy_button_is_on_every_answer_and_reports_through_the_status():
    script = page_script()
    assert "bar.appendChild(copyButton(" in js_function(script, "showTurn")
    copy = js_function(script, "copyText")
    assert "navigator.clipboard.writeText(text)" in copy and 'document.execCommand("copy")' in copy
    assert copy.count("try {") == 2 and copy.count("catch (err)") == 2
    out = run_chat(["el", "copyText", "copyButton"], [], """
      const results = [];
      for (const [clip, exec] of [[true, false], [false, true], [false, false]]) {
        globalThis.window = {isSecureContext: true};
        Object.defineProperty(globalThis, "navigator", {configurable: true, writable: true, value: clip ?
          {clipboard: {writeText: async (t) => { results.push("clip:" + t); }}} :
          {clipboard: {writeText: async () => { throw new Error("denied"); }}}});
        document.execCommand = () => { if (!exec) throw new Error("no"); results.push("exec"); return true; };
        const b = copyButton("**answer**");
        await b.listeners.click[0]();
        results.push($("chatStatus").textContent);
      }
      out = results;
    """)
    assert out == ["clip:**answer**", "Answer copied.", "exec", "Answer copied.",
                   "Could not copy: select the answer and copy it by hand."], out
    assert '<div class="status" id="chatStatus" role="status" aria-live="polite">' in ASSISTANT_HTML


def test_deck_and_passage_sources_render_and_deck_sources_get_labels():
    assert run_pure("input.map(deckSourceLabel)", ["public_deck", "text", "pasted", "deck", "imported", None]) == [
        "public deck", "pasted list", "pasted list", "deck structure", "imported", ""]
    script = page_script()
    assert script.count("DECK_SOURCE_LABELS = {") == 1, "labels are mapped in one place"
    assert "deckSourceLabel(brief.source)" in js_function(script, "showHeldDeck")
    assert "brief.source)" not in js_function(script, "showHeldDeck").replace("deckSourceLabel(brief.source)", "")
    groups = run_pure("sourceGroups(input)", {"card_slugs": ["a", "a", 3], "deck_ids": ["d1", ""], "chunk_ids": ["rule:9.2"]})
    assert groups == {"cards": ["a"], "rules": [], "errata": [], "decks": ["d1"], "chunks": ["rule:9.2"]}
    deck = public_deck_index()[0]
    sources = {"card_slugs": ["x-card"], "rule_ids": ["9.2"], "deck_ids": [deck["id"], "ffffffff-0000"],
               "chunk_ids": ["rule:9.2", "rule:9.3"], "errata_ids": []}
    out = run_chat(["el", "sourceButtons", "nameDeckChips"], [], """
      globalThis.state = {decks: input.decks};
      const opened = [];
      globalThis.tileButton = (slug) => el("span", {"data-card": slug}, slug);
      globalThis.showSource = (tool, args) => opened.push([tool, args]);
      globalThis.showDeck = (id) => opened.push(["deck", id]);
      const box = sourceButtons(input.sources);
      const chips = box.children.filter((c) => c.attrs && c.attrs.class === "deckchip");
      for (const c of chips) c.listeners.click[0]();
      out = {tree: tree(box), chips: chips.map((c) => c.textContent), opened, none: sourceButtons({deck_ids: [], chunk_ids: []})};
    """, {"sources": sources, "decks": public_deck_index()})
    assert out["chips"] == [deck["name"], "deck ffffffff"], out["chips"]
    assert out["opened"] == [["deck", deck["id"]], ["deck", "ffffffff-0000"]] and out["none"] is None
    chunks = next(n for n in _walk(out["tree"]) if n.get("attrs", {}).get("class") == "chunks")
    assert _text(chunks) == "2 passage(s) searched" + "rule:9.2" + "rule:9.3"
    # The deck chip opens what an existing route returns for that id, and offers to load it.
    show = js_function(script, "showDeck")
    assert 'postJson("/api/tools/parse_deck", {deck_id: id})' in show and "loadDeck({deck_id: id})" in show
    assert "innerHTML" not in show and "innerHTML" not in js_function(script, "sourceButtons")
    assert "nameDeckChips();" in js_function(script, "loadDecks")


def test_cited_slugs_show_the_card_name_from_the_same_batch():
    script = page_script()
    turn = js_function(script, "showTurn")
    # Names come from fetchTiles (the batched /api/cards request the Sources tiles share), before
    # the Sources row asks for the same slugs in the same tick.
    assert turn.index("nameCite(cite)") < turn.index("sourceButtons(data.sources)")
    name = js_function(script, "nameCite")
    assert "fetchTiles([slug])" in name and "fetch(" not in name.replace("fetchTiles(", "")
    assert "innerHTML" not in name
    out = run_chat(["el", "nameCite"], [], """
      const fetched = [];
      globalThis.fetchTiles = async (slugs) => { fetched.push(...slugs); return [{slug: slugs[0], display_name: "<b>V</b>: Streetkid"}]; };
      const b = el("button", {type: "button", class: "cite", "data-card": "v-streetkid"}, "v-streetkid");
      nameCite(b);
      await new Promise((r) => setTimeout(r, 0));
      out = {text: b.textContent, attrs: b.attrs, fetched};
    """)
    assert out["text"] == "<b>V</b>: Streetkid" and out["fetched"] == ["v-streetkid"]
    assert out["attrs"]["title"] == "v-streetkid" and out["attrs"]["aria-label"] == "<b>V</b>: Streetkid (card v-streetkid)"


def test_theme_applies_before_the_body_from_the_one_script():
    html = ASSISTANT_HTML
    assert html.index("<script>") < html.index("</head>") < html.index("<body>"), "the script must run in <head>"
    script = page_script()
    assert script.index("applyStoredTheme") < script.index("function wirePage")
    assert 'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wirePage); else wirePage();' in script
    # Run the whole script as the head parser would (no body yet): nothing touches an element, and a
    # stored theme is already on <html>.
    for stored, failing in (("light", False), ("dark", False), (None, True)):
        program = ("const attrs = {}; let waited = null; const storeData = {};\n"
                   "const document = {readyState: 'loading', documentElement: {setAttribute(k, v) { attrs[k] = v; }, "
                   "getAttribute(k) { return attrs[k] ?? null; }}, getElementById() { throw new Error('element read in head'); }, "
                   "querySelectorAll() { throw new Error('query in head'); }, body: null, "
                   "addEventListener(t, f) { if (t === 'DOMContentLoaded') waited = f; }};\n"
                   "const window = {matchMedia: () => ({matches: false})};\n"
                   f"const failing = {json.dumps(failing)};\n"
                   "const store = {getItem(k) { if (failing) throw new Error('x'); return k === 'cyberpunk-assistant-theme' ? "
                   f"{json.dumps(stored)} : null; }}, setItem() {{ if (failing) throw new Error('x'); }}, removeItem() {{}}}};\n"
                   "globalThis.localStorage = store; globalThis.sessionStorage = store;\n"
                   f"{script}\nprocess.stdout.write(JSON.stringify([attrs['data-theme'] ?? null, typeof waited]));\n")
        proc = subprocess.run([CTX["node"], "-e", program], capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr[:800]
        assert json.loads(proc.stdout) == [stored, "function"], (stored, proc.stdout)



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
