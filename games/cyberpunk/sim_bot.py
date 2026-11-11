"""Local action-selection policy layer: decision validation, baseline and bounded policy calls.

Whatever drives a match (the local engine, from scope 2 on) owns legality, hidden
state and transitions. It builds a `Decision` holding only the acting seat's
visible context and the legal actions it offers; `PolicyRunner.choose` returns
one of those offered action IDs, falling back to a deterministic baseline when a
policy is slow, busy, fails or returns anything else. Nothing here implements
game rules or invents actions.

The external simulator's v1alpha1 HTTP bridge that used to live here was retired
on 2026-11-11; see docs/simulator-bot-retirement.md.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping

LOGGER = logging.getLogger("cyberpunk.sim_bot")


class DecisionError(ValueError):
    """A decision cannot be safely offered to a policy."""


def _require_text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise DecisionError(f"{name} must be a nonempty string.")


@dataclass(frozen=True, kw_only=True)
class Decision:
    """Policy input, validated on construction; policies receive an isolated copy.

    `deadline_ms` is the driver's per-decision budget; None means the runner's
    own cap applies.
    """

    request_id: str
    match_id: str
    sequence: int
    player_id: str
    legal_actions: tuple[Mapping[str, Any], ...]
    deadline_ms: float | None = None
    snapshot: Mapping[str, Any] = field(default_factory=dict)
    prompt: str = ""
    turn: Mapping[str, Any] = field(default_factory=dict)
    pending: Any = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        for name in ("request_id", "match_id", "player_id"):
            _require_text(getattr(self, name), name)
        if type(self.sequence) is not int or self.sequence < 0:
            raise DecisionError("sequence must be a nonnegative integer.")
        deadline = self.deadline_ms
        if deadline is not None and (type(deadline) not in (int, float) or not math.isfinite(deadline)
                                     or deadline <= 0):
            raise DecisionError("deadline_ms must be a positive finite number.")
        actions = self.legal_actions
        if not isinstance(actions, (list, tuple)) or not actions:
            raise DecisionError("A decision must offer a nonempty action list.")
        ids = set()
        for action in actions:
            if not isinstance(action, dict):
                raise DecisionError("Every legal action must be an object.")
            _require_text(action.get("actionId"), "actionId")
            if action["actionId"] in ids:
                raise DecisionError("Duplicate actionId in legal actions.")
            ids.add(action["actionId"])
            for key in ("type", "source"):
                if key in action and not isinstance(action[key], str):
                    raise DecisionError(f"Action {key} must be a string.")
        object.__setattr__(self, "legal_actions", tuple(actions))
        for name in ("snapshot", "turn", "metadata"):
            if not isinstance(getattr(self, name), dict):
                raise DecisionError(f"{name} must be an object.")
        if not isinstance(self.prompt, str):
            raise DecisionError("prompt must be a string.")

    @property
    def offered_ids(self) -> frozenset[str]:
        return frozenset(action["actionId"] for action in self.legal_actions)


_RECORD_FIELDS = {"requestId": "request_id", "matchId": "match_id", "sequence": "sequence",
                  "playerId": "player_id", "legalActions": "legal_actions",
                  "deadlineMs": "deadline_ms", "snapshot": "snapshot", "prompt": "prompt",
                  "turn": "turn", "pending": "pending", "metadata": "metadata"}


def decision_from_record(record: Mapping[str, Any]) -> Decision:
    """Build a Decision from a camelCase JSON record; unknown keys are ignored.

    `legalActions` is the only accepted action list; there is no alias fallback.
    """
    if not isinstance(record, dict):
        raise DecisionError("A decision record must be a JSON object.")
    if "legalActions" not in record:
        raise DecisionError("A decision record must include legalActions.")
    return Decision(**{name: record[key] for key, name in _RECORD_FIELDS.items() if key in record})


Policy = Callable[[Decision], Awaitable[str]]


def baseline_action_id(actions: tuple[Mapping[str, Any], ...]) -> str:
    """Deterministic smoke-play heuristic, not a rules or tactical evaluator.

    Resolve setup/pending choices first, otherwise prefer roll/play actions over
    ending a turn. Unknown action types remain selectable. Equal scores use the
    offered ID, so list reordering never changes the decision.
    """
    def rank(action):
        score = {"roll_die": 30, "play_card": 20, "end_turn": 0,
                 "concede": -100, "surrender": -100}.get(action.get("type"), 10)
        if action.get("source") in ("setup", "pending"):
            score += 50
        return (-score, action["actionId"])

    return min(actions, key=rank)["actionId"]


@dataclass(frozen=True)
class Selection:
    action_id: str
    reason: str
    elapsed_ms: float


class PolicyRunner:
    """Choose one offered action, with bounded optional asynchronous inference.

    Policies must perform nonblocking I/O and cooperate with cancellation. A
    CPU/GPU model belongs in a separate worker process, never on this event
    loop. Outstanding calls are bounded even if cancellation is delayed.
    """

    def __init__(self, policy: Policy | None = None, *, max_decision_ms: int = 2500,
                 max_policy_calls: int = 8):
        if type(max_decision_ms) is not int or max_decision_ms <= 0:
            raise ValueError("max_decision_ms must be a positive integer")
        if type(max_policy_calls) is not int or max_policy_calls <= 0:
            raise ValueError("max_policy_calls must be a positive integer")
        self.policy = policy
        self.max_decision_ms = max_decision_ms
        self.max_policy_calls = max_policy_calls
        self._tasks: set[asyncio.Task] = set()

    def _completed(self, task):
        self._tasks.discard(task)
        if not task.cancelled():
            task.exception()  # Retrieve failures from calls cancelled after timeout.

    async def choose(self, decision: Decision, *, started: float | None = None) -> Selection:
        started = time.monotonic() if started is None else started
        if not isinstance(decision, Decision):
            raise TypeError("choose requires a Decision")
        selected, reason = baseline_action_id(decision.legal_actions), "baseline"
        if self.policy is not None:
            budget = self.max_decision_ms if decision.deadline_ms is None else min(
                decision.deadline_ms, self.max_decision_ms)
            # Leave room for the caller to apply the action.
            timeout = (budget - min(50, budget * 0.1)) / 1000 - (time.monotonic() - started)
            if timeout <= 0:
                reason = "deadline_fallback"
            elif len(self._tasks) >= self.max_policy_calls:
                reason = "busy_fallback"
            else:
                offered = decision.offered_ids

                async def call():
                    return await self.policy(copy.deepcopy(decision))

                task = asyncio.create_task(call())
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

        selection = Selection(selected, reason, round((time.monotonic() - started) * 1000, 2))
        # Never log snapshots, known cards, model prompts or action payloads.
        LOGGER.info(json.dumps({"event": "bot_decision", "requestId": decision.request_id,
                                "matchId": decision.match_id, "sequence": decision.sequence,
                                "playerId": decision.player_id, "actionId": selection.action_id,
                                "selection": reason, "elapsedMs": selection.elapsed_ms}))
        return selection
