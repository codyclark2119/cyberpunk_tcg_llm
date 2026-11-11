"""Local bot-vs-bot matches: the TypeScript engine drives, the policy layer chooses.

The external simulator bridge is retired (docs/simulator-bot-retirement.md), so
this is how bots play full games now: everything runs on this machine, against
the engine worker in ``scripts/engine-worker.ts`` and, for an ``mlx`` seat, a
local MLX worker process.

The engine is the only rules authority. This module never decides legality,
never enumerates actions and never reads hidden information into a policy. For
each decision point it asks the engine who acts (the authoritative state's
``timing.actingPlayer``) and for that player's public ``ModelInputV2``, builds a
``Decision`` from that public observation and the engine-enumerated legal
actions only, asks the seat's ``PolicyRunner`` for an offered ``actionId`` and
submits exactly that id back through the engine. The game ends when the engine
reports an outcome, or when a decision/turn cap stops it.

With baseline policies on both seats a match is a pure function of its setup
and seed: ``baseline_action_id`` breaks ties on the offered id, and the engine
is deterministic.

Each match produces a JSONL record (see ``docs/local-match-runner.md``): one
``match`` header, one ``decision`` row per choice and one ``result`` row. It
holds public labels, ids and hashes only, never game states, events or hidden
cards.
"""

from __future__ import annotations

import collections
import json
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from games.cyberpunk.engine_adapter import EngineProtocolError, EngineWorker
from games.cyberpunk.sim_bot import Decision, PolicyRunner, Selection
from harness.core.io import write_jsonl_atomic

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "local" / "matches"
SETUP_SCRIPT = "scripts/local-match-setup.ts"
# 2: header records each seat's decision budget; decision rows add error and
# workerEvent; result rows add errors and workerRestarts (docs/local-time-budget.md).
RECORD_SCHEMA_VERSION = 2
DEFAULT_MAX_DECISIONS = 2000
DEFAULT_MAX_TURNS = 120
# Seed namespace for deterministic per-match matchIds; never a secret.
MATCH_ID_NAMESPACE = uuid.UUID("6f1c3a52-5b8e-4c1d-9a63-2f6f0c2d7b11")


@dataclass(frozen=True)
class MatchSetup:
    """An engine content bundle plus a createGame initialization, passed through as-is.

    Any format and decks the engine's ``createGame`` accepts work here; the
    runner neither validates decks nor knows any format.
    """

    content: Mapping[str, Any]
    initialization: Mapping[str, Any]
    source: str = "custom"

    def __post_init__(self):
        if not isinstance(self.content, dict) or not isinstance(self.initialization, dict):
            raise ValueError("A match setup needs a content object and an initialization object.")
        players = self.initialization.get("players")
        if not isinstance(players, list) or len(players) < 2:
            raise ValueError("initialization.players must list at least two players.")

    @property
    def engine(self) -> Mapping[str, Any]:
        """The engine identity the content bundle pins; the worker refuses any other."""
        return (self.content.get("manifest") or {}).get("engine") or {}

    def for_seed(self, seed: str) -> "MatchSetup":
        """Same content and decks, with this seed and a matchId derived from it."""
        if not isinstance(seed, str) or not seed:
            raise ValueError("seed must be a nonempty string")
        initialization = {**self.initialization, "seed": seed,
                          "matchId": str(uuid.uuid5(MATCH_ID_NAMESPACE, seed))}
        return MatchSetup(self.content, initialization, self.source)


def load_default_setup(app_root: str | Path = REPO_ROOT, node: str = "node") -> MatchSetup:
    """The fixed Demo content and decks, read from the TypeScript fixtures, not copied here."""
    completed = subprocess.run([node, "--import", "tsx", SETUP_SCRIPT], cwd=Path(app_root).resolve(),
                               capture_output=True, text=True, encoding="utf-8", check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"{SETUP_SCRIPT} failed: {completed.stderr.strip()[-500:]}")
    value = json.loads(completed.stdout)
    return MatchSetup(value["content"], value["initialization"], "demo")


def load_setup_file(path: str | Path) -> MatchSetup:
    """Read a JSON object with ``content`` and ``initialization`` (a replay fixture also qualifies)."""
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict) or "content" not in value or "initialization" not in value:
        raise ValueError("A setup file must be a JSON object with content and initialization.")
    return MatchSetup(value["content"], value["initialization"], f"file:{Path(path).name}")


