#!/usr/bin/env python3
"""Tests for the match record auditor (games/cyberpunk/match_audit.py, scripts/audit_match_records.py).

Why: the auditor is what lets a match record count as evidence, so it must pass
an honest record and catch each way a record can lie. Every record here is
played on the real engine worker (baseline seats, and one seat of the real
MLXPolicy against test_local_match.py's fake MLX worker subprocess, which
answers with valid choices, invalid text and prompt-too-large errors). Each
tamper changes exactly the field it names, keeps everything else consistent
(counters in the result row included, where the tamper would otherwise show
there first), and the test checks the auditor names that problem at that
decision and nothing else:

* a changed actionId: one the engine does NOT offer at that point (checked
  against the engine here, independently of the auditor), and one it does
  offer but was not played (caught by the replayed state hash);
* a changed stateHash: a real engine hash from another decision; the replay
  continues from the engine's state, so it is reported once; likewise the
  initial and final state hashes and a forged status;
* a forged engine identity: reported stale and not replayed at all;
* a fallback recorded as a model choice (reason and error relabelled, result
  counters fixed): caught because the model's raw output does not name the
  played action, and only for that reason; and selection labels that do not
  fit the seat (a "human" row on a baseline seat, a fallback without its
  failure code, a model choice with one).

The CLI's per-record lines, totals and exit status, and the play UI's Audit
view (/api/audit, through FastAPI's TestClient) are checked on the same
records. No model, network or listening socket is used. Needs node, installed
npm dependencies, fastapi and httpx.
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import contextlib
import copy
import hashlib
import io
import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from fastapi.testclient import TestClient

import audit_match_records
import test_local_match as tlm
from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import load_default_setup, play_match, write_match_record
from games.cyberpunk.match_audit import audit_rows, running_engine
from games.cyberpunk.play_app import PLAY_HTML, build_play_app
from games.cyberpunk.policy_bot import PolicyRunner, baseline_action_id
from harness.core.io import read_jsonl

CTX: dict = {}


def audit(rows, name="record"):
    return audit_rows(CTX["engine"], CTX["setup"], rows, CTX["running"], name)


def problems(report):
    return [(p["code"], p["index"]) for p in report["problems"]]


def write(name, rows):
    return write_match_record(CTX["dir"] / name, rows, force=True)


def offered_at(rows, k):
    """The engine's offered actions at decision k, replaying the record's own actions (not the auditor)."""
    setup = CTX["setup"].for_seed(rows[0]["seed"])
    worker = CTX["engine"]
    state = worker.create_game(content=setup.content, initialization=setup.initialization)["state"]
    for row in rows[1:k + 1]:
        state = worker.apply_action(content=setup.content, state=state, actor_id=row["playerId"],
                                    action_id=row["actionId"])["state"]
    actor = state["timing"]["actingPlayer"]
    return worker.model_input(content=setup.content, state=state, actor_id=actor)["legalActions"]


def fix_counters(rows):
    """Make the result row's counters agree with the (tampered) decision rows."""
    decisions = [r for r in rows if r["kind"] == "decision"]
    rows[-1]["selections"] = dict(sorted(collections.Counter(r["reason"] for r in decisions).items()))
    rows[-1]["errors"] = dict(sorted(collections.Counter(r["error"] for r in decisions if r["error"]).items()))


async def test_a_full_baseline_game_audits_clean():
    rows = await play_match(CTX["engine"], CTX["setup"].for_seed("audit-full"), [PolicyRunner(), PolicyRunner()],
                            policy_names=["baseline", "baseline"])
    assert rows[-1]["status"] == "finished", rows[-1]
    report = audit(rows, "audit-full.jsonl")
    n = len(rows) - 2
    assert report["verdict"] == "clean" and report["problems"] == [], report["problems"]
    assert report["replayed"] == report["decisions"] == n and report["status"] == "finished"
    assert report["engine"] == CTX["running"]
    seats = report["seats"]
    assert sum(s["decisions"] for s in seats.values()) == n
    for key, seat in seats.items():
        mine = [r for r in rows[1:-1] if str(r["seat"]) == key]
        assert seat["reasons"] == {"baseline": len(mine)} and seat["errors"] == {}
        assert seat["modelChoices"] == seat["fallbacks"] == 0 and seat["agree"] == len(mine)
    CTX["full"] = rows


