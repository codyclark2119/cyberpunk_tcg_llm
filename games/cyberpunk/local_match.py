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

Each match produces a JSONL record (see ``docs/local-match-runner.md`` and
``docs/local-match-records-v3.md``): one ``match`` header, one ``decision`` row
per choice and one ``result`` row. It holds public labels, ids, hashes and the
model's own raw answer, never game states, events or hidden cards.

Optionally (``training=``) each model decision is also logged as an engine-built
TrainingPosition plus one TrainingAttempt (harness/core/training_records.py).
Those records do hold the full engine state; they are training data, not part
of the match record, and nothing in them ever reaches a policy.
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
from games.cyberpunk.policy_bot import Decision, PolicyRunner, Selection, baseline_action_id
from harness.core.io import write_jsonl_atomic
from harness.core.training_records import Decoding, ModelMetadata, TrainingLog, build_position

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "local" / "matches"
DEFAULT_TRAINING_DIR = REPO_ROOT / "local" / "training"
SETUP_SCRIPT = "scripts/local-match-setup.ts"
# 2: header records each seat's decision budget; decision rows add error and
# workerEvent; result rows add errors and workerRestarts (docs/local-time-budget.md).
# 3: header seats add the model path/revision, adapter and prompt version; decision
# rows add chosenIndex, the baseline's pick and agreement, raw output and token
# counts; result rows add baselineAgreement (docs/local-match-records-v3.md).
RECORD_SCHEMA_VERSION = 3
TRAINING_GENERATOR = "local_match"
# Fields a seat's policy reports through ``describe()``; None for baseline and human seats.
SEAT_MODEL_FIELDS = ("modelPath", "modelRevision", "adapterPath", "adapterRevision", "promptVersion")
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


def git_revision(root: str | Path = REPO_ROOT) -> str | None:
    """The checked-out commit, or None outside a git checkout (never fetched)."""
    try:
        done = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True,
                              timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    value = done.stdout.strip()
    return value if done.returncode == 0 and value else None


def match_header(setup: MatchSetup, policy_names: Sequence[str], *, max_decisions: int,
                 max_turns: int, budgets_ms: Sequence[int | None] | None = None,
                 seat_models: Sequence[Mapping[str, Any] | None] | None = None) -> dict[str, Any]:
    """The record's ``match`` row, before ``initialStateHash`` is known.

    ``budgets_ms[seat]`` is that seat's per-decision policy budget, None for a
    seat with no timed policy (baseline or human). ``budgetMs`` is the largest.
    ``seat_models[seat]`` is what that seat's policy reports about its model
    (``SEAT_MODEL_FIELDS``); every field is None for a seat without one.
    """
    content, initialization = setup.content, setup.initialization
    budgets = list(budgets_ms) if budgets_ms is not None else [None] * len(policy_names)
    models = list(seat_models) if seat_models is not None else [None] * len(policy_names)
    if len(budgets) != len(policy_names) or len(models) != len(policy_names):
        raise ValueError("Give one budget and one model description per seat.")
    timed = [b for b in budgets if b is not None]
    return {"kind": "match", "schemaVersion": RECORD_SCHEMA_VERSION,
            "matchId": initialization.get("matchId", "local-match"),
            "seed": initialization.get("seed"), "format": initialization.get("format"),
            "setupSource": setup.source, "players": list(initialization["players"]),
            "decks": initialization.get("decks"), "engine": dict(setup.engine),
            "contentManifestHash": content.get("manifestHash"),
            "seats": [{"seat": seat, "policy": name, "budgetMs": budget,
                       **{key: (model or {}).get(key) for key in SEAT_MODEL_FIELDS}}
                      for seat, (name, budget, model) in enumerate(zip(policy_names, budgets, models))],
            "budgetMs": max(timed) if timed else None,
            "limits": {"maxDecisions": max_decisions, "maxTurns": max_turns}}


def seat_budgets(runners: Sequence[PolicyRunner]) -> list[int | None]:
    """Each runner's budget, or None when it has no policy to time."""
    return [runner.max_decision_ms if runner.policy is not None else None for runner in runners]


def seat_models(runners: Sequence[PolicyRunner]) -> list[dict[str, Any] | None]:
    """What each runner's policy says about its model (``describe()``), else None."""
    out = []
    for runner in runners:
        describe = getattr(runner.policy, "describe", None)
        info = describe() if callable(describe) else None
        out.append(dict(info) if isinstance(info, Mapping) else None)
    return out