def _decision(match_id: str, index: int, actor: str, model_input: Mapping[str, Any]) -> Decision:
    """Only the actor's public observation and the engine's public action descriptors."""
    observation = model_input["observation"]
    return Decision(
        request_id=f"{match_id}-{index}", match_id=match_id, sequence=index, player_id=actor,
        legal_actions=[dict(action) for action in model_input["legalActions"]],
        snapshot=dict(observation),
        turn={key: observation.get(key) for key in ("turn", "step", "window", "activeSeat", "actingSeat")},
        pending=observation.get("choice"),
        metadata={"format": observation.get("format")})


# Public alias for drivers that step a match themselves (the local play UI).
build_decision = _decision


def match_header(setup: MatchSetup, policy_names: Sequence[str], *, max_decisions: int,
                 max_turns: int, budgets_ms: Sequence[int | None] | None = None) -> dict[str, Any]:
    """The record's ``match`` row, before ``initialStateHash`` is known.

    ``budgets_ms[seat]`` is that seat's per-decision policy budget, None for a
    seat with no timed policy (baseline or human). ``budgetMs`` is the largest.
    """
    content, initialization = setup.content, setup.initialization
    budgets = list(budgets_ms) if budgets_ms is not None else [None] * len(policy_names)
    if len(budgets) != len(policy_names):
        raise ValueError("Give one budget per seat.")
    timed = [b for b in budgets if b is not None]
    return {"kind": "match", "schemaVersion": RECORD_SCHEMA_VERSION,
            "matchId": initialization.get("matchId", "local-match"),
            "seed": initialization.get("seed"), "format": initialization.get("format"),
            "setupSource": setup.source, "players": list(initialization["players"]),
            "decks": initialization.get("decks"), "engine": dict(setup.engine),
            "contentManifestHash": content.get("manifestHash"),
            "seats": [{"seat": seat, "policy": name, "budgetMs": budget}
                      for seat, (name, budget) in enumerate(zip(policy_names, budgets))],
            "budgetMs": max(timed) if timed else None,
            "limits": {"maxDecisions": max_decisions, "maxTurns": max_turns}}


def seat_budgets(runners: Sequence[PolicyRunner]) -> list[int | None]:
    """Each runner's budget, or None when it has no policy to time."""
    return [runner.max_decision_ms if runner.policy is not None else None for runner in runners]


def decision_row(index: int, decision: Decision, seat: int, policy: str, selection: Selection,
                 state_hash: str) -> dict[str, Any]:
    """One ``decision`` row; ``selection.action_id`` must be one the decision offered."""
    chosen = next(a for a in decision.legal_actions if a["actionId"] == selection.action_id)
    return {"kind": "decision", "index": index, "turn": decision.turn.get("turn"),
            "step": decision.turn.get("step"), "seat": seat, "playerId": decision.player_id,
            "policy": policy, "offered": len(decision.legal_actions),
            "actionId": selection.action_id,
            "label": (chosen.get("descriptor") or {}).get("label"),
            "reason": selection.reason, "error": selection.error,
            "workerEvent": selection.worker_event, "elapsedMs": selection.elapsed_ms,
            "stateHash": state_hash}


def result_row(match_id: str, rows: Sequence[Mapping[str, Any]], status: str, detail: str | None,
               state: Mapping[str, Any] | None, state_hash: str | None) -> dict[str, Any]:
    """The closing ``result`` row for the rows so far (header plus decisions)."""
    decisions = [row for row in rows if row.get("kind") == "decision"]
    reasons = collections.Counter(row["reason"] for row in decisions)
    errors = collections.Counter(row["error"] for row in decisions if row.get("error"))
    restarts = sum(1 for row in decisions if row.get("workerEvent") == "worker_restarted")
    outcome = (state or {}).get("match", {}).get("outcome") if state else None
    seat_of = {pid: player["seat"] for pid, player in (state or {}).get("players", {}).items()}
    return {"kind": "result", "matchId": match_id, "status": status, "detail": detail,
            "winnerSeat": seat_of.get(outcome["winnerId"]) if outcome else None,
            "loserSeat": seat_of.get(outcome["loserId"]) if outcome else None,
            "reason": outcome["reason"] if outcome else None,
            "turns": state["timing"]["turn"] if state else None,
            "decisions": len(rows) - 1, "selections": dict(sorted(reasons.items())),
            "errors": dict(sorted(errors.items())), "workerRestarts": restarts,
            "finalStateHash": state_hash}