async def test_a_short_baseline_game_audits_clean():
    rows = await play_match(CTX["engine"], CTX["setup"].for_seed("audit-short"), [PolicyRunner(), PolicyRunner()],
                            policy_names=["baseline", "baseline"], max_decisions=20)
    assert rows[-1]["status"] == "decision_cap" and len(rows) == 22
    report = audit(rows)
    assert report["verdict"] == "clean" and report["replayed"] == 20, report["problems"]
    CTX["short"] = rows
    write("short.jsonl", rows)


async def test_a_model_seat_record_audits_clean_and_counts_fallbacks():
    with tempfile.TemporaryDirectory() as tmp:
        args = tlm.run_args(Path(tmp), seed="audit-model", output_dir=Path(tmp) / "matches", max_decisions=40)
        assert await tlm.run_cli(args, tlm.fake_worker()) == 0
        rows = read_jsonl(Path(tmp) / "matches" / "audit-model-0.jsonl", missing_ok=False)
    assert rows[0]["seats"][1]["modelPath"], "the model seat must name its model for the raw-output check"
    report = audit(rows)
    assert report["verdict"] == "clean", report["problems"]
    model = [r for r in rows[1:-1] if r["seat"] == 1]
    seat = report["seats"]["1"]
    assert seat["policy"] == "mlx" and seat["decisions"] == len(model)
    assert seat["modelChoices"] == sum(r["reason"] == "policy" for r in model) > 0
    assert seat["fallbacks"] == sum(r["reason"].endswith("_fallback") for r in model) > 0
    assert seat["reasons"] == dict(collections.Counter(r["reason"] for r in model))
    assert seat["errors"] == dict(collections.Counter(r["error"] for r in model if r["error"]))
    assert {"invalid_output", "prompt_too_large"} <= set(seat["errors"]), seat["errors"]
    assert seat["agree"] == sum(r["agreesWithBaseline"] for r in model)
    CTX["model"] = rows
    write("model.jsonl", rows)


def test_an_action_id_the_engine_did_not_offer_is_caught():
    rows = copy.deepcopy(CTX["short"])
    k = next(i for i, r in enumerate(rows[1:-1]) if i > 2 and r["offered"] > 1)
    offered = {a["actionId"] for a in offered_at(rows, k)}
    assert rows[k + 1]["actionId"] in offered and len(offered) == rows[k + 1]["offered"]
    # A real engine actionId from elsewhere in the record, checked here to be NOT offered at k.
    forged = next(r["actionId"] for r in rows[1:-1] if r["actionId"] not in offered)
    rows[k + 1]["actionId"] = forged
    report = audit(rows)
    assert problems(report) == [("action_not_offered", k)], report["problems"]
    assert report["verdict"] == "mismatch" and report["replayed"] == k
    CTX["not_offered"] = rows


def test_a_different_offered_action_is_caught_by_the_replayed_hash():
    rows = copy.deepcopy(CTX["short"])
    k = next(i for i, r in enumerate(rows[1:-1]) if i > 2 and r["offered"] > 1)
    actions = offered_at(rows, k)
    row = rows[k + 1]
    other = next(i for i, a in enumerate(actions) if a["actionId"] != row["actionId"])
    # Rewrite the row as if `other` had been played, every derived field consistent except the hash.
    row.update(actionId=actions[other]["actionId"], chosenIndex=other, label=actions[other]["descriptor"]["label"],
               agreesWithBaseline=actions[other]["actionId"] == row["baselineActionId"])
    assert row["actionId"] != CTX["short"][k + 1]["actionId"]
    report = audit(rows)
    found = problems(report)
    assert found[0] == ("state_hash_mismatch", k), report["problems"]
    assert all(index is None or index >= k for _, index in found)
    # A baseline seat playing a non-baseline action is also named, at the same decision.
    assert ("baseline_not_baseline_pick", k) in found


def test_a_changed_state_hash_is_caught_once():
    rows = copy.deepcopy(CTX["short"])
    k = 7
    forged = rows[k + 3]["stateHash"]  # a real engine hash, of another decision
    assert forged != rows[k + 1]["stateHash"]
    rows[k + 1]["stateHash"] = forged
    report = audit(rows)
    assert problems(report) == [("state_hash_mismatch", k)], report["problems"]
    assert report["replayed"] == 20, "replay must continue from the engine's state, not the recorded hash"
    CTX["bad_hash"] = rows


