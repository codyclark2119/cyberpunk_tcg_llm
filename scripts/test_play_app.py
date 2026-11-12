#!/usr/bin/env python3
"""Tests for the local play UI (games/cyberpunk/play_app.py) against the real engine worker.

Why: the play page is the one place a person sees a live game, so it must show
only the human seat's public engine view, accept only an engine-offered
actionId, let the bot move through the policy layer, write the same match
record as the bot-vs-bot runner, list and serve those records, run bot-vs-bot
jobs only through the allowlisted runner, and ship a page whose inline script
actually parses. Its "Prompt size" tab must run the same measurement as
scripts/measure_prompt_size.py and show the current prompt's sizes and its
largest rendered prompt. Records are schemaVersion 3 (docs/local-match-records-v3.md),
human rows included, and a schemaVersion 2 record still opens in the viewer.
The engine and the Demo decks are real; the bot is the
deterministic baseline. No model, network or listening socket is used:
FastAPI's TestClient (fastapi and httpx) calls the app in process. Needs node
and installed npm dependencies.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from games.cyberpunk.local_match import SEAT_MODEL_FIELDS, load_default_setup
from games.cyberpunk.play_app import (HUMAN_REASON, PLAY_HTML, build_play_app, is_loopback, mlx_available,
                                      training_dir_for)
from games.cyberpunk.policy_bot import DEFAULT_DECISION_BUDGET_MS, baseline_action_id
from games.cyberpunk.policy_prompt import PROMPT_VERSION, SYSTEM_PROMPT
from games.cyberpunk.prompt_size import baseline_games, largest_prompt, report

FORBIDDEN_KEYS = ("actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId", "rng",
                  "objects", "turnHistory", "zones")
CTX: dict = {}
NO_MODEL = {key: None for key in SEAT_MODEL_FIELDS}
DECISION_KEYS = {"kind", "index", "turn", "step", "seat", "playerId", "policy", "offered", "actionId",
                 "chosenIndex", "label", "baselineActionId", "baselineIndex", "agreesWithBaseline", "reason",
                 "error", "workerEvent", "elapsedMs", "rawOutput", "inputTokens", "outputTokens", "stateHash"}
V3_ONLY = {"chosenIndex", "baselineActionId", "baselineIndex", "agreesWithBaseline", "rawOutput",
           "inputTokens", "outputTokens"}


def client() -> TestClient:
    return CTX["client"]


def start(seed, seat=0, **extra):
    response = client().post("/api/play", json={"seat": seat, "policy": "baseline", "seed": seed, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def session(view):
    return CTX["app"].state.play.sessions[view["id"]]


def test_page_is_the_play_ui_and_self_contained():
    response = client().get("/")
    assert response.status_code == 200 and "Cyberpunk TCG local play" in response.text
    assert "Play a bot" in response.text and "Match records" in response.text
    # No CDN or remote asset: the page must work offline.
    assert not re.search(r"""(src|href)\s*=\s*["']?(https?:)?//""", PLAY_HTML)
    assert "<script src" not in PLAY_HTML and "@import" not in PLAY_HTML
    # Bot settings carry the decision budget; the viewer shows each fallback's failure code.
    assert 'id="pBudget"' in PLAY_HTML and 'id="bBudget"' in PLAY_HTML
    assert 'kv("Error", d.error)' in PLAY_HTML and '"Reason", "Error", "ms"' in PLAY_HTML
    # v3 viewer fields and the training option of the bot-vs-bot launcher.
    for needle in ('kv("Chosen index", d.chosenIndex)', 'kv("Baseline index", d.baselineIndex)',
                   'kv("Agrees with baseline"', 'kv("Raw output", d.rawOutput)', "agreementText(REC.summary.agreement)",
                   "s.modelRevision", 'id="bTraining"', "CONFIG.trainingDir"):
        assert needle in PLAY_HTML, needle


def test_page_javascript_actually_parses():
    blocks = re.findall(r"<script>(.*?)</script>", PLAY_HTML, re.S)
    assert len(blocks) == 1, "the play page lost its script block"
    for lineno, line in enumerate(blocks[0].splitlines(), 1):
        assert not line.strip().startswith("#"), f"script line {lineno} starts with '#'"
    proc = subprocess.run([CTX["node"], "-e", "new Function(require('fs').readFileSync(0, 'utf8'))"],
                          input=blocks[0], capture_output=True, text=True)
    assert proc.returncode == 0, f"play page script does not parse:\n{proc.stderr[:600]}"


