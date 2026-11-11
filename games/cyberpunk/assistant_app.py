"""The local assistant's loopback page: a small chat box and a Tools tab that runs any tool by hand.

Every tool in this project gets a UI, and the card, rules and deck tools in
``games/cyberpunk/assistant/`` are no exception: this page lists the registry,
builds a form from each tool's JSON schema, runs the tool on the server and
shows the JSON result exactly as a model would receive it.

Chat: ``POST /api/chat`` with ``{"session": id, "message": text}`` runs one
turn of ``assistant/loop.py`` against the configured model and returns the
answer and its trace (every tool call, its arguments, ok or error, a summary
and its sources). A short history per session is kept in memory, server side.
With no model configured the route answers 503 ``no_model``; a real model is a
local MLX worker that starts on the first chat (``scripts/assistant_local.py
--model``).

The deck tools get three form controls the schema alone does not imply: a
textarea for a pasted list (``text``), a JSON textarea for a deck dict
(``deck``, with a button that inserts the last deck ``parse_deck`` returned, so
tools can be chained by hand), and a picker over the public decks
(``deck_id``, filled from ``/api/decks``).

It is the harness monitor's ``build_app`` (token middleware) with the generic
console page replaced by this one, served on loopback by
``scripts/assistant_local.py``. One self-contained page: inline CSS and JS, no
CDN, works offline.

DNS rebinding: a page on another site can resolve its own hostname to
127.0.0.1 and then talk to this server from the victim's browser. Loopback
needs no token, so the guard here is the Host header: unless the app was
started for the LAN, a request whose Host is not a loopback name is refused, as
is any cross-site Origin. Off loopback the monitor's token applies instead.
"""

# No `from __future__ import annotations` here: FastAPI resolves the route handlers' `Request`
# annotation at runtime, and it is imported inside `build_assistant_app`.
import asyncio
import contextlib
import ipaddress
import re
import secrets
from collections import OrderedDict
from urllib.parse import urlsplit

from games.cyberpunk.assistant.decks import public_deck_index
from games.cyberpunk.assistant.loop import ASSISTANT_PROMPT_VERSION, run_turn
from games.cyberpunk.assistant.tools import TOOLS, call_tool
from games.cyberpunk.config import REPO_ROOT
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.webui.monitor import build_app
from harness.core.webui.runner import lan_ip

__all__ = ["build_assistant_app", "serve_assistant", "ASSISTANT_HTML", "is_loopback", "host_allowed",
           "ChatService"]

DEFAULT_PORT = 8767
TITLE = "Cyberpunk TCG assistant"
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_MESSAGE_CHARS = 8000
NO_MODEL = ("No model configured. Restart with: python scripts/assistant_local.py --model models/qwen3-8b-4bit "
            "(Apple Silicon Mac with mlx-lm installed and the weights downloaded).")


class ChatService:
    """Sessions of short history over one model; turns run one at a time (one local model)."""

    def __init__(self, model=None, *, max_history_messages: int = 8, max_sessions: int = 32,
                 enable_thinking: bool = False, max_tokens: int = 1024):
        self.model = model
        self.max_history_messages = max_history_messages
        self.max_sessions = max_sessions
        self.enable_thinking = enable_thinking
        self.max_tokens = max_tokens
        self.sessions: OrderedDict[str, list[dict]] = OrderedDict()
        self._lock: asyncio.Lock | None = None

    async def chat(self, session: str, message: str) -> dict:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            history = list(self.sessions.get(session, []))
            turn = await run_turn(history, message, self.model, max_tokens=self.max_tokens,
                                  enable_thinking=self.enable_thinking)
            if turn.ok:
                # Only the question and the final answer are kept: facts are fetched
                # again by tools, and the answer's cited slugs carry the context.
                history += [{"role": "user", "content": message}, {"role": "assistant", "content": turn.answer}]
                self.sessions[session] = history[-self.max_history_messages:]
                self.sessions.move_to_end(session)
                while len(self.sessions) > self.max_sessions:
                    self.sessions.popitem(last=False)
            return {**turn.to_dict(), "session": session,
                    "historyMessages": len(self.sessions.get(session, []))}

    async def close(self):
        close = getattr(self.model, "close", None)
        if close is not None:
            await close()


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _hostname(value: str) -> str | None:
    """The host part of a Host header or Origin, without port or IPv6 brackets."""
    if not value:
        return None
    try:
        parsed = urlsplit(value if "//" in value else f"//{value}")
        return (parsed.hostname or "").casefold() or None
    except ValueError:
        return None