def test_changed_initial_and_final_hashes_and_a_forged_status_are_caught():
    rows = copy.deepcopy(CTX["short"])
    rows[0]["initialStateHash"] = rows[1]["stateHash"]
    assert problems(audit(rows)) == [("initial_state_hash", None)]
    rows = copy.deepcopy(CTX["short"])
    rows[-1]["finalStateHash"] = rows[-3]["stateHash"]  # the decision before last
    assert rows[-1]["finalStateHash"] != CTX["short"][-1]["finalStateHash"]
    report = audit(rows)
    assert problems(report) == [("result_mismatch", None)] and "finalStateHash" in report["problems"][0]["detail"]
    rows = copy.deepcopy(CTX["short"])
    rows[-1]["status"] = "finished"  # the engine has no outcome after 20 decisions
    assert problems(audit(rows)) == [("status_mismatch", None)]


def test_a_forged_engine_identity_is_stale_and_not_replayed():
    for field in ("artifactHash", "version"):
        rows = copy.deepcopy(CTX["short"])
        value = rows[0]["engine"][field]
        rows[0]["engine"][field] = (hashlib.sha256(value.encode()).hexdigest() if field == "artifactHash"
                                    else value + "-forged")
        assert rows[0]["engine"] != CTX["running"]
        report = audit(rows)
        assert report["verdict"] == "stale" and problems(report) == [("stale_engine", None)], report["problems"]
        assert report["replayed"] == 0 and report["seats"] == {}
    CTX["stale"] = rows


def test_a_fallback_recorded_as_a_model_choice_is_caught():
    for error in ("invalid_output", "prompt_too_large"):
        rows = copy.deepcopy(CTX["model"])
        row = next(r for r in rows[1:-1] if r["error"] == error)
        assert row["reason"] == "policy_error_fallback" and row["actionId"] == row["baselineActionId"]
        row["reason"], row["error"] = "policy", None
        fix_counters(rows)
        report = audit(rows)
        assert problems(report) == [("model_choice_unsupported", row["index"])], report["problems"]
        assert report["seats"]["1"]["modelChoices"] == sum(r["reason"] == "policy" for r in rows[1:-1] if r["seat"] == 1)
        if error == "invalid_output":
            CTX["relabelled"] = rows
    # The check is the raw output: a forged answer naming the played index passes (consistency, not authenticity).
    rows = copy.deepcopy(CTX["relabelled"])
    row = next(r for r in rows[1:-1] if r["reason"] == "policy" and r["rawOutput"] == "I attack!")
    row["rawOutput"] = json.dumps({"choice": row["chosenIndex"]})
    assert audit(rows)["verdict"] == "clean"
    # ...while a valid answer naming ANOTHER offered index is still not the played action.
    row["rawOutput"] = json.dumps({"choice": (row["chosenIndex"] + 1) % row["offered"]})
    assert row["offered"] > 1
    assert problems(audit(rows)) == [("model_choice_unsupported", row["index"])]


def test_selection_labels_that_do_not_fit_the_seat_are_caught():
    rows = copy.deepcopy(CTX["short"])
    rows[5]["reason"] = "human"  # a baseline seat's row claiming a human chose
    fix_counters(rows)
    assert problems(audit(rows)) == [("reason_not_for_policy", 4)]
    rows = copy.deepcopy(CTX["model"])
    row = next(r for r in rows[1:-1] if r["error"] == "prompt_too_large")
    row["error"] = None  # a fallback with its failure code dropped
    fix_counters(rows)
    assert problems(audit(rows)) == [("fallback_without_error", row["index"])]
    rows = copy.deepcopy(CTX["model"])
    row = next(r for r in rows[1:-1] if r["reason"] == "policy")
    row["error"] = "timeout"  # a model choice carrying a failure code
    fix_counters(rows)
    assert problems(audit(rows)) == [("error_without_fallback", row["index"])]


