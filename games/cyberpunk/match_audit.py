"""Replay local match records on the engine worker and report every disagreement.

A match record (``games/cyberpunk/local_match.py``) is a claim: these seeds and
decks, on this engine build, offered these actions, the seats chose these ids
for these reasons, and the engine answered with these state hashes. This module
checks the claim against the only rules authority, the running engine worker.
It decides nothing itself. Every expected value comes from the worker
(``createGame``, ``modelInput``, ``applyAction``) or from the very functions the
runner used to write the row (``decision_row``, ``result_row``,
``baseline_action_id``, ``parse_choice``), so a record audits clean exactly when
writing it again from the engine's answers gives the same rows.

Per record:

* **Engine identity.** The header's ``engine`` (version, artifactHash) must be
  the running worker's. A record from another engine build is reported
  ``stale`` and is not replayed: replaying it would test the new engine, not the
  record.
* **Setup.** The content manifest hash, format, players and decks must be the
  audit setup's (the fixed Demo setup unless one is given), and the matchId the
  one the runner derives from the seed.
* **Decisions.** From the engine's initial state (``initialStateHash``), each
  recorded ``actionId`` must be among the actions the engine offers the acting
  player; the row's engine-derived fields (turn, step, seat, player, policy,
  offered count, chosen index, label, baseline pick and agreement) must equal
  what ``decision_row`` writes from that offer; and the recorded ``stateHash``
  must equal the hash of the engine's transition. Replay continues from the
  engine's state, not the recorded hash, so one wrong hash is reported once.
  A non-offered id stops the replay.
* **Selections.** A ``baseline`` row must be a baseline seat playing the
  baseline's pick; a ``human`` row a human seat; ``policy`` and ``*_fallback``
  rows a policy seat. A fallback carries an error code and plays the baseline's
  pick; nothing else carries an error code. A ``policy`` row on a seat whose
  header names a model must be backed by its raw output: ``parse_choice`` of
  ``rawOutput`` must give the played index. That catches a fallback relabelled
  as a model choice, not a forged raw output.
* **Result.** ``finished`` exactly when the engine reports an outcome, and the
  result row equal to ``result_row`` over the recorded rows and the replayed
  final state (winner, reason, turns, counts, agreement, ``finalStateHash``).

Counts (per seat and pooled per policy name) cover replayed decisions only:
model choices, every selection reason and error code, and agreement with the
baseline's pick on the engine's offered list.
"""

from __future__ import annotations

import collections
import json
import subprocess
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from games.cyberpunk.engine_adapter import EngineProtocolError, EngineWorker
from games.cyberpunk.local_match import (DEFAULT_OUTPUT_DIR, REPO_ROOT, MatchSetup, build_decision,
                                         decision_row, result_row)
from games.cyberpunk.policy_bot import Selection, baseline_action_id
from games.cyberpunk.policy_prompt import parse_choice
from harness.core.io import read_jsonl

IDENTITY_SCRIPT = "scripts/print-engine-identity.ts"
SUPPORTED_SCHEMAS = (2, 3)
# Seat policies that never call a model; every other policy name is a policy seat.
BASELINE, HUMAN, MODEL_CHOICE = "baseline", "human", "policy"
# Decision-row fields ``decision_row`` derives from the engine's offer (v3 adds the last four).
ENGINE_FIELDS_V2 = ("index", "turn", "step", "seat", "playerId", "policy", "offered", "label")
ENGINE_FIELDS_V3 = ENGINE_FIELDS_V2 + ("chosenIndex", "baselineActionId", "baselineIndex", "agreesWithBaseline")
VERDICTS = ("clean", "stale", "mismatch", "unreadable")


def running_engine(app_root: str | Path = REPO_ROOT, node: str = "node") -> dict[str, str]:
    """The engine identity the worker computes for itself (``scripts/engine-identity.ts``)."""
    done = subprocess.run([node, "--import", "tsx", IDENTITY_SCRIPT], cwd=Path(app_root).resolve(),
                          capture_output=True, text=True, encoding="utf-8", check=False)
    if done.returncode != 0:
        raise RuntimeError(f"{IDENTITY_SCRIPT} failed: {done.stderr.strip()[-500:]}")
    value = json.loads(done.stdout)
    return {"version": value["version"], "artifactHash": value["artifactHash"]}