def host_allowed(host_header: str | None, origin: str | None, *, lan: bool) -> bool:
    """Loopback mode accepts only a loopback Host and, when sent, a loopback Origin."""
    if lan:
        return True
    host = _hostname(host_header or "")
    if host is None or not is_loopback(host):
        return False
    if origin and origin != "null":
        origin_host = _hostname(origin)
        if origin_host is None or not is_loopback(origin_host):
            return False
    return True


def registry_view() -> dict:
    return {"rulesVersion": RULES_VERSION,
            "tools": [{"name": t.name, "description": t.description, "parameters": t.parameters}
                      for t in TOOLS.values()]}


def build_assistant_app(*, token: str | None = None, lan: bool = False, chat: ChatService | None = None):
    """The FastAPI app: the monitor's app (token) plus the tool and chat routes and a Host/Origin guard."""
    chat = chat if chat is not None else ChatService()
    from fastapi import Request
    from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
    from fastapi.routing import APIRoute

    def routes(app):
        app.router.routes[:] = [r for r in app.router.routes
                                if not (isinstance(r, APIRoute) and r.path == "/")]

        # Registered after the monitor's token middleware, so it runs first:
        # a rebinding attempt is refused before anything else looks at it.
        @app.middleware("http")
        async def host_guard(request: Request, call_next):
            if not host_allowed(request.headers.get("host"), request.headers.get("origin"), lan=lan):
                return PlainTextResponse("Refused: this server answers only to a loopback Host and Origin.", 403)
            return await call_next(request)

        @app.get("/", response_class=HTMLResponse)
        def index():
            return ASSISTANT_HTML

        @app.get("/api/tools")
        def list_tools():
            return registry_view()

        @app.get("/api/decks")
        def list_decks():
            return {"rulesVersion": RULES_VERSION, "decks": public_deck_index()}

        @app.post("/api/tools/{name}")
        async def run_tool(name: str, request: Request):
            if name not in TOOLS:
                return JSONResponse(call_tool(name, {}), status_code=404)
            try:
                payload = await request.json()
            except ValueError:
                payload = None
            if not isinstance(payload, dict):
                return JSONResponse({"ok": False, "tool": name, "error": "Send the arguments as a JSON object.",
                                     "error_kind": "invalid_arguments", "rules_version": RULES_VERSION},
                                    status_code=400)
            result = call_tool(name, payload)
            if result["ok"]:
                return result
            return JSONResponse(result, status_code=404 if result.get("error_kind") == "not_found" else 400)

        def chat_refusal(kind: str, message: str, status: int):
            return JSONResponse({"ok": False, "error_kind": kind, "error": message, "rulesVersion": RULES_VERSION,
                                 "promptVersion": ASSISTANT_PROMPT_VERSION}, status_code=status)

        @app.post("/api/chat")
        async def post_chat(request: Request):
            try:
                payload = await request.json()
            except ValueError:
                payload = None
            if not isinstance(payload, dict):
                return chat_refusal("invalid_arguments", "Send {\"session\": id, \"message\": text}.", 400)
            session, message = payload.get("session"), payload.get("message")
            if not isinstance(session, str) or not SESSION_RE.match(session):
                return chat_refusal("invalid_arguments", "session must be 1-64 letters, digits, - or _.", 400)
            if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
                return chat_refusal("invalid_arguments",
                                    f"message must be non-empty text of at most {MAX_MESSAGE_CHARS} characters.", 400)
            if chat.model is None:
                return chat_refusal("no_model", NO_MODEL, 503)
            result = await chat.chat(session, message.strip())
            return JSONResponse(result, status_code=200 if result["stopReason"] != "model_error" else 502)

        # Stop the model worker when the server stops (it would also exit on stdin EOF).
        inner_lifespan = app.router.lifespan_context

        @contextlib.asynccontextmanager
        async def lifespan(server_app):
            async with inner_lifespan(server_app) as lifespan_state:
                yield lifespan_state
            await chat.close()

        app.router.lifespan_context = lifespan

    return build_app([], REPO_ROOT, title=TITLE, token=token, extra_routes=routes)