def test_config_and_bad_requests_are_refused():
    config = client().get("/api/play/config").json()
    assert config["policies"] == (["baseline", "mlx"] if mlx_available() else ["baseline"])
    assert config["botAction"] == "local-matches" and config["live"] == []
    assert config["budgetMs"] == DEFAULT_DECISION_BUDGET_MS
    assert config["trainingDir"] == str(CTX["records"].parent / "training")
    bad = [{"seat": 2}, {"seat": True}, {"seed": "../escape"}, {"seed": "a b"}, {"policy": "remote"},
           {"maxTurns": -1}, {"maxDecisions": "9"}, {"setup": "/no/such/file.json"}, {"setup": "README.md"},
           {"budgetMs": 0}, {"budgetMs": "1000"}, {"budgetMs": 1.5}, {"budgetMs": 600_001}]
    if not mlx_available():
        bad.append({"policy": "mlx"})
    for payload in bad:
        response = client().post("/api/play", json={"seed": "refused", **payload})
        assert response.status_code == 400, (payload, response.text)
    assert client().post("/api/play", content="[]", headers={"content-type": "application/json"}).status_code == 400
    assert client().get("/api/play/nope").status_code == 404
    assert client().post("/api/play/nope/action", json={"actionId": "x"}).status_code == 404
    assert not CTX["app"].state.play.sessions, "a refused request left a session behind"


def test_start_lets_the_bot_move_until_the_human_decides():
    for seat in (0, 1):
        view = start(f"play-start-{seat}", seat=seat, **({"budgetMs": 2500} if seat else {}))
        assert view["botBudgetMs"] == (2500 if seat else DEFAULT_DECISION_BUDGET_MS)
        assert view["status"] == "live" and view["humanSeat"] == seat and view["yourTurn"], view["status"]
        assert view["observation"]["viewerSeat"] == seat and view["observation"]["actingSeat"] == seat
        assert view["actions"] and all(a["actionId"] and a["label"] for a in view["actions"])
        CTX[f"view{seat}"] = view
    assert sorted(client().get("/api/play/config").json()["live"]) == sorted(
        [CTX["view0"]["id"], CTX["view1"]["id"]])


def test_a_non_offered_action_id_is_refused_and_changes_nothing():
    view = CTX["view1"]
    before = session(view).state_hash
    for action_id in ("0" * 64, None, 7, view["actions"][0]["actionId"][:-1] + "x"):
        response = client().post(f"/api/play/{view['id']}/action", json={"actionId": action_id})
        assert response.status_code == 400, (action_id, response.text)
    after = client().get(f"/api/play/{view['id']}").json()
    assert session(view).state_hash == before and after["actions"] == view["actions"]
    assert after["log"] == view["log"]


def test_human_moves_are_applied_and_the_bot_answers():
    view = CTX["view1"]
    for _ in range(12):
        if view["status"] != "live":
            break
        offered = {a["actionId"] for a in view["actions"]}
        choice = view["actions"][-1]["actionId"]
        response = client().post(f"/api/play/{view['id']}/action", json={"actionId": choice})
        assert response.status_code == 200, response.text
        view = response.json()
        assert choice in offered
    mine = [d for d in view["log"] if d["mine"]]
    bot = [d for d in view["log"] if not d["mine"]]
    assert len(mine) >= 12 and bot, "the bot never moved"
    assert all(d["label"] for d in mine)
    # The bot's choices stay private during the match: no label, no timing.
    assert all(d["label"] is None and d["elapsedMs"] is None for d in bot)
    rows = session(view).rows
    assert all(r["reason"] == HUMAN_REASON and r["policy"] == "human" for r in rows[1:] if r["seat"] == 1)
    # Human rows carry the same index and baseline fields as bot rows.
    human = [r for r in rows[1:] if r["seat"] == 1]
    assert all(set(r) == DECISION_KEYS for r in rows[1:])
    assert all(r["chosenIndex"] == r["offered"] - 1 and r["rawOutput"] is None for r in human)
    assert all(r["agreesWithBaseline"] is (r["actionId"] == r["baselineActionId"]) for r in rows[1:])
    assert all(r["agreesWithBaseline"] for r in rows[1:] if r["seat"] == 0)
    assert all(r["reason"] == "baseline" for r in rows[1:] if r["seat"] == 0)
    CTX["view1"] = view