def test_the_cli_reports_each_record_and_the_total_and_exits_nonzero():
    write("not-offered.jsonl", CTX["not_offered"])
    write("stale.jsonl", CTX["stale"])
    (CTX["dir"] / "broken.jsonl").write_text("not json\n", encoding="utf-8")

    def cli(*argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit_match_records.main([*argv, "--node", CTX["node"]])
        return code, out.getvalue().splitlines()

    code, lines = cli(str(CTX["dir"] / "short.jsonl"))
    assert code == 0 and lines[0].startswith("CLEAN     short.jsonl: 20/20 decisions replayed"), lines
    assert lines[-1] == "audited 1 records: 1 clean, 0 stale, 0 mismatch, 0 unreadable; 20/20 decisions replayed"
    code, lines = cli(str(CTX["dir"]))
    assert code == 1
    verdicts = {line.split()[1].rstrip(":"): line.split()[0] for line in lines if line[:1].isupper()
                and line.split()[0] in ("CLEAN", "STALE", "MISMATCH", "UNREADABLE")}
    assert verdicts == {"broken.jsonl": "UNREADABLE", "model.jsonl": "CLEAN", "not-offered.jsonl": "MISMATCH",
                        "short.jsonl": "CLEAN", "stale.jsonl": "STALE"}, verdicts
    assert any("action_not_offered at decision" in line for line in lines)
    assert any(line.startswith("policy mlx: ") and "model choices" in line and "prompt_too_large" in line
               for line in lines), lines
    assert lines[-1].startswith("audited 5 records: 2 clean, 1 stale, 1 mismatch, 1 unreadable;"), lines[-1]
    code, lines = cli(str(CTX["dir"] / "stale.jsonl"), "--json")
    report = json.loads("\n".join(lines))
    assert code == 1 and report["records"][0]["verdict"] == "stale" and report["totals"]["ok"] is False


def test_the_play_ui_audit_view_lists_and_audits_records():
    for needle in ('data-tab="audit"', 'id="aSelected"', 'id="aAll"', "/api/audit", "renderAudit", "modelChoices"):
        assert needle in PLAY_HTML, needle
    write("bad-hash.jsonl", CTX["bad_hash"])
    app = build_play_app(CTX["dir"], node=CTX["node"], setup_loader=lambda: CTX["setup"])
    with TestClient(app) as client:
        assert 'data-tab="audit"' in client.get("/").text
        listing = {r["name"]: r for r in client.get("/api/records").json()["records"]}
        assert listing["short.jsonl"]["engine"] == CTX["running"]["version"]
        body = client.post("/api/audit", json={"names": ["short.jsonl", "bad-hash.jsonl", "stale.jsonl"]}).json()
        verdicts = {r["name"]: r["verdict"] for r in body["records"]}
        assert verdicts == {"short.jsonl": "clean", "bad-hash.jsonl": "mismatch", "stale.jsonl": "stale"}
        bad = next(r for r in body["records"] if r["name"] == "bad-hash.jsonl")
        assert problems(bad) == [("state_hash_mismatch", 7)]
        assert body["totals"]["ok"] is False and body["engine"] == CTX["running"]
        assert body["totals"]["policies"]["baseline"]["decisions"] == 40
        for payload, status in (({"names": "short.jsonl"}, 400), ({"names": ["../short.jsonl"]}, 400),
                                ({"names": []}, 400), ({"names": ["short.jsonl", "short.jsonl"]}, 400),
                                ({"names": ["missing.jsonl"]}, 404), ({"setup": "/no/such.json"}, 400)):
            response = client.post("/api/audit", json=payload)
            assert response.status_code == status, (payload, response.text)
        assert client.post("/api/audit", content="[]", headers={"content-type": "application/json"}).status_code == 400
        everything = client.post("/api/audit", json={}).json()
        assert everything["totals"]["records"] == len(list(CTX["dir"].glob("*.jsonl")))


async def run(node):
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["node"] = node
    CTX["setup"] = load_default_setup(REPO_ROOT, node=node)
    CTX["running"] = running_engine(REPO_ROOT, node)
    assert CTX["setup"].engine == CTX["running"], "the Demo setup must pin the running engine"
    tlm.CTX.update(node=node, setup=CTX["setup"])
    with tempfile.TemporaryDirectory() as tmp, EngineWorker(REPO_ROOT, node=node) as engine:
        CTX["dir"], CTX["engine"] = Path(tmp) / "matches", engine
        CTX["dir"].mkdir()
        for test in tests:
            result = test()
            if asyncio.iscoroutine(result):
                await result
            print(f"OK  {test.__name__}")
    print(f"PASS match record audit: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    asyncio.run(run(args.node))


if __name__ == "__main__":
    main()
