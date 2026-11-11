"""Local play UI: a person against a local bot, bot-vs-bot jobs and a match-record viewer.

Every tool in this project gets a UI, and this is the one for local matches.
It is one FastAPI app with one self-contained page (inline CSS and JS, no CDN,
works offline), served on loopback by ``scripts/play_local.py``.

The engine stays the only rules authority. For a human seat the server asks the
engine for that player's public ``ModelInputV2`` and sends the browser only its
``observation`` and the engine-offered actions (``actionId`` plus the public
descriptor). The browser sends back an ``actionId``; the server refuses any id
that is not in the offered list and submits only that id through the engine
worker. The authoritative state, events, RNG and the other seat's hidden cards
never leave the server. During a live match the human also never sees the bot's
action labels or offered counts, only that the bot acted; the full record,
labels included, is readable in the viewer once the match is over.

A bot seat moves through ``PolicyRunner`` exactly as in ``local_match``. Human
matches write the same JSONL record as ``scripts/run_local_matches.py``, with the
human seat's policy and every human decision's reason set to ``human``.

Bot-vs-bot matches run ``scripts/run_local_matches.py`` through the harness
monitor's allowlisted ``Runner``: the client names the one action id and fills
its declared arguments; the command line is built server-side, one job at a time.
The app is the monitor's ``build_app`` (token middleware and job routes) with
its generic console page replaced by this one.

Sessions live in memory, keyed by a random id, each with its own engine worker
that is closed when the match ends or is abandoned (and on shutdown).
"""


import asyncio
import contextlib
import ipaddress
import json
import platform
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from games.cyberpunk.engine_adapter import EngineProtocolError, EngineWorker
from games.cyberpunk.local_match import (DEFAULT_MAX_DECISIONS, DEFAULT_MAX_TURNS, DEFAULT_OUTPUT_DIR,
                                         REPO_ROOT, MatchSetup, build_decision, decision_row,
                                         load_default_setup, load_setup_file, match_header, result_row,
                                         write_match_record)
from games.cyberpunk.sim_bot import Decision, PolicyRunner, Selection
from harness.core.webui.monitor import build_app
from harness.core.webui.runner import Runner, lan_ip

__all__ = ["build_play_app", "serve_play", "PLAY_HTML", "HUMAN_REASON", "bot_match_action"]

HUMAN_REASON = "human"
BOT_POLICIES = ("baseline", "mlx")
MAX_ACTIVE_SESSIONS = 4
MAX_KEPT_SESSIONS = 32
SEED_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
RECORD_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.jsonl$")
# Public card-catalog fields the page may show for a card the observation names.
CARD_FIELDS = ("displayName", "name", "type", "colors", "power", "printedCost", "ram", "keywords",
               "tags", "rulesText")


def mlx_available() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def bot_match_action(records_dir: Path, node: str = "node") -> dict:
    """The one allowlisted job: ``run_local_matches.py`` writing into ``records_dir``."""
    return {
        "id": "local-matches", "label": "Bot vs bot matches", "group": "Matches",
        "cmd": "scripts/run_local_matches.py", "writes": True,
        "desc": "Play N matches on the local engine; each writes a record the viewer reads.",
        "args": [
            {"name": "--matches", "type": "int", "default": 1, "label": "Matches"},
            {"name": "--seed", "type": "text", "default": "local", "label": "Seed prefix"},
            {"name": "--policy", "key": "seat0", "type": "choice", "choices": list(BOT_POLICIES),
             "default": "baseline", "label": "Seat 0 policy"},
            {"key": "seat1", "type": "choice", "choices": list(BOT_POLICIES), "default": "baseline",
             "label": "Seat 1 policy"},
            {"name": "--setup", "type": "text", "default": "", "label": "Setup file (blank: Demo)"},
            {"name": "--max-decisions", "type": "int", "default": DEFAULT_MAX_DECISIONS,
             "label": "Max decisions"},
            {"name": "--max-turns", "type": "int", "default": DEFAULT_MAX_TURNS, "label": "Max turns"},
            {"name": "--force", "type": "flag", "default": False, "label": "Replace existing records"},
            {"name": "--output-dir", "type": "fixed", "value": [str(records_dir)]},
            {"name": "--node", "type": "fixed", "value": [node]},
        ],
    }


