#!/usr/bin/env python3
"""Cross-language tests for the training record format (TrainingPosition v2, TrainingAttempt v1).

Why: the TypeScript contract in packages/training-harness is the training
record format, and Python writes and reads it (harness/core/training_records.py).
A Python reader that is looser than zod would let records into training that the
engine side rejects; one that is stricter would drop good data. So every check
here runs on engine-generated positions from checked-in replay fixtures, never
on hand-written ones, and every verdict is compared with the TS side:

  * Python rebuilds each fixture position from the engine worker's own `hash`,
    `observe` and `listLegalActions` answers and gets the TS `generatePosition`
    record back byte for byte;
  * records Python writes (positions plus accepted and rejected attempts from
    the logging hook) are accepted by TS `importPositions`,
    `TrainingAttemptSchema` and `validateTrainingPosition`;
  * records TS writes (`exportPositions`, `exportAttempts`, scripts/training-demo.ts)
    are read back unchanged by Python;
  * each tampered record (extra field, unknown schemaVersion, bad pattern, ...)
    is rejected by both sides, and the one class Python cannot see (a forged
    hash with valid shape) is shown to be rejected by TS.

No model, server or network is used. Needs node and installed npm dependencies.
"""

from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from harness.core import training_records as tr  # noqa: E402

FIXTURES = ["value-conditions-replay", "combat-attack-replay", "gear-replay"]
POSITIONS_PER_FIXTURE = 4
MODEL = tr.ModelMetadata(model_revision="test-model@0", tokenizer_revision="test-tokenizer@0",
                         adapter_revision="none", prompt_fingerprint="a" * 64)
DECODING = tr.Decoding(temperature=0.0, top_p=1.0, max_tokens=64, seed=7)
CTX: dict = {}


