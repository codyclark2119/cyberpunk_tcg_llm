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
``scripts/assistant_local.py``. One self-contained page: its markup, CSS and JS
live in ``games/cyberpunk/assistant_ui/`` and are inlined into ``ASSISTANT_HTML``
at import (no CDN, works offline). The theme is dark by default with a light
variant behind a header toggle; the choice is kept in the browser only.

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

Card tiles (2026-11-14): ``GET /api/card/<slug>`` returns ``{ok, card}``, the
display payload ``assistant_ui/card_view.py`` builds from ``get_card``'s facts
(text as keyword/trigger/symbol/rule segments, errata beside it), or a 404
``{ok: false, error: "not_found", did_you_mean}``; ``GET /api/cards?slugs=a,b``
returns ``{ok, cards, missing}`` for up to ``MAX_BATCH`` distinct slugs. Both are
read-only and behind the same Host guard. The page shows cited cards, links in
an answer's prose and an eval item's linked cards as tiles (text only, no art).

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
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from games.cyberpunk.assistant import eval_store
from games.cyberpunk.assistant.decks import public_deck_index
from games.cyberpunk.assistant.eval_store import EvalSetError
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, DEFAULT_PRELOAD, DEFAULT_THINKING,
                                            MAX_TOKENS_LIMIT, MAX_TOOL_CALLS, MAX_TOOL_CALLS_LIMIT,
                                            default_max_tokens, run_turn)
from games.cyberpunk.assistant.tools import TOOLS, call_tool, cards, index_status
from games.cyberpunk.assistant_ui import assemble_page
from games.cyberpunk.assistant_ui.card_view import MAX_BATCH, CardNotFound, card_tile, card_tiles
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

        # Card tiles (read-only): the page's display of a card, built from get_card's facts.
        @app.get("/api/card/{slug}")
        def get_card_tile(slug: str):
            try:
                return {"ok": True, "card": card_tile(slug)}
            except CardNotFound as exc:
                return JSONResponse({"ok": False, "error": "not_found", "slug": slug, "message": str(exc),
                                     "did_you_mean": exc.did_you_mean}, status_code=404)

        @app.get("/api/cards")
        def get_card_tiles(slugs: str = ""):
            wanted = [s for s in (part.strip() for part in slugs.split(",")) if s]
            if not wanted:
                return JSONResponse({"ok": False, "error": "invalid_arguments",
                                     "message": "Pass slugs=a,b (comma-separated)."}, status_code=400)
            try:
                found, missing = card_tiles(wanted)
            except ValueError as exc:
                return JSONResponse({"ok": False, "error": "too_many", "limit": MAX_BATCH, "message": str(exc)},
                                    status_code=400)
            return {"ok": True, "cards": found, "missing": missing}

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


ASSISTANT_HTML = assemble_page(EXAMPLE_QUESTIONS)