class PlayError(Exception):
    """A request the play API refuses; ``status`` is the HTTP code."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class PlaySession:
    """One human-vs-bot match: the authoritative state stays here, never in a response."""

    sid: str
    setup: MatchSetup
    human_seat: int
    bot_policy: str
    bot_runner: PolicyRunner
    worker: EngineWorker
    record_path: Path
    max_decisions: int
    max_turns: int
    rows: list[dict[str, Any]] = field(default_factory=list)
    state: Mapping[str, Any] | None = None
    state_hash: str | None = None
    status: str | None = None  # None while the match is live
    detail: str | None = None
    pending: Decision | None = None
    offered_at: float = 0.0
    observation: Mapping[str, Any] | None = None
    human_id: str | None = None
    record_written: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def policy_names(self) -> list[str]:
        names = [self.bot_policy, self.bot_policy]
        names[self.human_seat] = HUMAN_REASON
        return names

    @property
    def match_id(self) -> str:
        return self.rows[0]["matchId"]

    async def _engine(self, method: Callable, **kwargs):
        return await asyncio.to_thread(method, content=self.setup.content, **kwargs)

    async def start(self) -> None:
        self.rows = [match_header(self.setup, self.policy_names, max_decisions=self.max_decisions,
                                  max_turns=self.max_turns)]
        try:
            created = await self._engine(self.worker.create_game, initialization=self.setup.initialization)
        except EngineProtocolError as exc:
            await self.finish("engine_error", str(exc)[:500])
            return
        self.state, self.state_hash = created["state"], created["stateHash"]
        self.rows[0]["initialStateHash"] = self.state_hash
        self.human_id = next(pid for pid, player in self.state["players"].items()
                             if player["seat"] == self.human_seat)
        await self._advance()

    async def _advance(self) -> None:
        """Let the bot move until the human must act or the match stops."""
        try:
            while True:
                state = self.state
                if state["match"].get("outcome"):
                    return await self.finish("finished")
                index = len(self.rows) - 1
                if index >= self.max_decisions:
                    return await self.finish("decision_cap")
                if state["timing"]["turn"] > self.max_turns:
                    return await self.finish("turn_cap")
                actor = state["timing"]["actingPlayer"]
                seat = state["players"][actor]["seat"]
                model_input = await self._engine(self.worker.model_input, state=state, actor_id=actor)
                if not model_input["legalActions"]:
                    return await self.finish("no_legal_actions", "engine offered the acting player no action")
                decision = build_decision(self.match_id, index, actor, model_input)
                if seat == self.human_seat:
                    self.pending, self.offered_at = decision, time.monotonic()
                    self.observation = model_input["observation"]
                    return
                selection = await self.bot_runner.choose(decision)
                if selection.action_id not in decision.offered_ids:
                    raise AssertionError("policy runner returned an actionId the engine did not offer")
                await self._apply(decision, seat, self.bot_policy, selection)
        except EngineProtocolError as exc:
            await self.finish("engine_error", str(exc)[:500])

    async def _apply(self, decision: Decision, seat: int, policy: str, selection: Selection) -> None:
        transition = await self._engine(self.worker.apply_action, state=self.state,
                                        actor_id=decision.player_id, action_id=selection.action_id)
        self.state, self.state_hash = transition["state"], transition["stateHash"]
        self.rows.append(decision_row(decision.sequence, decision, seat, policy, selection, self.state_hash))

    async def act(self, action_id: Any) -> None:
        if self.status is not None:
            raise PlayError("This match is over.", 409)
        decision = self.pending
        if decision is None:
            raise PlayError("It is not your decision.", 409)
        if not isinstance(action_id, str) or action_id not in decision.offered_ids:
            raise PlayError("That actionId was not offered by the engine.", 400)
        elapsed = round((time.monotonic() - self.offered_at) * 1000, 2)
        self.pending = None
        try:
            await self._apply(decision, self.human_seat, HUMAN_REASON,
                              Selection(action_id, HUMAN_REASON, elapsed))
        except EngineProtocolError as exc:
            await self.finish("engine_error", str(exc)[:500])
            return
        await self._advance()

    async def finish(self, status: str, detail: str | None = None) -> None:
        """Close the match: final public view, result row, record, worker shut down."""
        if self.status is not None:
            return
        self.status, self.detail, self.pending = status, detail, None
        if self.state is not None and self.human_id is not None and status != "engine_error":
            try:
                model_input = await self._engine(self.worker.model_input, state=self.state,
                                                 actor_id=self.human_id)
                self.observation = model_input["observation"]
            except EngineProtocolError:
                pass
        self.rows.append(result_row(self.match_id, self.rows, status, detail, self.state, self.state_hash))
        try:
            write_match_record(self.record_path, self.rows)
            self.record_written = True
        except FileExistsError:
            self.detail = (self.detail or "") + " (record not written: file already exists)"
        self.close()

    def close(self) -> None:
        self.worker.close()

    def view(self, catalog: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        """What the human may see: own public observation, offered actions, own moves."""
        observation = self.observation or {}
        card_ids = sorted({card["content"]["cardId"] for player in observation.get("players", [])
                           for card in player.get("cards", []) if isinstance(card.get("content"), dict)})
        log = []
        for row in self.rows[1:]:
            if row.get("kind") != "decision":
                continue
            mine = row["seat"] == self.human_seat
            log.append({"index": row["index"], "turn": row["turn"], "step": row["step"],
                        "seat": row["seat"], "mine": mine,
                        "label": row["label"] if mine else None,
                        "elapsedMs": row["elapsedMs"] if mine else None})
        actions = [] if self.pending is None else [
            {"actionId": a["actionId"], "label": (a.get("descriptor") or {}).get("label"),
             "descriptor": a.get("descriptor")} for a in self.pending.legal_actions]
        result = self.rows[-1] if self.status is not None else None
        return {"id": self.sid, "seed": self.rows[0]["seed"], "format": self.rows[0]["format"],
                "setupSource": self.setup.source, "humanSeat": self.human_seat,
                "botPolicy": self.bot_policy, "status": self.status or "live", "detail": self.detail,
                "yourTurn": self.pending is not None, "observation": observation, "actions": actions,
                "log": log, "cards": {cid: catalog[cid] for cid in card_ids if cid in catalog},
                "result": result,
                "record": self.record_path.name if self.record_written else None}


class PlayState:
    """In-memory sessions, the cached Demo setup and the optional shared MLX worker."""

    def __init__(self, records_dir: Path, node: str, setup_loader: Callable[[], MatchSetup] | None,
                 mlx_model: str | None, mlx_adapter: str | None):
        self.records_dir = records_dir
        self.node = node
        self.setup_loader = setup_loader or (lambda: load_default_setup(REPO_ROOT, node=node))
        self.mlx_model, self.mlx_adapter = mlx_model, mlx_adapter
        self.sessions: dict[str, PlaySession] = {}
        self._demo: MatchSetup | None = None
        self._mlx = None
        self._mlx_lock = asyncio.Lock()
        self._create_lock = asyncio.Lock()

    async def demo_setup(self) -> MatchSetup:
        if self._demo is None:
            self._demo = await asyncio.to_thread(self.setup_loader)
        return self._demo

    async def resolve_setup(self, path: Any) -> MatchSetup:
        if path in (None, ""):
            return await self.demo_setup()
        if not isinstance(path, str):
            raise PlayError("setup must be a file path or blank for the Demo setup.")
        target = Path(path).expanduser()
        if not target.is_absolute():
            target = REPO_ROOT / target
        if target.suffix != ".json" or not target.is_file():
            raise PlayError("setup must name an existing .json file.")
        try:
            return load_setup_file(target)
        except (ValueError, OSError) as exc:
            raise PlayError(f"setup file rejected: {exc}") from None

    async def bot_runner(self, policy: str) -> PolicyRunner:
        if policy == "baseline":
            return PolicyRunner()
        if policy != "mlx":
            raise PlayError(f"policy must be one of {', '.join(BOT_POLICIES)}.")
        if not mlx_available():
            raise PlayError("An mlx bot requires native arm64 Python on Apple Silicon macOS.")
        from games.cyberpunk.sim_mlx import DEFAULT_MODEL, MLXPolicy, make_worker
        async with self._mlx_lock:
            if self._mlx is None:
                try:
                    worker = make_worker(self.mlx_model or DEFAULT_MODEL, adapter=self.mlx_adapter)
                except ValueError as exc:
                    raise PlayError(str(exc)) from None
                await worker.start()
                self._mlx = worker
        return PolicyRunner(MLXPolicy(self._mlx))

    async def create(self, payload: Mapping[str, Any]) -> PlaySession:
        seat = payload.get("seat", 0)
        if seat not in (0, 1) or isinstance(seat, bool):
            raise PlayError("seat must be 0 or 1.")
        policy = payload.get("policy") or "baseline"
        seed = payload.get("seed") or "human-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        if not isinstance(seed, str) or not SEED_RE.match(seed):
            raise PlayError("seed must be 1-80 letters, digits, '.', '_' or '-'.")
        limits = {}
        for key, default, low in (("maxDecisions", DEFAULT_MAX_DECISIONS, 1),
                                  ("maxTurns", DEFAULT_MAX_TURNS, 0)):
            value = payload.get(key, default)
            if type(value) is not int or value < low:
                raise PlayError(f"{key} must be an integer >= {low}.")
            limits[key] = value
        record_path = self.records_dir / f"{seed}.jsonl"
        async with self._create_lock:
            live = [s for s in self.sessions.values() if s.status is None]
            if len(live) >= MAX_ACTIVE_SESSIONS:
                raise PlayError(f"{len(live)} matches are already live; finish or abandon one first.", 409)
            if record_path.exists() or any(s.record_path == record_path for s in live):
                raise PlayError(f"A record for seed {seed!r} already exists; choose another seed.", 409)
            setup = await self.resolve_setup(payload.get("setup"))
            if len(setup.initialization["players"]) != 2:
                raise PlayError("Human matches need a two-player setup.")
            runner = await self.bot_runner(policy)
            session = PlaySession(sid=secrets.token_urlsafe(9), setup=setup.for_seed(seed), human_seat=seat,
                                  bot_policy=policy, bot_runner=runner,
                                  worker=EngineWorker(REPO_ROOT, node=self.node), record_path=record_path,
                                  max_decisions=limits["maxDecisions"], max_turns=limits["maxTurns"])
            self.sessions[session.sid] = session
            self._prune()
        async with session.lock:
            await session.start()
        return session

    def _prune(self) -> None:
        done = [sid for sid, s in self.sessions.items() if s.status is not None]
        for sid in done[:max(0, len(self.sessions) - MAX_KEPT_SESSIONS)]:
            del self.sessions[sid]

    def get(self, sid: str) -> PlaySession:
        session = self.sessions.get(sid)
        if session is None:
            raise PlayError("No such match.", 404)
        return session

    def catalog(self, session: PlaySession) -> dict[str, dict[str, Any]]:
        return {card["id"]: {k: card[k] for k in CARD_FIELDS if k in card}
                for card in session.setup.content.get("cards", []) if isinstance(card, dict) and "id" in card}

    async def close_all(self) -> None:
        for session in list(self.sessions.values()):
            if session.status is None:
                await session.finish("abandoned", "server shut down")
            session.close()
        if self._mlx is not None:
            await self._mlx.close()
            self._mlx = None

    # Match records (the viewer) -------------------------------------------------------

    def list_records(self, limit: int = 500) -> list[dict[str, Any]]:
        if not self.records_dir.is_dir():
            return []
        files = sorted((p for p in self.records_dir.glob("*.jsonl") if RECORD_RE.match(p.name)),
                       key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
        out = []
        for path in files:
            entry: dict[str, Any] = {"name": path.name, "modified": datetime.fromtimestamp(
                path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")}
            try:
                rows = self._read_rows(path)
                header, result = rows[0], rows[-1]
                entry.update({"seed": header.get("seed"), "format": header.get("format"),
                              "policies": [s.get("policy") for s in header.get("seats", [])],
                              "setupSource": header.get("setupSource")})
                if result.get("kind") == "result":
                    entry.update({k: result.get(k) for k in ("status", "winnerSeat", "reason", "turns",
                                                             "decisions")})
            except (ValueError, OSError, IndexError, AttributeError) as exc:
                entry["error"] = f"unreadable record: {exc}"[:200]
            out.append(entry)
        return out

    def _read_rows(self, path: Path) -> list[dict[str, Any]]:
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not rows or not isinstance(rows[0], dict) or rows[0].get("kind") != "match":
            raise ValueError("first row is not a match header")
        return rows

    def read_record(self, name: str) -> list[dict[str, Any]]:
        if not RECORD_RE.match(name):
            raise PlayError("Not a record name.", 400)
        path = self.records_dir / name
        if not path.is_file():
            raise PlayError("No such record.", 404)
        try:
            return self._read_rows(path)
        except ValueError as exc:
            raise PlayError(f"unreadable record: {exc}", 422) from None


def build_play_app(records_dir: Path = DEFAULT_OUTPUT_DIR, *, token: str | None = None, node: str = "node",
                   setup_loader: Callable[[], MatchSetup] | None = None, mlx_model: str | None = None,
                   mlx_adapter: str | None = None):
    """The FastAPI app: the monitor's app (token, job routes) plus the play and record routes."""
    from fastapi import Request
    from fastapi.responses import HTMLResponse, JSONResponse
    from fastapi.routing import APIRoute

    records_dir = Path(records_dir)
    if not records_dir.is_absolute():
        records_dir = REPO_ROOT / records_dir
    play = PlayState(records_dir, node, setup_loader, mlx_model, mlx_adapter)
    action = bot_match_action(records_dir, node)

    def refused(exc: PlayError):
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=exc.status)

    def routes(app):
        # The monitor registers its generic console at "/"; this app's page replaces it.
        app.router.routes[:] = [r for r in app.router.routes
                                if not (isinstance(r, APIRoute) and r.path == "/")]

        @app.get("/", response_class=HTMLResponse)
        def index():
            return PLAY_HTML

        @app.get("/api/play/config")
        def config():
            return {"policies": [p for p in BOT_POLICIES if p == "baseline" or mlx_available()],
                    "seats": [0, 1], "maxDecisions": DEFAULT_MAX_DECISIONS, "maxTurns": DEFAULT_MAX_TURNS,
                    "recordsDir": str(records_dir), "botAction": action["id"],
                    "live": [s.sid for s in play.sessions.values() if s.status is None]}

        @app.post("/api/play")
        async def create(request: Request):
            try:
                payload = await request.json()
            except ValueError:
                payload = None
            if not isinstance(payload, dict):
                return refused(PlayError("Send a JSON object."))
            try:
                session = await play.create(payload)
            except PlayError as exc:
                return refused(exc)
            return session.view(play.catalog(session))

        @app.get("/api/play/{sid}")
        async def view(sid: str):
            try:
                session = play.get(sid)
            except PlayError as exc:
                return refused(exc)
            async with session.lock:
                return session.view(play.catalog(session))

        @app.post("/api/play/{sid}/action")
        async def act(sid: str, request: Request):
            try:
                payload = await request.json()
            except ValueError:
                payload = None
            try:
                session = play.get(sid)
                if not isinstance(payload, dict):
                    raise PlayError("Send a JSON object with an actionId.")
                async with session.lock:
                    await session.act(payload.get("actionId"))
                    return session.view(play.catalog(session))
            except PlayError as exc:
                return refused(exc)

        @app.post("/api/play/{sid}/abandon")
        async def abandon(sid: str):
            try:
                session = play.get(sid)
            except PlayError as exc:
                return refused(exc)
            async with session.lock:
                await session.finish("abandoned", "abandoned by the player")
                return session.view(play.catalog(session))

        @app.get("/api/records")
        def records():
            return {"dir": str(records_dir), "records": play.list_records()}

        @app.get("/api/records/{name}")
        def record(name: str):
            try:
                return {"name": name, "rows": play.read_record(name)}
            except PlayError as exc:
                return refused(exc)

    app = build_app([action], REPO_ROOT, title="Cyberpunk TCG local play", token=token,
                    runner=Runner({action["id"]: action}, REPO_ROOT), extra_routes=routes)
    app.state.play = play
    inner_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(asgi_app):
        # Engine workers and the MLX worker are closed on the server's own loop.
        async with inner_lifespan(asgi_app) as value:
            try:
                yield value
            finally:
                await play.close_all()

    app.router.lifespan_context = lifespan
    return app