def test_human_view_holds_no_opponent_hidden_information():
    view = client().get(f"/api/play/{CTX['view1']['id']}").json()
    text = json.dumps(view)
    for key in (*FORBIDDEN_KEYS, "state", "events", "stateHash"):
        assert f'"{key}"' not in text, key
    state = session(view).state
    me = next(p for p in state["players"].values() if p["seat"] == 1)
    them = next(p for p in state["players"].values() if p["seat"] == 0)
    hidden = them["zones"]["HAND"] + them["zones"]["DECK"]
    assert them["zones"]["HAND"], "opponent has no hand; the check would be empty"
    for instance in hidden:
        assert f'"{instance}"' not in text, f"opponent hidden card {instance} leaked into the human view"
    assert any(f'"{instance}"' in text for instance in me["zones"]["HAND"]), "own hand missing from view"
    opponent = next(p for p in view["observation"]["players"] if p["seat"] == 0)
    assert opponent["counts"]["HAND"] == len(them["zones"]["HAND"])
    assert not [c for c in opponent["cards"] if c["zone"] in ("HAND", "DECK")]
    assert all("content" not in c for c in opponent["cards"] if c["face"] == "DOWN")
    assert set(view["cards"]) <= {c["content"]["cardId"] for p in view["observation"]["players"]
                                  for c in p["cards"] if "content" in c}


def test_abandon_writes_the_record_and_closes_the_worker():
    view = CTX["view1"]
    worker = session(view).worker
    result = client().post(f"/api/play/{view['id']}/abandon").json()
    assert result["status"] == "abandoned" and result["record"] == "play-start-1.jsonl" and not result["actions"]
    assert worker._process.poll() is not None, "engine worker left running after abandon"
    assert client().post(f"/api/play/{view['id']}/action",
                         json={"actionId": view["actions"][0]["actionId"]}).status_code == 409
    rows = [json.loads(line) for line in (CTX["records"] / "play-start-1.jsonl").read_text().splitlines()]
    header, decisions, final = rows[0], rows[1:-1], rows[-1]
    assert header["kind"] == "match" and header["seed"] == "play-start-1"
    # Neither seat runs a timed policy (baseline bot, human), so no budget applies.
    assert header["schemaVersion"] == 3
    assert header["seats"] == [{"seat": 0, "policy": "baseline", "budgetMs": None, **NO_MODEL},
                               {"seat": 1, "policy": "human", "budgetMs": None, **NO_MODEL}]
    assert header["budgetMs"] is None
    assert final["kind"] == "result" and final["status"] == "abandoned" and final["decisions"] == len(decisions)
    assert all(set(r) == DECISION_KEYS for r in decisions)
    for seat in ("0", "1"):
        mine = [r for r in decisions if str(r["seat"]) == seat]
        assert final["baselineAgreement"][seat]["decisions"] == len(mine)
        assert final["baselineAgreement"][seat]["agree"] == sum(r["agreesWithBaseline"] for r in mine)
    assert all(r["error"] is None for r in decisions) and final["errors"] == {}
    assert [r["index"] for r in decisions] == list(range(len(decisions)))
    assert final["selections"]["human"] == sum(1 for r in decisions if r["seat"] == 1)
    assert final["finalStateHash"] == decisions[-1]["stateHash"]
    text = "\n".join(map(json.dumps, rows))
    for key in (*FORBIDDEN_KEYS, "state", "events", "hand"):
        assert f'"{key}"' not in text, key
    # The same seed cannot overwrite that record.
    assert client().post("/api/play", json={"seed": "play-start-1"}).status_code == 409


def test_a_full_human_game_finishes_through_the_engine():
    view = CTX["view0"]
    while view["status"] == "live":
        choice = baseline_action_id(tuple(view["actions"]))
        view = client().post(f"/api/play/{view['id']}/action", json={"actionId": choice}).json()
    assert view["status"] == "finished", (view["status"], view["detail"])
    assert view["result"]["winnerSeat"] in (0, 1) and view["result"]["reason"]
    assert view["record"] == "play-start-0.jsonl" and not view["actions"]
    assert session(view).worker._process.poll() is not None


