#!/usr/bin/env python3
"""Tests for the local match runner against the real TypeScript engine worker.

Why: the runner is the only thing between the policy layer and the engine, so
it must play whole games, submit only engine-offered actionIds, stay
deterministic with baseline seats, fall back when a policy misbehaves and keep
hidden state out of both the policy input and the match record. The fixed Demo
decks and the engine are real; the "mlx" seat is a fake async policy. No model,
server or network is used. Needs node and installed npm dependencies.

Record schemaVersion 3 (docs/local-match-records-v3.md) is checked on every
row: the chosen index, the baseline's pick on the same offered list and the
agreement flag, plus the model fields a real ``MLXPolicy`` reports. That policy
talks to a fake MLX worker subprocess (this file with ``--fake-mlx-worker``),
which answers with a valid choice, invalid text or a prompt-too-large error in a
fixed rotation. Training records written through ``--training-dir`` are read
back with harness/core/training_records.py's validators and checked by the
TypeScript contract (scripts/check-training-records.ts).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import (RECORD_SCHEMA_VERSION, SEAT_MODEL_FIELDS, MatchSetup, TrainingRecorder,
                                         load_default_setup, load_setup_file, play_match, summarize,
                                         write_match_record)
from games.cyberpunk.policy_bot import DEFAULT_DECISION_BUDGET_MS, PolicyRunner, baseline_action_id
from games.cyberpunk.policy_mlx import MLXPolicy, model_info, model_revision
from games.cyberpunk.policy_prompt import PROMPT_VERSION
from harness.core import training_records as tr
from harness.core.local_worker import PROTOCOL, LocalWorker
import run_local_matches

FORBIDDEN_KEYS = ("actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId", "rng")
CTX: dict = {}
REVISION = "545dc4251c05440727734bcd94334791f6ab0192"
DECISION_KEYS = {"kind", "index", "turn", "step", "seat", "playerId", "policy", "offered", "actionId",
                 "chosenIndex", "label", "baselineActionId", "baselineIndex", "agreesWithBaseline", "reason",
                 "error", "workerEvent", "elapsedMs", "rawOutput", "inputTokens", "outputTokens", "stateHash"}
NO_MODEL = {key: None for key in SEAT_MODEL_FIELDS}


def fake_mlx_worker():
    """A stand-in for scripts/mlx_policy_worker.py: same protocol, no model.

    Request ids rotate through: every 5th answers invalid text, every 7th a
    prompt-too-large error, every other one ``{"choice":0}``.
    """
    def emit(record):
        print(json.dumps({"protocol": PROTOCOL, **record}), flush=True)
    emit({"event": "ready", "ok": True})
    for line in sys.stdin:
        message = json.loads(line)
        n, tokens = message["id"], len(json.dumps(message["messages"])) // 4
        if n % 7 == 0:
            emit({"id": n, "ok": False, "error": "prompt_too_large", "promptTokens": tokens})
        else:
            emit({"id": n, "ok": True, "text": "I attack!" if n % 5 == 0 else '{"choice":0}',
                  "promptTokens": tokens, "generationTokens": 5, "inferenceMs": 2.5})


def fake_model_dir(root: Path, revision: str | None = REVISION) -> Path:
    """A model directory as `hf download --local-dir` leaves it, minus the weights."""
    path = root / "fake-model"
    (path / ".cache" / "huggingface" / "download").mkdir(parents=True, exist_ok=True)
    (path / "config.json").write_text("{}", encoding="utf-8")
    if revision is not None:
        (path / ".cache" / "huggingface" / "download" / "config.json.metadata").write_text(
            f"{revision}\n\"etag\"\n1758800000.0\n", encoding="utf-8")
    return path


def fake_worker() -> LocalWorker:
    return LocalWorker([sys.executable, "-u", str(Path(__file__).resolve()), "--fake-mlx-worker"],
                       cwd=REPO_ROOT, startup_timeout=10, response_timeout=10)


def run_args(tmp: Path, **changes) -> SimpleNamespace:
    values = dict(matches=1, seed="train", policy=["baseline", "mlx"], model=str(fake_model_dir(tmp)),
                  adapter=None, training_dir=None, budget_ms=DEFAULT_DECISION_BUDGET_MS, node=CTX["node"],
                  output_dir=tmp / "matches", force=False, max_decisions=40, max_turns=120)
    values.update(changes)
    return SimpleNamespace(**values)


async def run_cli(args, worker=None):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return await run_local_matches.run(args, CTX["setup"], mlx_worker=worker)


def read_record(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def baseline_pair():
    return [PolicyRunner(), PolicyRunner()]


async def play(setup, runners, names, **kwargs):
    decisions = []
    rows = await play_match(CTX["engine"], setup, runners, policy_names=names,
                            on_decision=decisions.append, **kwargs)
    return rows, decisions


async def full_baseline_game():
    if "game" not in CTX:
        CTX["game"] = await play(CTX["setup"].for_seed("test-local-match"), baseline_pair(),
                                 ["baseline", "baseline"])
    return CTX["game"]


async def test_default_setup_is_the_fixed_demo_pinned_to_this_engine():
    setup = CTX["setup"]
    assert setup.source == "demo" and setup.initialization["format"] == "DEMO_STARTER_V1"
    assert len(setup.initialization["decks"]) == 2
    assert set(setup.engine) == {"version", "artifactHash"} and len(setup.engine["artifactHash"]) == 64


async def test_for_seed_derives_seed_and_match_id_only():
    a, b = CTX["setup"].for_seed("x"), CTX["setup"].for_seed("x")
    assert a.initialization == b.initialization and a.initialization["seed"] == "x"
    assert uuid.UUID(a.initialization["matchId"]).version == 5
    assert a.initialization["matchId"] != CTX["setup"].for_seed("y").initialization["matchId"]
    assert a.initialization["decks"] == CTX["setup"].initialization["decks"] and a.content is CTX["setup"].content


async def test_baseline_game_plays_to_an_engine_outcome():
    rows, _ = await full_baseline_game()
    header, decisions, result = rows[0], rows[1:-1], rows[-1]
    assert header["kind"] == "match" and result["kind"] == "result"
    assert all(row["kind"] == "decision" for row in decisions) and len(decisions) > 20
    assert result["status"] == "finished" and result["detail"] is None, result
    assert {result["winnerSeat"], result["loserSeat"]} == {0, 1}
    assert result["reason"] in {"EMPTY_DRAW", "START_TURN_GIGS", "OVERTIME_GIGS"}
    assert result["decisions"] == len(decisions) and result["selections"] == {"baseline": len(decisions)}
    assert result["finalStateHash"] == decisions[-1]["stateHash"]
    assert [row["index"] for row in decisions] == list(range(len(decisions)))
    assert {row["seat"] for row in decisions} == {0, 1}


async def test_every_chosen_action_was_offered_by_the_engine():
    rows, offered = await full_baseline_game()
    decisions = rows[1:-1]
    assert len(offered) == len(decisions)
    for row, decision in zip(decisions, offered):
        assert row["actionId"] in decision.offered_ids
        assert row["offered"] == len(decision.legal_actions)
        assert row["actionId"] == baseline_action_id(decision.legal_actions)
        assert row["playerId"] == decision.player_id and row["index"] == decision.sequence


async def test_same_seed_replays_the_same_game():
    first, _ = await full_baseline_game()
    second, _ = await play(CTX["setup"].for_seed("test-local-match"), baseline_pair(), ["baseline", "baseline"])
    def trace(rows):
        return [(r["seat"], r["actionId"], r["stateHash"]) for r in rows[1:-1]]
    assert trace(first) == trace(second)
    assert first[-1]["finalStateHash"] == second[-1]["finalStateHash"]
    assert first[0]["initialStateHash"] == second[0]["initialStateHash"]
    other, _ = await play(CTX["setup"].for_seed("test-local-match-other"), baseline_pair(),
                          ["baseline", "baseline"], max_decisions=40)
    assert other[0]["initialStateHash"] != first[0]["initialStateHash"]


async def test_policies_see_only_public_input():
    seen = []

    async def spy(decision):
        seen.append(json.dumps({"snapshot": decision.snapshot, "actions": decision.legal_actions,
                                "pending": decision.pending, "turn": decision.turn}, sort_keys=True))
        return decision.legal_actions[0]["actionId"]

    await play(CTX["setup"].for_seed("test-public"), [PolicyRunner(spy), PolicyRunner(spy)],
               ["fake", "fake"], max_decisions=40)
    assert len(seen) == 40
    for text in seen:
        for key in FORBIDDEN_KEYS:
            assert f'"{key}"' not in text, key
        assert '"state"' not in text and '"events"' not in text


async def test_fake_mlx_seat_choices_are_applied():
    async def last(decision):
        return decision.legal_actions[-1]["actionId"]

    rows, offered = await play(CTX["setup"].for_seed("test-fake-mlx"), [PolicyRunner(), PolicyRunner(last)],
                               ["baseline", "mlx"], max_decisions=60)
    seat1 = [(row, d) for row, d in zip(rows[1:-1], offered) if row["seat"] == 1]
    assert seat1 and all(row["reason"] == "policy" and row["policy"] == "mlx" for row, _ in seat1)
    assert all(row["actionId"] == d.legal_actions[-1]["actionId"] for row, d in seat1)
    assert all(row["reason"] == "baseline" for row in rows[1:-1] if row["seat"] == 0)
    assert rows[-1]["status"] == "decision_cap" and rows[-1]["decisions"] == 60


async def test_non_offered_action_falls_back_to_baseline():
    async def rogue(_decision):
        return "0" * 64

    rows, offered = await play(CTX["setup"].for_seed("test-rogue"), [PolicyRunner(rogue), PolicyRunner(rogue)],
                               ["mlx", "mlx"], max_decisions=30)
    decisions = rows[1:-1]
    assert len(decisions) == 30 and rows[-1]["selections"] == {"invalid_action_fallback": 30}
    for row, decision in zip(decisions, offered):
        assert row["reason"] == "invalid_action_fallback"
        assert row["actionId"] == baseline_action_id(decision.legal_actions)


async def test_failing_and_slow_policies_fall_back():
    async def broken(_decision):
        raise RuntimeError("model crashed")

    async def slow(decision):
        await asyncio.sleep(1)
        return decision.legal_actions[0]["actionId"]

    rows, _ = await play(CTX["setup"].for_seed("test-broken"),
                         [PolicyRunner(broken), PolicyRunner(slow, max_decision_ms=100)],
                         ["mlx", "mlx"], max_decisions=12)
    reasons = {row["seat"]: row["reason"] for row in rows[1:-1]}
    assert reasons == {0: "policy_error_fallback", 1: "timeout_fallback"}, reasons
    # Each fallback says why, next to the reason, and the result row counts them.
    errors = {row["seat"]: row["error"] for row in rows[1:-1]}
    assert errors == {0: "policy_error", 1: "timeout"}, errors
    counts = {"policy_error": sum(1 for row in rows[1:-1] if row["seat"] == 0),
              "timeout": sum(1 for row in rows[1:-1] if row["seat"] == 1)}
    assert rows[-1]["errors"] == counts and rows[-1]["workerRestarts"] == 0
    assert summarize([rows])["errors"] == counts and summarize([rows])["workerRestarts"] == 0


async def test_budget_is_configurable_and_recorded_in_the_header():
    async def first(decision):
        return decision.legal_actions[0]["actionId"]

    rows, _ = await play(CTX["setup"].for_seed("test-budget"),
                         [PolicyRunner(), PolicyRunner(first, max_decision_ms=1234)],
                         ["baseline", "mlx"], max_decisions=4)
    header = rows[0]
    assert header["schemaVersion"] == RECORD_SCHEMA_VERSION == 3 and header["budgetMs"] == 1234
    # A plain async policy reports no model: every model field is None.
    assert header["seats"] == [{"seat": 0, "policy": "baseline", "budgetMs": None, **NO_MODEL},
                               {"seat": 1, "policy": "mlx", "budgetMs": 1234, **NO_MODEL}]
    rows, _ = await play(CTX["setup"].for_seed("test-budget-default"), [PolicyRunner(first), PolicyRunner(first)],
                         ["mlx", "mlx"], max_decisions=2)
    assert rows[0]["budgetMs"] == DEFAULT_DECISION_BUDGET_MS
    assert all(row["error"] is None and row["workerEvent"] is None for row in rows[1:-1])


async def test_slow_seat_times_out_once_then_its_choices_apply():
    # A policy that blows the budget once (the late answer is dropped) and then answers.
    calls = []

    async def slow_once(decision):
        calls.append(decision.request_id)
        if len(calls) == 1:
            await asyncio.sleep(0.5)
        return decision.legal_actions[-1]["actionId"]

    rows, offered = await play(CTX["setup"].for_seed("test-slow-once"),
                               [PolicyRunner(), PolicyRunner(slow_once, max_decision_ms=100)],
                               ["baseline", "mlx"], max_decisions=40)
    seat1 = [(row, d) for row, d in zip(rows[1:-1], offered) if row["seat"] == 1]
    assert len(seat1) > 2
    assert [row["reason"] for row, _ in seat1] == ["timeout_fallback"] + ["policy"] * (len(seat1) - 1)
    assert seat1[0][0]["error"] == "timeout"
    assert all(row["actionId"] == d.legal_actions[-1]["actionId"] for row, d in seat1[1:])


async def test_turn_cap_and_engine_errors_end_with_a_result_row():
    rows, _ = await play(CTX["setup"].for_seed("test-cap"), baseline_pair(), ["baseline", "baseline"],
                         max_turns=1)
    assert rows[-1]["status"] == "turn_cap" and rows[-1]["turns"] == 2
    bad = MatchSetup(CTX["setup"].content, {**CTX["setup"].initialization, "decks": []}, "test")
    rows, _ = await play(bad.for_seed("test-bad"), baseline_pair(), ["baseline", "baseline"])
    assert [row["kind"] for row in rows] == ["match", "result"]
    assert rows[-1]["status"] == "engine_error" and rows[-1]["detail"] and rows[-1]["finalStateHash"] is None


async def test_record_round_trips_without_hidden_state():
    rows, _ = await full_baseline_game()
    with tempfile.TemporaryDirectory() as tmp:
        path = write_match_record(Path(tmp) / "m.jsonl", rows)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert [json.loads(line) for line in lines] == rows
        try:
            write_match_record(path, rows)
        except FileExistsError:
            pass
        else:
            raise AssertionError("an existing match record was overwritten")
        write_match_record(path, rows[:2], force=True)
        assert len(path.read_text(encoding="utf-8").splitlines()) == 2
    header = rows[0]
    assert header["engine"] == dict(CTX["setup"].engine) and header["seed"] == "test-local-match"
    assert header["decks"] == CTX["setup"].initialization["decks"]
    assert all(set(row) == DECISION_KEYS for row in rows[1:-1])
    text = "\n".join(json.dumps(row) for row in rows)
    for key in (*FORBIDDEN_KEYS, "state", "events", "hand"):
        assert f'"{key}"' not in text, key


async def test_setup_file_accepts_a_replay_fixture_and_summary_counts():
    setup = load_setup_file(REPO_ROOT / "tests/fixtures/demo-matrix-empty-draw-replay.v1.json")
    assert setup.engine == CTX["setup"].engine and setup.source.startswith("file:")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "bad.json"
        path.write_text("{}", encoding="utf-8")
        try:
            load_setup_file(path)
        except ValueError:
            pass
        else:
            raise AssertionError("a setup without content/initialization was accepted")
    rows, _ = await full_baseline_game()
    summary = summarize([rows, rows])
    assert summary["matches"] == 2 and summary["statuses"] == {"finished": 2}
    assert summary["decisions"] == 2 * rows[-1]["decisions"] and summary["fallbacks"] == 0


async def test_every_row_records_its_index_and_the_baseline_pick():
    async def last(decision):
        return decision.legal_actions[-1]["actionId"]

    games = [await full_baseline_game(),
             await play(CTX["setup"].for_seed("test-v3-fields"), [PolicyRunner(), PolicyRunner(last)],
                        ["baseline", "fake"], max_decisions=60)]
    for rows, offered in games:
        decisions = rows[1:-1]
        assert len(decisions) == len(offered) and decisions
        for row, decision in zip(decisions, offered):
            ids = [a["actionId"] for a in decision.legal_actions]
            baseline = baseline_action_id(decision.legal_actions)
            assert set(row) == DECISION_KEYS
            assert ids[row["chosenIndex"]] == row["actionId"]
            assert row["baselineActionId"] == baseline and ids[row["baselineIndex"]] == baseline
            assert row["agreesWithBaseline"] is (row["actionId"] == baseline)
            assert row["rawOutput"] is None and row["inputTokens"] is None and row["outputTokens"] is None
        agreement = rows[-1]["baselineAgreement"]
        for seat in ("0", "1"):
            mine = [row for row in decisions if str(row["seat"]) == seat]
            agree = sum(row["agreesWithBaseline"] for row in mine)
            assert agreement[seat] == {"policy": mine[0]["policy"], "decisions": len(mine), "agree": agree,
                                       "rate": round(agree / len(mine), 4)}, agreement
    baseline_rows = games[0][0]
    assert all(row["agreesWithBaseline"] for row in baseline_rows[1:-1])
    fake_rows = [row for row in games[1][0][1:-1] if row["seat"] == 1]
    assert all(row["chosenIndex"] == row["offered"] - 1 for row in fake_rows)
    # The "last" policy disagrees with the baseline somewhere; the record must show it.
    assert any(not row["agreesWithBaseline"] for row in fake_rows)
    assert summarize([games[1][0]])["baselineAgreement"]["fake"]["decisions"] == len(fake_rows)


async def test_model_revision_is_read_from_local_download_metadata_only():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        assert model_revision(fake_model_dir(root)) == REVISION
        assert model_revision(fake_model_dir(root / "none", revision=None)) is None
        assert model_revision(fake_model_dir(root / "bad", revision="not-a-commit")) is None
        snapshot = root / "hub" / "snapshots" / REVISION
        snapshot.mkdir(parents=True)
        assert model_revision(snapshot) == REVISION
        info = model_info(str(fake_model_dir(root)))
        assert info["modelRevision"] == REVISION and info["modelPath"] == str((root / "fake-model").resolve())
        assert info["promptVersion"] == PROMPT_VERSION and len(info["promptFingerprint"]) == 64
        assert info["adapterPath"] is None and info["adapterRevision"] is None
        assert model_info("models/qwen3-8b-4bit")["modelPath"] == "models/qwen3-8b-4bit"


async def test_mlx_seat_header_and_rows_carry_model_fields():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        args = run_args(tmp, budget_ms=4321)
        assert await run_cli(args, fake_worker()) == 0
        rows = read_record(tmp / "matches" / "train-0.jsonl")
    header, decisions = rows[0], rows[1:-1]
    assert header["schemaVersion"] == 3 and header["budgetMs"] == 4321
    assert header["seats"][0] == {"seat": 0, "policy": "baseline", "budgetMs": None, **NO_MODEL}
    assert header["seats"][1] == {"seat": 1, "policy": "mlx", "budgetMs": 4321,
                                  "modelPath": str((tmp / "fake-model").resolve()), "modelRevision": REVISION,
                                  "adapterPath": None, "adapterRevision": None, "promptVersion": PROMPT_VERSION}
    mlx = [row for row in decisions if row["seat"] == 1]
    by_reason = {}
    for row in mlx:
        by_reason.setdefault(row["reason"], []).append(row)
    assert set(by_reason) == {"policy", "policy_error_fallback"}, set(by_reason)
    for row in by_reason["policy"]:
        assert row["rawOutput"] == '{"choice":0}' and row["chosenIndex"] == 0
        assert row["inputTokens"] > 0 and row["outputTokens"] == 5
    errors = {row["error"] for row in by_reason["policy_error_fallback"]}
    assert errors == {"invalid_output", "prompt_too_large"}, errors
    for row in by_reason["policy_error_fallback"]:
        if row["error"] == "invalid_output":
            assert row["rawOutput"] == "I attack!" and row["outputTokens"] == 5
        else:
            assert row["rawOutput"] is None and row["inputTokens"] > 0 and row["outputTokens"] is None
        assert row["actionId"] == row["baselineActionId"] and row["agreesWithBaseline"] is True
    assert all(set(row) == DECISION_KEYS for row in decisions)
    CTX["mlx_rows"] = rows


async def test_training_records_are_valid_and_match_the_record():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        training = tmp / "training"
        assert await run_cli(run_args(tmp, training_dir=training), fake_worker()) == 0
        rows = read_record(tmp / "matches" / "train-0.jsonl")
        positions = tr.read_positions(training / "positions.jsonl", expect_engine=CTX["setup"].engine)
        attempts = tr.read_attempts(training / "attempts.jsonl")
        # The record is unchanged by logging: same game as without --training-dir.
        assert [(r["actionId"], r["stateHash"]) for r in rows[1:-1]] == \
            [(r["actionId"], r["stateHash"]) for r in CTX["mlx_rows"][1:-1]]
        logged = [row for row in rows[1:-1] if row["seat"] == 1 and row["rawOutput"] is not None]
        assert logged and len(positions) == len(attempts) == len(logged)
        by_position = {p["positionId"]: p for p in positions}
        for row, attempt in zip(logged, attempts):
            position = by_position[attempt["positionId"]]
            assert position["actingSeat"] == 1 and position["provenance"]["generator"] == "local_match"
            assert position["provenance"]["seed"] == "train-0"
            assert row["actionId"] in {a["actionId"] for a in position["legalActions"]}
            assert attempt["rawModelOutput"] == row["rawOutput"]
            assert attempt["inputTokens"] == row["inputTokens"] and attempt["outputTokens"] == 5
            assert attempt["modelRevision"] == attempt["tokenizerRevision"] == REVISION
            assert attempt["adapterRevision"] == "none" and attempt["decoding"]["temperature"] == 0.0
            if row["reason"] == "policy":
                assert attempt["validation"] == {"ok": True, "codes": []}
                assert attempt["parsedChoice"] == {"actionId": row["actionId"]}
                assert attempt["resultingStateHash"] == row["stateHash"]
            else:
                assert attempt["validation"] == {"ok": False, "codes": ["INVALID_MODEL_OUTPUT"]}
                assert attempt["parsedChoice"] is None and attempt["resultingStateHash"] is None
        assert {a["validation"]["ok"] for a in attempts} == {True, False}
        # The TypeScript contract accepts them and re-derives every position from the engine.
        content = tmp / "content.json"
        content.write_text(json.dumps({"content": CTX["setup"].content}), encoding="utf-8")
        done = subprocess.run([CTX["node"], "--import", "tsx", "scripts/check-training-records.ts",
                               str(training / "positions.jsonl"), str(training / "attempts.jsonl"),
                               str(tmp / "ts"), str(content)],
                              cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        report = json.loads(done.stdout)
        assert report["importPositions"] == {"ok": True, "count": len(positions)}, report["importPositions"]
        assert all(a["ok"] for a in report["attempts"]) and report["exported"] is True
        assert report["derivationMatches"] == [True] * len(positions)
        # A second run of the same seed appends new attempts (identical positions dedupe).
        assert await run_cli(run_args(tmp, training_dir=training, force=True), fake_worker()) == 0
        assert len(tr.read_attempts(training / "attempts.jsonl")) == 2 * len(attempts)
        assert len(tr.read_positions(training / "positions.jsonl")) == len(positions)


async def test_training_writes_nothing_when_off_baseline_only_or_the_run_raises():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # Off by default: an mlx game writes its record and no training files anywhere.
        assert await run_cli(run_args(tmp, seed="off"), fake_worker()) == 0
        assert (tmp / "matches" / "off-0.jsonl").exists()
        assert not list(tmp.rglob("positions.jsonl")) and not list(tmp.rglob("attempts.jsonl"))
        # Baseline seats log nothing even with a training directory.
        training = tmp / "training"
        assert await run_cli(run_args(tmp, seed="base", policy=["baseline", "baseline"],
                                      training_dir=training)) == 0
        assert not training.exists()
        # A match that raises mid-game writes no training records.
        info = model_info(str(fake_model_dir(tmp)))
        worker = fake_worker()
        await worker.start()
        try:
            def crash(decision):
                if decision.sequence == 30:
                    raise RuntimeError("runner crashed")
            policy = PolicyRunner(MLXPolicy(worker, info=info))
            try:
                with tr.TrainingLog(training / "positions.jsonl", training / "attempts.jsonl",
                                    expect_engine=CTX["setup"].engine) as log:
                    recorder = TrainingRecorder(log, revision="test")
                    await play_match(CTX["engine"], CTX["setup"].for_seed("crash"), [PolicyRunner(), policy],
                                     policy_names=["baseline", "mlx"], on_decision=crash, training=recorder)
            except RuntimeError:
                pass
            else:
                raise AssertionError("the crashing match did not raise")
            assert recorder.attempts > 0, "nothing was logged before the crash; the check would be empty"
            assert not training.exists()
        finally:
            await worker.close()
        # A model with no revision in its metadata cannot be logged: refused before any game.
        bare = fake_model_dir(tmp / "bare", revision=None)
        try:
            await run_cli(run_args(tmp, seed="bare", model=str(bare), training_dir=training))
        except ValueError as exc:
            assert "revision" in str(exc)
        else:
            raise AssertionError("training with an unknown model revision was accepted")
        assert not (tmp / "matches" / "bare-0.jsonl").exists() and not training.exists()


async def run_tests(node):
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["setup"] = load_default_setup(REPO_ROOT, node=node)
    CTX["node"] = node
    with EngineWorker(REPO_ROOT, node=node) as engine:
        CTX["engine"] = engine
        for test in tests:
            await test()
            print(f"OK  {test.__name__}")
    print(f"PASS local match runner: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    parser.add_argument("--fake-mlx-worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.fake_mlx_worker:
        fake_mlx_worker()
        return
    asyncio.run(run_tests(args.node))


if __name__ == "__main__":
    main()
