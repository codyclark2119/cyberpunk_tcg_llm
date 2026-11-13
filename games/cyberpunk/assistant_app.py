"""The local assistant's loopback page: a Chat tab (default) and a Tools tab that runs any tool by hand.

Every tool in this project gets a UI, and the card, rules and deck tools in
``games/cyberpunk/assistant/`` are no exception: the Tools tab lists the
registry, builds a form from each tool's JSON schema, runs the tool on the
server and shows the JSON result exactly as a model would receive it.

Chat tab: ``POST /api/chat`` with ``{"session": id, "message": text,
"thinking": bool?, "preload": bool?}`` runs one turn of ``assistant/loop.py``
against the configured model and returns the answer and its trace (every model
step and tool call, its arguments, ok or error, a summary, its result, sources
and timings). The automatic context steps the loop ran before the model spoke
(``auto: true``) open the trace, marked "auto". The settings row has a toggle
each for thinking and the preload, defaulting to the server's settings. The page renders the answer through a tiny escaping markdown subset
(paragraphs, lists, bold, inline code) and every other model or tool string with
``textContent``. Each session keeps a short history and, optionally, a deck
loaded in the deck panel (``POST /api/deck`` runs ``parse_deck`` and, when every
line resolves, holds the deck and adds ``check_deck`` and ``deck_profile``;
``/api/deck/clear`` drops it). The loop gives a held deck to the model as a
labelled block in the system message (``loop.deck_context``).
``/api/chat/reset`` starts a new chat (history cleared; the deck stays until
cleared). ``GET /api/status`` reports the snapshot (``RULES_VERSION``, ``TOURNAMENT_RULES_VERSION``, card
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

Eval tab: the multiple-choice gold sets under ``data/gold/`` (questions,
choices, the key and a review note per question), a Run button and the scored
runs under ``eval/runs/``. Notes are written atomically to a sidecar under
``eval/notes/`` and never to ``data/gold/`` (``assistant/eval_store.py``). The
Run button is one allowlisted ``Runner`` action (``eval_action``, the same
pattern as ``play_app.bot_match_action``): the page names the action and fills
its declared values, ``EvalRunner`` checks each value and builds the
``scripts/eval_assistant.py`` argv server-side with the page's own model
settings (no shell), and it refuses to start while a chat turn or another job
is running; the chat refuses while an eval job runs. Progress comes from the
job log (the monitor's ``/api/job`` route). The form carries max tokens
(1..``MAX_TOKENS_LIMIT``), max tool calls (1..``MAX_TOOL_CALLS_LIMIT``) and
"resume"; a run name with an incomplete ``<name>.partial.jsonl`` is refused
unless resume or replace is ticked, and the Runs list shows such a partial as
incomplete. Sample, Seed and Pass mark (2026-11-13) pass ``--sample``, ``--seed``
and ``--pass-mark``: a sample needs a seed (and a seed a sample), a sample excludes
"Only these ids" and a non-zero "First N" (the form's "--limit 0" is then left
out), and a pass mark may not exceed the sample. The Runs list and a run's page
show the sample, its seed and PASS/FAIL against the pass mark when a run has them.
A set item with linked cards (``cards``, e.g. the official test's) shows them under
its question.

The Eval tab's Retrieval panel measures ``search_rules`` itself: two more
allowlisted actions, "Build rules index" (``scripts/build_rules_index.py``, no
values; Apple Silicon only) and "Measure retrieval"
(``scripts/eval_retrieval.py --name``, checked like a run name), and
``/api/eval/retrieval`` (index status and each report's recall per method) with
``/api/eval/retrieval/<name>.json`` for one report's per-question hits.

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

from games.cyberpunk.assistant import eval_store
from games.cyberpunk.assistant.decks import public_deck_index
from games.cyberpunk.assistant.eval_store import EvalSetError
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, DEFAULT_PRELOAD, DEFAULT_THINKING,
                                            MAX_TOKENS_LIMIT, MAX_TOOL_CALLS, MAX_TOOL_CALLS_LIMIT,
                                            default_max_tokens, run_turn)
from games.cyberpunk.assistant.tools import TOOLS, call_tool, cards, index_status
from games.cyberpunk.config import REPO_ROOT
from games.cyberpunk.prompts import RULES_VERSION, TOURNAMENT_RULES_VERSION
from harness.core.webui.monitor import build_app
from harness.core.webui.runner import Runner, lan_ip

__all__ = ["build_assistant_app", "serve_assistant", "ASSISTANT_HTML", "is_loopback", "host_allowed",
           "ChatService", "Session", "deck_brief", "EXAMPLE_QUESTIONS", "EvalRunner", "eval_action",
           "index_action", "retrieval_action"]

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
                 enable_thinking: bool = DEFAULT_THINKING, max_tokens: int | None = None,
                 preload: bool = DEFAULT_PRELOAD, model_path: str | None = None, adapter_path: str | None = None):
        self.model = model
        # The model and adapter directories as given on the command line, for the Eval tab's runs.
        self.model_path = model_path
        self.adapter_path = adapter_path
        self.max_history_messages = max_history_messages
        self.max_sessions = max_sessions
        self.enable_thinking = enable_thinking
        self.max_tokens = max_tokens  # None: by thinking (loop.default_max_tokens)
        self.preload = preload
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
                "thinkingDefault": self.enable_thinking, "preloadDefault": self.preload,
                "maxTokens": self.max_tokens}

    async def chat(self, session: str, message: str, *, thinking: bool | None = None,
                   preload: bool | None = None) -> dict:
        thinking = self.enable_thinking if thinking is None else thinking
        preload = self.preload if preload is None else preload
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            record = self.session(session)
            history = list(record.history)
            self.busy = True
            if self.model_state in ("idle", "error"):
                self.model_state = "loading"
            try:
                turn = await run_turn(history, message, self.model, enable_thinking=thinking, preload=preload,
                                      max_tokens=self.max_tokens or default_max_tokens(thinking), deck=record.deck)
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
                    "thinking": thinking,
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


EVAL_ACTION_ID = "eval-assistant"
EVAL_IDS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(,[A-Za-z0-9][A-Za-z0-9._-]*)*$")
EVAL_INT_LIMITS = {"max_tokens": (1, MAX_TOKENS_LIMIT), "max_tool_calls": (1, MAX_TOOL_CALLS_LIMIT),
                   "limit": (0, 10000), "sample": (1, 10000), "seed": (0, 2**31 - 1), "pass_mark": (1, 10000)}


def _repo_relative(path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def eval_action(chat: "ChatService", set_paths: list[str], runs_dir) -> dict:
    """The one allowlisted eval job: ``scripts/eval_assistant.py`` with this page's model settings."""
    args = [{"name": "--set", "key": "set", "type": "choice", "choices": list(set_paths),
             "default": set_paths[0] if set_paths else "", "label": "Set"},
            {"name": "--name", "key": "name", "type": "text", "default": "", "label": "Run name"}]
    if chat.model_path:
        args.append({"name": "--model", "type": "fixed", "value": [chat.model_path]})
    if chat.adapter_path:
        args.append({"name": "--adapter", "type": "fixed", "value": [chat.adapter_path]})
    # Thinking and the preload are on in the scorer by default, so the argv carries only the switch-offs.
    # The page sends "thinking" and "preload" booleans; EvalRunner turns them into these two flags.
    # Max tokens and max tool calls are text-typed so an unset value is left out and the scorer picks its default.
    args += [{"name": "--no-thinking", "key": "no_thinking", "type": "flag", "default": not chat.enable_thinking,
              "label": "Think first (off)"},
             {"name": "--no-preload", "key": "no_preload", "type": "flag", "default": not chat.preload,
              "label": "Preload rules and cards (off)"},
             {"name": "--max-tokens", "key": "max_tokens", "type": "text",
              "default": "" if chat.max_tokens is None else str(chat.max_tokens), "label": "Max tokens per step"},
             {"name": "--max-tool-calls", "key": "max_tool_calls", "type": "text", "default": "",
              "label": "Max tool calls per question"},
             {"name": "--limit", "key": "limit", "type": "int", "default": 0, "label": "First N (0: all)"},
             {"name": "--ids", "key": "ids", "type": "text", "default": "", "label": "Only these ids"},
             {"name": "--sample", "key": "sample", "type": "text", "default": "", "label": "Sample N keyed questions"},
             {"name": "--seed", "key": "seed", "type": "text", "default": "", "label": "Seed"},
             {"name": "--pass-mark", "key": "pass_mark", "type": "text", "default": "", "label": "Pass mark"},
             {"name": "--force", "key": "force", "type": "flag", "default": False, "label": "Replace a run"},
             {"name": "--resume", "key": "resume", "type": "flag", "default": False,
              "label": "Resume an incomplete run"},
             {"name": "--runs-dir", "type": "fixed", "value": [str(runs_dir)]}]
    return {"id": EVAL_ACTION_ID, "label": "Score the assistant on a set", "group": "Eval",
            "cmd": "scripts/eval_assistant.py", "writes": True,
            "desc": "Put every question of a multiple-choice set to the assistant and write a scored run.",
            "args": args}


