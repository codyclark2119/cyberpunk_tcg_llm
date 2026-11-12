"""Strength-eval summaries computed from local match records, shared by the CLI and the play UI.

Why: a model's playing strength against the deterministic baseline is a count of
wins, losses and draws over many matches, and the number is only worth reading
with its uncertainty. This module turns match records (schemaVersion 2 or 3,
docs/local-match-records-v3.md) into per-configuration numbers without playing
anything, so ``scripts/eval_local_strength.py`` (which writes the records), the
play UI's "Strength" tab and the tests all compute the same summary, and an
existing run can be re-summarised at any time.

A record counts for the one seat whose policy is not ``baseline`` (the subject);
the other seat must be the baseline. Records with two baseline seats or two
non-baseline seats are listed as skipped. The subject's configuration is read
from the record header itself (policy, model path and revision, adapter, prompt
version and budget), never from a file name.

Outcomes are from the subject's side: a win or a loss when the engine named a
winner, a draw when the match stopped without one (an engine outcome with no
winner, or the turn or decision cap), and "no result" for anything else
(engine_error, no_legal_actions, abandoned), which is left out of the win rate.
``winRate`` is wins / (wins + losses + draws) with a 95% Wilson score interval.

Agreement, fallbacks, latency and tokens cover the subject seat's decisions
only. A record without the v3 decision fields contributes nothing to agreement
or tokens, and a configuration with no v3 record reports them as None ("n/a"),
never as zero.
"""

from __future__ import annotations

import collections
import json
import math
import os
import re
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from harness.core.io import read_jsonl

SUMMARY_SCHEMA_VERSION = 1
BASELINE = "baseline"
# z for a two-sided 95% interval.
Z95 = 1.959963984540054
DRAW_STATUSES = ("finished", "turn_cap", "decision_cap")
CONFIG_FIELDS = ("policy", "modelPath", "modelRevision", "adapterPath", "adapterRevision", "promptVersion",
                 "budgetMs")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
RECORD_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.jsonl$")
PLAN_FILE = "plan.json"
TIMINGS_FILE = "timings.jsonl"
SUMMARY_FILE = "summary.json"
MATCHES_DIR = "matches"


def wilson_interval(successes: int, trials: int, z: float = Z95) -> list[float] | None:
    """The Wilson score interval for a binomial proportion, or None with no trials."""
    if trials <= 0:
        return None
    if not 0 <= successes <= trials:
        raise ValueError("successes must be between 0 and trials")
    p = successes / trials
    z2 = z * z
    denominator = 1 + z2 / trials
    centre = (p + z2 / (2 * trials)) / denominator
    half = z * math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / denominator
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def percentile(values: Sequence[float], fraction: float) -> float | None:
    """Nearest-rank percentile (as games/cyberpunk/prompt_size.py uses), None when empty."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def median(values: Sequence[float]) -> float | None:
    return percentile(values, 0.5)


def read_record(path: str | Path) -> list[dict[str, Any]]:
    rows = read_jsonl(Path(path), missing_ok=False)
    if not rows or not isinstance(rows[0], dict) or rows[0].get("kind") != "match":
        raise ValueError("first row is not a match header")
    return rows


def subject_seat(header: Mapping[str, Any]) -> int | None:
    """The one non-baseline seat facing a baseline seat, else None."""
    seats = header.get("seats") or []
    if len(seats) != 2:
        return None
    others = [s for s in seats if s.get("policy") != BASELINE]
    if len(others) != 1:
        return None
    return others[0].get("seat")


def config_of(header: Mapping[str, Any], seat: int) -> dict[str, Any]:
    entry = next(s for s in header["seats"] if s.get("seat") == seat)
    return {key: entry.get(key) for key in CONFIG_FIELDS}


def config_key(config: Mapping[str, Any]) -> str:
    return json.dumps([config.get(key) for key in CONFIG_FIELDS if key != "modelRevision"])


def config_label(config: Mapping[str, Any]) -> str:
    """A short human name: model directory, prompt version, budget."""
    model = config.get("modelPath")
    parts = [Path(model).name if model else config.get("policy") or "?"]
    if config.get("adapterPath"):
        parts.append("+" + Path(config["adapterPath"]).name)
    parts.append(config.get("promptVersion") or "prompt n/a")
    parts.append(f"{config['budgetMs']} ms" if config.get("budgetMs") is not None else "no budget")
    return " / ".join(parts)


def outcome(result: Mapping[str, Any] | None, seat: int) -> str:
    """win, loss, draw or none, from ``seat``'s side."""
    if not result or result.get("kind") != "result":
        return "none"
    winner = result.get("winnerSeat")
    if winner is not None:
        return "win" if winner == seat else "loss"
    return "draw" if result.get("status") in DRAW_STATUSES else "none"