class Worker:
    """Minimal JSONL client for scripts/engine-worker.ts (test-local; the runner uses its own adapter)."""

    def __init__(self, node: str):
        self.proc = subprocess.Popen([node, "--import", "tsx", "scripts/engine-worker.ts"], cwd=REPO_ROOT,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
        self.n = 0

    def call(self, op: str, content: dict, **fields) -> dict:
        self.n += 1
        request = {"schemaVersion": 1, "requestId": f"t-{self.n}", "op": op, "content": content, **fields}
        self.proc.stdin.write(json.dumps(request) + "\n")
        self.proc.stdin.flush()
        response = json.loads(self.proc.stdout.readline())
        assert response["ok"], (op, response.get("errors"))
        return response["value"]

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


def ts_check(positions_path: Path, attempts_path: Path, out_dir: Path, content_path: Path | None = None) -> dict:
    cmd = [CTX["node"], "--import", "tsx", "scripts/check-training-records.ts",
           str(positions_path), str(attempts_path), str(out_dir)]
    if content_path is not None:
        cmd.append(str(content_path))
    done = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(done.stdout)


def rejects(fn, *args, **kwargs) -> str:
    try:
        fn(*args, **kwargs)
    except (tr.TrainingRecordError, SystemExit) as exc:
        return str(exc)
    raise AssertionError(f"{fn.__name__} accepted a record it should reject")


def fixture(name: str) -> dict:
    return json.loads((REPO_ROOT / "tests" / "fixtures" / f"{name}.v1.json").read_text(encoding="utf-8"))


def engine_position(worker: Worker, content: dict, reference: dict) -> dict:
    """Rebuild a fixture position from worker answers alone, as a local match runner would."""
    state = reference["state"]
    actor = state["match"]["playerOrder"][reference["actingSeat"]]
    observation = worker.call("observe", content, state=state, actorId=actor)["observation"]
    actions = worker.call("listLegalActions", content, state=state, actorId=actor)["actions"]
    hashes = worker.call("hash", content, state=state, actorId=actor)
    return tr.build_position(state=state, content=content, actor_id=actor, observation=observation,
                             legal_actions=actions, hashes=hashes, position_id=reference["positionId"],
                             provenance=reference["provenance"])


def setup():
    """Per fixture: engine-built positions plus one accepted and one rejected attempt each, via the hook."""
    worker = Worker(CTX["node"])
    try:
        for name in FIXTURES:
            data = fixture(name)
            content, refs = data["content"], data["positions"][:POSITIONS_PER_FIXTURE]
            built = [engine_position(worker, content, ref) for ref in refs]
            out = CTX["tmp"] / name
            log = tr.TrainingLog(out / "positions.jsonl", out / "attempts.jsonl",
                                 expect_engine=content["manifest"]["engine"])
            with log:
                for i, position in enumerate(built):
                    actor = position["state"]["match"]["playerOrder"][position["actingSeat"]]
                    choice = position["legalActions"][-1]["actionId"]
                    applied = worker.call("applyAction", content, state=position["state"], actorId=actor,
                                          actionId=choice)
                    log.log_attempt(position=position, attempt_id=f"{name}-{i}-ok",
                                    raw_model_output=json.dumps({"choice": len(position["legalActions"]) - 1}),
                                    parsed_action_id=choice, validation_ok=True, validation_codes=[],
                                    resulting_state_hash=applied["stateHash"], model=MODEL, decoding=DECODING,
                                    elapsed_ms=12.5, input_tokens=900, output_tokens=6)
                    log.log_attempt(position=position, attempt_id=f"{name}-{i}-bad",
                                    raw_model_output="I attack with everything!", parsed_action_id=None,
                                    validation_ok=False, validation_codes=["INVALID_MODEL_OUTPUT"],
                                    resulting_state_hash=None, model=MODEL,
                                    decoding=tr.Decoding(temperature=0.7, top_p=0.9, max_tokens=64),
                                    elapsed_ms=30, input_tokens=900, output_tokens=8)
            CTX.setdefault("runs", {})[name] = {"data": data, "refs": refs, "built": built, "out": out}
    finally:
        worker.close()


def test_engine_fixture_positions_satisfy_python_reader():
    for name in FIXTURES:
        positions = fixture(name)["positions"]
        for p in positions:
            tr.validate_position(p)
        assert len(positions) >= POSITIONS_PER_FIXTURE, name


def test_python_built_positions_equal_ts_generate_position():
    for name, run in CTX["runs"].items():
        for ref, built in zip(run["refs"], run["built"]):
            assert tr._json_equal(ref, built), (name, ref["positionId"])
            assert json.dumps(ref, sort_keys=True) == json.dumps(built, sort_keys=True)


def test_python_written_records_read_back_in_python():
    for name, run in CTX["runs"].items():
        positions = tr.read_positions(run["out"] / "positions.jsonl")
        attempts = tr.read_attempts(run["out"] / "attempts.jsonl")
        assert positions == run["built"], name
        assert len(attempts) == 2 * POSITIONS_PER_FIXTURE
        assert {a["positionId"] for a in attempts} == {p["positionId"] for p in positions}


def test_python_written_records_accepted_by_typescript():
    for name, run in CTX["runs"].items():
        content_path = REPO_ROOT / "tests" / "fixtures" / f"{name}.v1.json"
        report = ts_check(run["out"] / "positions.jsonl", run["out"] / "attempts.jsonl", run["out"] / "ts",
                          content_path)
        assert report["importPositions"] == {"ok": True, "count": POSITIONS_PER_FIXTURE}, (name, report)
        assert all(p["ok"] for p in report["positions"]), report["positions"]
        assert all(a["ok"] for a in report["attempts"]) and len(report["attempts"]) == 2 * POSITIONS_PER_FIXTURE
        assert report["derivationMatches"] == [True] * POSITIONS_PER_FIXTURE, report["derivationMatches"]
        assert report["exported"] is True
        CTX.setdefault("ts_reports", {})[name] = report


def test_typescript_written_records_read_back_in_python():
    for name, run in CTX["runs"].items():
        ts_dir = run["out"] / "ts"
        assert tr.read_positions(ts_dir / "positions.ts.jsonl") == tr.read_positions(run["out"] / "positions.jsonl")
        assert tr.read_attempts(ts_dir / "attempts.ts.jsonl") == tr.read_attempts(run["out"] / "attempts.jsonl")


def test_training_demo_export_reads_in_python():
    demo = subprocess.run([CTX["node"], "--import", "tsx", "scripts/training-demo.ts"], cwd=REPO_ROOT,
                          capture_output=True, text=True, encoding="utf-8", check=True).stdout
    path = CTX["tmp"] / "training-demo.jsonl"
    path.write_text(demo, encoding="utf-8")
    positions = tr.read_positions(path)
    assert len(positions) == len([line for line in demo.splitlines() if line.strip()]) >= 1
    # Python can re-write TS output (merge into a fresh log) without changing a record.
    again = CTX["tmp"] / "training-demo.py.jsonl"
    tr.write_positions(again, positions)
    assert tr.read_positions(again) == positions


def _mutations(position: dict, attempt: dict):
    """(label, kind, record): each must be rejected by both Python and TypeScript."""
    def p(fn):
        rec = copy.deepcopy(position)
        fn(rec)
        return rec

    def a(fn):
        rec = copy.deepcopy(attempt)
        fn(rec)
        return rec
    return [
        ("position extra top-level field", "position", p(lambda r: r.update(note="x"))),
        ("position extra nested field", "position", p(lambda r: r["provenance"].update(extra=1))),
        ("position extra field deep in state", "position", p(lambda r: r["state"]["match"].update(debug=True))),
        ("position schemaVersion 3", "position", p(lambda r: r.update(schemaVersion=3))),
        ("position schemaVersion 1", "position", p(lambda r: r.update(schemaVersion=1))),
        ("position schemaVersion as string", "position", p(lambda r: r.update(schemaVersion="2"))),
        ("position missing legalActions", "position", p(lambda r: r.pop("legalActions"))),
        ("position hash not hex", "position", p(lambda r: r.update(stateHash="Z" * 64))),
        ("position hash with trailing newline", "position", p(lambda r: r.update(stateHash=r["stateHash"] + "\n"))),
        ("position actingSeat mismatch", "position", p(lambda r: r.update(actingSeat=1 - r["actingSeat"]))),
        ("position provenance seed mismatch", "position", p(lambda r: r["provenance"].update(seed="other"))),
        ("position empty positionId", "position", p(lambda r: r.update(positionId=""))),
        ("attempt extra field", "attempt", a(lambda r: r.update(score=1))),
        ("attempt extra decoding field", "attempt", a(lambda r: r["decoding"].update(topK=40))),
        ("attempt schemaVersion 2", "attempt", a(lambda r: r.update(schemaVersion=2))),
        ("attempt topP above 1", "attempt", a(lambda r: r["decoding"].update(topP=1.5))),
        ("attempt negative tokens", "attempt", a(lambda r: r.update(inputTokens=-1))),
        ("attempt fractional maxTokens", "attempt", a(lambda r: r["decoding"].update(maxTokens=1.5))),
        ("attempt parsedChoice extra field", "attempt", a(lambda r: r.update(parsedChoice={"actionId": "a" * 64, "i": 0}))),
        ("attempt boolean as number", "attempt", a(lambda r: r.update(elapsedMs=True))),
        ("attempt promptFingerprint uppercase", "attempt", a(lambda r: r.update(promptFingerprint="A" * 64))),
    ]


def test_tampered_records_rejected_by_both_languages():
    run = CTX["runs"][FIXTURES[0]]
    position = run["built"][0]
    attempt = tr.read_attempts(run["out"] / "attempts.jsonl")[0]
    cases = _mutations(position, attempt)
    for label, kind, record in cases:
        rejects(tr.validate_position if kind == "position" else tr.validate_attempt, record)
    out = CTX["tmp"] / "tampered"
    out.mkdir()
    pos_cases = [r for _, k, r in cases if k == "position"]
    att_cases = [r for _, k, r in cases if k == "attempt"]
    # Written raw: the Python writer would refuse these, which is the point.
    (out / "positions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in pos_cases), encoding="utf-8")
    (out / "attempts.jsonl").write_text("".join(json.dumps(r) + "\n" for r in att_cases), encoding="utf-8")
    report = ts_check(out / "positions.jsonl", out / "attempts.jsonl", out / "ts")
    labels = [label for label, _, _ in cases]
    verdicts = report["positions"] + report["attempts"]
    accepted = [label for label, v in zip([l for l, k, _ in cases if k == "position"] +
                                          [l for l, k, _ in cases if k == "attempt"], verdicts) if v["ok"]]
    assert len(verdicts) == len(labels) and not accepted, f"TS accepted: {accepted}"
    assert report["importPositions"]["ok"] is False and report["exported"] is False


def test_forged_hash_is_the_documented_python_gap_and_ts_rejects_it():
    run = CTX["runs"][FIXTURES[0]]
    forged = copy.deepcopy(run["built"][0])
    forged["stateHash"] = "0" * 64
    forged["legalActions"][0]["descriptor"]["label"] = "Fabricated label"
    tr.validate_position(forged)  # shape is valid: Python does not recompute engine hashes
    out = CTX["tmp"] / "forged"
    out.mkdir()
    (out / "positions.jsonl").write_text(json.dumps(forged) + "\n", encoding="utf-8")
    (out / "attempts.jsonl").write_text("", encoding="utf-8")
    report = ts_check(out / "positions.jsonl", out / "attempts.jsonl", out / "ts")
    assert report["positions"][0]["ok"] is False and "mismatch" in report["positions"][0]["error"], report


def test_non_json_numbers_never_reach_disk():
    run = CTX["runs"][FIXTURES[0]]
    attempt = dict(tr.read_attempts(run["out"] / "attempts.jsonl")[0], attemptId="nan", elapsedMs=float("nan"))
    rejects(tr.validate_attempt, attempt)
    path = CTX["tmp"] / "nan.jsonl"
    path.write_text(json.dumps(dict(attempt, elapsedMs=1)).replace('"elapsedMs": 1', '"elapsedMs": NaN') + "\n")
    rejects(tr.read_attempts, path)


def test_reader_and_writer_fail_closed():
    run = CTX["runs"][FIXTURES[0]]
    positions = tr.read_positions(run["out"] / "positions.jsonl")
    attempts = tr.read_attempts(run["out"] / "attempts.jsonl")
    other = copy.deepcopy(positions[1])
    other["positionId"] = positions[0]["positionId"]
    assert "conflicting position ID" in rejects(tr.write_positions, CTX["tmp"] / "conflict.jsonl", [positions[0], other])
    assert "duplicate attempt ID" in rejects(tr.write_attempts, CTX["tmp"] / "dup.jsonl", [attempts[0], attempts[0]])
    # Identical repeats collapse, as in TS exportPositions.
    assert len(tr.write_positions(CTX["tmp"] / "repeat.jsonl", [positions[0], copy.deepcopy(positions[0])])) == 1
    # guard_shrink: rewriting a file with fewer records needs force.
    path = CTX["tmp"] / "shrink.jsonl"
    tr.write_positions(path, positions)
    assert "refusing to shrink" in rejects(tr.write_positions, path, positions[:1])
    tr.write_positions(path, positions[:1], force=True)
    assert len(tr.read_positions(path)) == 1
    # Pinned to an engine build: a different identity is refused.
    engine = dict(positions[0]["manifest"]["engine"], artifactHash="f" * 64)
    assert "pinned to engine" in rejects(tr.read_positions, run["out"] / "positions.jsonl", expect_engine=engine)
    # A schema keyword the validator does not implement fails closed.
    try:
        tr.SchemaValidator({"type": "object", "if": {}})
    except tr.SchemaError:
        pass
    else:
        raise AssertionError("unknown JSON Schema keyword was accepted")


def test_hook_refuses_attempts_that_contradict_the_engine():
    position = CTX["runs"][FIXTURES[0]]["built"][0]
    base = dict(position=position, attempt_id="x", raw_model_output="{}", model=MODEL, decoding=DECODING,
                elapsed_ms=1, input_tokens=1, output_tokens=1)
    offered = position["legalActions"][0]["actionId"]
    rejects(tr.build_attempt, **base, parsed_action_id="b" * 64, validation_ok=True, validation_codes=[],
            resulting_state_hash="c" * 64)
    rejects(tr.build_attempt, **base, parsed_action_id=offered, validation_ok=True, validation_codes=[],
            resulting_state_hash=None)
    rejects(tr.build_attempt, **base, parsed_action_id=None, validation_ok=False, validation_codes=[],
            resulting_state_hash=None)
    rejects(tr.build_attempt, **base, parsed_action_id=offered, validation_ok=False,
            validation_codes=["ACTION_NOT_LEGAL"], resulting_state_hash="c" * 64)
    # A log that raises mid-run writes nothing.
    out = CTX["tmp"] / "aborted"
    try:
        with tr.TrainingLog(out / "p.jsonl", out / "a.jsonl") as log:
            log.log_attempt(**base, parsed_action_id=None, validation_ok=False, validation_codes=["X"],
                            resulting_state_hash=None)
            raise RuntimeError("runner crashed")
    except RuntimeError:
        pass
    assert not (out / "p.jsonl").exists() and not (out / "a.jsonl").exists()


def test_flush_appends_without_losing_existing_records():
    run = CTX["runs"][FIXTURES[0]]
    out = CTX["tmp"] / "append"
    first, second = run["built"][0], run["built"][1]
    common = dict(raw_model_output="?", parsed_action_id=None, validation_ok=False,
                  validation_codes=["INVALID_MODEL_OUTPUT"], resulting_state_hash=None, model=MODEL,
                  decoding=DECODING, elapsed_ms=1, input_tokens=1, output_tokens=1)
    tr.log_training_attempt(out / "p.jsonl", out / "a.jsonl", position=first, attempt_id="one", **common)
    tr.log_training_attempt(out / "p.jsonl", out / "a.jsonl", position=first, attempt_id="two", **common)
    tr.log_training_attempt(out / "p.jsonl", out / "a.jsonl", position=second, attempt_id="three", **common)
    assert [p["positionId"] for p in tr.read_positions(out / "p.jsonl")] == [first["positionId"], second["positionId"]]
    assert [a["attemptId"] for a in tr.read_attempts(out / "a.jsonl")] == ["one", "two", "three"]
    assert "duplicate attempt ID" in rejects(tr.log_training_attempt, out / "p.jsonl", out / "a.jsonl",
                                             position=first, attempt_id="two", **common)


def run_tests(node: str):
    CTX["node"] = node
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    with tempfile.TemporaryDirectory(prefix="training-records-") as tmp:
        CTX["tmp"] = Path(tmp)
        setup()
        for test in tests:
            test()
            print(f"OK  {test.__name__}")
    print(f"PASS training records: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    run_tests(args.node)


if __name__ == "__main__":
    main()