INDEX_ACTION_ID = "build-rules-index"
RETRIEVAL_ACTION_ID = "eval-retrieval"


def index_action() -> dict:
    """Build the rules embedding index (``scripts/build_rules_index.py``). It takes no values at all."""
    return {"id": INDEX_ACTION_ID, "label": "Build rules index", "group": "Eval", "cmd": "scripts/build_rules_index.py",
            "writes": True, "args": [],
            "desc": "Embed every rule for hybrid search_rules (Apple Silicon with mlx-embeddings; a git-ignored "
                    "build artifact). Without it search_rules stays lexical."}


def retrieval_action(reports_dir) -> dict:
    """Measure search_rules recall on the quiz (``scripts/eval_retrieval.py``) into ``<reports_dir>/<name>.json``."""
    return {"id": RETRIEVAL_ACTION_ID, "label": "Measure retrieval", "group": "Eval", "cmd": "scripts/eval_retrieval.py",
            "writes": True, "desc": "Recall@1/5/10 of each search_rules method against the expected-rules draft.",
            "args": [{"name": "--name", "key": "name", "type": "text", "default": "", "label": "Report name"},
                     {"name": "--force", "key": "force", "type": "flag", "default": False, "label": "Replace"},
                     {"name": "--quiet", "type": "fixed", "value": []},
                     {"name": "--reports-dir", "type": "fixed", "value": [str(reports_dir)]}]}


class EvalRunner(Runner):
    """The monitor's one-job-at-a-time runner, checking the eval action's values before argv is built.

    The base runner passes text values through unchecked; here the run name and
    ids must match fixed patterns (so a value can never read as a flag), numbers
    must be in range, flags must be booleans, an existing run needs ``force``,
    and nothing starts without a configured model or while a chat turn runs.
    """

    def __init__(self, actions_by_id: dict, repo_root, *, chat: "ChatService", runs_dir, reports_dir=None):
        super().__init__(actions_by_id, repo_root)
        self.chat = chat
        self.runs_dir = runs_dir
        self.reports_dir = eval_store.REPORTS_DIR if reports_dir is None else reports_dir

    def running(self) -> bool:
        return bool(self.active and self.jobs[self.active]["status"] == "running")

    def build_cmd(self, action: dict, values: dict) -> list[str]:
        if action["id"] == EVAL_ACTION_ID:
            values = self.check_eval_values(action, values)
            if "sample" in values:
                # The scorer refuses --sample with any --limit, and the form's "First N" is always sent (0).
                action = {**action, "args": [spec for spec in action["args"] if spec.get("key") != "limit"]}
        elif action["id"] == INDEX_ACTION_ID:
            if not isinstance(values, dict) or values:
                raise ValueError("Build rules index takes no values")
        elif action["id"] == RETRIEVAL_ACTION_ID:
            values = self.check_retrieval_values(values)
        else:
            raise ValueError(f"unknown action {action['id']!r}")
        return super().build_cmd(action, values)

    def check_retrieval_values(self, values: dict) -> dict:
        if not isinstance(values, dict):
            raise ValueError("values must be an object")
        extra = sorted(set(values) - {"name", "force"})
        if extra:
            raise ValueError(f"unknown value(s): {', '.join(extra)}")
        name, force = values.get("name"), values.get("force", False)
        if not isinstance(name, str) or not eval_store.RUN_NAME_RE.match(name):
            raise ValueError("Report name must be 1-80 letters, digits, '.', '_' or '-', starting with a letter or "
                             "digit.")
        if not isinstance(force, bool):
            raise ValueError("force must be true or false")
        if (self.reports_dir / f"{name}.json").exists() and not force:
            raise ValueError(f"A report named {name} exists; tick 'replace' or pick another name.")
        return {"name": name, "force": force}

    def check_eval_values(self, action: dict, values: dict) -> dict:
        if not isinstance(values, dict):
            raise ValueError("values must be an object")
        if not self.chat.model_path:
            raise ValueError("No model configured: restart the page with --model to run an eval.")
        allowed = {spec.get("key") for spec in action["args"] if spec.get("key")} - {"no_thinking", "no_preload"}
        allowed |= {"thinking", "preload"}
        extra = sorted(set(values) - allowed)
        if extra:
            raise ValueError(f"unknown value(s): {', '.join(extra)}")
        name = values.get("name")
        if not isinstance(name, str) or not eval_store.RUN_NAME_RE.match(name):
            raise ValueError("Run name must be 1-80 letters, digits, '.', '_' or '-', starting with a letter or digit.")
        clean = {"name": name}
        for key in ("thinking", "preload", "force", "resume"):
            if values.get(key) is not None and not isinstance(values[key], bool):
                raise ValueError(f"{key} must be true or false")
        for key in ("force", "resume"):
            if values.get(key) is not None:
                clean[key] = values[key]
        thinking = self.chat.enable_thinking if values.get("thinking") is None else values["thinking"]
        preload = self.chat.preload if values.get("preload") is None else values["preload"]
        clean["no_thinking"], clean["no_preload"] = not thinking, not preload
        for key, (low, high) in EVAL_INT_LIMITS.items():
            raw = values.get(key)
            if raw is None or raw == "":
                continue
            if isinstance(raw, bool) or not isinstance(raw, int) or not low <= raw <= high:
                raise ValueError(f"{key} must be a whole number {low}..{high}")
            clean[key] = raw
        ids = values.get("ids")
        if ids not in (None, ""):
            if not isinstance(ids, str) or len(ids) > 2000 or not EVAL_IDS_RE.match(ids):
                raise ValueError("ids must be comma-separated item ids")
            clean["ids"] = ids
        if values.get("set") not in (None, ""):
            clean["set"] = values["set"]  # checked against the action's choices by the base runner
        if ("sample" in clean) != ("seed" in clean):
            raise ValueError("Sample and Seed go together: give both or neither.")
        if "sample" in clean:
            if "ids" in clean or clean.get("limit"):
                raise ValueError("Sample draws its own questions: clear 'Only these ids' and set 'First N' to 0.")
            if clean.get("pass_mark", 0) > clean["sample"]:
                raise ValueError("Pass mark cannot be more than the sample.")
        if f"{name}.jsonl".endswith(eval_store.PARTIAL_SUFFIX):
            raise ValueError("Run name must not end in '.partial': that is where an incomplete run is kept.")
        if (self.runs_dir / f"{name}.jsonl").exists() and not clean.get("force"):
            raise ValueError(f"A run named {name} exists; tick 'Replace a run' or pick another name.")
        if (eval_store.partial_path(self.runs_dir, name).exists() and not clean.get("resume")
                and not clean.get("force")):
            raise ValueError(f"An incomplete run named {name} exists; tick 'Resume' to continue it with the same "
                             "settings, 'Replace a run' to start over, or pick another name.")
        return clean

    def start(self, action_id: str, values: dict) -> dict:
        if self.chat.busy:
            # "still running" makes the monitor answer 409, like a job already running.
            return {"ok": False, "error": "A chat turn is still running; try again when it has answered."}
        return super().start(action_id, values)