def record_paths(targets: Iterable[str | Path]) -> list[Path]:
    """Each file as given, and every ``*.jsonl`` directly inside each directory, sorted."""
    out: list[Path] = []
    for target in targets:
        path = Path(target)
        if not path.is_absolute():
            path = REPO_ROOT / path
        out.extend(sorted(path.glob("*.jsonl")) if path.is_dir() else [path])
    return out


def _identity(engine: Any) -> tuple[Any, Any]:
    engine = engine if isinstance(engine, Mapping) else {}
    return engine.get("version"), engine.get("artifactHash")


class _Audit:
    """The audit of one record's rows; ``problems`` and ``seats`` fill in as it runs."""

    def __init__(self, name: str, rows: Sequence[Mapping[str, Any]]):
        self.name, self.rows = name, rows
        self.problems: list[dict[str, Any]] = []
        self.seats: dict[str, dict[str, Any]] = {}
        self.replayed = 0
        self.stale = False

    def problem(self, code: str, detail: str, index: int | None = None) -> None:
        self.problems.append({"code": code, "index": index, "detail": detail})

    def count(self, row: Mapping[str, Any], policy: str, agrees: bool) -> None:
        seat = self.seats.setdefault(str(row["seat"]), {
            "policy": policy, "decisions": 0, "modelChoices": 0, "fallbacks": 0, "agree": 0,
            "reasons": collections.Counter(), "errors": collections.Counter()})
        seat["decisions"] += 1
        seat["modelChoices"] += row.get("reason") == MODEL_CHOICE
        seat["fallbacks"] += str(row.get("reason")).endswith("_fallback")
        seat["agree"] += agrees
        seat["reasons"][str(row.get("reason"))] += 1
        if row.get("error"):
            seat["errors"][str(row["error"])] += 1

    def report(self) -> dict[str, Any]:
        header = self.rows[0] if self.rows and isinstance(self.rows[0], Mapping) else {}
        result = self.rows[-1] if len(self.rows) > 1 and isinstance(self.rows[-1], Mapping) else {}
        verdict = "stale" if self.stale else "mismatch" if self.problems else "clean"
        if any(p["code"] == "unreadable" for p in self.problems):
            verdict = "unreadable"
        seats = {}
        for key, seat in sorted(self.seats.items()):
            seats[key] = {**seat, "reasons": dict(sorted(seat["reasons"].items())),
                          "errors": dict(sorted(seat["errors"].items())),
                          "agreement": round(seat["agree"] / seat["decisions"], 4)}
        return {"name": self.name, "verdict": verdict, "matchId": header.get("matchId"),
                "seed": header.get("seed"), "schemaVersion": header.get("schemaVersion"),
                "engine": dict(header["engine"]) if isinstance(header.get("engine"), Mapping) else None,
                "status": result.get("status") if result.get("kind") == "result" else None,
                "decisions": sum(1 for r in self.rows if isinstance(r, Mapping) and r.get("kind") == "decision"),
                "replayed": self.replayed, "problems": self.problems, "seats": seats}