def decision_row(index: int, decision: Decision, seat: int, policy: str, selection: Selection,
                 state_hash: str) -> dict[str, Any]:
    """One ``decision`` row; ``selection.action_id`` must be one the decision offered.

    The baseline's pick is computed on the same offered list for comparison
    only; it never changes what was played.
    """
    ids = [a["actionId"] for a in decision.legal_actions]
    chosen_index = ids.index(selection.action_id)
    chosen = decision.legal_actions[chosen_index]
    baseline = baseline_action_id(decision.legal_actions)
    details = selection.details or {}
    return {"kind": "decision", "index": index, "turn": decision.turn.get("turn"),
            "step": decision.turn.get("step"), "seat": seat, "playerId": decision.player_id,
            "policy": policy, "offered": len(decision.legal_actions),
            "actionId": selection.action_id, "chosenIndex": chosen_index,
            "label": (chosen.get("descriptor") or {}).get("label"),
            "baselineActionId": baseline, "baselineIndex": ids.index(baseline),
            "agreesWithBaseline": baseline == selection.action_id,
            "reason": selection.reason, "error": selection.error,
            "workerEvent": selection.worker_event, "elapsedMs": selection.elapsed_ms,
            "rawOutput": details.get("rawOutput"), "inputTokens": details.get("inputTokens"),
            "outputTokens": details.get("outputTokens"),
            "stateHash": state_hash}


def baseline_agreement(rows: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]] | None:
    """Per seat: decisions, how many matched the baseline's pick, and the rate.

    None for a record without the v3 fields (schemaVersion 2 and earlier).
    """
    decisions = [row for row in rows if row.get("kind") == "decision"]
    if any("agreesWithBaseline" not in row for row in decisions):
        return None
    out: dict[str, dict[str, Any]] = {}
    for row in decisions:
        entry = out.setdefault(str(row["seat"]), {"policy": row.get("policy"), "decisions": 0, "agree": 0})
        entry["decisions"] += 1
        entry["agree"] += 1 if row["agreesWithBaseline"] else 0
    for entry in out.values():
        entry["rate"] = round(entry["agree"] / entry["decisions"], 4)
    return dict(sorted(out.items()))


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
            "baselineAgreement": baseline_agreement(rows), "finalStateHash": state_hash}