def serve_play(host: str = "127.0.0.1", port: int = 8766, *, lan: bool = False, no_auth: bool = False,
               records_dir: Path = DEFAULT_OUTPUT_DIR, node: str = "node", mlx_model: str | None = None,
               mlx_adapter: str | None = None) -> None:
    """Serve on loopback by default; any other bind needs the printed token unless ``no_auth``."""
    import uvicorn

    bind = "0.0.0.0" if lan else host
    token = None if (no_auth or is_loopback(bind)) else secrets.token_urlsafe(12)
    app = build_play_app(records_dir, token=token, node=node, mlx_model=mlx_model, mlx_adapter=mlx_adapter)
    shown = f"http://{lan_ip() if lan else host}:{port}"
    print(f"Cyberpunk TCG local play -> {shown}/" + (f"?t={token}" if token else ""), flush=True)
    if not is_loopback(bind) and not token:
        print("  WARNING: reachable beyond this machine with --no-auth. Anyone on this network can "
              "play, start bot jobs and read match records.", flush=True)
    try:
        uvicorn.run(app, host=bind, port=port, log_level="warning")
    finally:
        # Lifespan shutdown already closed everything; this only catches an aborted startup.
        for session in app.state.play.sessions.values():
            session.close()


PLAY_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cyberpunk TCG local play</title>
<style>
:root{--bg:#f6f6f4;--panel:#fff;--ink:#1b1b1f;--muted:#666;--line:#ddd;--accent:#0b6e69;--warn:#a03a00;--mine:#e7f4f2;--card:#fafafa}
@media (prefers-color-scheme: dark){:root{--bg:#141417;--panel:#1d1d22;--ink:#e8e8ea;--muted:#9a9aa2;--line:#33333a;--accent:#4fc1b8;--warn:#ff9a5c;--mine:#183331;--card:#24242a}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;gap:16px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
header h1{font-size:16px;margin:0}
nav button{background:none;border:0;border-bottom:2px solid transparent;padding:6px 10px;color:var(--muted);cursor:pointer;font:inherit}
nav button.on{color:var(--ink);border-color:var(--accent)}
main{padding:16px;max-width:1200px;margin:0 auto}
section{display:none}section.on{display:block}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
input,select{font:inherit;padding:5px 6px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--ink)}
button.act,button.go{font:inherit;padding:6px 10px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.ghost{font:inherit;padding:5px 9px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.actions button.act{background:var(--panel);color:var(--ink);text-align:left}
.actions button.act:hover{background:var(--mine)}
.muted{color:var(--muted)}.warn{color:var(--warn)}.err{color:var(--warn);white-space:pre-wrap}
.board{display:grid;grid-template-columns:1fr;gap:12px}
.zone{margin:6px 0}.zone b{font-size:12px;color:var(--muted);display:block;margin-bottom:3px}
.cards{display:flex;flex-wrap:wrap;gap:6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 7px;font-size:12px;max-width:220px}
.card.spent{opacity:.65;border-style:dashed}.card.down{color:var(--muted);font-style:italic}
.dice{display:flex;gap:6px;flex-wrap:wrap;font-size:12px}
.die{border:1px solid var(--line);border-radius:4px;padding:1px 5px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
tr.sel td{background:var(--mine)}tr.click{cursor:pointer}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:360px;overflow:auto;background:var(--card);padding:8px;border-radius:6px;margin:0}
.log{max-height:260px;overflow:auto;font-size:12px}
.log div.mine{background:var(--mine)}
.banner{font-weight:600;padding:8px;border-radius:6px;background:var(--mine)}
.twocol{display:grid;grid-template-columns:2fr 1fr;gap:12px}
@media (max-width:800px){.twocol{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Cyberpunk TCG local play</h1>
<nav><button data-tab="play" class="on">Play a bot</button><button data-tab="bots">Bot vs bot</button><button data-tab="records">Match records</button></nav>
<span class="muted" id="hdr"></span></header>
<main>
<section id="play" class="on">
  <div class="panel" id="newgame">
    <div class="row">
      <label>Your seat<select id="pSeat"><option value="0">Seat 0</option><option value="1">Seat 1</option></select></label>
      <label>Bot policy<select id="pPolicy"></select></label>
      <label>Seed<input id="pSeed" placeholder="auto"></label>
      <label>Setup file<input id="pSetup" placeholder="blank: fixed Demo decks" size="28"></label>
      <label>Max turns<input id="pTurns" type="number" min="0" style="width:80px"></label>
      <button class="go" id="pStart">Start match</button>
    </div>
    <div class="err" id="pErr"></div>
  </div>
  <div id="game"></div>
</section>
<section id="bots">
  <div class="panel">
    <div class="row">
      <label>Matches<input id="bMatches" type="number" min="1" value="1" style="width:70px"></label>
      <label>Seed prefix<input id="bSeed" value="local"></label>
      <label>Seat 0<select id="bP0"></select></label>
      <label>Seat 1<select id="bP1"></select></label>
      <label>Setup file<input id="bSetup" placeholder="blank: fixed Demo decks" size="24"></label>
      <label>Max decisions<input id="bMaxD" type="number" min="1" style="width:90px"></label>
      <label>Max turns<input id="bMaxT" type="number" min="0" style="width:80px"></label>
      <label>Replace records<input id="bForce" type="checkbox"></label>
      <button class="go" id="bStart">Run</button>
      <button class="ghost" id="bCancel" disabled>Cancel</button>
    </div>
    <div class="err" id="bErr"></div>
  </div>
  <div class="panel"><div id="bStatus" class="muted">No job yet. Jobs run one at a time.</div><pre id="bLog"></pre></div>
  <div class="panel"><b>Recent jobs</b><div id="bHist"></div></div>
</section>
<section id="records">
  <div class="panel"><div class="row"><button class="ghost" id="rRefresh">Refresh</button><span class="muted" id="rDir"></span></div>
  <div id="rList"></div></div>
  <div id="rView"></div>
</section>
</main>
<script>
"use strict";
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
async function api(path, body) {
  const opts = body === undefined ? {} : {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)};
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { data = {error: res.status + " " + res.statusText}; }
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}
function fill(sel, values) { sel.replaceChildren(...values.map(v => h("option", {value: v}, v))); }
function num(id) { const v = $(id).value.trim(); return v === "" ? undefined : Number(v); }

document.querySelectorAll("nav button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll("main section").forEach(s => s.classList.toggle("on", s.id === b.dataset.tab));
  if (b.dataset.tab === "records") loadRecords();
  if (b.dataset.tab === "bots") loadHistory();
}));

let CONFIG = null;
async function init() {
  CONFIG = await api("/api/play/config");
  fill($("pPolicy"), CONFIG.policies);
  fill($("bP0"), CONFIG.policies); fill($("bP1"), CONFIG.policies);
  $("pTurns").value = CONFIG.maxTurns; $("bMaxT").value = CONFIG.maxTurns; $("bMaxD").value = CONFIG.maxDecisions;
  $("hdr").textContent = "records: " + CONFIG.recordsDir;
  if (CONFIG.live.length) { SID = CONFIG.live[0]; refreshGame(); }
}

/* ---------- play a bot ---------- */
let SID = null, BUSY = false;
$("pStart").addEventListener("click", async () => {
  $("pErr").textContent = ""; $("pStart").disabled = true;
  $("game").replaceChildren(h("div", {class: "panel muted"}, "Starting the engine and letting the bot move..."));
  try {
    const body = {seat: Number($("pSeat").value), policy: $("pPolicy").value, maxTurns: num("pTurns")};
    if ($("pSeed").value.trim()) body.seed = $("pSeed").value.trim();
    if ($("pSetup").value.trim()) body.setup = $("pSetup").value.trim();
    const view = await api("/api/play", body);
    SID = view.id; renderGame(view);
  } catch (e) { $("pErr").textContent = e.message; $("game").replaceChildren(); }
  finally { $("pStart").disabled = false; }
});
async function refreshGame() { if (SID) renderGame(await api("/api/play/" + SID)); }
async function choose(actionId) {
  if (BUSY) return; BUSY = true;
  document.querySelectorAll(".actions button").forEach(b => { b.disabled = true; });
  try { renderGame(await api("/api/play/" + SID + "/action", {actionId: actionId})); }
  catch (e) { $("pErr").textContent = e.message; refreshGame(); }
  finally { BUSY = false; }
}
async function abandon() {
  if (!confirm("Abandon this match? Its record is written with status abandoned.")) return;
  renderGame(await api("/api/play/" + SID + "/abandon", {}));
}
function cardName(cards, card) {
  const c = card.content && cards[card.content.cardId];
  if (!card.content) return "face-down card";
  return c ? (c.displayName || c.name) : card.content.cardId;
}
function cardTitle(cards, card) {
  const c = card.content && cards[card.content.cardId];
  if (!c) return null;
  const cost = c.printedCost && c.printedCost.kind === "EDDIES" ? "cost " + c.printedCost.amount : "";
  return [c.type, cost, c.power !== undefined ? "power " + c.power : "", (c.keywords || []).join(" "), c.rulesText].filter(Boolean).join(" | ");
}
function renderCard(cards, card) {
  const bits = [cardName(cards, card)];
  if (card.effectivePower !== undefined && card.effectivePower !== null) bits.push("P" + card.effectivePower);
  if (card.damage) bits.push("dmg " + card.damage);
  if (card.readiness === "SPENT") bits.push("spent");
  if (card.effectiveKeywords && card.effectiveKeywords.length) bits.push(card.effectiveKeywords.join(","));
  if (card.attachments && card.attachments.length) bits.push("+" + card.attachments.length + " attached");
  const cls = "card" + (card.readiness === "SPENT" ? " spent" : "") + (card.content ? "" : " down");
  return h("span", {class: cls, title: cardTitle(cards, card)}, bits.join(" · "));
}
function renderPlayer(view, p) {
  const you = p.seat === view.humanSeat;
  const zones = {};
  for (const card of p.cards || []) (zones[card.zone] = zones[card.zone] || []).push(card);
  const counts = Object.entries(p.counts || {}).map(([k, v]) => k.toLowerCase() + " " + v).join(", ");
  return h("div", {class: "panel"},
    h("div", {}, h("b", {}, (you ? "You" : "Bot") + " (seat " + p.seat + ")"), "  street cred " + p.streetCred, h("span", {class: "muted"}, "  " + counts)),
    h("div", {class: "dice"}, (p.gigs || []).map(d => h("span", {class: "die", title: d.zone},
      d.dieType + (d.roll && d.roll.kind === "ROLLED" ? "=" + d.roll.currentValue : " unrolled") + (d.zone === "GIGS" ? " gig" : "")))),
    Object.entries(zones).map(([zone, list]) => h("div", {class: "zone"}, h("b", {}, zone), h("div", {class: "cards"}, list.map(c => renderCard(view.cards, c))))));
}
function renderGame(view) {
  const o = view.observation || {};
  const players = (o.players || []).slice().sort((a, b) => (a.seat === view.humanSeat) - (b.seat === view.humanSeat));
  let status;
  if (view.status !== "live") {
    const r = view.result || {};
    const won = r.winnerSeat === view.humanSeat ? "You won" : (r.winnerSeat === null || r.winnerSeat === undefined ? "No winner" : "The bot won");
    status = h("div", {class: "banner"}, view.status + ": " + won + (r.reason ? " (" + r.reason + ")" : "") + (view.detail ? " - " + view.detail : "") + (view.record ? "  record: " + view.record : ""));
  } else {
    status = h("div", {class: "banner"}, view.yourTurn ? "Your decision" : "Waiting for the bot");
  }
  const actions = h("div", {class: "actions"}, view.actions.map(a => h("button", {class: "act", title: a.descriptor ? JSON.stringify(a.descriptor) : null, onclick: () => choose(a.actionId)}, a.label || a.actionId.slice(0, 12))));
  const log = h("div", {class: "log"}, view.log.slice().reverse().map(d => h("div", {class: d.mine ? "mine" : ""},
    "#" + d.index + " t" + d.turn + " " + d.step + ": " + (d.mine ? "you: " + d.label : "bot acted"))));
  const choice = o.choice ? h("div", {class: "muted"}, "Pending choice: " + o.choice.kind + " (" + o.choice.min + ".." + o.choice.max + ") for seat " + o.choice.actorSeat) : null;
  $("game").replaceChildren(
    h("div", {class: "panel"}, h("div", {class: "row"},
      h("span", {}, "Seed " + view.seed + " · " + view.format + " · " + view.setupSource + " · you are seat " + view.humanSeat + " vs " + view.botPolicy),
      view.status === "live" ? h("button", {class: "ghost", onclick: abandon}, "Abandon") : null),
      h("div", {class: "muted"}, "Turn " + o.turn + " · " + o.window + " / " + o.step + " · active seat " + o.activeSeat + " · acting seat " + o.actingSeat),
      status, choice),
    h("div", {class: "twocol"},
      h("div", {class: "board"}, players.map(p => renderPlayer(view, p))),
      h("div", {},
        h("div", {class: "panel"}, h("b", {}, "Engine-offered actions"), view.actions.length ? actions : h("div", {class: "muted"}, "None for you right now.")),
        h("div", {class: "panel"}, h("b", {}, "Moves"), log),
        h("details", {class: "panel"}, h("summary", {}, "Your public observation (raw)"), h("pre", {}, JSON.stringify(o, null, 1))))));
}

/* ---------- bot vs bot ---------- */
let JOB = null, JOB_LINES = 0, JOB_TIMER = null;
$("bStart").addEventListener("click", async () => {
  $("bErr").textContent = "";
  const values = {"--matches": num("bMatches"), "--seed": $("bSeed").value.trim(), seat0: $("bP0").value, seat1: $("bP1").value,
    "--setup": $("bSetup").value.trim(), "--max-decisions": num("bMaxD"), "--max-turns": num("bMaxT"), "--force": $("bForce").checked};
  try {
    const r = await api("/api/run/" + CONFIG.botAction, {values: values});
    JOB = r.job; JOB_LINES = 0; $("bLog").textContent = ""; pollJob();
  } catch (e) { $("bErr").textContent = e.message; }
});
$("bCancel").addEventListener("click", async () => { if (JOB) { try { await api("/api/cancel/" + JOB, {}); } catch (e) { $("bErr").textContent = e.message; } } });
async function pollJob() {
  clearTimeout(JOB_TIMER);
  if (!JOB) return;
  const j = await api("/api/job/" + JOB + "?since=" + JOB_LINES);
  JOB_LINES = j.total_lines;
  if (j.lines.length) $("bLog").textContent += j.lines.join("\n") + "\n";
  $("bLog").scrollTop = $("bLog").scrollHeight;
  $("bStatus").textContent = j.label + ": " + j.status + " · started " + j.started + (j.ended ? " · ended " + j.ended : "") + " · " + j.cmd;
  $("bStart").disabled = j.status === "running"; $("bCancel").disabled = j.status !== "running";
  if (j.status === "running") JOB_TIMER = setTimeout(pollJob, 1000); else loadHistory();
}
async function loadHistory() {
  const r = await api("/api/history");
  $("bHist").replaceChildren(h("table", {}, h("tr", {}, h("th", {}, "Started"), h("th", {}, "Job"), h("th", {}, "Status"), h("th", {}, "Exit")),
    r.jobs.map(j => h("tr", {class: "click", onclick: () => { JOB = j.id; JOB_LINES = 0; $("bLog").textContent = ""; pollJob(); }},
      h("td", {}, j.started), h("td", {}, j.label), h("td", {}, j.status), h("td", {}, j.returncode)))));
  if (r.active && !JOB) { JOB = r.active; pollJob(); }
}

/* ---------- match records ---------- */
$("rRefresh").addEventListener("click", () => loadRecords());
async function loadRecords() {
  const r = await api("/api/records");
  $("rDir").textContent = r.dir;
  if (!r.records.length) { $("rList").replaceChildren(h("div", {class: "muted"}, "No match records yet.")); return; }
  $("rList").replaceChildren(h("table", {},
    h("tr", {}, ["Record", "Policies", "Status", "Winner seat", "Reason", "Turns", "Decisions", "Modified"].map(x => h("th", {}, x))),
    r.records.map(x => h("tr", {class: "click", onclick: () => openRecord(x.name)},
      h("td", {}, x.name), h("td", {}, (x.policies || []).join(" vs ")), h("td", {class: x.error ? "warn" : ""}, x.error || x.status),
      h("td", {}, x.winnerSeat), h("td", {}, x.reason), h("td", {}, x.turns), h("td", {}, x.decisions), h("td", {}, x.modified)))));
}
let REC = null, STEP = 0;
async function openRecord(name) {
  const r = await api("/api/records/" + encodeURIComponent(name));
  const rows = r.rows;
  REC = {name: name, header: rows[0], decisions: rows.filter(x => x.kind === "decision"), result: rows.find(x => x.kind === "result")};
  STEP = 0; renderRecord();
}
function stepTo(i) { STEP = Math.max(0, Math.min(REC.decisions.length - 1, i)); renderRecord(); }
function renderRecord() {
  const hd = REC.header, d = REC.decisions[STEP], res = REC.result;
  const kv = (k, v) => h("tr", {}, h("th", {}, k), h("td", {}, v === undefined || v === null ? "" : (typeof v === "object" ? JSON.stringify(v) : v)));
  const nav = h("div", {class: "row"},
    h("button", {class: "ghost", onclick: () => stepTo(0)}, "First"), h("button", {class: "ghost", onclick: () => stepTo(STEP - 1)}, "Prev"),
    h("button", {class: "ghost", onclick: () => stepTo(STEP + 1)}, "Next"), h("button", {class: "ghost", onclick: () => stepTo(REC.decisions.length - 1)}, "Last"),
    h("input", {type: "range", min: 0, max: Math.max(0, REC.decisions.length - 1), value: STEP, oninput: e => stepTo(Number(e.target.value))}),
    h("span", {}, REC.decisions.length ? "decision " + (STEP + 1) + " of " + REC.decisions.length : "no decisions"));
  const table = h("table", {}, h("tr", {}, ["#", "Turn", "Step", "Seat", "Policy", "Offered", "Action", "Reason", "ms"].map(x => h("th", {}, x))),
    REC.decisions.map((x, i) => h("tr", {class: "click" + (i === STEP ? " sel" : ""), onclick: () => stepTo(i)},
      h("td", {}, x.index), h("td", {}, x.turn), h("td", {}, x.step), h("td", {}, x.seat), h("td", {}, x.policy), h("td", {}, x.offered),
      h("td", {}, x.label), h("td", {class: String(x.reason).endsWith("_fallback") ? "warn" : ""}, x.reason), h("td", {}, x.elapsedMs))));
  $("rView").replaceChildren(
    h("div", {class: "twocol"},
      h("div", {class: "panel"}, h("b", {}, REC.name), nav,
        d ? h("table", {}, kv("Decision", d.index), kv("Turn / step", d.turn + " / " + d.step), kv("Seat / player", d.seat + " / " + d.playerId),
          kv("Policy", d.policy), kv("Offered", d.offered), kv("Chosen", d.label), kv("actionId", d.actionId), kv("Reason", d.reason),
          kv("Elapsed ms", d.elapsedMs), kv("State hash after", d.stateHash)) : null),
      h("div", {class: "panel"}, h("b", {}, "Match"), h("table", {}, kv("Seed", hd.seed), kv("Format", hd.format), kv("Setup", hd.setupSource),
        kv("Seats", (hd.seats || []).map(s => s.seat + ": " + s.policy).join(", ")), kv("Engine", hd.engine && hd.engine.version), kv("Limits", hd.limits)),
        h("b", {}, "Result"), res ? h("table", {}, kv("Status", res.status), kv("Winner seat", res.winnerSeat), kv("Reason", res.reason), kv("Turns", res.turns),
          kv("Decisions", res.decisions), kv("Selections", res.selections), kv("Detail", res.detail)) : h("div", {class: "warn"}, "No result row"))),
    h("div", {class: "panel"}, table));
}

init().catch(e => { $("pErr").textContent = "Could not load: " + e.message; });
</script>
</body>
</html>
"""