def _tally() -> dict[str, int]:
    return {"matches": 0, "wins": 0, "losses": 0, "draws": 0, "noResult": 0}


def _add(tally: dict[str, int], result: str) -> None:
    tally["matches"] += 1
    tally[{"win": "wins", "loss": "losses", "draw": "draws", "none": "noResult"}[result]] += 1


def summarize_config(records: Sequence[tuple[str, list[dict[str, Any]]]], seat_of: Mapping[str, int],
                     wall_ms: Mapping[str, float] | None = None) -> dict[str, Any]:
    """One configuration's numbers over ``records`` (name, rows); ``seat_of[name]`` is its subject seat."""
    header = records[0][1][0]
    config = config_of(header, seat_of[records[0][0]])
    revisions = sorted({str(config_of(rows[0], seat_of[name]).get("modelRevision"))
                        for name, rows in records})
    total, by_seat = _tally(), {"0": _tally(), "1": _tally()}
    statuses: collections.Counter = collections.Counter()
    fallbacks: collections.Counter = collections.Counter()
    agree = agree_decisions = 0
    per_match_rates: list[float] = []
    without_agreement = 0
    latencies: list[float] = []
    input_tokens: list[int] = []
    decisions = 0
    matches = []
    walls = []
    for name, rows in records:
        seat = seat_of[name]
        result = rows[-1] if rows[-1].get("kind") == "result" else None
        result_kind = outcome(result, seat)
        _add(total, result_kind)
        _add(by_seat.setdefault(str(seat), _tally()), result_kind)
        statuses[(result or {}).get("status") or "missing"] += 1
        mine = [row for row in rows if row.get("kind") == "decision" and row.get("seat") == seat]
        decisions += len(mine)
        for row in mine:
            reason = str(row.get("reason") or "")
            if reason.endswith("_fallback"):
                fallbacks[row.get("error") or reason] += 1
            if isinstance(row.get("elapsedMs"), (int, float)):
                latencies.append(row["elapsedMs"])
            if type(row.get("inputTokens")) is int:
                input_tokens.append(row["inputTokens"])
        v3 = bool(mine) and all("agreesWithBaseline" in row for row in mine)
        if v3:
            hits = sum(1 for row in mine if row["agreesWithBaseline"])
            agree += hits
            agree_decisions += len(mine)
            per_match_rates.append(hits / len(mine))
        elif mine:
            without_agreement += 1
        wall = (wall_ms or {}).get(name)
        if wall is not None:
            walls.append(wall)
        matches.append({"name": name, "seed": header_seed(rows[0]), "subjectSeat": seat, "outcome": result_kind,
                        "status": (result or {}).get("status"), "winnerSeat": (result or {}).get("winnerSeat"),
                        "reason": (result or {}).get("reason"), "turns": (result or {}).get("turns"),
                        "decisions": len(mine),
                        "agreement": round(per_match_rates[-1], 4) if v3 else None,
                        "wallMs": wall})
    played = total["wins"] + total["losses"] + total["draws"]
    return {
        "label": config_label(config), "config": config, "modelRevisions": revisions,
        **total, "bySeat": dict(sorted(by_seat.items())), "statuses": dict(sorted(statuses.items())),
        "games": played,
        "winRate": round(total["wins"] / played, 4) if played else None,
        "winRateInterval95": wilson_interval(total["wins"], played),
        "baselineAgreement": None if not agree_decisions else {
            "decisions": agree_decisions, "agree": agree, "rate": round(agree / agree_decisions, 4),
            "meanPerMatch": round(sum(per_match_rates) / len(per_match_rates), 4),
            "matches": len(per_match_rates), "matchesWithout": without_agreement},
        "decisions": decisions,
        "fallbacks": {"total": sum(fallbacks.values()), "byError": dict(sorted(fallbacks.items())),
                      "rate": round(sum(fallbacks.values()) / decisions, 4) if decisions else None},
        "latencyMs": {"p50": percentile(latencies, 0.5), "p95": percentile(latencies, 0.95),
                      "max": max(latencies) if latencies else None, "decisions": len(latencies)},
        "inputTokens": {"median": median(input_tokens), "max": max(input_tokens) if input_tokens else None,
                        "decisions": len(input_tokens)},
        "wallSeconds": round(sum(walls) / 1000, 1) if walls else None,
        "matchesTimed": len(walls),
        "matchList": matches,
    }


def header_seed(header: Mapping[str, Any]) -> Any:
    return header.get("seed")