def _check_header(audit: _Audit, header: Mapping[str, Any], setup: MatchSetup,
                  running: Mapping[str, str]) -> MatchSetup | None:
    """The setup to replay with, or None when the record cannot be replayed on it."""
    if header.get("schemaVersion") not in SUPPORTED_SCHEMAS:
        audit.problem("unsupported_schema", f"schemaVersion {header.get('schemaVersion')!r}; "
                                            f"this auditor reads {list(SUPPORTED_SCHEMAS)}")
        return None
    recorded, expected = _identity(header.get("engine")), _identity(running)
    if recorded != expected:
        audit.stale = True
        audit.problem("stale_engine", f"recorded on engine {recorded[0]}/{str(recorded[1])[:12]}, the running "
                                      f"worker is {expected[0]}/{str(expected[1])[:12]}; not replayed")
        return None
    seed = header.get("seed")
    if not isinstance(seed, str) or not seed:
        audit.problem("setup_mismatch", "the header has no seed")
        return None
    replay = setup.for_seed(seed)
    init = replay.initialization
    differs = [name for name, ok in (
        ("contentManifestHash", header.get("contentManifestHash") == replay.content.get("manifestHash")),
        ("format", header.get("format") == init.get("format")),
        ("players", header.get("players") == init.get("players")),
        ("decks", header.get("decks") == init.get("decks")),
        ("matchId", header.get("matchId") == init.get("matchId")),
    ) if not ok]
    seats = header.get("seats")
    if not isinstance(seats, list) or [s.get("seat") if isinstance(s, Mapping) else None
                                       for s in seats] != list(range(len(init["players"]))):
        differs.append("seats")
    if differs:
        audit.problem("setup_mismatch", f"{', '.join(differs)} differ from the audit setup "
                                        f"({setup.source}); give the record's own setup file")
        return None
    return replay


def _check_selection(audit: _Audit, row: Mapping[str, Any], seat: Mapping[str, Any], offered: list[str],
                     baseline: str, index: int) -> None:
    reason, error, policy = row.get("reason"), row.get("error"), seat.get("policy")
    fallback = isinstance(reason, str) and reason.endswith("_fallback")
    if reason == BASELINE:
        if policy != BASELINE:
            audit.problem("reason_not_for_policy", f"reason baseline on a {policy!r} seat", index)
        elif row["actionId"] != baseline:
            audit.problem("baseline_not_baseline_pick", "a baseline seat played another action", index)
    elif reason == HUMAN:
        if policy != HUMAN:
            audit.problem("reason_not_for_policy", f"reason human on a {policy!r} seat", index)
    elif reason == MODEL_CHOICE or fallback:
        if policy in (BASELINE, HUMAN):
            audit.problem("reason_not_for_policy", f"reason {reason} on a {policy!r} seat", index)
        if fallback and row["actionId"] != baseline:
            audit.problem("fallback_not_baseline_pick", f"{reason} played another action than the "
                                                        "baseline's pick", index)
    else:
        audit.problem("unknown_reason", f"reason {reason!r}", index)
    if fallback and not error:
        audit.problem("fallback_without_error", f"{reason} has no error code", index)
    if not fallback and error:
        audit.problem("error_without_fallback", f"error {error!r} on a {reason!r} row", index)
    if reason == MODEL_CHOICE and seat.get("modelPath"):
        # A model seat's choice is the index its own answer names; nothing else is a model choice.
        try:
            parsed = parse_choice(row.get("rawOutput"), len(offered))
        except (ValueError, TypeError, RecursionError):
            parsed = None
        if parsed is None or offered[parsed] != row["actionId"]:
            audit.problem("model_choice_unsupported",
                          "recorded as a model choice, but the raw output "
                          + ("is missing" if row.get("rawOutput") is None else "does not name the played action"),
                          index)