class TrainingRecorder:
    """Logs each model decision of a match as a TrainingPosition plus one TrainingAttempt.

    Positions are built from the engine worker's own ``observe``,
    ``listLegalActions`` and ``hash`` answers for the state the model saw
    (``build_position``); nothing is computed in Python. A decision whose policy
    produced no raw output (timeout, busy, prompt too large, a baseline or
    human seat) logs nothing: there is no attempt to record. Writes go through
    ``log`` (a ``TrainingLog``), which writes nothing if the run raises.
    """

    def __init__(self, log: TrainingLog, *, revision: str | None, run_id: str | None = None):
        self.log = log
        self.revision = revision or "unknown"
        self.run_id = run_id or uuid.uuid4().hex[:12]
        self.attempts = 0

    @staticmethod
    def check_seat(info: Mapping[str, Any] | None) -> None:
        """A seat that will be logged must name its model by revision, never by path alone."""
        if not info or not info.get("modelRevision"):
            raise ValueError("Training records need the model's revision; none was found in the local "
                             "weights' metadata (see docs/local-match-records-v3.md).")
        if info.get("adapterPath") and not info.get("adapterRevision"):
            raise ValueError("Training records need the adapter's revision.")

    def record(self, worker: EngineWorker, setup: MatchSetup, state: Mapping[str, Any],
               decision: Decision, seat_info: Mapping[str, Any], selection: Selection,
               state_hash_after: str) -> dict[str, Any] | None:
        details = selection.details or {}
        raw = details.get("rawOutput")
        if not isinstance(raw, str):
            return None
        content, actor = setup.content, decision.player_id
        hashes = worker.hashes(content=content, state=state, actor_id=actor)
        position = build_position(
            state=state, content=content, actor_id=actor,
            observation=worker.observe(content=content, state=state, actor_id=actor),
            legal_actions=worker.list_legal_actions(content=content, state=state, actor_id=actor),
            hashes=hashes,
            position_id=(f"{TRAINING_GENERATOR}/{self.revision[:12]}/{state['rng']['seed']}/"
                         f"{decision.sequence}/{hashes['positionHash'][:16]}"),
            provenance={"generator": TRAINING_GENERATOR, "revision": self.revision,
                        "seed": state["rng"]["seed"]})
        index = details.get("parsedIndex")
        offered = [a["actionId"] for a in decision.legal_actions]
        parsed = offered[index] if type(index) is int and 0 <= index < len(offered) else None
        if parsed is None:
            ok, codes, resulting = False, ["INVALID_MODEL_OUTPUT"], None
        elif parsed == selection.action_id:
            ok, codes, resulting = True, [], state_hash_after
        else:
            # Parsed but not played (cannot happen through PolicyRunner today); ask the
            # engine what it would have produced, without touching the match.
            ok, codes = True, []
            resulting = worker.apply_action(content=content, state=state, actor_id=actor,
                                            action_id=parsed)["stateHash"]
        decoding = seat_info.get("decoding") or {}
        inference_ms = details.get("inferenceMs")
        self.attempts += 1
        return self.log.log_attempt(
            position=position, attempt_id=f"{decision.request_id}/{self.run_id}",
            raw_model_output=raw, parsed_action_id=parsed, validation_ok=ok, validation_codes=codes,
            resulting_state_hash=resulting,
            model=ModelMetadata(model_revision=seat_info["modelRevision"],
                                tokenizer_revision=seat_info["modelRevision"],
                                adapter_revision=seat_info.get("adapterRevision") or "none",
                                prompt_fingerprint=seat_info["promptFingerprint"]),
            decoding=Decoding(temperature=decoding.get("temperature", 0.0), top_p=decoding.get("topP", 1.0),
                              max_tokens=decoding.get("maxTokens", 16), seed=decoding.get("seed")),
            elapsed_ms=inference_ms if isinstance(inference_ms, (int, float)) else selection.elapsed_ms,
            input_tokens=details.get("inputTokens") or 0, output_tokens=details.get("outputTokens") or 0)


async def play_match(worker: EngineWorker, setup: MatchSetup, runners: Sequence[PolicyRunner], *,
                     policy_names: Sequence[str], max_decisions: int = DEFAULT_MAX_DECISIONS,
                     max_turns: int = DEFAULT_MAX_TURNS,
                     on_decision: Callable[[Decision], None] | None = None,
                     training: TrainingRecorder | None = None) -> list[dict[str, Any]]:
    """Play one match and return its record rows. ``runners[seat]`` chooses for engine seat ``seat``.

    With ``training``, every decision of a seat whose policy describes a model
    is also logged as training records (``TrainingRecorder``).
    """
    if len(runners) != len(policy_names):
        raise ValueError("Give one policy name per seat runner.")
    if max_decisions < 1 or max_turns < 0:
        raise ValueError("max_decisions must be positive and max_turns nonnegative.")
    content, initialization = setup.content, setup.initialization
    models = seat_models(runners)
    if training is not None:
        for info in models:
            if info is not None:
                TrainingRecorder.check_seat(info)
    header = match_header(setup, policy_names, max_decisions=max_decisions, max_turns=max_turns,
                          budgets_ms=seat_budgets(runners), seat_models=models)
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
            if training is not None and models[seat] is not None:
                training.record(worker, setup, state, decision, models[seat], selection,
                                transition["stateHash"])
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
            "baselineAgreement": _pooled_agreement(records),
            "maxElapsedMs": times[-1] if times else None}


def _pooled_agreement(records: Sequence[Sequence[Mapping[str, Any]]]) -> dict[str, dict[str, Any]] | None:
    """Per policy name, over every v3 record: decisions, agreements with the baseline and the rate."""
    out: dict[str, dict[str, Any]] = {}
    for rows in records:
        for row in rows:
            if row.get("kind") != "decision" or "agreesWithBaseline" not in row:
                continue
            entry = out.setdefault(row["policy"], {"decisions": 0, "agree": 0})
            entry["decisions"] += 1
            entry["agree"] += 1 if row["agreesWithBaseline"] else 0
    for entry in out.values():
        entry["rate"] = round(entry["agree"] / entry["decisions"], 4)
    return dict(sorted(out.items())) or None