async def play_match(worker: EngineWorker, setup: MatchSetup, runners: Sequence[PolicyRunner], *,
                     policy_names: Sequence[str], max_decisions: int = DEFAULT_MAX_DECISIONS,
                     max_turns: int = DEFAULT_MAX_TURNS,
                     on_decision: Callable[[Decision], None] | None = None) -> list[dict[str, Any]]:
    """Play one match and return its record rows. ``runners[seat]`` chooses for engine seat ``seat``."""
    if len(runners) != len(policy_names):
        raise ValueError("Give one policy name per seat runner.")
    if max_decisions < 1 or max_turns < 0:
        raise ValueError("max_decisions must be positive and max_turns nonnegative.")
    content, initialization = setup.content, setup.initialization
    header = match_header(setup, policy_names, max_decisions=max_decisions, max_turns=max_turns,
                          budgets_ms=seat_budgets(runners))
    for runner in runners:
        runner.begin_match()
    match_id = header["matchId"]
    rows: list[dict[str, Any]] = [header]
    status, detail, state, state_hash = "engine_error", None, None, None
    try:
        created = worker.create_game(content=content, initialization=initialization)
        state, state_hash = created["state"], created["stateHash"]
        header["initialStateHash"] = state_hash
        while True:
            if state["match"].get("outcome"):
                status = "finished"
                break
            index = len(rows) - 1
            if index >= max_decisions:
                status = "decision_cap"
                break
            if state["timing"]["turn"] > max_turns:
                status = "turn_cap"
                break
            actor = state["timing"]["actingPlayer"]
            seat = state["players"][actor]["seat"]
            if not 0 <= seat < len(runners):
                raise ValueError(f"no policy configured for engine seat {seat}")
            model_input = worker.model_input(content=content, state=state, actor_id=actor)
            if not model_input["legalActions"]:
                status, detail = "no_legal_actions", "engine offered the acting player no action"
                break
            decision = _decision(match_id, index, actor, model_input)
            if on_decision is not None:
                on_decision(decision)
            selection = await runners[seat].choose(decision)
            if selection.action_id not in decision.offered_ids:
                raise AssertionError("policy runner returned an actionId the engine did not offer")
            transition = worker.apply_action(content=content, state=state, actor_id=actor,
                                             action_id=selection.action_id)
            state, state_hash = transition["state"], transition["stateHash"]
            rows.append(decision_row(index, decision, seat, policy_names[seat], selection, state_hash))
    except EngineProtocolError as exc:
        status, detail = "engine_error", str(exc)[:500]
    rows.append(result_row(match_id, rows, status, detail, state, state_hash))
    return rows


def write_match_record(path: str | Path, rows: list[dict[str, Any]], *, force: bool = False) -> Path:
    """Write one match record; refuse to replace an existing one unless forced."""
    target = Path(path)
    if not target.is_absolute():
        target = REPO_ROOT / target
    if target.exists() and not force:
        raise FileExistsError(f"{target} already exists; choose another output or force (--force)")
    write_jsonl_atomic(target, rows)
    return target


def summarize(records: Sequence[Sequence[Mapping[str, Any]]]) -> dict[str, Any]:
    """Aggregate result rows: statuses, wins per seat, reasons and fallbacks."""
    results = [rows[-1] for rows in records]
    decisions = [row for rows in records for row in rows if row.get("kind") == "decision"]
    times = sorted(row["elapsedMs"] for row in decisions)
    selections = collections.Counter(row["reason"] for row in decisions)
    errors = collections.Counter(row["error"] for row in decisions if row.get("error"))
    return {"matches": len(results),
            "statuses": dict(sorted(collections.Counter(r["status"] for r in results).items())),
            "winsBySeat": dict(sorted(collections.Counter(
                str(r["winnerSeat"]) for r in results if r["winnerSeat"] is not None).items())),
            "endReasons": dict(sorted(collections.Counter(
                r["reason"] for r in results if r["reason"]).items())),
            "decisions": len(decisions), "selections": dict(sorted(selections.items())),
            "fallbacks": sum(n for reason, n in selections.items() if reason.endswith("_fallback")),
            "errors": dict(sorted(errors.items())),
            "workerRestarts": sum(r.get("workerRestarts", 0) for r in results),
            "maxElapsedMs": times[-1] if times else None}
