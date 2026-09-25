"""External Cyberpunk TCG Sim v1alpha1 transport and action selection.

The remote simulator owns legality and state transitions. Its JSON contract is
distinct from our local engine's ModelInputV2: never reconstruct GameState or
translate simulator payloads into local engine actions here.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import math
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping

API_VERSION = "v1alpha1"
GAME = "cyberpunk-tcg-sim"
LOGGER = logging.getLogger("cyberpunk.sim_bot")


class BotRequestError(ValueError):
    """A request cannot be safely interpreted under the simulator contract."""


@dataclass(frozen=True)
class BotProfile:
    bot_id: str = "community.cyberpunk-tcg-llm"
    name: str = "Cyberpunk TCG AI (baseline)"
    version: str = "0.1.0"

    def __post_init__(self):
        if any(not isinstance(value, str) or not value.strip()
               for value in (self.bot_id, self.name, self.version)):
            raise ValueError("bot id, name and version must be nonempty strings")


@dataclass(frozen=True)
class Decision:
    """Bot-visible policy input; nested JSON is an isolated per-call copy."""

    request_id: str
    match_id: str
    sequence: int
    player_id: str
    deadline_ms: float
    snapshot: Mapping[str, Any]
    legal_actions: tuple[Mapping[str, Any], ...]
    prompt: str
    turn: Mapping[str, Any]
    pending: Any
    metadata: Mapping[str, Any]


Policy = Callable[[Decision], Awaitable[str]]


def baseline_action_id(actions: tuple[Mapping[str, Any], ...]) -> str:
    """Deterministic smoke-play heuristic, not a rules or tactical evaluator.

    Resolve setup/pending choices first, otherwise prefer the guide's roll/play
    examples over ending a turn. Unknown action types remain selectable. Equal
    scores use the offered ID, so list reordering never changes the decision.
    """
    def rank(action):
        score = {"roll_die": 30, "play_card": 20, "end_turn": 0,
                 "concede": -100, "surrender": -100}.get(action.get("type"), 10)
        if action.get("source") in ("setup", "pending"):
            score += 50
        return (-score, action["actionId"])

    return min(actions, key=rank)["actionId"]


def _text(body, key):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip():
        raise BotRequestError(f"{key} must be a nonempty string.")
    return value


def _object(body, key):
    value = body.get(key, {})
    if not isinstance(value, dict):
        raise BotRequestError(f"{key} must be an object.")
    return value


def _version(body):
    if not isinstance(body, dict):
        raise BotRequestError("Request must be a JSON object.")
    if body.get("apiVersion") != API_VERSION:
        raise BotRequestError("Unsupported apiVersion.")


def _decision(body, profile):
    _version(body)
    if body.get("event") != "state_sync":
        raise BotRequestError("Unsupported event.")
    if body.get("botId") != profile.bot_id:
        raise BotRequestError("botId does not match this service.")
    for key in ("requestId", "matchId", "playerId"):
        _text(body, key)
    sequence = body.get("sequence")
    if type(sequence) is not int or sequence < 0:
        raise BotRequestError("sequence must be a nonnegative integer.")
    if body.get("status") not in ("acting", "waiting", "finished"):
        raise BotRequestError("Unsupported status.")
    if body["status"] != "acting":
        return None
    deadline = body.get("deadlineMs")
    if (type(deadline) not in (int, float) or (type(deadline) is float and not math.isfinite(deadline))
            or deadline <= 0):
        raise BotRequestError("deadlineMs must be a positive finite number.")
    # An explicitly supplied legalActions list is authoritative, even if empty
    # or invalid. Never fall through to a potentially stale alias in that case.
    actions = body.get("legalActions") if "legalActions" in body else body.get("possibleActions")
    if not isinstance(actions, list) or not actions:
        raise BotRequestError("Acting requests must offer a nonempty action list.")
    ids = set()
    for action in actions:
        if not isinstance(action, dict):
            raise BotRequestError("Every legal action must be an object.")
        action_id = _text(action, "actionId")
        if action_id in ids:
            raise BotRequestError("Duplicate actionId in legal actions.")
        ids.add(action_id)
        for key in ("type", "source"):
            if key in action and not isinstance(action[key], str):
                raise BotRequestError(f"Action {key} must be a string.")
    prompt = body.get("prompt", "")
    if not isinstance(prompt, str):
        raise BotRequestError("prompt must be a string.")
    return Decision(body["requestId"], body["matchId"], sequence,
                    body["playerId"], deadline, _object(body, "snapshot"),
                    tuple(actions), prompt, _object(body, "turn"),
                    body.get("pending"), _object(body, "metadata"))


class BotService:
    """Stateless HTTP decisions with bounded optional asynchronous inference.

    Policies must perform nonblocking I/O and cooperate with cancellation. A
    CPU/GPU model belongs in a separate worker process/service, never on this
    event loop. Outstanding calls are bounded even if cancellation is delayed.
    """

    def __init__(self, profile: BotProfile | None = None, policy: Policy | None = None,
                 max_decision_ms: int = 2500, max_policy_calls: int = 8):
        if type(max_decision_ms) is not int or max_decision_ms <= 0:
            raise ValueError("max_decision_ms must be a positive integer")
        if type(max_policy_calls) is not int or max_policy_calls <= 0:
            raise ValueError("max_policy_calls must be a positive integer")
        self.profile = profile or BotProfile()
        self.policy = policy
        self.max_decision_ms = max_decision_ms
        self.max_policy_calls = max_policy_calls
        self._tasks: set[asyncio.Task] = set()

    def ready(self, body):
        _version(body)
        if body.get("game") != GAME or body.get("check") != "ready":
            raise BotRequestError("Expected a cyberpunk-tcg-sim ready check.")
        return {"ok": True, "ready": True, "botId": self.profile.bot_id,
                "name": self.profile.name, "version": self.profile.version,
                "apiVersions": [API_VERSION]}

    def _completed(self, task):
        self._tasks.discard(task)
        if not task.cancelled():
            task.exception()  # Retrieve failures from calls cancelled after timeout.

    async def sync(self, body, *, started=None):
        started = time.monotonic() if started is None else started
        decision = _decision(body, self.profile)
        if decision is None:
            response = {"ok": True, "actionId": None, "requestId": body["requestId"]}
            self._log(body, response, "acknowledged", started)
            return response

        fallback = baseline_action_id(decision.legal_actions)
        offered = frozenset(action["actionId"] for action in decision.legal_actions)
        selected, reason = fallback, "baseline"
        if self.policy is not None:
            budget = min(decision.deadline_ms, self.max_decision_ms)
            # Leave room to encode/send the response and include request parsing.
            timeout = (budget - min(50, budget * 0.1)) / 1000 - (time.monotonic() - started)
            if timeout <= 0:
                reason = "deadline_fallback"
            elif len(self._tasks) >= self.max_policy_calls:
                reason = "busy_fallback"
            else:
                async def choose():
                    return await self.policy(copy.deepcopy(decision))

                task = asyncio.create_task(choose())
                self._tasks.add(task)
                task.add_done_callback(self._completed)
                try:
                    done, _ = await asyncio.wait({task}, timeout=timeout)
                    if not done:
                        task.cancel()
                        reason = "timeout_fallback"
                    elif task.cancelled():
                        reason = "policy_error_fallback"
                    else:
                        candidate = task.result()
                        if isinstance(candidate, str) and candidate in offered:
                            selected, reason = candidate, "policy"
                        else:
                            reason = "invalid_action_fallback"
                except asyncio.CancelledError:
                    task.cancel()
                    raise
                except Exception:
                    reason = "policy_error_fallback"

        response = {"ok": True, "actionId": selected, "requestId": decision.request_id}
        self._log(body, response, reason, started)
        return response

    @staticmethod
    def _log(body, response, reason, started):
        # Never log snapshots, known cards, model prompts or action payloads.
        LOGGER.info(json.dumps({"event": "bot_decision", "requestId": body["requestId"],
                               "matchId": body["matchId"], "sequence": body["sequence"],
                               "playerId": body["playerId"], "actionId": response["actionId"],
                               "selection": reason,
                               "elapsedMs": round((time.monotonic() - started) * 1000, 2)}))


def build_app(service: BotService | None = None, *, base_path: str = "",
              max_body_bytes: int = 2 * 1024 * 1024):
    """Build the optional FastAPI transport without loading MLX or local engine data."""
    # Lazy imports keep the existing offline corpus/engine clients lightweight.
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    if base_path not in ("", "/") and (not base_path.startswith("/") or base_path.startswith("//") or any(
            part in ("", ".", "..") for part in base_path.strip("/").split("/"))
            or any(char in base_path for char in "?#{}")):
        raise ValueError("base_path must be a literal absolute URL path")
    if type(max_body_bytes) is not int or max_body_bytes <= 0:
        raise ValueError("max_body_bytes must be a positive integer")
    prefix = base_path.rstrip("/")
    service = service or BotService()
    app = FastAPI(title=service.profile.name, docs_url=None, redoc_url=None, openapi_url=None)

    async def read_json(request):
        data = bytearray()
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > max_body_bytes:
                    raise BotRequestError("Request body is too large.")
        def reject_constant(_value):
            raise BotRequestError("Invalid JSON number.")
        try:
            return json.loads(data.decode("utf-8"), parse_constant=reject_constant)
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise BotRequestError("Invalid JSON request.") from exc

    async def handle(request, endpoint):
        started = time.monotonic()
        try:
            body = await read_json(request)
            result = service.ready(body) if endpoint == "ready" else await service.sync(body, started=started)
            return JSONResponse(result)
        except (BotRequestError, TimeoutError) as exc:
            message = str(exc) if isinstance(exc, BotRequestError) else "Request body timed out."
            return JSONResponse({"ok": False, "error": message}, status_code=400)

    # Explicit annotations avoid FastAPI resolving a locally imported Request
    # through this module's postponed-annotation globals.
    async def ready(request):
        return await handle(request, "ready")

    async def sync(request):
        return await handle(request, "sync")

    ready.__annotations__["request"] = Request
    sync.__annotations__["request"] = Request
    app.post(prefix + "/ready")(ready)
    app.post(prefix + "/sync")(sync)
    return app