def audit_rows(worker: EngineWorker, setup: MatchSetup, rows: Sequence[Mapping[str, Any]],
               running: Mapping[str, str], name: str = "record") -> dict[str, Any]:
    """Audit one record's rows on ``worker``; ``setup`` is the content and decks it should use."""
    audit = _Audit(name, rows)
    if not rows or not isinstance(rows[0], Mapping) or rows[0].get("kind") != "match":
        audit.problem("unreadable", "the first row is not a match header")
        return audit.report()
    header = rows[0]
    has_result = len(rows) > 1 and isinstance(rows[-1], Mapping) and rows[-1].get("kind") == "result"
    body = rows[1:-1] if has_result else rows[1:]
    if not has_result:
        audit.problem("missing_result", "the record has no result row")
    decisions = [row for row in body if isinstance(row, Mapping) and row.get("kind") == "decision"]
    if len(decisions) != len(body):
        audit.problem("unexpected_row", "rows between the header and the result must all be decisions")
    replay = _check_header(audit, header, setup, running)
    if replay is None:
        return audit.report()
    content, seats = replay.content, header["seats"]
    fields = ENGINE_FIELDS_V3 if header["schemaVersion"] >= 3 else ENGINE_FIELDS_V2
    state = state_hash = None
    complete = False
    try:
        created = worker.create_game(content=content, initialization=replay.initialization)
        state, state_hash = created["state"], created["stateHash"]
        if header.get("initialStateHash") != state_hash:
            audit.problem("initial_state_hash", "initialStateHash differs from the engine's created game")
        for index, row in enumerate(decisions):
            if state["match"].get("outcome"):
                audit.problem("decision_after_outcome", "the engine had already ended the match", index)
                break
            actor = state["timing"]["actingPlayer"]
            seat = state["players"][actor]["seat"]
            model_input = worker.model_input(content=content, state=state, actor_id=actor)
            decision = build_decision(header["matchId"], index, actor, model_input)
            offered = [action["actionId"] for action in decision.legal_actions]  # engine order
            if row.get("actionId") not in offered:
                audit.problem("action_not_offered", f"actionId {str(row.get('actionId'))[:16]}... is not among "
                                                    f"the {len(offered)} actions the engine offers", index)
                break
            transition = worker.apply_action(content=content, state=state, actor_id=actor,
                                             action_id=row["actionId"])
            state, state_hash = transition["state"], transition["stateHash"]
            details = {key: row.get(key) for key in ("rawOutput", "inputTokens", "outputTokens")}
            selection = Selection(row["actionId"], row.get("reason"), row.get("elapsedMs"), row.get("error"),
                                  row.get("workerEvent"), details)
            expected = decision_row(index, decision, seat, seats[seat].get("policy"), selection, state_hash)
            wrong = [key for key in fields if row.get(key, KeyError) != expected[key]]
            if wrong:
                audit.problem("row_mismatch", "fields differ from the engine's offer: " + ", ".join(
                    f"{key} {row.get(key)!r} != {expected[key]!r}" for key in wrong), index)
            if row.get("stateHash") != state_hash:
                audit.problem("state_hash_mismatch", "stateHash differs from the engine's transition", index)
            baseline = baseline_action_id(decision.legal_actions)
            _check_selection(audit, row, seats[seat], offered, baseline, index)
            audit.count(row, seats[seat].get("policy"), row["actionId"] == baseline)
            audit.replayed += 1
        else:
            complete = True
    except EngineProtocolError as exc:
        audit.problem("replay_engine_error", str(exc)[:300], audit.replayed)
    if complete and has_result:
        result = rows[-1]
        outcome = bool(state["match"].get("outcome"))
        if (result.get("status") == "finished") != outcome:
            audit.problem("status_mismatch", f"status {result.get('status')!r}, but the engine "
                                             + ("reports" if outcome else "does not report") + " an outcome")
        expected = result_row(header["matchId"], [header, *decisions], result.get("status"),
                              result.get("detail"), state, state_hash)
        wrong = [key for key in sorted(set(result) | set(expected))
                 if key in result and result[key] != expected.get(key, KeyError)]
        if wrong:
            audit.problem("result_mismatch", "result fields differ from the replay: " + ", ".join(wrong))
    return audit.report()


def audit_record(worker: EngineWorker, setup: MatchSetup, path: str | Path,
                 running: Mapping[str, str], name: str | None = None) -> dict[str, Any]:
    """Read one record file and audit it; an unreadable file is a verdict, not an exception."""
    path = Path(path)
    try:
        rows = read_jsonl(path, missing_ok=False)
    except (OSError, ValueError) as exc:
        audit = _Audit(name or path.name, [])
        audit.problem("unreadable", str(exc)[:300])
        return audit.report()
    return audit_rows(worker, setup, rows, running, name or path.name)