def test_viewer_lists_and_serves_records():
    listing = client().get("/api/records").json()
    by_name = {r["name"]: r for r in listing["records"]}
    assert by_name["play-start-0.jsonl"]["status"] == "finished"
    assert by_name["play-start-1.jsonl"]["status"] == "abandoned"
    assert by_name["play-start-1.jsonl"]["policies"] == ["baseline", "human"]
    (CTX["records"] / "broken.jsonl").write_text("not json\n")
    assert "error" in {r["name"]: r for r in client().get("/api/records").json()["records"]}["broken.jsonl"]
    served = client().get("/api/records/play-start-0.jsonl").json()
    rows = served["rows"]
    assert rows[0]["kind"] == "match" and rows[-1]["kind"] == "result"
    # v3: the viewer's per-seat agreement, also on the listing.
    agreement = served["summary"]["agreement"]
    assert served["summary"]["schemaVersion"] == 3 and agreement == rows[-1]["baselineAgreement"]
    assert agreement["0"]["policy"] == "human" and agreement["1"]["policy"] == "baseline"
    assert agreement["1"]["rate"] == 1.0  # the baseline bot always agrees with itself
    assert by_name["play-start-0.jsonl"]["agreement"] == agreement
    assert by_name["play-start-0.jsonl"]["schemaVersion"] == 3
    # A schemaVersion 2 record (as written before this change) still lists and opens.
    v2 = [dict(rows[0], schemaVersion=2, seats=[{k: s[k] for k in ("seat", "policy", "budgetMs")}
                                                 for s in rows[0]["seats"]])]
    v2 += [{k: v for k, v in r.items() if k not in V3_ONLY} for r in rows[1:-1]]
    v2.append({k: v for k, v in rows[-1].items() if k != "baselineAgreement"})
    (CTX["records"] / "old-v2.jsonl").write_text("".join(json.dumps(r) + "\n" for r in v2))
    old = {r["name"]: r for r in client().get("/api/records").json()["records"]}["old-v2.jsonl"]
    assert "error" not in old and old["status"] == "finished" and old["schemaVersion"] == 2
    assert old["agreement"] is None and old["decisions"] == len(v2) - 2
    served = client().get("/api/records/old-v2.jsonl")
    assert served.status_code == 200 and served.json()["rows"] == v2
    assert served.json()["summary"] == {"schemaVersion": 2, "agreement": None}
    for name, code in (("..%2Fsecret.jsonl", 404), ("x.txt", 400), (".hidden.jsonl", 400),
                       ("missing.jsonl", 404), ("broken.jsonl", 422)):
        assert client().get(f"/api/records/{name}").status_code == code, name


def test_bot_vs_bot_runs_only_through_the_allowlisted_runner():
    actions = client().get("/api/actions").json()
    listed = {a["id"]: a for group in actions["groups"].values() for a in group}
    # The bot-vs-bot job and the strength eval (scripts/test_strength_eval.py) are the only actions.
    assert set(listed) == {"local-matches", "strength-eval"}
    assert all("cmd" not in a for a in listed.values())
    runner = CTX["app"].state.runner
    cmd = runner.build_cmd(runner.actions_by_id["local-matches"],
                           {"--matches": 2, "--seed": "s", "seat0": "baseline", "seat1": "mlx", "--force": True,
                            "--budget-ms": 4000})
    assert cmd[cmd.index("--budget-ms") + 1] == "4000"
    assert cmd[1] == "scripts/run_local_matches.py"
    assert cmd[cmd.index("--policy"):cmd.index("--policy") + 3] == ["--policy", "baseline", "mlx"]
    assert cmd[cmd.index("--output-dir") + 1] == str(CTX["records"]) and "--force" in cmd
    # Training logging is off unless asked for, and then only into the one fixed directory.
    assert "--training-dir" not in cmd
    training = str(training_dir_for(CTX["records"]))
    on = runner.build_cmd(runner.actions_by_id["local-matches"], {"--training-dir": training})
    assert on[on.index("--training-dir") + 1] == training
    assert client().post("/api/run/local-matches",
                         json={"values": {"--training-dir": "/tmp/elsewhere"}}).status_code == 400
    assert client().post("/api/run/local-matches",
                         json={"values": {"seat0": "rm -rf"}}).status_code == 400
    assert client().post("/api/run/anything-else", json={}).status_code == 400
    started = client().post("/api/run/local-matches", json={"values": {
        "--matches": 1, "--seed": "bots", "--max-decisions": 12, "--budget-ms": 4000,
        "--training-dir": training}})
    assert started.status_code == 200, started.text
    job = started.json()["job"]
    assert client().post("/api/run/local-matches", json={"values": {}}).status_code == 409
    deadline = time.monotonic() + 120
    while (view := client().get(f"/api/job/{job}").json())["status"] == "running":
        assert time.monotonic() < deadline, "bot-vs-bot job did not finish"
        time.sleep(0.25)
    assert view["status"] == "done" and view["returncode"] == 0, view["lines"][-10:]
    record = {r["name"]: r for r in client().get("/api/records").json()["records"]}["bots-0.jsonl"]
    assert record["status"] == "decision_cap" and record["decisions"] == 12
    assert record["policies"] == ["baseline", "baseline"]
    # Baseline seats log no training records, even with the option on.
    assert not Path(training).exists()