def summarize_records(records: Iterable[tuple[str, list[dict[str, Any]]]],
                      wall_ms: Mapping[str, float] | None = None,
                      order: Sequence[str] | None = None) -> dict[str, Any]:
    """Group records by the subject's configuration and summarise each group.

    ``order`` lists config labels to put first (the run plan's order); the rest
    follow sorted by label.
    """
    groups: dict[str, list[tuple[str, list[dict[str, Any]]]]] = {}
    seat_of: dict[str, int] = {}
    skipped = []
    for name, rows in records:
        seat = subject_seat(rows[0])
        if seat is None:
            skipped.append({"name": name, "why": "needs exactly one non-baseline seat against the baseline"})
            continue
        seat_of[name] = seat
        groups.setdefault(config_key(config_of(rows[0], seat)), []).append((name, rows))
    configs = [summarize_config(sorted(group, key=lambda item: item[0]), seat_of, wall_ms)
               for group in groups.values()]
    rank = {label: index for index, label in enumerate(order or [])}
    configs.sort(key=lambda c: (rank.get(c["label"], len(rank)), c["label"]))
    walls = [c["wallSeconds"] for c in configs if c["wallSeconds"] is not None]
    return {"schemaVersion": SUMMARY_SCHEMA_VERSION, "records": len(seat_of) + len(skipped),
            "configs": configs, "skipped": skipped,
            "wallSeconds": round(sum(walls), 1) if walls else None}


def read_timings(run_dir: Path) -> tuple[dict[str, float], float | None]:
    """Per-record match wall time (ms) and total model load seconds from ``timings.jsonl``."""
    path = Path(run_dir) / TIMINGS_FILE
    walls: dict[str, float] = {}
    load_ms = 0.0
    loads = 0
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict):
                continue
            if entry.get("kind") == "match" and isinstance(entry.get("wallMs"), (int, float)):
                walls[str(entry.get("record"))] = entry["wallMs"]
            elif entry.get("kind") == "load" and isinstance(entry.get("wallMs"), (int, float)):
                load_ms += entry["wallMs"]
                loads += 1
    return walls, (round(load_ms / 1000, 1) if loads else None)


def read_plan(run_dir: Path) -> dict[str, Any] | None:
    path = Path(run_dir) / PLAN_FILE
    if not path.is_file():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else None


def summarize_run(run_dir: str | Path) -> dict[str, Any]:
    """Summarise every record under ``<run_dir>/matches/`` (plus the plan and timings, when present)."""
    run_dir = Path(run_dir)
    records, unreadable = [], []
    matches_dir = run_dir / MATCHES_DIR
    if matches_dir.is_dir():
        for path in sorted(matches_dir.glob("*.jsonl")):
            if not RECORD_NAME_RE.match(path.name):
                continue
            try:
                records.append((path.name, read_record(path)))
            except (ValueError, OSError) as exc:
                unreadable.append({"name": path.name, "why": f"unreadable record: {exc}"[:200]})
    try:
        plan = read_plan(run_dir)
    except (ValueError, OSError):
        plan = None
    walls, load_seconds = read_timings(run_dir)
    order = [c.get("label") for c in (plan or {}).get("configs", []) if isinstance(c, dict)]
    summary = summarize_records(records, walls, order)
    summary["skipped"] += unreadable
    planned = (plan or {}).get("plannedMatches")
    summary.update({"runId": run_dir.name, "plannedMatches": planned,
                    "completedMatches": len(records), "loadSeconds": load_seconds,
                    "plan": plan})
    return summary


def write_json_atomic(path: Path, value: Any) -> None:
    """Write JSON through a temp file in the same directory, then replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def write_summary(run_dir: str | Path) -> dict[str, Any]:
    """Re-summarise ``run_dir`` and write ``summary.json`` beside its records."""
    summary = summarize_run(run_dir)
    write_json_atomic(Path(run_dir) / SUMMARY_FILE, summary)
    return summary


def list_runs(root: str | Path) -> list[dict[str, Any]]:
    """Each run directory under ``root`` with its plan's headline numbers (no records read)."""
    root = Path(root)
    if not root.is_dir():
        return []
    out = []
    for path in sorted((p for p in root.iterdir() if p.is_dir() and RUN_ID_RE.match(p.name)),
                       key=lambda p: p.stat().st_mtime, reverse=True):
        matches_dir = path / MATCHES_DIR
        done = sum(1 for p in matches_dir.glob("*.jsonl") if RECORD_NAME_RE.match(p.name)) \
            if matches_dir.is_dir() else 0
        try:
            plan = read_plan(path) or {}
        except (ValueError, OSError):
            plan = {}
        out.append({"runId": path.name, "completedMatches": done, "plannedMatches": plan.get("plannedMatches"),
                    "configs": [c.get("label") for c in plan.get("configs", []) if isinstance(c, dict)],
                    "seed": plan.get("seed"), "matchesPerConfig": plan.get("matchesPerConfig")})
    return out