def totals(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Verdicts, problem codes, and per policy name the counts of every replayed decision."""
    policies: dict[str, dict[str, Any]] = {}
    for record in records:
        for seat in record["seats"].values():
            entry = policies.setdefault(seat["policy"], {"decisions": 0, "modelChoices": 0, "fallbacks": 0,
                                                         "agree": 0, "reasons": collections.Counter(),
                                                         "errors": collections.Counter()})
            for key in ("decisions", "modelChoices", "fallbacks", "agree"):
                entry[key] += seat[key]
            entry["reasons"].update(seat["reasons"])
            entry["errors"].update(seat["errors"])
    for entry in policies.values():
        entry["reasons"], entry["errors"] = dict(sorted(entry["reasons"].items())), dict(sorted(entry["errors"].items()))
        entry["agreement"] = round(entry["agree"] / entry["decisions"], 4) if entry["decisions"] else None
    verdicts = collections.Counter(r["verdict"] for r in records)
    return {"records": len(records), "verdicts": {v: verdicts.get(v, 0) for v in VERDICTS},
            "problems": dict(sorted(collections.Counter(p["code"] for r in records for p in r["problems"]).items())),
            "decisions": sum(r["decisions"] for r in records), "replayed": sum(r["replayed"] for r in records),
            "policies": dict(sorted(policies.items())),
            "ok": bool(records) and verdicts.get("clean", 0) == len(records)}


def audit_paths(paths: Sequence[Path], setup: MatchSetup, running: Mapping[str, str], *,
                app_root: str | Path = REPO_ROOT, node: str = "node",
                names: Sequence[str] | None = None) -> dict[str, Any]:
    """Audit every path with one engine worker; ``ok`` only when every record is clean."""
    if _identity(setup.engine) != _identity(running):
        raise ValueError(f"the audit setup ({setup.source}) pins engine {setup.engine.get('version')}, "
                         f"not the running {running.get('version')}")
    with EngineWorker(app_root, node=node) as worker:
        records = [audit_record(worker, setup, path, running, names[i] if names else None)
                   for i, path in enumerate(paths)]
    return {"engine": dict(running), "setup": setup.source, "records": records, "totals": totals(records)}


def format_report(report: Mapping[str, Any]) -> list[str]:
    """Plain-text lines: one per record (and per problem), then the totals."""
    lines = []
    for record in report["records"]:
        seats = "; ".join(
            f"seat {key} {s['policy']}: {s['decisions']} decisions, {s['modelChoices']} model, "
            f"{s['fallbacks']} fallback{' ' + json.dumps(s['errors']) if s['errors'] else ''}, "
            f"agree {s['agree']}/{s['decisions']}" for key, s in record["seats"].items())
        lines.append(f"{record['verdict'].upper():9} {record['name']}: {record['replayed']}/{record['decisions']} "
                     f"decisions replayed, status {record['status']}" + (f"; {seats}" if seats else ""))
        lines.extend(f"          - {p['code']}" + (f" at decision {p['index']}" if p["index"] is not None else "")
                     + f": {p['detail']}" for p in record["problems"])
    t = report["totals"]
    lines.append(f"engine {report['engine']['version']}/{report['engine']['artifactHash'][:12]}, setup {report['setup']}")
    for policy, entry in t["policies"].items():
        lines.append(f"policy {policy}: {entry['decisions']} decisions, {entry['modelChoices']} model choices, "
                     f"{entry['fallbacks']} fallbacks, reasons {json.dumps(entry['reasons'])}, "
                     f"errors {json.dumps(entry['errors'])}, baseline agreement {entry['agree']}/{entry['decisions']}")
    lines.append(f"audited {t['records']} records: " + ", ".join(f"{n} {v}" for v, n in t["verdicts"].items())
                 + f"; {t['replayed']}/{t['decisions']} decisions replayed")
    return lines


__all__ = ["DEFAULT_OUTPUT_DIR", "audit_paths", "audit_record", "audit_rows", "format_report", "record_paths",
           "running_engine", "totals"]
