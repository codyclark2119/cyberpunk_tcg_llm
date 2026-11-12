#!/usr/bin/env python3
"""Tests for the local strength eval (scripts/eval_local_strength.py, games/cyberpunk/strength_eval.py).

Why: a strength number is only useful if it counts the right games for the
right side. These tests check that every configuration plays the same seeds
once per seat, that the summary's wins, losses, draws, Wilson interval,
agreement, fallbacks, latency and tokens match hand-built records exactly, that
a v2 record's missing agreement is reported as n/a and never as zero, that
re-running a run id skips finished matches (and replays a missing one
identically), that the prompt version reaches the model, and that the play UI's
"Strength" tab only launches through the allowlisted runner, serves summaries
and records of a run and ships a page script that parses.

The engine and Demo decks are real; the model is a fake MLX worker subprocess
(this file with ``--fake-mlx-worker``) whose answer depends only on the prompt,
so a replayed match makes the same choices. No model, network or listening
socket is used. Needs node, installed npm dependencies, fastapi and httpx.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from fastapi.testclient import TestClient

from games.cyberpunk import strength_eval as se
from games.cyberpunk.local_match import load_default_setup
from games.cyberpunk.play_app import PLAY_HTML, build_play_app, strength_dir_for
from games.cyberpunk.policy_bot import DEFAULT_DECISION_BUDGET_MS
from games.cyberpunk.policy_mlx import model_info
from games.cyberpunk.policy_prompt import PROMPT_VERSION, PROMPT_VERSIONS
from harness.core.local_worker import PROTOCOL, LocalWorker
import eval_local_strength

CTX: dict = {}
REVISION = "545dc4251c05440727734bcd94334791f6ab0192"
V3 = "local-choice-v3"


def fake_mlx_worker():
    """scripts/mlx_policy_worker.py's protocol with no model; the answer depends only on the prompt.

    A prompt whose length is a multiple of 7 gets invalid text, else ``{"choice":0}``.
    """
    def emit(record):
        print(json.dumps({"protocol": PROTOCOL, **record}), flush=True)
    emit({"event": "ready", "ok": True})
    for line in sys.stdin:
        message = json.loads(line)
        size = len(json.dumps(message["messages"]))
        emit({"id": message["id"], "ok": True, "text": "I attack!" if size % 7 == 0 else '{"choice":0}',
              "promptTokens": size // 4, "generationTokens": 5, "inferenceMs": 1.0})


def fake_model_dir(root: Path, name: str = "fake-model") -> Path:
    path = root / name
    (path / ".cache" / "huggingface" / "download").mkdir(parents=True, exist_ok=True)
    (path / "config.json").write_text("{}", encoding="utf-8")
    (path / ".cache" / "huggingface" / "download" / "config.json.metadata").write_text(
        f"{REVISION}\n\"etag\"\n1758800000.0\n", encoding="utf-8")
    return path


class Factory:
    """Counts worker starts per model; every worker is the fake one."""

    def __init__(self):
        self.models: list[str] = []

    def __call__(self, model, budget):
        self.models.append(model)
        return LocalWorker([sys.executable, "-u", str(Path(__file__).resolve()), "--fake-mlx-worker"],
                           cwd=REPO_ROOT, startup_timeout=10, response_timeout=10)


def eval_args(tmp: Path, **changes) -> SimpleNamespace:
    values = dict(run_id="t", model=[str(fake_model_dir(tmp))], prompt_version=[V3, PROMPT_VERSION],
                  budget_ms=None, matches=4, seed="st", setup=None, max_decisions=30, max_turns=120,
                  output_root=tmp / "strength", node=CTX["node"])
    values.update(changes)
    return SimpleNamespace(**values)


async def run_eval(args, factory):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = await eval_local_strength.run(args, CTX["setup"], worker_factory=factory)
    return code, out.getvalue(), err.getvalue()


# ---- hand-built records ---------------------------------------------------------------------

def header(subject_seat, *, prompt=PROMPT_VERSION, budget=5000, model="models/m", v3=True, seed="s-0",
           subject="mlx"):
    seats = []
    for seat in (0, 1):
        mine = seat == subject_seat
        entry = {"seat": seat, "policy": subject if mine else "baseline", "budgetMs": budget if mine else None}
        if v3:
            entry.update({"modelPath": model if mine else None, "modelRevision": REVISION if mine else None,
                          "adapterPath": None, "adapterRevision": None,
                          "promptVersion": prompt if mine else None})
        seats.append(entry)
    return {"kind": "match", "schemaVersion": 3 if v3 else 2, "matchId": "m", "seed": seed, "seats": seats}


def decision(seat, *, ms, agree=True, tokens=None, reason="policy", error=None, v3=True):
    row = {"kind": "decision", "seat": seat, "policy": "x", "reason": reason, "error": error, "elapsedMs": ms}
    if v3:
        row.update({"agreesWithBaseline": agree, "inputTokens": tokens})
    return row


def result(status, winner):
    return {"kind": "result", "status": status, "winnerSeat": winner, "reason": "r" if winner is not None else None,
            "turns": 9}


def test_wilson_interval_and_percentiles():
    assert se.wilson_interval(7, 10) == [0.3968, 0.8922]
    assert se.wilson_interval(0, 10) == [0.0, 0.2775]
    assert se.wilson_interval(10, 10) == [0.7225, 1.0]
    assert se.wilson_interval(3, 5) == [0.2307, 0.8824]
    assert se.wilson_interval(0, 0) is None
    assert se.percentile([5, 1, 3, 2, 4], 0.5) == 3 and se.percentile([5, 1, 3, 2, 4], 0.95) == 5
    assert se.percentile([], 0.5) is None


def test_summary_numbers_on_hand_built_records():
    records = [
        # Model in seat 0: a win, a loss and a turn-cap draw.
        ("a.jsonl", [header(0), decision(0, ms=100, tokens=1000), decision(1, ms=0.1),
                     decision(0, ms=300, agree=False, tokens=1200), result("finished", 0)]),
        ("b.jsonl", [header(0), decision(0, ms=200, tokens=900, reason="timeout_fallback", error="timeout"),
                     result("finished", 1)]),
        ("c.jsonl", [header(0), decision(0, ms=400, tokens=1100), result("turn_cap", None)]),
        # Model in seat 1: two wins and an engine error (no result, not in the rate).
        ("d.jsonl", [header(1), decision(1, ms=500, tokens=1300, reason="policy_error_fallback",
                                         error="invalid_output"), result("finished", 1)]),
        ("e.jsonl", [header(1), decision(1, ms=600, agree=False, tokens=800), result("finished", 1)]),
        ("f.jsonl", [header(1), decision(1, ms=700, tokens=None, reason="policy_error_fallback",
                                         error="prompt_too_large"), result("engine_error", None)]),
        # Another prompt version is its own configuration.
        ("g.jsonl", [header(0, prompt=V3), decision(0, ms=50, tokens=400), result("finished", 1)]),
        # Baseline against baseline has no subject.
        ("h.jsonl", [header(0, subject="baseline"), result("finished", 0)]),
    ]
    summary = se.summarize_records(records, wall_ms={"a.jsonl": 1000, "b.jsonl": 2500},
                                   order=["m / local-choice-v4 / 5000 ms"])
    assert summary["records"] == 8 and [s["name"] for s in summary["skipped"]] == ["h.jsonl"]
    first, second = summary["configs"]
    assert first["label"] == "m / local-choice-v4 / 5000 ms" and second["label"] == "m / local-choice-v3 / 5000 ms"
    assert first["config"] == {"policy": "mlx", "modelPath": "models/m", "modelRevision": REVISION,
                               "adapterPath": None, "adapterRevision": None, "promptVersion": PROMPT_VERSION,
                               "budgetMs": 5000}
    assert (first["matches"], first["wins"], first["losses"], first["draws"], first["noResult"]) == (6, 3, 1, 1, 1)
    assert first["bySeat"] == {"0": {"matches": 3, "wins": 1, "losses": 1, "draws": 1, "noResult": 0},
                               "1": {"matches": 3, "wins": 2, "losses": 0, "draws": 0, "noResult": 1}}
    assert first["games"] == 5 and first["winRate"] == 0.6
    assert first["winRateInterval95"] == se.wilson_interval(3, 5) == [0.2307, 0.8824]
    assert first["statuses"] == {"engine_error": 1, "finished": 4, "turn_cap": 1}
    # Only the model seat's 7 decisions count (seat 1's baseline row in a.jsonl does not).
    assert first["decisions"] == 7
    agreement = first["baselineAgreement"]
    assert agreement["decisions"] == 7 and agreement["agree"] == 5 and agreement["rate"] == round(5 / 7, 4)
    assert agreement["meanPerMatch"] == round((0.5 + 1 + 1 + 1 + 0 + 1) / 6, 4) and agreement["matchesWithout"] == 0
    assert first["fallbacks"] == {"total": 3, "byError": {"invalid_output": 1, "prompt_too_large": 1, "timeout": 1},
                                  "rate": round(3 / 7, 4)}
    assert first["latencyMs"] == {"p50": 400, "p95": 700, "max": 700, "decisions": 7}
    assert first["inputTokens"] == {"median": 1000, "max": 1300, "decisions": 6}
    assert first["wallSeconds"] == 3.5 and first["matchesTimed"] == 2 and summary["wallSeconds"] == 3.5
    by_name = {m["name"]: m for m in first["matchList"]}
    assert {n: by_name[n + ".jsonl"]["outcome"] for n in "abcdef"} == {
        "a": "win", "b": "loss", "c": "draw", "d": "win", "e": "win", "f": "none"}
    assert by_name["a.jsonl"]["agreement"] == 0.5 and by_name["a.jsonl"]["decisions"] == 2
    assert (second["matches"], second["losses"], second["winRate"]) == (1, 1, 0.0)
    assert second["winRateInterval95"] == [0.0, 0.7935]


def test_v2_records_report_agreement_and_tokens_as_na_not_zero():
    v2 = [("old.jsonl", [header(0, v3=False), decision(0, ms=10, v3=False), result("finished", 0)])]
    (config,) = se.summarize_records(v2)["configs"]
    assert config["baselineAgreement"] is None and config["inputTokens"]["median"] is None
    assert config["inputTokens"]["max"] is None and config["matchList"][0]["agreement"] is None
    assert config["wins"] == 1 and config["latencyMs"]["p50"] == 10
    assert config["config"]["promptVersion"] is None and "prompt n/a" in config["label"]
    # Mixed with a v3 record of the same configuration key, only the v3 one counts for agreement.
    mixed = v2 + [("new.jsonl", [header(0, v3=False), dict(decision(0, ms=20), agreesWithBaseline=False),
                                 result("finished", 1)])]
    (config,) = se.summarize_records(mixed)["configs"]
    assert config["baselineAgreement"] == {"decisions": 1, "agree": 0, "rate": 0.0, "meanPerMatch": 0.0,
                                           "matches": 1, "matchesWithout": 1}
    # A run of only v2 records says n/a in the CLI's table too.
    with tempfile.TemporaryDirectory() as tmp:
        run = Path(tmp) / "old-run"
        (run / "matches").mkdir(parents=True)
        (run / "matches" / "old.jsonl").write_text("".join(json.dumps(r) + "\n" for r in v2[0][1]))
        summary = se.summarize_run(run)
        assert summary["completedMatches"] == 1 and summary["plannedMatches"] is None
        assert "agreement n/a" in eval_local_strength.format_summary(summary)


async def test_cli_alternates_seats_on_the_same_seed_list():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        factory = Factory()
        args = eval_args(tmp)
        code, out, err = await run_eval(args, factory)
        assert code == 0, err
        assert len(factory.models) == 1, "both prompt versions share one model load"
        run = tmp / "strength" / "t"
        plan = json.loads((run / "plan.json").read_text())
        assert plan["seeds"] == ["st-0", "st-1"] and plan["plannedMatches"] == 8
        assert [c["promptVersion"] for c in plan["configs"]] == [V3, PROMPT_VERSION]
        names = sorted(p.name for p in (run / "matches").iterdir())
        assert names == sorted(f"{c}-st-{k}-s{s}.jsonl" for c in ("c0", "c1") for k in (0, 1) for s in (0, 1))
        firsts = {}
        for config in plan["configs"]:
            for k in (0, 1):
                for seat in (0, 1):
                    rows = se.read_record(run / "matches" / f"{config['id']}-st-{k}-s{seat}.jsonl")
                    head = rows[0]
                    assert head["seed"] == f"st-{k}" and se.subject_seat(head) == seat
                    assert [s["policy"] for s in head["seats"]] == (["mlx", "baseline"] if seat == 0
                                                                    else ["baseline", "mlx"])
                    model_seat = head["seats"][seat]
                    assert model_seat["promptVersion"] == config["promptVersion"]
                    assert model_seat["budgetMs"] == DEFAULT_DECISION_BUDGET_MS
                    assert model_seat["modelRevision"] == REVISION
                    mine = [r for r in rows if r.get("kind") == "decision" and r["seat"] == seat]
                    assert mine and all(r["rawOutput"] in ('{"choice":0}', "I attack!") for r in mine)
                    firsts[(config["promptVersion"], k, seat)] = mine[0]
        # The prompt version reaches the model: v4 adds the card reference to the same position.
        for k in (0, 1):
            for seat in (0, 1):
                assert firsts[(PROMPT_VERSION, k, seat)]["inputTokens"] > firsts[(V3, k, seat)]["inputTokens"]
        summary = json.loads((run / "summary.json").read_text())
        assert summary == json.loads(json.dumps(se.summarize_run(run)))
        assert [c["label"] for c in summary["configs"]] == [c["label"] for c in plan["configs"]]
        for config in summary["configs"]:
            assert config["matches"] == 4 and config["bySeat"]["0"]["matches"] == 2
            assert config["bySeat"]["1"]["matches"] == 2 and config["matchesTimed"] == 4
            assert config["baselineAgreement"]["decisions"] == config["decisions"] > 0
        assert summary["completedMatches"] == 8 and summary["loadSeconds"] is not None
        assert "8 to play" in err and "run t: 8/8 matches" in out
        CTX["run_root"] = CTX["scratch"] / "strength-copy"
        CTX["run_root"].mkdir()
        subprocess.run(["cp", "-r", str(run), str(CTX["run_root"] / "t")], check=True)


async def test_resume_skips_finished_matches_and_replays_a_missing_one():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        args = eval_args(tmp, prompt_version=[PROMPT_VERSION], matches=2)
        assert (await run_eval(args, Factory()))[0] == 0
        matches = tmp / "strength" / "t" / "matches"
        before = {p.name: (p.stat().st_mtime_ns, p.read_bytes()) for p in matches.iterdir()}
        assert len(before) == 2
        # Same command again: nothing to play, and the model is not even loaded.
        factory = Factory()
        code, _, err = await run_eval(args, factory)
        assert code == 0 and factory.models == [] and "2 already done, 0 to play" in err
        assert {p.name: (p.stat().st_mtime_ns, p.read_bytes()) for p in matches.iterdir()} == before
        # A missing match is replayed, and only it, with the same choices and states.
        gone = matches / "c0-st-0-s1.jsonl"
        old = se.read_record(gone)
        gone.unlink()
        factory = Factory()
        code, _, err = await run_eval(args, factory)
        assert code == 0 and len(factory.models) == 1 and "1 already done, 1 to play" in err
        new = se.read_record(gone)
        strip = lambda rows: [{k: v for k, v in r.items() if k not in ("elapsedMs",)} for r in rows]  # noqa: E731
        assert strip(new) == strip(old)
        assert (matches / "c0-st-0-s0.jsonl").stat().st_mtime_ns == before["c0-st-0-s0.jsonl"][0]
        timings = [json.loads(line) for line in (tmp / "strength" / "t" / "timings.jsonl").read_text().splitlines()]
        assert [t["kind"] for t in timings] == ["load", "match", "match", "load", "match"]
        # A different plan under the same run id is refused before anything is played.
        for changed in (dict(matches=4), dict(seed="other"), dict(budget_ms=[4000]), dict(max_turns=50)):
            try:
                await run_eval(eval_args(tmp, **{"prompt_version": [PROMPT_VERSION], "matches": 2, **changed}), Factory())
            except ValueError as exc:
                assert "different plan" in str(exc)
            else:
                raise AssertionError(f"a changed plan was accepted: {changed}")
        assert len(list(matches.iterdir())) == 2


def test_cli_validates_arguments_and_resummarises_without_playing():
    script = [sys.executable, str(REPO_ROOT / "scripts" / "eval_local_strength.py")]
    for extra, needle in ((["--run-id", "x", "--model", "m", "--matches", "3"], "even"),
                          (["--run-id", "../x", "--model", "m"], "--run-id"),
                          (["--run-id", "x"], "--model"),
                          (["--run-id", "x", "--model", "m", "--prompt-version", "local-choice-v2"], "invalid choice"),
                          (["--run-id", "x", "--model", "m", "--budget-ms", "0"], "--budget-ms")):
        done = subprocess.run(script + extra, capture_output=True, text=True, cwd=REPO_ROOT)
        assert done.returncode == 2 and needle in done.stderr, (extra, done.stderr)
    root = CTX["run_root"]
    summary_path = root / "t" / "summary.json"
    expected = summary_path.read_text()
    summary_path.unlink()
    done = subprocess.run(script + ["--run-id", "t", "--output-root", str(root), "--summarize-only"],
                          capture_output=True, text=True, cwd=REPO_ROOT)
    assert done.returncode == 0, done.stderr
    assert json.loads(summary_path.read_text()) == json.loads(expected)
    assert "run t: 8/8 matches" in done.stdout


def test_prompt_version_is_recorded_and_fingerprinted():
    assert PROMPT_VERSIONS == (V3, PROMPT_VERSION)
    with tempfile.TemporaryDirectory() as tmp:
        info3 = model_info(str(fake_model_dir(Path(tmp))), prompt_version=V3)
        info4 = model_info(str(fake_model_dir(Path(tmp))))
    assert info3["promptVersion"] == V3 and info4["promptVersion"] == PROMPT_VERSION
    assert info3["promptFingerprint"] != info4["promptFingerprint"]
    try:
        model_info("models/x", prompt_version="local-choice-v2")
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown prompt version was accepted")
    run = CTX["run_root"] / "t" / "matches"
    rows = se.read_record(run / "c1-st-0-s0.jsonl")
    assert rows[0]["seats"][0]["promptVersion"] == PROMPT_VERSION


# ---- play UI ----------------------------------------------------------------------------------

def test_ui_launches_only_through_the_allowlisted_runner():
    app, client = CTX["app"], CTX["client"]
    runner = app.state.runner
    action = runner.actions_by_id["strength-eval"]
    cmd = runner.build_cmd(action, {"--run-id": "r1", "model0": "models/fake-a", "model1": "models/fake-b",
                                    "prompt0": V3, "prompt1": PROMPT_VERSION, "--matches": 6,
                                    "--budget-ms": 4000})
    assert cmd[1] == "scripts/eval_local_strength.py"
    assert [cmd[i + 1] for i, c in enumerate(cmd) if c == "--model"] == ["models/fake-a", "models/fake-b"]
    assert [cmd[i + 1] for i, c in enumerate(cmd) if c == "--prompt-version"] == [V3, PROMPT_VERSION]
    assert cmd[cmd.index("--output-root") + 1] == str(strength_dir_for(CTX["records"]))
    assert cmd[cmd.index("--matches") + 1] == "6" and cmd[cmd.index("--budget-ms") + 1] == "4000"
    # Blank slots are left out; anything outside the choice lists is refused.
    short = runner.build_cmd(action, {"--run-id": "r2", "model0": "models/fake-a"})
    assert short.count("--model") == 1 and "--prompt-version" not in short
    for values in ({"model0": "/etc"}, {"model1": "models/../x"}, {"prompt0": "local-choice-v2"},
                   {"--output-root": "/tmp/x", "model0": "/tmp/x"}):
        response = client.post("/api/run/strength-eval", json={"values": values})
        assert response.status_code == 400, (values, response.text)
    built = runner.build_cmd(action, {"--output-root": "/tmp/elsewhere"})
    assert built[built.index("--output-root") + 1] == str(strength_dir_for(CTX["records"]))
    # The job runs the real CLI; it refuses before playing: off Apple Silicon, or (on a Mac) because
    # models/fake-a is not a downloaded model.
    started = client.post("/api/run/strength-eval", json={"values": {"--run-id": "ui", "model0": "models/fake-a"}})
    assert started.status_code == 200, started.text
    job = started.json()["job"]
    assert client.post("/api/run/local-matches", json={"values": {}}).status_code == 409
    deadline = time.monotonic() + 60
    while (view := client.get(f"/api/job/{job}").json())["status"] == "running":
        assert time.monotonic() < deadline, "strength job did not finish"
        time.sleep(0.2)
    assert "eval_local_strength.py" in view["cmd"] and "--model models/fake-a" in view["cmd"]
    assert view["returncode"] == 2 and any("Apple Silicon" in line or "downloaded local directory" in line
                                           for line in view["lines"]), view["lines"][-5:]


def test_ui_lists_runs_and_serves_summaries_and_records():
    client = CTX["client"]
    root = strength_dir_for(CTX["records"])
    subprocess.run(["cp", "-r", str(CTX["run_root"] / "t"), str(root / "t")], check=True)
    body = client.get("/api/strength").json()
    assert body["dir"] == str(root) and body["action"] == "strength-eval"
    assert body["models"] == ["models/fake-a", "models/fake-b"] and body["promptVersions"] == list(PROMPT_VERSIONS)
    (listed,) = [r for r in body["runs"] if r["runId"] == "t"]
    assert listed["completedMatches"] == 8 and listed["plannedMatches"] == 8 and listed["matchesPerConfig"] == 4
    summary = client.get("/api/strength/t").json()
    assert summary == json.loads(json.dumps(se.summarize_run(root / "t")))
    name = summary["configs"][0]["matchList"][0]["name"]
    record = client.get(f"/api/strength/t/records/{name}")
    assert record.status_code == 200
    assert record.json()["rows"] == se.read_record(root / "t" / "matches" / name)
    assert record.json()["summary"]["schemaVersion"] == 3 and record.json()["summary"]["agreement"]
    for path, code in (("/api/strength/missing", 404), ("/api/strength/.hidden", 400),
                       ("/api/strength/..%2Fmatches", 404), ("/api/strength/t/records/x.txt", 400),
                       ("/api/strength/t/records/missing.jsonl", 404),
                       ("/api/strength/t/records/..%2Fplan.json", 404),
                       ("/api/strength/nope/records/a.jsonl", 404)):
        assert client.get(path).status_code == code, path


def test_page_has_the_strength_tab_and_its_script_parses():
    for needle in ('data-tab="strength"', 'id="tStart"', 'id="tRuns"', 'id="tCompare"', "renderStrength",
                   "/api/strength", "openStrengthRecord", "winRateInterval95", "baselineAgreement"):
        assert needle in PLAY_HTML, needle
    (block,) = re.findall(r"<script>(.*?)</script>", PLAY_HTML, re.S)
    proc = subprocess.run([CTX["node"], "-e", "new Function(require('fs').readFileSync(0, 'utf8'))"],
                          input=block, capture_output=True, text=True)
    assert proc.returncode == 0, f"play page script does not parse:\n{proc.stderr[:600]}"


async def run_tests(node):
    CTX["node"] = node
    CTX["setup"] = load_default_setup(REPO_ROOT, node=node)
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    with tempfile.TemporaryDirectory() as tmp:
        CTX["records"] = Path(tmp) / "matches"
        CTX["records"].mkdir()
        strength_dir_for(CTX["records"]).mkdir()
        CTX["scratch"] = Path(tmp) / "scratch"
        CTX["scratch"].mkdir()
        CTX["app"] = build_play_app(CTX["records"], node=node, setup_loader=lambda: CTX["setup"],
                                    strength_models=["models/fake-a", "models/fake-b"])
        with TestClient(CTX["app"]) as client:
            CTX["client"] = client
            for test in tests:
                outcome = test()
                if asyncio.iscoroutine(outcome):
                    await outcome
                print(f"OK  {test.__name__}")
    print(f"PASS strength eval: {len(tests)}/{len(tests)}")


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