def registry_view() -> dict:
    return {"rulesVersion": RULES_VERSION, "tournamentRulesVersion": TOURNAMENT_RULES_VERSION,
            "tools": [{"name": t.name, "description": t.description, "parameters": t.parameters}
                      for t in TOOLS.values()]}


def build_assistant_app(*, token: str | None = None, lan: bool = False, chat: ChatService | None = None,
                        gold_dir=None, runs_dir=None, notes_dir=None, reports_dir=None):
    """The FastAPI app: the monitor's app (token, job routes) plus the tool, chat and eval routes and a
    Host/Origin guard. ``gold_dir``, ``runs_dir``, ``notes_dir`` and ``reports_dir`` default to data/gold,
    eval/runs, eval/notes and eval/reports; tests point them at temporary directories."""
    chat = chat if chat is not None else ChatService()
    gold_dir = eval_store.GOLD_DIR if gold_dir is None else gold_dir
    runs_dir = eval_store.RUNS_DIR if runs_dir is None else runs_dir
    notes_dir = eval_store.NOTES_DIR if notes_dir is None else notes_dir
    sets = eval_store.list_sets(gold_dir)
    set_paths = {s["name"]: _repo_relative(gold_dir / s["name"]) for s in sets}
    reports_dir = eval_store.REPORTS_DIR if reports_dir is None else reports_dir
    action = eval_action(chat, list(set_paths.values()), runs_dir)
    actions = [action, index_action(), retrieval_action(reports_dir)]
    runner = EvalRunner({a["id"]: a for a in actions}, REPO_ROOT, chat=chat, runs_dir=runs_dir,
                        reports_dir=reports_dir)
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
                                     "error_kind": "invalid_arguments", "rules_version": RULES_VERSION,
                                     "tournament_rules_version": TOURNAMENT_RULES_VERSION},
                                    status_code=400)
            result = call_tool(name, payload)
            if result["ok"]:
                return result
            return JSONResponse(result, status_code=404 if result.get("error_kind") == "not_found" else 400)

        def chat_refusal(kind: str, message: str, status: int):
            return JSONResponse({"ok": False, "error_kind": kind, "error": message, "rulesVersion": RULES_VERSION,
                                 "tournamentRulesVersion": TOURNAMENT_RULES_VERSION, "promptVersion": ASSISTANT_PROMPT_VERSION}, status_code=status)

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
            return {"rulesVersion": RULES_VERSION, "tournamentRulesVersion": TOURNAMENT_RULES_VERSION,
                    "cardCount": len(cards()), "promptVersion": ASSISTANT_PROMPT_VERSION,
                    "maxToolCalls": MAX_TOOL_CALLS, "model": chat.status()}

        @app.post("/api/chat")
        async def post_chat(request: Request):
            payload, session = await session_payload(request)
            if session is None:
                return payload
            message, thinking, preload = payload.get("message"), payload.get("thinking"), payload.get("preload")
            if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
                return chat_refusal("invalid_arguments",
                                    f"message must be non-empty text of at most {MAX_MESSAGE_CHARS} characters.", 400)
            if thinking is not None and not isinstance(thinking, bool):
                return chat_refusal("invalid_arguments", "thinking must be true, false or omitted.", 400)
            if preload is not None and not isinstance(preload, bool):
                return chat_refusal("invalid_arguments", "preload must be true, false or omitted.", 400)
            if chat.model is None:
                return chat_refusal("no_model", NO_MODEL, 503)
            if runner.running():
                return chat_refusal("busy", "An eval run is in progress; chat is paused until it finishes.", 409)
            result = await chat.chat(session, message.strip(), thinking=thinking, preload=preload)
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

        # Eval tab ------------------------------------------------------------------------
        def eval_refusal(message: str, status: int):
            return JSONResponse({"ok": False, "error": message}, status_code=status)

        @app.get("/api/eval/config")
        def eval_config():
            return {"model": chat.model_path, "adapter": chat.adapter_path, "thinkingDefault": chat.enable_thinking,
                    "preloadDefault": chat.preload, "maxTokens": chat.max_tokens,
                    "maxTokensLimit": MAX_TOKENS_LIMIT, "maxToolCalls": MAX_TOOL_CALLS,
                    "maxToolCallsLimit": MAX_TOOL_CALLS_LIMIT, "actionId": action["id"], "chatBusy": chat.busy,
                    "active": runner.active if runner.running() else None,
                    "sets": [{**s, "path": set_paths[s["name"]]} for s in sets],
                    "runsDir": _repo_relative(runs_dir), "notesDir": _repo_relative(notes_dir)}

        @app.get("/api/eval/sets/{name}")
        def eval_set(name: str):
            try:
                path = eval_store.set_path(name, gold_dir)
                return {"name": name, "path": set_paths.get(name), "sha256": eval_store.file_sha256(path),
                        "items": eval_store.load_mc_set(path), "notes": eval_store.read_notes(name, notes_dir)}
            except FileNotFoundError:
                return eval_refusal("No such set.", 404)
            except (EvalSetError, ValueError) as exc:
                return eval_refusal(str(exc), 400)

        @app.post("/api/eval/notes")
        async def eval_note(request: Request):
            try:
                payload = await request.json()
            except ValueError:
                payload = None
            if not isinstance(payload, dict) or set(payload) != {"set", "id", "note"}:
                return eval_refusal("Send {set, id, note}.", 400)
            try:
                notes = eval_store.write_note(payload["set"], payload["id"], payload["note"],
                                              gold_dir=gold_dir, notes_dir=notes_dir)
            except FileNotFoundError:
                return eval_refusal("No such set.", 404)
            except (KeyError, TypeError):
                return eval_refusal("No such question in this set.", 404)
            except (EvalSetError, ValueError) as exc:
                return eval_refusal(str(exc), 400)
            return {"ok": True, "set": payload["set"], "id": payload["id"], "note": notes.get(payload["id"], ""),
                    "notesFile": _repo_relative(eval_store.notes_path(payload["set"], notes_dir))}

        @app.get("/api/eval/runs")
        def eval_runs():
            return {"dir": _repo_relative(runs_dir), "runs": eval_store.list_runs(runs_dir)}

        @app.get("/api/eval/runs/{name}")
        def eval_run(name: str):
            try:
                return {"name": name, "rows": eval_store.read_run(name, runs_dir)}
            except FileNotFoundError:
                return eval_refusal("No such run.", 404)
            except (EvalSetError, ValueError) as exc:
                return eval_refusal(str(exc), 400)

        @app.get("/api/eval/retrieval")
        def retrieval_overview():
            return {"index": index_status(), "dir": _repo_relative(reports_dir), "buildActionId": INDEX_ACTION_ID,
                    "measureActionId": RETRIEVAL_ACTION_ID,
                    "active": runner.active if runner.running() else None,
                    "reports": eval_store.list_retrieval_reports(reports_dir)}

        @app.get("/api/eval/retrieval/{name}")
        def retrieval_report(name: str):
            try:
                return {"name": name, "report": eval_store.read_retrieval_report(name, reports_dir)}
            except FileNotFoundError:
                return eval_refusal("No such report.", 404)
            except (EvalSetError, ValueError) as exc:
                return eval_refusal(str(exc), 400)

        # Stop the model worker when the server stops (it would also exit on stdin EOF).
        inner_lifespan = app.router.lifespan_context

        @contextlib.asynccontextmanager
        async def lifespan(server_app):
            async with inner_lifespan(server_app) as lifespan_state:
                yield lifespan_state
            await chat.close()

        app.router.lifespan_context = lifespan

    return build_app(actions, REPO_ROOT, title=TITLE, token=token, runner=runner, extra_routes=routes)


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
details.step.auto{border-left-style:dashed;border-left-color:var(--accent)}
details.step.auto>summary::before{content:"auto ";font-size:11px;color:var(--accent);font-weight:600}
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
#tabEval{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
@media (max-width:1000px){#tabEval{grid-template-columns:1fr}}
.qitem{border-top:1px solid var(--line);padding:8px 0}
.qitem .qtext{white-space:pre-wrap;overflow-wrap:anywhere}
ul.choices{list-style:none;margin:4px 0;padding:0;font-size:13px}
ul.choices li{padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
ul.choices li.key{background:var(--sel);color:var(--ok);font-weight:600}
ul.choices li.known{color:var(--warn);text-decoration:line-through}
.qitem textarea{width:100%;min-height:2.6em;font-size:12px;margin-top:4px}
table.runs{width:100%;border-collapse:collapse;font-size:12px}
table.runs th,table.runs td{text-align:left;border-bottom:1px solid var(--line);padding:3px 4px;vertical-align:top;overflow-wrap:anywhere}
table.runs tr.pick{cursor:pointer}table.runs tr.pick:hover{background:var(--sel)}
.oc-correct{color:var(--ok)}.oc-wrong,.oc-unanswered{color:var(--warn)}.oc-unscored{color:var(--muted)}
.evalrun{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0}
#evalLog{max-height:30vh}
</style>
</head>
<body>
<header>
  <h1>Cyberpunk TCG assistant</h1>
  <nav><button type="button" id="tabBtnChat" class="on" data-tab="Chat">Chat</button><button type="button" id="tabBtnTools" data-tab="Tools">Tools</button><button type="button" id="tabBtnEval" data-tab="Eval">Eval</button></nav>
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
        <label class="inline" title="Run search_rules on the question and get_card or find_card on each card name before the model speaks"><input type="checkbox" id="preloadToggle"> look up rules and cards first</label>
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
<section id="tabEval" hidden>
  <div>
    <div class="panel">
      <h2>Set</h2>
      <p class="muted" style="margin:0 0 6px;font-size:12px">Multiple-choice gold sets from data/gold (eval only, never training data). The key is highlighted and known-incorrect options are struck through. Notes save to a sidecar under eval/notes; the set itself is never edited here.</p>
      <div class="row"><select id="evalSetPick"></select></div>
      <div class="status" id="evalSetStatus"></div>
      <div id="evalSetBody"></div>
    </div>
  </div>
  <div>
    <div class="panel">
      <h2>Run</h2>
      <p class="muted" style="margin:0 0 6px;font-size:12px">Runs scripts/eval_assistant.py on the selected set with this page's model. One job at a time; chat pauses while it runs.</p>
      <div class="muted" id="evalModel" style="font-size:12px"></div>
      <div class="evalrun">
        <label>Run name<input type="text" id="evalName" maxlength="80" placeholder="baseline-qwen3-8b"></label>
        <label>Max tokens per step<input type="number" id="evalMaxTokens" min="1" max="16384" step="1"></label>
        <label>Max tool calls per question<input type="number" id="evalMaxToolCalls" min="1" max="16" step="1"></label>
        <label>First N (0: all)<input type="number" id="evalLimit" min="0" step="1" value="0"></label>
        <label>Only these ids<input type="text" id="evalIds" placeholder="cody-quiz-01,cody-quiz-03"></label>
        <label>Sample N keyed questions<input type="number" id="evalSample" min="1" step="1" placeholder="e.g. 40 (needs a seed)"></label>
        <label>Seed<input type="number" id="evalSeed" min="0" step="1" placeholder="e.g. 1"></label>
        <label>Pass mark<input type="number" id="evalPassMark" min="1" step="1" placeholder="e.g. 35"></label>
        <label class="inline"><input type="checkbox" id="evalThinking"> think first</label>
        <label class="inline"><input type="checkbox" id="evalPreload"> look up rules and cards first</label>
        <label class="inline"><input type="checkbox" id="evalForce"> replace a run of this name</label>
        <label class="inline"><input type="checkbox" id="evalResume"> resume an incomplete run of this name</label>
      </div>
      <button class="go" id="evalRunBtn" type="button">Run eval</button>
      <div class="status" id="evalRunStatus"></div>
      <pre id="evalLog" class="muted" hidden></pre>
    </div>
    <div class="panel">
      <h2>Runs</h2>
      <div class="row"><button class="small" id="evalRunsRefresh" type="button">Refresh</button></div>
      <div id="evalRuns" class="muted">No runs loaded.</div>
      <div id="evalRunBody"></div>
    </div>
    <div class="panel">
      <h2>Retrieval</h2>
      <p class="muted" style="margin:0 0 6px;font-size:12px">How often search_rules returns a rule each quiz question needs (scripts/eval_retrieval.py). The expected rules are an unreviewed Claude draft in eval/sets: a measurement aid, not gold, never training data. Build rules index embeds every rule for hybrid search (Apple Silicon only; a git-ignored build artifact).</p>
      <div class="muted" id="retrIndex" style="font-size:12px">Index status not loaded.</div>
      <div class="evalrun">
        <label>Report name<input type="text" id="retrName" maxlength="80" placeholder="retrieval-quiz"></label>
        <label class="inline"><input type="checkbox" id="retrForce"> replace a report of this name</label>
      </div>
      <div class="row"><button class="go" id="retrMeasureBtn" type="button">Measure retrieval</button><button class="small" id="retrBuildBtn" type="button">Build rules index</button><button class="small" id="retrRefresh" type="button">Refresh</button></div>
      <div class="status" id="retrStatus"></div>
      <pre id="retrLog" class="muted" hidden></pre>
      <div id="retrReports" class="muted">No reports loaded.</div>
      <div id="retrReportBody"></div>
    </div>
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
  if (step.kind === "context") {
    if (!step.ok) return "context · full · about " + (step.estimatedTokens ?? "?") + " tokens, limit " + (step.limit ?? "?");
    if (step.action === "kept") return "context · over the estimate, nothing to drop; the worker decides · about " +
      (step.estimatedTokens ?? "?") + " tokens, limit " + (step.limit ?? "?");
    return "context · dropped " + (step.dropped || []).length + " earlier tool result(s) · about " +
      (step.estimatedTokens ?? "?") + " -> " + (step.estimatedTokensAfter ?? "?") + " tokens, limit " + (step.limit ?? "?");
  }
  if (step.kind === "model") {
    if (!step.ok) return "model · error · " + (step.error || "failed");
    return "model · " + (step.finishReason === "length" ? "token limit" : "ok") + " · " +
      (step.generationTokens ?? "?") + " tokens · " +
      (step.toolCallsRequested ? "asked for " + step.toolCallsRequested + " tool call(s)" : "answered") + " · " + ms(step.elapsedMs);
  }
  const auto = step.auto ? (step.link ? "linked \u201c" + step.link.span + "\u201d · " : "") +
    (step.implied ? "implied (" + step.implied.via + " of " + step.implied.of + ") · " : "") +
    (step.sent ? "sent " + (step.contextChars || 0) + " chars · " : "not sent · ") : "";
  return (step.tool || "(no tool)") + " · " + (step.ok ? "ok" : (step.errorKind || "error")) + " · " + auto +
    (step.summary || "") + " · " + ms(step.elapsedMs);
}
// Flags for an answer that did not end normally.
// Progress of an eval job from its log lines: the last "[k/N]" line the scorer printed.
function jobProgress(lines) {
  let done = 0, total = 0;
  for (const line of lines || []) {
    const m = /^\[(\d+)\/(\d+)\]/.exec(String(line));
    if (m) { done = Number(m[1]); total = Number(m[2]); }
  }
  return {done, total};
}
// A run file's rows split into header, items and summary.
function splitRun(rows) {
  const out = {header: null, items: [], summary: null};
  for (const row of rows || []) {
    if (row.kind === "header") out.header = row;
    else if (row.kind === "item") out.items.push(row);
    else if (row.kind === "summary") out.summary = row;
  }
  return out;
}
function scoreText(summary) {
  if (!summary) return "no summary";
  const pct = summary.score === null || summary.score === undefined ? "n/a" : (summary.score * 100).toFixed(1) + "%";
  return summary.correct + "/" + summary.scored + " correct (" + pct + ") · " + summary.unanswered + " unanswered · " +
    summary.unscored + " unscored · tools used on " + summary.tool_use + "/" + summary.items;
}
// An item's linked cards (the set's "cards" slugs), or "" for an item without that field.
function linkedCardsText(item) {
  if (!item || !Array.isArray(item.cards)) return "";
  return "linked cards: " + (item.cards.length ? item.cards.join(", ") : "none");
}
// "PASS (35/40 needed)" for a finished run with a pass mark, else "".
function passText(summary, passMark) {
  if (!summary || passMark === null || passMark === undefined) return "";
  return (summary.correct >= passMark ? "PASS" : "FAIL") + " (" + passMark + "/" + summary.items + " needed)";
}
function answerFlags(data, maxToolCalls) {
  const flags = [];
  if (data.stopReason === "tool_cap") flags.push("hit the tool-call cap (" + maxToolCalls + " calls)");
  if (data.stopReason === "length" || (data.trace || []).some((s) => s.kind === "model" && s.finishReason === "length"))
    flags.push("hit the token limit");
  if (data.stopReason === "model_error") flags.push("model error");
  if (data.stopReason === "empty") flags.push("no answer text");
  if (data.stopReason === "context_full") flags.push("ran out of model context");
  return flags;
}
// Rows of the retrieval table: one per method of one report, recall as percentages or why it did not run.
function retrievalRows(report) {
  const pct = (v) => v === null || v === undefined ? "n/a" : (v * 100).toFixed(1) + "%";
  const rows = [];
  for (const [method, m] of Object.entries((report && report.methods) || {})) {
    if (!m.available) { rows.push({method, cells: ["unavailable: " + (m.reason || "unknown reason")]}); continue; }
    rows.push({method, cells: [pct(m["recall@1"]), pct(m["recall@5"]), pct(m["recall@10"]),
      m["chars@10"] === null || m["chars@10"] === undefined ? "n/a" : String(Math.round(m["chars@10"]))]});
  }
  return rows;
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
  for (const tab of ["Chat", "Tools", "Eval"]) {
    $("tab" + tab).hidden = tab !== name;
    $("tabBtn" + tab).classList.toggle("on", tab === name);
  }
  if (name === "Eval" && !evalState.loaded) loadEval().catch((err) => { $("evalSetStatus").textContent = "Could not load: " + err; });
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
  $("snapshot").textContent = "snapshot " + data.rulesVersion + " · tournament rules " + data.tournamentRulesVersion +
    " · " + data.cardCount + " cards";
  const m = data.model;
  const badge = $("modelBadge");
  badge.className = "badge " + m.state;
  badge.textContent = (m.label ? m.label + ": " : "") + (MODEL_TEXT[m.state] || m.state) + (m.busy && m.state === "ready" ? " (answering)" : "");
  badge.title = m.lastError ? "last error: " + m.lastError : "prompt " + data.promptVersion;
  if (!state.statusLoaded) {
    $("thinkToggle").checked = !!m.thinkingDefault;
    $("preloadToggle").checked = m.preloadDefault !== false;
    state.statusLoaded = true;
  }
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
  const d = el("details", {class: (step.ok ? "step" : "step bad") + (step.auto ? " auto" : "")});
  d.appendChild(el("summary", {}, stepLine(step)));
  if (step.kind === "context") {
    d.appendChild(jsonPre("prompt guard", {reason: step.reason, dropped: step.dropped, estimatedTokens: step.estimatedTokens,
      estimatedTokensAfter: step.estimatedTokensAfter, limit: step.limit}));
  } else if (step.kind === "model") {
    d.appendChild(jsonPre("model step", {finishReason: step.finishReason, promptTokens: step.promptTokens,
      generationTokens: step.generationTokens, elapsedMs: step.elapsedMs, error: step.error}));
    if (step.thinking) d.appendChild(jsonPre("thinking", step.thinking));
  } else {
    d.appendChild(jsonPre("arguments", step.arguments ?? {}));
    if (step.auto) d.appendChild(jsonPre("automatic step (run before the model spoke)", {link: step.link ?? null,
      implied: step.implied ?? null,
      sentToModel: !!step.sent, contextChars: step.contextChars, note: step.contextNote ?? null}));
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
    d.appendChild(el("summary", {}, "Trace: " + (data.autoToolCalls ? data.autoToolCalls + " auto step(s), " : "") +
      (data.toolCalls || 0) + " tool call(s), " + ms(data.elapsedMs) +
      (data.thinking ? ", thinking on" : "") + (data.preload ? "" : ", preload off") + (data.deckInContext ? ", deck in context" : "") +
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
      thinking: $("thinkToggle").checked, preload: $("preloadToggle").checked});
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
  body.appendChild(el("div", {class: "muted", style: "font-size:11px"}, tool + " · snapshot " + data.rules_version +
    " · tournament rules " + data.tournament_rules_version));
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

// Eval tab --------------------------------------------------------------------------
const evalState = {loaded: false, config: null, set: null, job: null, jobLines: 0, timer: null};

async function getJson(url) {
  const response = await fetch(url);
  let data;
  try { data = await response.json(); } catch (err) { data = {ok: false, error: "HTTP " + response.status}; }
  return [response, data];
}

async function loadEval() {
  const [, config] = await getJson("/api/eval/config");
  evalState.config = config;
  evalState.loaded = true;
  const pick = $("evalSetPick");
  pick.textContent = "";
  for (const s of config.sets || []) pick.appendChild(el("option", {value: s.name}, s.name + " · " + s.items + " items, " + s.scored + " keyed"));
  $("evalModel").textContent = config.model ? "Model: " + config.model + (config.adapter ? " + " + config.adapter : "") :
    "No model configured: restart with --model to run an eval. Sets and runs still show.";
  $("evalRunBtn").disabled = !config.model;
  $("evalMaxTokens").value = config.maxTokens ?? "";
  $("evalMaxTokens").placeholder = "default: 2048 thinking, 1024 not";
  $("evalMaxTokens").max = String(config.maxTokensLimit || 16384);
  $("evalMaxToolCalls").value = "";
  $("evalMaxToolCalls").placeholder = "default: " + (config.maxToolCalls ?? 6);
  $("evalMaxToolCalls").max = String(config.maxToolCallsLimit || 16);
  $("evalThinking").checked = !!config.thinkingDefault;
  $("evalPreload").checked = config.preloadDefault !== false;
  if (config.active) watchJob(config.active);
  if ((config.sets || []).length) await loadSet(pick.value); else $("evalSetStatus").textContent = "No multiple-choice sets in data/gold.";
  await loadRuns();
  await loadRetr();
}

async function loadSet(name) {
  $("evalSetStatus").textContent = "Loading " + name + " …";
  const [, data] = await getJson("/api/eval/sets/" + encodeURIComponent(name));
  const body = $("evalSetBody");
  body.textContent = "";
  if (data.ok === false) { $("evalSetStatus").textContent = "Refused: " + data.error; return; }
  evalState.set = data;
  const keyed = data.items.filter((i) => i.correct !== null && i.correct !== undefined).length;
  $("evalSetStatus").textContent = data.items.length + " questions, " + keyed + " keyed · sha256 " + data.sha256.slice(0, 12) + "…";
  for (const item of data.items) {
    const box = el("div", {class: "qitem"});
    box.appendChild(el("div", {class: "muted", style: "font-size:12px"}, item.id + " · key " + (item.correct || "none (unscored)") +
      (item.answer_key_by ? " · keyed by " + item.answer_key_by : "") + (item.source ? " · " + item.source : "")));
    box.appendChild(el("div", {class: "qtext"}, item.question));
    const linked = linkedCardsText(item);
    if (linked) box.appendChild(el("div", {class: "muted linked", style: "font-size:12px"}, linked));
    const ul = el("ul", {class: "choices"});
    for (const c of item.choices) {
      const cls = c.letter === item.correct ? "key" : (item.known_incorrect || []).includes(c.letter) ? "known" : "";
      ul.appendChild(el("li", cls ? {class: cls} : {}, c.letter + ". " + c.text));
    }
    box.appendChild(ul);
    const note = el("textarea", {placeholder: "Review note (saved to eval/notes, not to the set)"});
    note.value = (data.notes || {})[item.id] || "";
    const row = el("div", {class: "row"});
    const save = el("button", {type: "button", class: "small"}, "Save note");
    const status = el("span", {class: "muted", style: "font-size:12px"});
    save.addEventListener("click", () => saveNote(data.name, item.id, note, status));
    row.appendChild(save);
    row.appendChild(status);
    box.appendChild(note);
    box.appendChild(row);
    body.appendChild(box);
  }
}

async function saveNote(setName, id, textarea, status) {
  status.textContent = "Saving …";
  try {
    const [, data] = await postJson("/api/eval/notes", {set: setName, id, note: textarea.value});
    status.textContent = data.ok ? "Saved to " + data.notesFile : "Refused: " + data.error;
  } catch (err) {
    status.textContent = "Request failed: " + err;
  }
}

async function startEval() {
  const config = evalState.config;
  if (!config) return;
  const set = (config.sets || []).find((s) => s.name === $("evalSetPick").value);
  const values = {set: set ? set.path : "", name: $("evalName").value.trim(), thinking: $("evalThinking").checked,
    preload: $("evalPreload").checked, force: $("evalForce").checked, resume: $("evalResume").checked,
    ids: $("evalIds").value.trim()};
  const rawMax = $("evalMaxTokens").value.trim(), rawCalls = $("evalMaxToolCalls").value.trim();
  const maxTokens = rawMax === "" ? null : Number(rawMax), limit = Number($("evalLimit").value || 0);
  const maxToolCalls = rawCalls === "" ? null : Number(rawCalls);
  const optional = {sample: $("evalSample").value.trim(), seed: $("evalSeed").value.trim(), pass_mark: $("evalPassMark").value.trim()};
  if ((maxTokens !== null && !Number.isInteger(maxTokens)) || (maxToolCalls !== null && !Number.isInteger(maxToolCalls)) ||
      !Number.isInteger(limit) || Object.values(optional).some((raw) => raw !== "" && !Number.isInteger(Number(raw)))) {
    $("evalRunStatus").textContent = "Max tokens, max tool calls, First N, sample, seed and pass mark must be whole numbers."; return;
  }
  if (maxTokens !== null) values.max_tokens = maxTokens;
  if (maxToolCalls !== null) values.max_tool_calls = maxToolCalls;
  for (const [key, raw] of Object.entries(optional)) if (raw !== "") values[key] = Number(raw);
  values.limit = limit;
  $("evalRunBtn").disabled = true;
  $("evalRunStatus").textContent = "Starting …";
  try {
    const [response, data] = await postJson("/api/run/" + encodeURIComponent(config.actionId), {values});
    if (!data.ok) {
      $("evalRunStatus").textContent = "Refused (" + response.status + "): " + data.error;
      $("evalRunBtn").disabled = false;
      return;
    }
    watchJob(data.job);
  } catch (err) {
    $("evalRunStatus").textContent = "Request failed: " + err;
    $("evalRunBtn").disabled = false;
  }
}

function watchJob(id) {
  evalState.job = id;
  evalState.jobLines = 0;
  $("evalLog").textContent = "";
  $("evalLog").hidden = false;
  $("evalRunBtn").disabled = true;
  clearInterval(evalState.timer);
  evalState.timer = setInterval(() => pollJob().catch(() => {}), 1500);
  pollJob().catch(() => {});
}

async function pollJob() {
  const [response, job] = await getJson("/api/job/" + encodeURIComponent(evalState.job) + "?since=" + evalState.jobLines);
  if (!response.ok) return;
  const log = $("evalLog");
  if (job.lines.length) log.textContent += job.lines.join("\n") + "\n";
  evalState.allLines = (evalState.allLines || []).concat(job.lines);
  evalState.jobLines = job.total_lines;
  log.scrollTop = log.scrollHeight;
  const p = jobProgress(evalState.allLines);
  $("evalRunStatus").textContent = job.status + (p.total ? " · " + p.done + "/" + p.total + " questions" : "") + " · " + job.cmd;
  if (job.status !== "running") {
    clearInterval(evalState.timer);
    evalState.allLines = [];
    $("evalRunBtn").disabled = !(evalState.config && evalState.config.model);
    loadRuns().catch(() => {});
  }
}

async function loadRuns() {
  const [, data] = await getJson("/api/eval/runs");
  const box = $("evalRuns");
  box.textContent = "";
  box.className = "";
  if (!data.runs || !data.runs.length) { box.className = "muted"; box.textContent = "No runs in " + data.dir + " yet."; return; }
  const table = el("table", {class: "runs"});
  const head = el("tr");
  for (const h of ["run", "model", "thinking", "preload", "prompt", "score"]) head.appendChild(el("th", {}, h));
  table.appendChild(head);
  for (const run of data.runs) {
    const tr = el("tr", {class: "pick"});
    tr.appendChild(el("td", {}, run.name + (run.incomplete ? " (incomplete)" : "")));
    if (run.error) { tr.appendChild(el("td", {colspan: "5", class: "err"}, run.error)); table.appendChild(tr); continue; }
    tr.appendChild(el("td", {}, (run.model || "") + (run.adapter ? " + " + run.adapter : "")));
    tr.appendChild(el("td", {}, run.thinking ? "on" : "off"));
    tr.appendChild(el("td", {}, run.preload ? "on" : "off"));
    tr.appendChild(el("td", {}, (run.eval_prompt_version || "") + " / " + (run.assistant_prompt_version || "")));
    const sampled = run.sample !== undefined ? "sample " + run.sample + " · seed " + run.seed + " · " : "";
    const verdict = run.passed !== undefined ? " · " + passText(run.summary, run.pass_mark) : "";
    tr.appendChild(el("td", {}, (run.incomplete ? "incomplete: " + ((run.summary || {}).items || 0) + " question(s) so far; " +
      "run it again with resume to finish · " : "") + sampled + scoreText(run.summary) + verdict));
    tr.addEventListener("click", () => showRun(run.name).catch((err) => { $("evalRunBody").textContent = "Could not load: " + err; }));
    table.appendChild(tr);
  }
  box.appendChild(table);
}

async function showRun(name) {
  const body = $("evalRunBody");
  body.textContent = "Loading " + name + " …";
  const [, data] = await getJson("/api/eval/runs/" + encodeURIComponent(name));
  body.textContent = "";
  if (data.ok === false) { body.className = "err"; body.textContent = data.error; return; }
  body.className = "";
  const run = splitRun(data.rows);
  const questions = {};
  if (evalState.set && run.header && run.header.set && run.header.set.endsWith("/" + evalState.set.name))
    for (const item of evalState.set.items) questions[item.id] = item.question;
  const verdict = run.summary && run.summary.pass_mark !== undefined ? " · " + passText(run.summary, run.summary.pass_mark) : "";
  body.appendChild(el("h3", {}, name + ": " + (run.summary ? scoreText(run.summary) + verdict :
    "incomplete, " + run.items.length + " question(s) so far (resume it to finish)")));
  if (run.header) body.appendChild(factsList({set: run.header.set, "set sha256": run.header.set_sha256, model: run.header.model,
    adapter: run.header.adapter, thinking: String(run.header.thinking), "max tokens": run.header.max_tokens,
    "max tool calls": run.header.max_tool_calls,
    ...(run.header.sample !== undefined ? {sample: run.header.sample + " keyed question(s), seed " + run.header.seed} : {}),
    ...(run.header.pass_mark !== undefined ? {"pass mark": run.header.pass_mark} : {}),
    "system prompt": run.header.system_prompt_sha256 ? "not the default (sha256 " + run.header.system_prompt_sha256 + ")" : "default",
    preload: run.header.preload ? "on (k " + run.header.preload_k + ", " + run.header.preload_chars + " chars)" : "off",
    "tool specs sha256": run.header.tool_specs_sha256,
    prompts: run.header.eval_prompt_version + " / " + run.header.assistant_prompt_version, snapshot: run.header.rules_version}));
  for (const item of run.items) {
    const d = el("details", {class: "step" + (item.outcome === "wrong" || item.outcome === "unanswered" ? " bad" : "")});
    const sum = el("summary");
    sum.appendChild(el("span", {class: "oc-" + item.outcome}, item.outcome));
    sum.appendChild(document.createTextNode(" · " + item.id + " · chose " + (item.chosen || "-") + ", key " + (item.correct || "-") +
      (item.known_incorrect_hit ? " · picked a known-incorrect option" : "") + " · tools: " + ((item.tools_called || []).join(", ") || "none") +
      ((item.auto_tools || []).length ? " · auto: " + item.auto_tools.join(", ") : "") +
      (item.hit_tool_cap ? " · hit tool cap" : "") + (item.hit_length ? " · hit token limit" : "")));
    d.appendChild(sum);
    if (questions[item.id]) d.appendChild(el("div", {class: "qtext"}, questions[item.id]));
    d.appendChild(factsList({rules: item.rule_ids, cards: item.card_slugs, errata: item.errata_ids, parse: item.parse, stop: item.stop_reason}));
    d.appendChild(el("pre", {}, item.answer || ""));
    const trace = el("details", {class: "trace"});
    trace.appendChild(el("summary", {}, "Trace: " + (item.trace || []).length + " step(s)"));
    for (const step of item.trace || []) trace.appendChild(traceRow(step));
    d.appendChild(trace);
    body.appendChild(d);
  }
}

// Retrieval panel -------------------------------------------------------------------
const retrState = {data: null, job: null, lines: 0, timer: null};

async function loadRetr() {
  const [, data] = await getJson("/api/eval/retrieval");
  retrState.data = data;
  const idx = data.index || {};
  $("retrIndex").textContent = "Rules index " + idx.path + ": " + (idx.usable ? "in use (" + idx.model_id + ", " +
    idx.documents + " documents), search_rules runs hybrid" : "not in use, search_rules runs lexical: " + (idx.reason || "")) + ".";
  if (data.active && !retrState.job) watchRetrJob(data.active);
  const box = $("retrReports");
  box.textContent = "";
  box.className = "";
  if (!data.reports || !data.reports.length) { box.className = "muted"; box.textContent = "No retrieval reports in " + data.dir + " yet."; return; }
  const table = el("table", {class: "runs"});
  const head = el("tr");
  for (const h of ["report", "method", "R@1", "R@5", "R@10", "chars@10"]) head.appendChild(el("th", {}, h));
  table.appendChild(head);
  for (const report of data.reports) {
    if (report.error) {
      const tr = el("tr");
      tr.appendChild(el("td", {}, report.name));
      tr.appendChild(el("td", {colspan: "5", class: "err"}, report.error));
      table.appendChild(tr);
      continue;
    }
    for (const row of retrievalRows(report)) {
      const tr = el("tr", {class: "pick"});
      tr.appendChild(el("td", {}, report.name));
      tr.appendChild(el("td", {}, row.method));
      if (row.cells.length === 1) tr.appendChild(el("td", {colspan: "4", class: "muted"}, row.cells[0]));
      else for (const cell of row.cells) tr.appendChild(el("td", {}, cell));
      tr.addEventListener("click", () => showRetrReport(report.name, row.method).catch((err) => { $("retrReportBody").textContent = "Could not load: " + err; }));
      table.appendChild(tr);
    }
  }
  box.appendChild(table);
}

async function showRetrReport(name, method) {
  const body = $("retrReportBody");
  body.textContent = "Loading " + name + " …";
  const [, data] = await getJson("/api/eval/retrieval/" + encodeURIComponent(name));
  body.textContent = "";
  if (data.ok === false) { body.className = "err"; body.textContent = data.error; return; }
  body.className = "";
  const report = data.report, m = (report.methods || {})[method];
  body.appendChild(el("h3", {}, name + " · " + method));
  body.appendChild(factsList({"expected set": report.expected_set + " (" + (report.expected_status || []).join(", ") + ")",
    questions: report.questions, query: report.query_form, snapshot: report.rules_version, scored: report.scored,
    skipped: (report.skipped || []).map((s) => s.id).join(", "), "hit rule": report.match_rule}));
  if (!m || !m.available) { body.appendChild(el("div", {class: "muted"}, "Not measured: " + ((m && m.reason) || "no such method"))); return; }
  const table = el("table", {class: "runs"});
  const head = el("tr");
  for (const h of ["question", "expected", "first hit", "top 3"]) head.appendChild(el("th", {}, h));
  table.appendChild(head);
  for (const item of m.items || []) {
    const tr = el("tr");
    tr.appendChild(el("td", {}, item.id));
    tr.appendChild(el("td", {}, (item.expected || []).join(", ")));
    tr.appendChild(el("td", {class: item.first_hit_rank ? "" : "err"}, item.first_hit_rank ? "#" + item.first_hit_rank : "none in top 10"));
    tr.appendChild(el("td", {}, (item.top || []).slice(0, 3).map((t) => t.rule_ids.length ? t.rule_ids.slice(0, 3).join("/") : t.chunk_id).join(" · ")));
    table.appendChild(tr);
  }
  body.appendChild(table);
}

async function startRetrJob(actionId, values) {
  $("retrStatus").textContent = "Starting …";
  try {
    const [response, data] = await postJson("/api/run/" + encodeURIComponent(actionId), {values});
    if (!data.ok) { $("retrStatus").textContent = "Refused (" + response.status + "): " + data.error; return; }
    watchRetrJob(data.job);
  } catch (err) {
    $("retrStatus").textContent = "Request failed: " + err;
  }
}

function watchRetrJob(id) {
  retrState.job = id;
  retrState.lines = 0;
  $("retrLog").textContent = "";
  $("retrLog").hidden = false;
  clearInterval(retrState.timer);
  retrState.timer = setInterval(() => pollRetrJob().catch(() => {}), 1500);
  pollRetrJob().catch(() => {});
}

async function pollRetrJob() {
  const [response, job] = await getJson("/api/job/" + encodeURIComponent(retrState.job) + "?since=" + retrState.lines);
  if (!response.ok) return;
  if (job.lines.length) $("retrLog").textContent += job.lines.join("\n") + "\n";
  retrState.lines = job.total_lines;
  $("retrStatus").textContent = job.status + " · " + job.cmd;
  if (job.status !== "running") {
    clearInterval(retrState.timer);
    retrState.job = null;
    loadRetr().catch(() => {});
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
$("evalSetPick").addEventListener("change", () => loadSet($("evalSetPick").value).catch((err) => { $("evalSetStatus").textContent = "Could not load: " + err; }));
$("evalRunBtn").addEventListener("click", startEval);
$("evalRunsRefresh").addEventListener("click", () => loadRuns().catch((err) => { $("evalRuns").textContent = "Could not load: " + err; }));
$("retrRefresh").addEventListener("click", () => loadRetr().catch((err) => { $("retrReports").textContent = "Could not load: " + err; }));
$("retrBuildBtn").addEventListener("click", () => startRetrJob(retrState.data ? retrState.data.buildActionId : "build-rules-index", {}));
$("retrMeasureBtn").addEventListener("click", () => startRetrJob(retrState.data ? retrState.data.measureActionId : "eval-retrieval",
  {name: $("retrName").value.trim(), force: $("retrForce").checked}));
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