def test_prompt_size_view_runs_the_cli_measurement():
    for needle in ('data-tab="prompt"', 'id="sStart"', 'id="sMatches"', "renderPromptSize", "/api/prompt-size",
                   '{id: "sUser"}'):
        assert needle in PLAY_HTML, needle
    for payload in ({"matches": 0}, {"matches": 6}, {"matches": "1"}, {"matches": True}, {"seed": "../x"},
                    {"seed": ""}):
        response = client().post("/api/prompt-size", json=payload)
        assert response.status_code == 400, (payload, response.text)
    assert client().post("/api/prompt-size", content="[]",
                         headers={"content-type": "application/json"}).status_code == 400
    response = client().post("/api/prompt-size", json={"matches": 1, "seed": "ui-size"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["promptVersion"] == PROMPT_VERSION and body["seeds"] == ["ui-size-0"]
    assert set(body["versions"]) == {"local-choice-v2", "local-choice-v3", PROMPT_VERSION}
    # The same numbers the CLI's report() gives on the same games.
    games = asyncio.run(baseline_games(["ui-size-0"], CTX["node"], REPO_ROOT, CTX["setup"]))
    expected = report(games, 3.0)
    assert body["versions"] == expected["versions"] and body["decisions"] == expected["decisions"]
    current = body["versions"][PROMPT_VERSION]["all"]
    assert current["max"] > body["versions"]["local-choice-v3"]["all"]["max"], "no card reference measured"
    largest = body["largest"]
    assert largest == largest_prompt(games, 3.0)
    assert largest["system"] == SYSTEM_PROMPT and "\nCards:\n" in largest["user"]
    assert largest["chars"] == len(largest["system"]) + len(largest["user"]) == current["max"]
    assert largest["approxTokens"] == round(largest["chars"] / 3)
    assert body["cardTrimming"] and all(isinstance(rule, str) for rule in body["cardTrimming"])


def test_token_is_required_when_one_is_set_and_loopback_needs_none():
    assert is_loopback("127.0.0.1") and is_loopback("::1") and is_loopback("localhost")
    assert not is_loopback("0.0.0.0") and not is_loopback("192.168.1.5") and not is_loopback("example")
    app = build_play_app(CTX["records"], token="sekret", node=CTX["node"], setup_loader=lambda: CTX["setup"])
    with TestClient(app) as guarded:
        assert guarded.get("/").status_code == 401
        assert guarded.get("/api/records").status_code == 401
        assert guarded.post("/api/play", json={}).status_code == 401
        assert guarded.get("/api/records", headers={"x-token": "sekret"}).status_code == 200
        assert guarded.get("/?t=sekret").status_code == 200
        assert guarded.get("/api/records").status_code == 200, "token cookie was not kept"


def run(node):
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["node"] = node
    CTX["setup"] = load_default_setup(REPO_ROOT, node=node)
    with tempfile.TemporaryDirectory() as tmp:
        CTX["records"] = Path(tmp) / "matches"
        CTX["app"] = build_play_app(CTX["records"], node=node, setup_loader=lambda: CTX["setup"])
        with TestClient(CTX["app"]) as test_client:
            CTX["client"] = test_client
            for test in tests:
                test()
                print(f"OK  {test.__name__}")
        workers = [s.worker for s in CTX["app"].state.play.sessions.values()]
        assert workers and all(w._process.poll() is not None for w in workers), "engine worker left running"
    print(f"PASS local play UI: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    run(args.node)


if __name__ == "__main__":
    main()