def serve_assistant(host: str = "127.0.0.1", port: int = DEFAULT_PORT, *, lan: bool = False,
                    no_auth: bool = False, chat: ChatService | None = None) -> None:
    """Serve on loopback by default; any other bind needs the printed token unless ``no_auth``."""
    import uvicorn

    bind = "0.0.0.0" if lan else host
    open_bind = not is_loopback(bind)
    token = None if (no_auth or not open_bind) else secrets.token_urlsafe(12)
    app = build_assistant_app(token=token, lan=open_bind, chat=chat)
    shown = f"http://{lan_ip() if lan else host}:{port}"
    print(f"{TITLE} -> {shown}/" + (f"?t={token}" if token else ""), flush=True)
    if open_bind and not token:
        print("  WARNING: reachable beyond this machine with --no-auth. Anyone on this network can run the "
              "card, rules and deck tools.", flush=True)
    uvicorn.run(app, host=bind, port=port, log_level="warning")


ASSISTANT_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cyberpunk TCG assistant</title>
<style>
:root{--bg:#f6f6f4;--panel:#fff;--ink:#1b1b1f;--muted:#666;--line:#ddd;--accent:#0b6e69;--warn:#a03a00;--sel:#e7f4f2;--card:#fafafa}
@media (prefers-color-scheme: dark){:root{--bg:#141417;--panel:#1d1d22;--ink:#e8e8ea;--muted:#9a9aa2;--line:#33333a;--accent:#4fc1b8;--warn:#ff9a5c;--sel:#183331;--card:#24242a}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;gap:16px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
header h1{font-size:16px;margin:0}
.badge{font-size:12px;border:1px solid var(--line);border-radius:10px;padding:1px 8px;color:var(--muted)}
nav button{background:none;border:0;border-bottom:2px solid var(--accent);padding:6px 10px;color:var(--ink);font:inherit}
main{padding:16px;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:240px 1fr;gap:12px}
@media (max-width:760px){main{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px;min-width:0}
ul.tools{list-style:none;margin:0;padding:0}
ul.tools li button{width:100%;text-align:left;background:none;border:0;border-radius:6px;padding:6px 8px;color:var(--ink);font:inherit;cursor:pointer}
ul.tools li button.on{background:var(--sel)}
.muted{color:var(--muted)}.err{color:var(--warn);white-space:pre-wrap}
form{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin:10px 0}
label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
label .req{color:var(--warn)}
label.wide{grid-column:1/-1}
textarea.x{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:9em;resize:vertical}
button.small{font:inherit;font-size:12px;padding:2px 8px;border-radius:5px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;align-self:flex-start}
input,select,textarea{font:inherit;padding:5px 6px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--ink);min-width:0}
button.go{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:70vh;overflow:auto;background:var(--card);padding:8px;border-radius:6px;margin:0}
.status{margin:8px 0;font-size:13px}
section.chat{max-width:1200px;margin:16px auto 0;padding:0 16px}
#chatLog .turn{border-top:1px solid var(--line);padding:8px 0}
#chatLog .q{font-weight:600;white-space:pre-wrap}
#chatLog .a{white-space:pre-wrap;margin:6px 0}
#chatLog details{font-size:12px;color:var(--muted)}
#chatLog ol{margin:4px 0;padding-left:20px}
#chatLog li{margin:3px 0;word-break:break-word}
#chatLog li.bad{color:var(--warn)}
.chatrow{display:flex;gap:8px;align-items:flex-end}
.chatrow textarea{flex:1;min-height:3.2em;resize:vertical}
</style>
</head>
<body>
<header>
  <h1>Cyberpunk TCG assistant</h1>
  <nav><button type="button">Chat and tools</button></nav>
  <span class="badge" id="snapshot">snapshot …</span>
  <span class="muted">Ask the local model, or run any card, rules or deck tool by hand. A tool's result is exactly what the model receives.</span>
</header>
<section class="chat">
  <div class="panel">
    <h2 style="margin:0 0 6px;font-size:15px">Ask</h2>
    <p class="muted" style="margin:0 0 8px">The local model answers using only the tools below; every tool it ran is listed under its answer.</p>
    <div id="chatLog"></div>
    <div class="chatrow">
      <textarea id="chatInput" placeholder="Ask about a card, a rule or a deck list"></textarea>
      <button class="go" id="chatSend" type="button">Send</button>
      <button class="small" id="chatNew" type="button">New chat</button>
    </div>
    <div class="status" id="chatStatus"></div>
  </div>
</section>
<main>
  <div class="panel"><ul class="tools" id="toolList"></ul></div>
  <div>
    <div class="panel">
      <h2 id="toolName" style="margin:0;font-size:15px">Pick a tool</h2>
      <p id="toolDesc" class="muted"></p>
      <form id="toolForm" autocomplete="off"></form>
      <button class="go" id="runBtn" type="button" disabled>Run</button>
      <div class="status" id="status"></div>
    </div>
    <div class="panel"><pre id="output" class="muted">No result yet.</pre></div>
  </div>
</main>
<script>
"use strict";
const state = {tools: [], current: null, decks: [], lastDeck: null};
// Arguments the schema types do not fully describe get their own control.
const LONG_TEXT = 1000;
const $ = (id) => document.getElementById(id);

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadDecks() {
  const response = await fetch("/api/decks");
  if (!response.ok) return;
  state.decks = (await response.json()).decks;
  if (state.current) pick(state.current.name);
}

function deckPicker() {
  const input = el("select");
  input.appendChild(el("option", {value: ""}, "(no public deck)"));
  for (const d of state.decks) {
    const label = (d.name || "(unnamed)") + " · " + (d.colours || []).join("/") + " · " + d.card_count + " cards";
    input.appendChild(el("option", {value: d.id}, label));
  }
  return input;
}

async function loadTools() {
  const response = await fetch("/api/tools");
  if (!response.ok) { $("status").textContent = "Could not load tools: HTTP " + response.status; return; }
  const data = await response.json();
  state.tools = data.tools;
  $("snapshot").textContent = "rules snapshot " + data.rulesVersion;
  const list = $("toolList");
  list.textContent = "";
  for (const tool of state.tools) {
    const li = el("li");
    const button = el("button", {type: "button", "data-tool": tool.name}, tool.name);
    button.addEventListener("click", () => pick(tool.name));
    li.appendChild(button);
    list.appendChild(li);
  }
  const wanted = location.hash.slice(1);
  pick(state.tools.some((t) => t.name === wanted) ? wanted : state.tools[0].name);
}

function pick(name) {
  const tool = state.tools.find((t) => t.name === name);
  state.current = tool;
  history.replaceState(null, "", "#" + name);
  for (const b of document.querySelectorAll("ul.tools button")) b.classList.toggle("on", b.dataset.tool === name);
  $("toolName").textContent = tool.name;
  $("toolDesc").textContent = tool.description;
  const form = $("toolForm");
  form.textContent = "";
  const props = tool.parameters.properties || {};
  const required = new Set(tool.parameters.required || []);
  for (const [field, spec] of Object.entries(props)) {
    const label = el("label");
    const title = el("span", {}, field);
    if (required.has(field)) title.appendChild(el("span", {class: "req"}, " *"));
    label.appendChild(title);
    let input;
    let wide = false;
    if (field === "deck_id") {
      input = deckPicker();
      wide = true;
    } else if (spec.type === "object") {
      input = el("textarea", {class: "x", spellcheck: "false"});
      input.placeholder = '{"zones": [{"zone_code": "legends", "cards": [{"card_slug": "...", "quantity": 1}]}, ' +
        '{"zone_code": "deck", "cards": []}]}';
      wide = true;
    } else if (spec.type === "string" && (spec.maxLength || 0) >= LONG_TEXT) {
      input = el("textarea", {class: "x", spellcheck: "false"});
      input.placeholder = "Legends\n1 V: Streetkid\n...\nDeck\n3 Kiroshi Optics\n...";
      wide = true;
    } else if (spec.enum) {
      input = el("select");
      input.appendChild(el("option", {value: ""}, required.has(field) ? "(choose)" : "(any)"));
      for (const value of spec.enum) input.appendChild(el("option", {value: String(value)}, String(value)));
    } else if (spec.type === "integer") {
      input = el("input", {type: "number", step: "1"});
      if (spec.minimum !== undefined) input.min = spec.minimum;
      if (spec.maximum !== undefined) input.max = spec.maximum;
    } else {
      input = el("input", {type: "text"});
      if (spec.maxLength) input.maxLength = spec.maxLength;
    }
    input.name = field;
    input.dataset.type = spec.type;
    if (spec.description) input.title = spec.description;
    if (!input.placeholder) input.placeholder = spec.description || "";
    label.appendChild(input);
    if (wide) label.classList.add("wide");
    if (spec.type === "object" && field === "deck") {
      const use = el("button", {type: "button", class: "small"}, "Insert last parsed deck");
      use.disabled = !state.lastDeck;
      use.addEventListener("click", () => { input.value = JSON.stringify(state.lastDeck, null, 1); });
      label.appendChild(use);
    }
    form.appendChild(label);
  }
  $("runBtn").disabled = false;
  $("status").textContent = "";
}

function collectArgs() {
  const args = {};
  for (const input of $("toolForm").querySelectorAll("input,select,textarea")) {
    const raw = input.value.trim();
    if (raw === "") continue;
    if (input.dataset.type === "object") {
      try { args[input.name] = JSON.parse(raw); } catch (err) { throw new Error(input.name + " is not valid JSON: " + err.message); }
    } else if (input.dataset.type === "integer") {
      const n = Number(raw);
      args[input.name] = Number.isInteger(n) ? n : raw;
    } else {
      args[input.name] = raw;
    }
  }
  return args;
}

async function run() {
  const tool = state.current;
  if (!tool) return;
  let args;
  try { args = collectArgs(); } catch (err) { $("status").textContent = err.message; return; }
  $("runBtn").disabled = true;
  $("status").textContent = "Running " + tool.name + " …";
  try {
    const response = await fetch("/api/tools/" + encodeURIComponent(tool.name), {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(args)});
    const data = await response.json();
    $("output").className = data.ok ? "" : "err";
    $("output").textContent = JSON.stringify(data, null, 2);
    if (data.ok) {
      const s = data.sources || {};
      const bits = [];
      if (s.card_slugs && s.card_slugs.length) bits.push(s.card_slugs.length + " card(s)");
      if (s.rule_ids && s.rule_ids.length) bits.push(s.rule_ids.length + " rule(s)");
      if (s.errata_ids && s.errata_ids.length) bits.push(s.errata_ids.length + " erratum/errata");
      if (s.deck_ids && s.deck_ids.length) bits.push(s.deck_ids.length + " public deck(s)");
      if (data.result && typeof data.result.method === "string" && data.result.method.length < 40) bits.push("method " + data.result.method);
      if (data.result && data.result.deck) {
        state.lastDeck = data.result.deck;
        bits.push("deck kept for 'Insert last parsed deck'");
      }
      if (data.result && data.result.resolved === false) bits.push(data.result.unresolved.length + " line(s) unresolved");
      $("status").textContent = "OK" + (bits.length ? ": " + bits.join(", ") : "");
    } else {
      $("status").textContent = "Refused (" + (data.error_kind || response.status) + "): " + data.error;
    }
  } catch (err) {
    $("status").textContent = "Request failed: " + err;
  } finally {
    $("runBtn").disabled = false;
  }
}

function newSession() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
let chatSession = newSession();

function traceItem(step) {
  const li = el("li");
  if (step.kind === "model") {
    if (!step.ok) { li.className = "bad"; li.textContent = "model failed: " + step.error; return li; }
    li.textContent = "model: " + (step.generationTokens ?? "?") + " tokens, " + Math.round(step.elapsedMs || 0) + " ms" +
      (step.toolCallsRequested ? ", asked for " + step.toolCallsRequested + " tool call(s)" : ", answered");
    if (step.thinking) {
      const d = el("details");
      d.appendChild(el("summary", {}, "thinking"));
      d.appendChild(el("pre", {}, step.thinking));
      li.appendChild(d);
    }
    return li;
  }
  if (!step.ok) li.className = "bad";
  li.textContent = (step.tool || "(no tool)") + " " + JSON.stringify(step.arguments ?? {}) + " -> " +
    (step.ok ? "ok" : (step.errorKind || "error")) + ": " + (step.summary || "") + " (" + Math.round(step.elapsedMs || 0) + " ms)";
  return li;
}

function showTurn(question, data) {
  const turn = el("div", {class: "turn"});
  turn.appendChild(el("div", {class: "q"}, question));
  turn.appendChild(el("div", {class: data.ok ? "a" : "a err"}, data.answer || data.error || "No answer."));
  if (data.trace && data.trace.length) {
    const d = el("details");
    d.appendChild(el("summary", {}, "trace: " + data.toolCalls + " tool call(s), " + Math.round(data.elapsedMs || 0) +
      " ms, prompt " + data.promptVersion + ", snapshot " + data.rulesVersion));
    const ol = el("ol");
    for (const step of data.trace) ol.appendChild(traceItem(step));
    d.appendChild(ol);
    turn.appendChild(d);
  }
  $("chatLog").appendChild(turn);
}

async function sendChat() {
  const question = $("chatInput").value.trim();
  if (!question) return;
  $("chatSend").disabled = true;
  $("chatStatus").textContent = "Thinking … (the first question also loads the model)";
  try {
    const response = await fetch("/api/chat", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({session: chatSession, message: question})});
    const data = await response.json();
    showTurn(question, data);
    $("chatStatus").textContent = data.ok ? "" : "Refused (" + (data.error_kind || data.stopReason || response.status) + ")";
    if (data.ok) $("chatInput").value = "";
  } catch (err) {
    $("chatStatus").textContent = "Request failed: " + err;
  } finally {
    $("chatSend").disabled = false;
  }
}

$("chatSend").addEventListener("click", sendChat);
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$("chatNew").addEventListener("click", () => { chatSession = newSession(); $("chatLog").textContent = ""; $("chatStatus").textContent = "New chat."; });
$("runBtn").addEventListener("click", run);
$("toolForm").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); run(); }
});
loadTools().then(loadDecks).catch((err) => { $("status").textContent = "Could not load tools: " + err; });
</script>
</body>
</html>
"""
