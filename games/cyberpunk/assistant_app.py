"""The local assistant's loopback page: a Chat tab (default) and a Tools tab that runs any tool by hand.

Every tool in this project gets a UI, and the card, rules and deck tools in
``games/cyberpunk/assistant/`` are no exception: the Tools tab lists the
registry, builds a form from each tool's JSON schema, runs the tool on the
server and shows the JSON result exactly as a model would receive it.

Chat tab: ``POST /api/chat`` with ``{"session": id, "message": text,
"thinking": bool?}`` runs one turn of ``assistant/loop.py`` against the
configured model and returns the answer and its trace (every model step and
tool call, its arguments, ok or error, a summary, its result, sources and
timings). The page renders the answer through a tiny escaping markdown subset
(paragraphs, lists, bold, inline code) and every other model or tool string with
``textContent``. Each session keeps a short history and, optionally, a deck
loaded in the deck panel (``POST /api/deck`` runs ``parse_deck`` and, when every
line resolves, holds the deck and adds ``check_deck`` and ``deck_profile``;
``/api/deck/clear`` drops it). The loop gives a held deck to the model as a
labelled block in the system message (``loop.deck_context``).
``/api/chat/reset`` starts a new chat (history cleared; the deck stays until
cleared). ``GET /api/status`` reports the snapshot (``RULES_VERSION``, card
count) and the model's state: none, idle, loading, ready or error. With no model
configured the chat route answers 503 ``no_model``; a real model is a local MLX
worker that starts on the first question (``scripts/assistant_local.py
--model``). The example-question chips only fill the input box.

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
import html
import ipaddress
import re
import secrets
from collections import OrderedDict
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from games.cyberpunk.assistant.decks import public_deck_index
from games.cyberpunk.assistant.loop import ASSISTANT_PROMPT_VERSION, MAX_TOOL_CALLS, run_turn
from games.cyberpunk.assistant.tools import TOOLS, call_tool, cards
from games.cyberpunk.config import REPO_ROOT
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.webui.monitor import build_app
from harness.core.webui.runner import lan_ip

__all__ = ["build_assistant_app", "serve_assistant", "ASSISTANT_HTML", "is_loopback", "host_allowed",
           "ChatService", "Session", "deck_brief", "EXAMPLE_QUESTIONS"]

DEFAULT_PORT = 8767
TITLE = "Cyberpunk TCG assistant"
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_MESSAGE_CHARS = 8000
# Suggestions for the chat input, one per kind of question. They only fill the input box; nothing on
# the server or in the loop looks at them (scripts/test_assistant_ui.py checks that).
EXAMPLE_QUESTIONS = (
    ("Rules", "Which Units can attack, and which Units can be attacked? Cite the rules."),
    ("Deckbuilding", "Is my loaded deck legal, and where is its cost curve thin?"),
    ("Matchup", "How might my loaded deck fare against a Blue deck full of Blockers? Label what is judgment."),
    ("Combo", "Which cards work well with V: Streetkid, and why?"),
)
NO_MODEL = ("No model configured. Restart with: python scripts/assistant_local.py --model models/qwen3-8b-4bit "
            "(Apple Silicon Mac with mlx-lm installed and the weights downloaded).")


@dataclass
class Session:
    """One chat: the kept history and the deck loaded in the deck panel (or None)."""
    history: list[dict] = field(default_factory=list)
    deck: dict | None = None


def deck_brief(deck: dict | None) -> dict | None:
    """What the page shows about the held deck: name, format, counts and where it came from."""
    if deck is None:
        return None
    counts = {z["zone_code"]: sum(c["quantity"] for c in z["cards"]) for z in deck.get("zones", [])}
    fmt = deck.get("format") or {}
    return {"name": deck.get("name"), "format": fmt.get("name") or fmt.get("code"),
            "legends": counts.get("legends", 0), "deck": counts.get("deck", 0),
            "source": (deck.get("source") or {}).get("kind", "pasted")}


class ChatService:
    """Sessions of short history and an optional loaded deck over one model; turns run one at a time."""

    def __init__(self, model=None, *, max_history_messages: int = 8, max_sessions: int = 32,
                 enable_thinking: bool = False, max_tokens: int = 1024):
        self.model = model
        self.max_history_messages = max_history_messages
        self.max_sessions = max_sessions
        self.enable_thinking = enable_thinking
        self.max_tokens = max_tokens
        self.sessions: OrderedDict[str, Session] = OrderedDict()
        self._lock: asyncio.Lock | None = None
        # Model status for the header badge: none, idle (starts on the first question), loading, ready, error.
        self.model_state = "none" if model is None else "idle"
        self.last_error: str | None = None
        self.busy = False

    def session(self, session: str) -> Session:
        record = self.sessions.get(session)
        if record is None:
            record = self.sessions[session] = Session()
        self.sessions.move_to_end(session)
        while len(self.sessions) > self.max_sessions:
            self.sessions.popitem(last=False)
        return record

    def status(self) -> dict:
        return {"configured": self.model is not None, "label": getattr(self.model, "label", None),
                "state": self.model_state, "lastError": self.last_error, "busy": self.busy,
                "thinkingDefault": self.enable_thinking, "maxTokens": self.max_tokens}

    async def chat(self, session: str, message: str, *, thinking: bool | None = None) -> dict:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            record = self.session(session)
            history = list(record.history)
            self.busy = True
            if self.model_state in ("idle", "error"):
                self.model_state = "loading"
            try:
                turn = await run_turn(history, message, self.model, max_tokens=self.max_tokens,
                                      enable_thinking=self.enable_thinking if thinking is None else thinking,
                                      deck=record.deck)
            finally:
                self.busy = False
            if turn.stop_reason == "model_error":
                self.model_state, self.last_error = "error", turn.error
            else:
                self.model_state = "ready"
            if turn.ok:
                # Only the question and the final answer are kept: facts are fetched
                # again by tools, and the answer's cited slugs carry the context.
                history += [{"role": "user", "content": message}, {"role": "assistant", "content": turn.answer}]
                record.history = history[-self.max_history_messages:]
            return {**turn.to_dict(), "session": session, "historyMessages": len(record.history),
                    "thinking": self.enable_thinking if thinking is None else thinking,
                    "deckInContext": deck_brief(record.deck)}

    def reset(self, session: str) -> dict:
        """New chat: forget the history; a loaded deck stays until it is cleared."""
        record = self.session(session)
        record.history = []
        return {"ok": True, "session": session, "historyMessages": 0, "deck": deck_brief(record.deck)}

    def load_deck(self, session: str, args: dict) -> tuple[dict, int]:
        """Run parse_deck; when every line resolves, hold the deck and add check_deck and deck_profile."""
        parsed = call_tool("parse_deck", args)
        if not parsed["ok"]:
            return {"ok": False, "loaded": False, "parse": parsed, "error_kind": parsed.get("error_kind"),
                    "error": parsed.get("error")}, 404 if parsed.get("error_kind") == "not_found" else 400
        deck = parsed["result"]["deck"]
        record = self.session(session)
        body = {"ok": True, "loaded": deck is not None, "parse": parsed, "check": None, "profile": None}
        if deck is not None:
            record.deck = deck
            body["check"] = call_tool("check_deck", {"deck": deck})
            body["profile"] = call_tool("deck_profile", {"deck": deck})
        body["deck"] = deck_brief(record.deck)
        return body, 200

    def clear_deck(self, session: str) -> dict:
        record = self.session(session)
        record.deck = None
        return {"ok": True, "session": session, "deck": None}

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

        async def session_payload(request: Request):
            """(payload, session) or (refusal response, None)."""
            try:
                payload = await request.json()
            except ValueError:
                payload = None
            if not isinstance(payload, dict):
                return chat_refusal("invalid_arguments", "Send a JSON object with a session id.", 400), None
            session = payload.get("session")
            if not isinstance(session, str) or not SESSION_RE.match(session):
                return chat_refusal("invalid_arguments", "session must be 1-64 letters, digits, - or _.", 400), None
            return payload, session

        @app.get("/api/status")
        def status():
            return {"rulesVersion": RULES_VERSION, "cardCount": len(cards()), "promptVersion": ASSISTANT_PROMPT_VERSION,
                    "maxToolCalls": MAX_TOOL_CALLS, "model": chat.status()}

        @app.post("/api/chat")
        async def post_chat(request: Request):
            payload, session = await session_payload(request)
            if session is None:
                return payload
            message, thinking = payload.get("message"), payload.get("thinking")
            if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
                return chat_refusal("invalid_arguments",
                                    f"message must be non-empty text of at most {MAX_MESSAGE_CHARS} characters.", 400)
            if thinking is not None and not isinstance(thinking, bool):
                return chat_refusal("invalid_arguments", "thinking must be true, false or omitted.", 400)
            if chat.model is None:
                return chat_refusal("no_model", NO_MODEL, 503)
            result = await chat.chat(session, message.strip(), thinking=thinking)
            return JSONResponse(result, status_code=200 if result["stopReason"] != "model_error" else 502)

        @app.post("/api/chat/reset")
        async def reset_chat(request: Request):
            payload, session = await session_payload(request)
            return payload if session is None else chat.reset(session)

        @app.post("/api/deck")
        async def load_deck(request: Request):
            payload, session = await session_payload(request)
            if session is None:
                return payload
            args = {k: v for k, v in payload.items() if k != "session"}
            if set(args) - {"text", "deck_id", "format"}:
                return chat_refusal("invalid_arguments", "Send text or deck_id (and optionally format).", 400)
            body, code = chat.load_deck(session, args)
            return JSONResponse(body, status_code=code)

        @app.post("/api/deck/clear")
        async def clear_deck(request: Request):
            payload, session = await session_payload(request)
            return payload if session is None else chat.clear_deck(session)

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
:root{--bg:#f6f6f4;--panel:#fff;--ink:#1b1b1f;--muted:#666;--line:#ddd;--accent:#0b6e69;--warn:#a03a00;--ok:#1d6b2f;--sel:#e7f4f2;--card:#fafafa}
@media (prefers-color-scheme: dark){:root{--bg:#141417;--panel:#1d1d22;--ink:#e8e8ea;--muted:#9a9aa2;--line:#33333a;--accent:#4fc1b8;--warn:#ff9a5c;--ok:#7fd18e;--sel:#183331;--card:#24242a}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
header h1{font-size:16px;margin:0}
.badge{font-size:12px;border:1px solid var(--line);border-radius:10px;padding:1px 8px;color:var(--muted);white-space:nowrap}
.badge.ready{color:var(--ok);border-color:var(--ok)}.badge.error{color:var(--warn);border-color:var(--warn)}
.badge.loading{color:var(--accent);border-color:var(--accent)}
nav{display:flex;gap:2px}
nav button{background:none;border:0;border-bottom:2px solid transparent;padding:6px 10px;color:var(--muted);font:inherit;cursor:pointer}
nav button.on{border-bottom-color:var(--accent);color:var(--ink)}
.wrap{padding:16px;max-width:1280px;margin:0 auto}
#tabTools{display:grid;grid-template-columns:240px 1fr;gap:12px}
.chatgrid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:12px}
@media (max-width:860px){#tabTools,.chatgrid{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px;min-width:0}
.panel h2{margin:0 0 6px;font-size:15px}
ul.tools{list-style:none;margin:0;padding:0}
ul.tools li button{width:100%;text-align:left;background:none;border:0;border-radius:6px;padding:6px 8px;color:var(--ink);font:inherit;cursor:pointer}
ul.tools li button.on{background:var(--sel)}
.muted{color:var(--muted)}.err{color:var(--warn);white-space:pre-wrap}.good{color:var(--ok)}
form{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin:10px 0}
label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
label .req{color:var(--warn)}
label.wide{grid-column:1/-1}
label.inline{flex-direction:row;align-items:center;gap:6px}
textarea.x{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:9em;resize:vertical}
button.small{font:inherit;font-size:12px;padding:2px 8px;border-radius:5px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;align-self:flex-start}
input,select,textarea{font:inherit;padding:5px 6px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--ink);min-width:0}
button.go{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:70vh;overflow:auto;background:var(--card);padding:8px;border-radius:6px;margin:0}
.status{margin:8px 0;font-size:13px}
#chatLog{display:flex;flex-direction:column;gap:10px;margin-bottom:10px}
.msg{border-radius:8px;padding:8px 10px;max-width:100%;overflow-wrap:anywhere}
.msg.q{background:var(--sel);white-space:pre-wrap;align-self:flex-end;max-width:85%}
.msg.a{background:var(--card);border:1px solid var(--line)}
.msg.a p{margin:0 0 6px}.msg.a ul,.msg.a ol{margin:0 0 6px;padding-left:20px}
.msg.a code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--sel);padding:0 3px;border-radius:3px}
.flag{display:inline-block;font-size:12px;color:var(--warn);border:1px solid var(--warn);border-radius:10px;padding:0 8px;margin-bottom:6px}
details.trace{margin-top:6px;font-size:12px}
details.trace>summary{cursor:pointer;color:var(--muted)}
details.step{border-left:2px solid var(--line);padding-left:8px;margin:4px 0}
details.step.bad{border-left-color:var(--warn)}
details.step>summary{cursor:pointer;overflow-wrap:anywhere}
details.step pre{margin:4px 0;max-height:40vh}
.sources{margin-top:6px;font-size:12px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.sources button{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 6px;border-radius:4px;border:1px solid var(--line);background:var(--panel);color:var(--accent);cursor:pointer}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.chips button{font:inherit;font-size:12px;padding:3px 10px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.chatrow{display:flex;gap:8px;align-items:flex-end}
.chatrow textarea{flex:1;min-height:3.2em;resize:vertical}
.chatopts{display:flex;gap:12px;align-items:center;margin-top:6px;flex-wrap:wrap}
.decknote{font-size:12px;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.row{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.row select{flex:1}
#deckText{width:100%;min-height:7em}
dl.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 10px;margin:4px 0;font-size:12px}
dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
ul.plain{margin:4px 0;padding-left:18px;font-size:12px}
h3{font-size:13px;margin:10px 0 4px}
</style>
</head>
<body>
<header>
  <h1>Cyberpunk TCG assistant</h1>
  <nav><button type="button" id="tabBtnChat" class="on" data-tab="Chat">Chat</button><button type="button" id="tabBtnTools" data-tab="Tools">Tools</button></nav>
  <span class="badge" id="snapshot">snapshot …</span>
  <span class="badge" id="modelBadge">model …</span>
</header>
<div class="wrap">
<section id="tabChat">
  <div class="chatgrid">
    <div class="panel">
      <p class="muted" style="margin:0 0 8px">The local model answers from tool results only; every tool it ran is in the trace under its answer. Strategy, combos and matchups are its judgment.</p>
      <div class="decknote" id="deckNote"></div>
      <div id="chatLog"></div>
      <div class="chips" id="chips">__EXAMPLES__</div>
      <div class="chatrow">
        <textarea id="chatInput" placeholder="Ask about a card, a rule or a deck (Enter sends, Shift+Enter for a new line)"></textarea>
        <button class="go" id="chatSend" type="button">Send</button>
      </div>
      <div class="chatopts">
        <label class="inline"><input type="checkbox" id="thinkToggle"> think first (slower)</label>
        <button class="small" id="chatNew" type="button">New chat</button>
      </div>
      <div class="status" id="chatStatus"></div>
    </div>
    <aside>
      <div class="panel">
        <h2>Deck</h2>
        <p class="muted" style="margin:0 0 6px;font-size:12px">Paste a list or pick a public deck. A deck that fully resolves is held for this chat and given to the model with every question until you clear it.</p>
        <textarea id="deckText" class="x" spellcheck="false" placeholder="Legends&#10;1 V: Streetkid&#10;...&#10;Deck&#10;3 Kiroshi Optics&#10;..."></textarea>
        <div class="row"><button class="small" id="deckLoadText" type="button">Load pasted list</button></div>
        <div class="row"><select id="deckPick"><option value="">(public decks loading …)</option></select><button class="small" id="deckLoadPick" type="button">Load</button></div>
        <div class="row"><button class="small" id="deckClear" type="button">Clear deck</button></div>
        <div class="status" id="deckStatus"></div>
        <div id="deckResult"></div>
      </div>
      <div class="panel">
        <h2 id="sideTitle">Source</h2>
        <div id="sideBody" class="muted">Click a card slug or rule id under an answer to see what the tools return for it.</div>
      </div>
    </aside>
  </div>
</section>
<section id="tabTools" hidden>
  <div class="panel"><ul class="tools" id="toolList"></ul></div>
  <div>
    <div class="panel">
      <p class="muted" style="margin:0 0 6px">Run any card, rules or deck tool by hand. A tool's result is exactly what the model receives.</p>
      <h2 id="toolName" style="margin:0;font-size:15px">Pick a tool</h2>
      <p id="toolDesc" class="muted"></p>
      <form id="toolForm" autocomplete="off"></form>
      <button class="go" id="runBtn" type="button" disabled>Run</button>
      <div class="status" id="status"></div>
    </div>
    <div class="panel"><pre id="output" class="muted">No result yet.</pre></div>
  </div>
</section>
</div>
<script>
"use strict";
// pure:start  (no DOM; scripts/test_assistant_ui.py runs this part under node)
const ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
// Inline markdown on one line: `code` and **bold** only. Every piece is escaped
// before a tag is added, and the only tags added are fixed literals.
function inlineMd(raw) {
  const parts = String(raw).split("`");
  return parts.map((part, i) => {
    const safe = escapeHtml(part);
    if (i % 2 === 1 && i < parts.length - 1) return "<code>" + safe + "</code>";
    const text = i % 2 === 1 ? "`" + safe : safe;  // an unmatched backtick stays literal
    return text.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  }).join("");
}
const UL_RE = /^\s*[-*]\s+/, OL_RE = /^\s*\d+[.)]\s+/;
// Model text to HTML: paragraphs, bulleted and numbered lists, bold, inline code. Nothing else.
function mdToHtml(text) {
  const out = [];
  for (const block of String(text ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    let kind = null, items = [];
    const flush = () => {
      if (!items.length) return;
      if (kind === "p") out.push("<p>" + items.map(inlineMd).join("<br>") + "</p>");
      else out.push("<" + kind + ">" + items.map((t) => "<li>" + inlineMd(t) + "</li>").join("") + "</" + kind + ">");
      items = [];
    };
    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      const k = UL_RE.test(line) ? "ul" : OL_RE.test(line) ? "ol" : "p";
      if (k !== kind) { flush(); kind = k; }
      items.push(k === "ul" ? line.replace(UL_RE, "") : k === "ol" ? line.replace(OL_RE, "") : line);
    }
    flush();
  }
  return out.join("");
}
function ms(value) { return Math.round(value || 0) + " ms"; }
// One line per trace step (shown with textContent).
function stepLine(step) {
  if (step.kind === "model") {
    if (!step.ok) return "model · error · " + (step.error || "failed");
    return "model · " + (step.finishReason === "length" ? "token limit" : "ok") + " · " +
      (step.generationTokens ?? "?") + " tokens · " +
      (step.toolCallsRequested ? "asked for " + step.toolCallsRequested + " tool call(s)" : "answered") + " · " + ms(step.elapsedMs);
  }
  return (step.tool || "(no tool)") + " · " + (step.ok ? "ok" : (step.errorKind || "error")) + " · " +
    (step.summary || "") + " · " + ms(step.elapsedMs);
}
// Flags for an answer that did not end normally.
function answerFlags(data, maxToolCalls) {
  const flags = [];
  if (data.stopReason === "tool_cap") flags.push("hit the tool-call cap (" + maxToolCalls + " calls)");
  if (data.stopReason === "length" || (data.trace || []).some((s) => s.kind === "model" && s.finishReason === "length"))
    flags.push("hit the token limit");
  if (data.stopReason === "model_error") flags.push("model error");
  if (data.stopReason === "empty") flags.push("no answer text");
  return flags;
}
// pure:end

const state = {tools: [], current: null, decks: [], lastDeck: null, maxToolCalls: 6, busy: false};
// Arguments the schema types do not fully describe get their own control.
const LONG_TEXT = 1000;
const $ = (id) => document.getElementById(id);

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function postJson(url, body) {
  const response = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch (err) { data = {ok: false, error: "HTTP " + response.status}; }
  return [response, data];
}

// Tabs ------------------------------------------------------------------------------
function showTab(name) {
  for (const tab of ["Chat", "Tools"]) {
    $("tab" + tab).hidden = tab !== name;
    $("tabBtn" + tab).classList.toggle("on", tab === name);
  }
}
for (const b of document.querySelectorAll("nav button")) b.addEventListener("click", () => showTab(b.dataset.tab));

// Status badges ---------------------------------------------------------------------
const MODEL_TEXT = {none: "no model configured", idle: "model idle (loads on first question)", loading: "model loading …",
  ready: "model ready", error: "model error"};
let statusTimer = null;
async function loadStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) return;
  const data = await response.json();
  state.maxToolCalls = data.maxToolCalls;
  $("snapshot").textContent = "snapshot " + data.rulesVersion + " · " + data.cardCount + " cards";
  const m = data.model;
  const badge = $("modelBadge");
  badge.className = "badge " + m.state;
  badge.textContent = (m.label ? m.label + ": " : "") + (MODEL_TEXT[m.state] || m.state) + (m.busy && m.state === "ready" ? " (answering)" : "");
  badge.title = m.lastError ? "last error: " + m.lastError : "prompt " + data.promptVersion;
  if (!state.statusLoaded) { $("thinkToggle").checked = !!m.thinkingDefault; state.statusLoaded = true; }
}

// Chat ------------------------------------------------------------------------------
function newSession() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
const chatSession = newSession();

function jsonPre(label, value) {
  const wrap = el("div");
  wrap.appendChild(el("div", {class: "muted"}, label));
  wrap.appendChild(el("pre", {}, JSON.stringify(value ?? null, null, 2)));
  return wrap;
}

function traceRow(step) {
  const d = el("details", {class: step.ok ? "step" : "step bad"});
  d.appendChild(el("summary", {}, stepLine(step)));
  if (step.kind === "model") {
    d.appendChild(jsonPre("model step", {finishReason: step.finishReason, promptTokens: step.promptTokens,
      generationTokens: step.generationTokens, elapsedMs: step.elapsedMs, error: step.error}));
    if (step.thinking) d.appendChild(jsonPre("thinking", step.thinking));
  } else {
    d.appendChild(jsonPre("arguments", step.arguments ?? {}));
    d.appendChild(step.ok ? jsonPre("result", step.result) : jsonPre("error", {errorKind: step.errorKind, error: step.error}));
  }
  return d;
}

function sourceButtons(sources) {
  const box = el("div", {class: "sources"});
  const s = sources || {};
  const slugs = s.card_slugs || [], rules = s.rule_ids || [], errata = s.errata_ids || [];
  if (!slugs.length && !rules.length && !errata.length) return null;
  box.appendChild(el("span", {class: "muted"}, "Sources:"));
  for (const slug of slugs) {
    const b = el("button", {type: "button", title: "card facts from get_card"}, slug);
    b.addEventListener("click", () => showSource("get_card", {slug}, slug));
    box.appendChild(b);
  }
  for (const id of rules) {
    const b = el("button", {type: "button", title: "rule from get_rule"}, "rule " + id);
    b.addEventListener("click", () => showSource("get_rule", {rule_id: id}, "rule " + id));
    box.appendChild(b);
  }
  if (errata.length) box.appendChild(el("span", {class: "muted"}, errata.length + " erratum/errata applied"));
  return box;
}

function showTurn(question, data) {
  $("chatLog").appendChild(el("div", {class: "msg q"}, question));
  const answer = el("div", {class: "msg a"});
  for (const flag of answerFlags(data, state.maxToolCalls)) answer.appendChild(el("div", {class: "flag"}, flag));
  const body = el("div", {class: data.ok ? "" : "err"});
  // The one HTML sink on the page: mdToHtml escapes everything before adding its few fixed tags.
  body.innerHTML = mdToHtml(data.answer || data.error || "No answer.");
  answer.appendChild(body);
  const src = sourceButtons(data.sources);
  if (src) answer.appendChild(src);
  if (data.trace && data.trace.length) {
    const d = el("details", {class: "trace"});
    d.appendChild(el("summary", {}, "Trace: " + (data.toolCalls || 0) + " tool call(s), " + ms(data.elapsedMs) +
      (data.thinking ? ", thinking on" : "") + (data.deckInContext ? ", deck in context" : "") +
      " · prompt " + data.promptVersion + " · snapshot " + data.rulesVersion));
    for (const step of data.trace) d.appendChild(traceRow(step));
    answer.appendChild(d);
  }
  $("chatLog").appendChild(answer);
  answer.scrollIntoView({block: "nearest"});
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["chatSend", "chatNew", "deckLoadText", "deckLoadPick", "deckClear"]) $(id).disabled = busy;
  $("chatInput").readOnly = busy;
  clearInterval(statusTimer);
  if (busy) statusTimer = setInterval(() => loadStatus().catch(() => {}), 2000);
}

async function sendChat() {
  const question = $("chatInput").value.trim();
  if (!question || state.busy) return;
  setBusy(true);
  $("chatStatus").textContent = "Working … (the first question also loads the model)";
  loadStatus().catch(() => {});
  try {
    const [response, data] = await postJson("/api/chat", {session: chatSession, message: question,
      thinking: $("thinkToggle").checked});
    showTurn(question, data);
    $("chatStatus").textContent = data.ok ? "" : "Refused (" + (data.error_kind || data.stopReason || response.status) + ")";
    if (data.ok) $("chatInput").value = "";
  } catch (err) {
    $("chatStatus").textContent = "Request failed: " + err;
  } finally {
    setBusy(false);
    loadStatus().catch(() => {});
  }
}

async function newChat() {
  const [, data] = await postJson("/api/chat/reset", {session: chatSession});
  $("chatLog").textContent = "";
  $("chatStatus").textContent = data.ok ? "New chat: history cleared" + (data.deck ? "; the loaded deck stays until you clear it." : ".") :
    "Could not reset: " + data.error;
}

// Source side panel -------------------------------------------------------------------
function factsList(obj) {
  const dl = el("dl", {class: "facts"});
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) continue;
    dl.appendChild(el("dt", {}, key));
    const shown = Array.isArray(value) && value.every((v) => typeof v !== "object") ? value.join(", ") :
      typeof value === "object" ? JSON.stringify(value, null, 1) : String(value);
    dl.appendChild(el("dd", {}, shown));
  }
  return dl;
}

async function showSource(tool, args, label) {
  $("sideTitle").textContent = label;
  const body = $("sideBody");
  body.className = "muted";
  body.textContent = "Loading " + tool + " …";
  const [, data] = await postJson("/api/tools/" + encodeURIComponent(tool), args);
  body.textContent = "";
  if (!data.ok) { body.className = "err"; body.textContent = (data.error_kind || "error") + ": " + data.error; return; }
  body.className = "";
  const result = data.result || {};
  const main = result.card || result.rule;
  if (main) body.appendChild(factsList(main));
  const rest = Object.fromEntries(Object.entries(result).filter(([k]) => k !== "card" && k !== "rule"));
  if (Object.keys(rest).length) body.appendChild(factsList(rest));
  body.appendChild(el("div", {class: "muted", style: "font-size:11px"}, tool + " · snapshot " + data.rules_version));
}

// Deck panel ------------------------------------------------------------------------
function showHeldDeck(brief) {
  const note = $("deckNote");
  note.textContent = "";
  if (!brief) { note.appendChild(el("span", {class: "muted"}, "No deck loaded.")); return; }
  note.appendChild(el("span", {}, "Deck in context: " + (brief.name || "(unnamed)") + " · " + brief.legends +
    " Legends + " + brief.deck + " cards" + (brief.format ? " · " + brief.format : "") + " · " + brief.source));
  const clear = el("button", {type: "button", class: "small"}, "Clear");
  clear.addEventListener("click", clearDeck);
  note.appendChild(clear);
}

function slugButton(slug, text) {
  const b = el("button", {type: "button", class: "small"}, text || slug);
  b.addEventListener("click", () => showSource("get_card", {slug}, slug));
  return b;
}

function renderDeck(data) {
  const out = $("deckResult");
  out.textContent = "";
  if (!data.ok) {
    $("deckStatus").className = "status err";
    $("deckStatus").textContent = "Refused (" + (data.error_kind || "error") + "): " + data.error;
    return;
  }
  const parsed = data.parse.result;
  $("deckStatus").className = "status " + (data.loaded ? "good" : "err");
  $("deckStatus").textContent = data.loaded ? "Loaded: the model sees this deck with every question." :
    "Not loaded: " + parsed.unresolved.length + " line(s) did not resolve to one card." +
    (data.deck ? " The previous deck stays in context." : "");
  if (parsed.unresolved.length) {
    out.appendChild(el("h3", {}, "Unresolved lines"));
    const ul = el("ul", {class: "plain"});
    for (const u of parsed.unresolved) {
      const li = el("li", {}, "line " + u.line + ": " + u.text + " (" + u.status + ")");
      for (const c of u.candidates || []) {
        li.appendChild(document.createTextNode(" "));
        li.appendChild(slugButton(c.slug, c.display_name + " · " + c.card_type + " · " + c.color));
      }
      ul.appendChild(li);
    }
    out.appendChild(ul);
  }
  for (const note of parsed.notes || []) out.appendChild(el("p", {class: "muted", style: "font-size:12px"}, note));
  if (data.check && data.check.ok) {
    const c = data.check.result;
    out.appendChild(el("h3", {class: c.legal ? "good" : "err"}, c.legal ? "Legal (construction rules)" : "Not legal"));
    if (c.violations.length) {
      const ul = el("ul", {class: "plain"});
      for (const v of c.violations) ul.appendChild(el("li", {}, v.rule + ": " + v.detail));
      out.appendChild(ul);
    }
  }
  if (data.profile && data.profile.ok) {
    const p = data.profile.result;
    out.appendChild(el("h3", {}, "Profile"));
    const ram = Object.entries(p.ram || {}).map(([colour, r]) => colour + " " + r.usage + "/" + r.budget).join(", ");
    out.appendChild(factsList({
      cards: p.counts.legends + " Legends + " + p.counts.deck + " (" + p.counts.distinct_deck_cards + " distinct)",
      curve: Object.entries(p.cost_curve || {}).map(([cost, n]) => cost + ":" + n).join("  "),
      "average cost": p.average_cost,
      colours: Object.entries(p.colour_split || {}).map(([k, n]) => k + " " + n).join(", "),
      types: Object.entries(p.type_split || {}).map(([k, n]) => k + " " + n).join(", "),
      "RAM used/budget": ram,
      keywords: Object.entries(p.keywords_printed || {}).map(([k, n]) => k + " " + n).join(", "),
    }));
    const legends = el("div", {class: "row"});
    for (const l of p.legends || []) legends.appendChild(slugButton(l.slug, l.display_name));
    out.appendChild(legends);
  }
  showHeldDeck(data.deck);
}

async function loadDeck(args) {
  setBusy(true);
  $("deckStatus").className = "status";
  $("deckStatus").textContent = "Running parse_deck …";
  try {
    const [, data] = await postJson("/api/deck", {session: chatSession, ...args});
    renderDeck(data);
  } catch (err) {
    $("deckStatus").textContent = "Request failed: " + err;
  } finally {
    setBusy(false);
  }
}

async function clearDeck() {
  const [, data] = await postJson("/api/deck/clear", {session: chatSession});
  $("deckResult").textContent = "";
  $("deckStatus").className = "status";
  $("deckStatus").textContent = data.ok ? "Deck cleared: later questions do not include it." : "Could not clear: " + data.error;
  showHeldDeck(null);
}

function fillDeckPick() {
  const select = $("deckPick");
  select.textContent = "";
  select.appendChild(el("option", {value: ""}, "(pick a public deck)"));
  for (const d of state.decks) {
    select.appendChild(el("option", {value: d.id}, (d.name || "(unnamed)") + " · " + (d.colours || []).join("/") + " · " + d.card_count + " cards"));
  }
}

// Tools tab -------------------------------------------------------------------------
async function loadDecks() {
  const response = await fetch("/api/decks");
  if (!response.ok) return;
  state.decks = (await response.json()).decks;
  fillDeckPick();
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
  if (state.tools.some((t) => t.name === wanted)) { showTab("Tools"); pick(wanted); } else pick(state.tools[0].name, true);
}

function pick(name, quiet) {
  const tool = state.tools.find((t) => t.name === name);
  state.current = tool;
  if (!quiet) history.replaceState(null, "", "#" + name);
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

// Wiring ----------------------------------------------------------------------------
// Example chips only fill the input box; the question goes through the same path as any other.
for (const chip of document.querySelectorAll("#chips button")) {
  chip.addEventListener("click", () => { $("chatInput").value = chip.dataset.example; $("chatInput").focus(); });
}
$("chatSend").addEventListener("click", sendChat);
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});
$("chatNew").addEventListener("click", () => newChat().catch((err) => { $("chatStatus").textContent = "Request failed: " + err; }));
$("deckLoadText").addEventListener("click", () => {
  const text = $("deckText").value.trim();
  if (text) loadDeck({text}); else $("deckStatus").textContent = "Paste a deck list first.";
});
$("deckLoadPick").addEventListener("click", () => {
  const id = $("deckPick").value;
  if (id) loadDeck({deck_id: id}); else $("deckStatus").textContent = "Pick a public deck first.";
});
$("deckClear").addEventListener("click", () => clearDeck().catch((err) => { $("deckStatus").textContent = "Request failed: " + err; }));
$("runBtn").addEventListener("click", run);
$("toolForm").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); run(); }
});
showHeldDeck(null);
loadStatus().catch(() => { $("modelBadge").textContent = "status unavailable"; });
loadTools().then(loadDecks).catch((err) => { $("status").textContent = "Could not load tools: " + err; });
</script>
</body>
</html>
"""
ASSISTANT_HTML = ASSISTANT_HTML.replace("__EXAMPLES__", "".join(
    f'<button type="button" data-example="{html.escape(question)}" title="{html.escape(question)}">'
    f'{html.escape(label)}</button>' for label, question in EXAMPLE_QUESTIONS))
