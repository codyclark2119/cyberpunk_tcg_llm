#!/usr/bin/env python3
"""Tests for the assistant's multiple-choice eval: the gold quiz, the scorer and the page's Eval tab.

Why: the quiz score is a measurement, so each piece that produces it must be
pinned. A gold file that drifted from what Cody keyed, a letter parser that
read a hedge ("Answer: B because ...") as a choice or took the first of two
Answer lines, a run file that differed between identical runs or silently
replaced an earlier one, or an unscored question counted as wrong would all
change the number without anyone noticing. The Eval tab starts a job that
loads a model, so its one action must build argv server-side without a shell,
refuse names that could read as flags, and refuse while chat or another job
runs; its notes must never write to data/gold. Everything runs on the
committed snapshot with the scorer's scripted fake model: no mlx, no weights,
no network.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient

from games.cyberpunk.assistant import eval_store
from games.cyberpunk.assistant_app import ASSISTANT_HTML, ChatService, EvalRunner, build_assistant_app
from harness.core.io import read_jsonl
from harness.core.webui import runner as runner_module

GOLD = REPO_ROOT / "data/gold/quiz_mc_2026-11-12.jsonl"
SCRIPT = REPO_ROOT / "scripts/eval_assistant.py"
LOCAL = {"host": "127.0.0.1:8767"}
CTX: dict = {}


def scorer():
    if "scorer" not in CTX:
        spec = importlib.util.spec_from_file_location("eval_assistant", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        CTX["scorer"] = module
    return CTX["scorer"]


def tree_digest(root: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            h.update(str(path.relative_to(root)).encode() + b"\0" + path.read_bytes() + b"\0")
    return h.hexdigest()


def run_scorer(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, cwd=REPO_ROOT)


@contextlib.contextmanager
def eval_dirs():
    """A temporary gold/runs/notes layout holding a copy of the quiz."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name in ("gold", "runs", "notes"):
            (root / name).mkdir()
        shutil.copyfile(GOLD, root / "gold" / GOLD.name)
        yield root


def app_client(root: Path, *, model_path: str | None = "models/qwen3-8b-4bit", chat: ChatService | None = None):
    chat = chat or ChatService(object(), model_path=model_path)
    app = build_assistant_app(chat=chat, gold_dir=root / "gold", runs_dir=root / "runs", notes_dir=root / "notes")
    return TestClient(app), chat, app


# The gold set ---------------------------------------------------------------------------------


def test_gold_quiz_parses_with_40_items_38_keyed():
    items = eval_store.load_mc_set(GOLD)
    assert len(items) == 40
    assert [i["id"] for i in items] == [f"cody-quiz-{n:02d}" for n in range(1, 41)]
    assert sum(1 for i in items if i["correct"] is not None) == 38
    unscored = {i["id"]: i["known_incorrect"] for i in items if i["correct"] is None}
    assert unscored == {"cody-quiz-04": ["D"], "cody-quiz-15": ["A"]}, unscored
    assert all(i["answer_key_by"] == "Cody" for i in items)
    assert {len(i["choices"]) for i in items} <= {2, 3, 4, 5}
    text = GOLD.read_text(encoding="utf-8")
    for quote in ("“", "”", "‘", "’"):
        assert quote not in text, "the copy keeps the ASCII-normalised quotes"
    by_id = {i["id"]: i for i in items}
    assert by_id["cody-quiz-29"]["question"].startswith('"Ready" refers to')
    assert "Gear card's bottom textbox" in by_id["cody-quiz-13"]["question"]
    listed = eval_store.list_sets(GOLD.parent)
    assert [s["name"] for s in listed] == [GOLD.name] and listed[0]["scored"] == 38


def test_set_validation_is_strict():
    good = {"id": "x-01", "question": "q?", "choices": [{"letter": "A", "text": "Yes"}, {"letter": "B", "text": "No"}],
            "correct": "A", "known_incorrect": []}
    bad_cases = [{**good, "correct": "C"}, {**good, "known_incorrect": ["A"]}, {**good, "choices": good["choices"][:1]},
                 {**good, "choices": [{"letter": "a", "text": "x"}, {"letter": "B", "text": "y"}]},
                 {**good, "question": " "}]
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "s.jsonl"
        path.write_text(json.dumps(good) + "\n" + json.dumps({**good, "id": "x-02", "correct": None}) + "\n")
        assert len(eval_store.load_mc_set(path)) == 2
        path.write_text(json.dumps(good) + "\n" + json.dumps(good) + "\n")
        try:
            eval_store.load_mc_set(path)
            raise AssertionError("duplicate id accepted")
        except eval_store.EvalSetError:
            pass
        for case in bad_cases:
            path.write_text(json.dumps(case) + "\n")
            try:
                eval_store.load_mc_set(path)
                raise AssertionError(f"accepted {case}")
            except eval_store.EvalSetError:
                pass


# The letter parser ---------------------------------------------------------------------------


def test_letter_parser_is_strict():
    parse = scorer().parse_answer_letter
    letters = ["A", "B", "C", "D"]
    cases = {
        "Because rule 4.5.\nAnswer: B": ("B", "ok"),
        "answer: c": ("C", "ok"),
        "Answer: d.": ("D", "ok"),
        "Answer: (A)": ("A", "ok"),
        "**Answer:** B": ("B", "ok"),
        "Answer: A\nOn reflection that is wrong.\nAnswer: C": ("C", "ok"),
        "Answer: B because the Gear stays.": (None, "no_answer_line"),
        "The answer is B.": (None, "no_answer_line"),
        "I think B": (None, "no_answer_line"),
        "": (None, "no_answer_line"),
        "Answer: E": (None, "not_a_choice"),
        "Answer: AB": (None, "no_answer_line"),
    }
    for text, expected in cases.items():
        assert parse(text, letters) == expected, (text, parse(text, letters))
    assert parse("Answer: C", ["A", "B"]) == (None, "not_a_choice")
    outcome = scorer().outcome_of
    assert [outcome("A", "A"), outcome("B", "A"), outcome(None, "A"), outcome("A", None), outcome(None, None)] == \
        ["correct", "wrong", "unanswered", "unscored", "unscored"]


# The scorer ----------------------------------------------------------------------------------


def test_fake_run_writes_header_records_and_summary_deterministically():
    with tempfile.TemporaryDirectory() as tmp:
        first = run_scorer("--set", str(GOLD.relative_to(REPO_ROOT)), "--fake", "--name", "a", "--runs-dir", tmp)
        assert first.returncode == 0, first.stderr
        second = run_scorer("--set", str(GOLD), "--fake", "--name", "b", "--runs-dir", tmp)
        assert second.returncode == 0, second.stderr
        a, b = (Path(tmp) / "a.jsonl").read_bytes(), (Path(tmp) / "b.jsonl").read_bytes()
        assert a == b, "two identical runs must write identical bytes"
        rows = read_jsonl(Path(tmp) / "a.jsonl")
        assert b"elapsed" not in a.lower() and not re.search(rb"20\d\d-\d\d-\d\dT", a), "no timings or timestamps"
    header, items, summary = rows[0], rows[1:-1], rows[-1]
    assert header == {
        "kind": "header", "scorer_version": "eval-assistant-v1", "eval_prompt_version": "eval-mc-v1",
        "assistant_prompt_version": header["assistant_prompt_version"], "rules_version": header["rules_version"],
        "set": "data/gold/quiz_mc_2026-11-12.jsonl", "set_sha256": hashlib.sha256(GOLD.read_bytes()).hexdigest(),
        "set_items": 40, "items_run": 40, "ids": None, "limit": 0, "model": "fake", "adapter": None, "fake": True,
        "thinking": False, "max_tokens": 1024, "max_tool_calls": 6}, header
    from games.cyberpunk.assistant.loop import ASSISTANT_PROMPT_VERSION
    from games.cyberpunk.prompts import RULES_VERSION
    assert header["assistant_prompt_version"] == ASSISTANT_PROMPT_VERSION and header["rules_version"] == RULES_VERSION
    assert len(items) == 40 and summary["kind"] == "summary"
    keys = {"kind", "id", "chosen", "correct", "outcome", "parse", "known_incorrect", "known_incorrect_hit",
            "tools_called", "tool_errors", "rule_ids", "card_slugs", "errata_ids", "stop_reason", "hit_tool_cap",
            "hit_length", "answer", "trace"}
    gold = {i["id"]: i for i in eval_store.load_mc_set(GOLD)}
    for record in items:
        assert set(record) == keys, sorted(set(record) ^ keys)
        assert record["correct"] == gold[record["id"]]["correct"]
        assert record["tools_called"] == ["search_rules"] and record["rule_ids"], record["id"]
        assert [s["kind"] for s in record["trace"]] == ["model", "tool", "model"]
        assert record["outcome"] == scorer().outcome_of(record["chosen"], record["correct"])
        assert record["known_incorrect_hit"] == (record["chosen"] in record["known_incorrect"])
        if record["chosen"] is None:
            assert record["parse"] == "no_answer_line" and "Answer:" not in record["answer"]
    by_id = {r["id"]: r for r in items}
    assert by_id["cody-quiz-04"]["outcome"] == by_id["cody-quiz-15"]["outcome"] == "unscored"
    outcomes = {r["outcome"] for r in items}
    assert outcomes == {"correct", "wrong", "unanswered", "unscored"}, outcomes
    assert summary == {"kind": "summary", **eval_store.summarize(items)}
    assert summary["scored"] == 38 and summary["unscored"] == 2 and summary["tool_use"] == 40
    assert f"Score: {summary['correct']}/38 scored correct" in first.stdout
    assert f"unanswered {summary['unanswered']}" in first.stdout and "tool use 40/40" in first.stdout


def test_scorer_refuses_overwrite_and_bad_arguments():
    with tempfile.TemporaryDirectory() as tmp:
        base = ["--set", str(GOLD), "--fake", "--runs-dir", tmp]
        assert run_scorer(*base, "--name", "r", "--ids", "cody-quiz-03,cody-quiz-04").returncode == 0
        path = Path(tmp) / "r.jsonl"
        before = path.read_bytes()
        rows = read_jsonl(path)
        assert [r["id"] for r in rows[1:-1]] == ["cody-quiz-03", "cody-quiz-04"] and rows[0]["items_run"] == 2
        again = run_scorer(*base, "--name", "r", "--limit", "1")
        assert again.returncode == 2 and "--force" in again.stderr and path.read_bytes() == before
        assert "[1/" not in again.stdout, "an existing run is refused before any question is asked"
        forced = run_scorer(*base, "--name", "r", "--limit", "1", "--force")
        assert forced.returncode == 0 and len(read_jsonl(path)) == 3
        for bad in (["--name", "-x"], ["--name", "../x"], ["--name", "ok", "--ids", "nope-99"],
                    ["--name", "ok", "--max-tokens", "0"], ["--name", "ok", "--model", "m"]):
            result = run_scorer(*base, *bad)
            assert result.returncode == 2, (bad, result.stderr)
        assert sorted(p.name for p in Path(tmp).iterdir()) == ["r.jsonl"]


def test_item_record_marks_known_incorrect_picks_caps_and_failed_turns():
    from types import SimpleNamespace
    item = {"id": "q", "question": "?", "correct": None, "known_incorrect": ["D"],
            "choices": [{"letter": x, "text": x} for x in "ABCD"]}
    sources = {"rule_ids": ["4.5"], "card_slugs": ["v-streetkid"], "errata_ids": []}
    trace = [{"step": 1, "kind": "model", "ok": True, "finishReason": "length", "elapsedMs": 3.0},
             {"step": 2, "kind": "tool", "tool": "get_card", "ok": False, "elapsedMs": 1.0}]
    turn = SimpleNamespace(ok=True, answer="Answer: D", stop_reason="answer", trace=trace, sources=sources)
    record = scorer().item_record(item, turn)
    assert record["chosen"] == "D" and record["known_incorrect_hit"] is True and record["outcome"] == "unscored"
    assert record["hit_length"] is True and record["hit_tool_cap"] is False and record["tool_errors"] == 1
    assert record["tools_called"] == ["get_card"] and record["card_slugs"] == ["v-streetkid"]
    assert all("elapsedMs" not in step for step in record["trace"])
    capped = SimpleNamespace(ok=False, answer="Answer: A", stop_reason="tool_cap", trace=[], sources=sources)
    record = scorer().item_record({**item, "correct": "A"}, capped)
    assert record["chosen"] is None and record["outcome"] == "unanswered" and record["hit_tool_cap"] is True
    assert record["known_incorrect_hit"] is False


def test_question_wrapper_carries_every_choice_and_the_answer_format():
    item = eval_store.load_mc_set(GOLD)[1]
    message = scorer().question_message(item)
    assert item["question"] in message
    for choice in item["choices"]:
        assert f"{choice['letter']}. {choice['text']}" in message
    assert message.rstrip().endswith("where <letter> is one of A, B, C, D.")
    assert "\nAnswer: <letter>\n" in message
    loop_source = (REPO_ROOT / "games/cyberpunk/assistant/loop.py").read_text()
    assert "Answer:" not in loop_source and "eval-mc" not in loop_source, "the wrapper lives in the scorer"


# The Eval tab: the Run action ---------------------------------------------------------------


class FakePopen:
    calls: list = []

    def __init__(self, args, **kwargs):
        FakePopen.calls.append((args, kwargs))
        self.stdout = iter(["[1/2] cody-quiz-01: chose A\n", "[2/2] cody-quiz-02: chose B\n"])
        self.returncode = 0

    def wait(self):
        return 0


def test_run_action_builds_argv_without_a_shell_and_checks_values():
    with eval_dirs() as root:
        client, chat, app = app_client(root)
        runner: EvalRunner = app.state.runner
        action = runner.actions_by_id["eval-assistant"]
        set_path = str(root / "gold" / GOLD.name)
        cmd = runner.build_cmd(action, {"set": set_path, "name": "baseline-1", "thinking": True, "max_tokens": 512,
                                        "limit": 3, "ids": "cody-quiz-01,cody-quiz-02"})
        assert cmd == [sys.executable, "scripts/eval_assistant.py", "--set", set_path, "--name", "baseline-1",
                       "--model", "models/qwen3-8b-4bit", "--thinking", "--max-tokens", "512", "--limit", "3",
                       "--ids", "cody-quiz-01,cody-quiz-02", "--runs-dir", str(root / "runs")], cmd
        bad_values = [{"name": "--force"}, {"name": "../x"}, {"name": "a b"}, {"name": ""}, {"name": "x" * 81},
                      {"name": "ok", "max_tokens": 0}, {"name": "ok", "max_tokens": "9; rm"},
                      {"name": "ok", "limit": -1}, {"name": "ok", "ids": "a,,b"}, {"name": "ok", "ids": "--force"},
                      {"name": "ok", "thinking": "yes"}, {"name": "ok", "model": "/etc"},
                      {"name": "ok", "set": "/etc/passwd"}, {"name": "ok", "cmd": "sh"}]
        for values in bad_values:
            try:
                runner.build_cmd(action, values)
                raise AssertionError(f"accepted {values}")
            except ValueError:
                pass
        (root / "runs" / "taken.jsonl").write_text("{}\n")
        for values, ok in (({"name": "taken"}, False), ({"name": "taken", "force": True}, True)):
            try:
                runner.build_cmd(action, values)
                assert ok, values
            except ValueError:
                assert not ok, values
        original = runner_module.subprocess.Popen
        runner_module.subprocess.Popen = FakePopen
        FakePopen.calls = []
        try:
            with client:
                refused = client.post("/api/run/eval-assistant", headers=LOCAL, json={"values": {"name": "a;b"}})
                assert refused.status_code == 400 and not FakePopen.calls
                chat.busy = True
                busy = client.post("/api/run/eval-assistant", headers=LOCAL, json={"values": {"name": "ok"}})
                assert busy.status_code == 409 and "chat turn" in busy.json()["error"] and not FakePopen.calls
                chat.busy = False
                started = client.post("/api/run/eval-assistant", headers=LOCAL,
                                      json={"values": {"name": "run-1", "set": set_path}})
                assert started.status_code == 200, started.text
                args, kwargs = FakePopen.calls[0]
                assert isinstance(args, list) and args[1] == "scripts/eval_assistant.py"
                assert "shell" not in kwargs and kwargs["cwd"] == REPO_ROOT
                job = started.json()["job"]
                for _ in range(200):
                    view = client.get(f"/api/job/{job}", headers=LOCAL).json()
                    if view["status"] != "running":
                        break
                assert view["status"] == "done" and view["lines"][-1].startswith("[2/2]")
                runner.active, runner.jobs[job]["status"] = job, "running"  # another job still going
                second = client.post("/api/run/eval-assistant", headers=LOCAL, json={"values": {"name": "run-2"}})
                assert second.status_code == 409 and len(FakePopen.calls) == 1
                chat_while_job = client.post("/api/chat", headers=LOCAL, json={"session": "s", "message": "hi"})
                assert chat_while_job.status_code == 409 and chat_while_job.json()["error_kind"] == "busy"
        finally:
            runner_module.subprocess.Popen = original
    with eval_dirs() as root:
        client, chat, app = app_client(root, model_path=None)
        try:
            app.state.runner.build_cmd(app.state.runner.actions_by_id["eval-assistant"], {"name": "ok"})
            raise AssertionError("ran without a model")
        except ValueError as exc:
            assert "No model configured" in str(exc)


# The Eval tab: routes, notes and the page --------------------------------------------------


def test_eval_routes_reject_a_foreign_host():
    with eval_dirs() as root:
        client, _, _ = app_client(root)
        routes = (("get", "/api/eval/config", None), ("get", f"/api/eval/sets/{GOLD.name}", None),
                  ("post", "/api/eval/notes", {"set": GOLD.name, "id": "cody-quiz-01", "note": "x"}),
                  ("get", "/api/eval/runs", None), ("get", "/api/eval/runs/none.jsonl", None),
                  ("post", "/api/run/eval-assistant", {"values": {"name": "x"}}), ("get", "/api/job/none", None),
                  ("get", "/api/history", None), ("get", "/api/actions", None))
        with client:
            for method, path, body in routes:
                send = getattr(client, method)
                kwargs = {"json": body} if body is not None else {}
                for host in ("evil.example:8767", "10.0.0.2:8767", ""):
                    assert send(path, headers={"host": host}, **kwargs).status_code == 403, (path, host)
                cross = send(path, headers={**LOCAL, "origin": "http://evil.example"}, **kwargs)
                assert cross.status_code == 403, path
        assert not any((root / "notes").iterdir()) and not any((root / "runs").iterdir())


def test_set_and_runs_views():
    with eval_dirs() as root:
        assert run_scorer("--set", str(root / "gold" / GOLD.name), "--fake", "--name", "smoke",
                          "--runs-dir", str(root / "runs"), "--limit", "5").returncode == 0
        (root / "runs" / "broken.jsonl").write_text('{"kind": "item"}\n')
        client, _, _ = app_client(root)
        with client:
            config = client.get("/api/eval/config", headers=LOCAL).json()
            assert config["model"] == "models/qwen3-8b-4bit" and config["actionId"] == "eval-assistant"
            assert [s["name"] for s in config["sets"]] == [GOLD.name] and config["sets"][0]["scored"] == 38
            data = client.get(f"/api/eval/sets/{GOLD.name}", headers=LOCAL).json()
            assert len(data["items"]) == 40 and data["notes"] == {}
            assert client.get("/api/eval/sets/..%2Fx.jsonl", headers=LOCAL).status_code in (400, 404)
            assert client.get("/api/eval/sets/missing.jsonl", headers=LOCAL).status_code == 404
            runs = client.get("/api/eval/runs", headers=LOCAL).json()["runs"]
            assert [r["name"] for r in runs] == ["broken.jsonl", "smoke.jsonl"]
            assert "error" in runs[0] and runs[1]["summary"]["items"] == 5 and runs[1]["model"] == "fake"
            rows = client.get("/api/eval/runs/smoke.jsonl", headers=LOCAL).json()["rows"]
            assert rows[0]["kind"] == "header" and len(rows) == 7
            assert client.get("/api/eval/runs/nope.jsonl", headers=LOCAL).status_code == 404
            assert client.get("/api/eval/runs/smoke", headers=LOCAL).status_code == 400


def test_notes_save_atomically_and_never_touch_gold():
    repo_gold = tree_digest(REPO_ROOT / "data/gold")
    with eval_dirs() as root:
        gold_before = tree_digest(root / "gold")
        client, _, _ = app_client(root)
        notes_file = root / "notes" / GOLD.name
        with client:
            ok = client.post("/api/eval/notes", headers=LOCAL,
                             json={"set": GOLD.name, "id": "cody-quiz-03", "note": "Mox Inciters <b>forces</b>?"})
            assert ok.status_code == 200 and ok.json()["note"] == "Mox Inciters <b>forces</b>?", ok.text
            client.post("/api/eval/notes", headers=LOCAL, json={"set": GOLD.name, "id": "cody-quiz-01", "note": "n1"})
            assert read_jsonl(notes_file) == [{"id": "cody-quiz-01", "note": "n1"},
                                              {"id": "cody-quiz-03", "note": "Mox Inciters <b>forces</b>?"}]
            data = client.get(f"/api/eval/sets/{GOLD.name}", headers=LOCAL).json()
            assert data["notes"]["cody-quiz-01"] == "n1"
            for body, code in (({"set": GOLD.name, "id": "nope", "note": "x"}, 404),
                               ({"set": "missing.jsonl", "id": "cody-quiz-01", "note": "x"}, 404),
                               ({"set": "../gold.jsonl", "id": "cody-quiz-01", "note": "x"}, 400),
                               ({"set": GOLD.name, "id": "cody-quiz-01", "note": "x" * 4001}, 400),
                               ({"set": GOLD.name, "id": "cody-quiz-01", "note": 5}, 400),
                               ({"set": GOLD.name, "id": "cody-quiz-01"}, 400)):
                assert client.post("/api/eval/notes", headers=LOCAL, json=body).status_code == code, body
            before = notes_file.read_bytes()
            real_replace = os.replace

            def failing_replace(src, dst):
                raise OSError("disk full")

            os.replace = failing_replace
            try:
                try:
                    client.post("/api/eval/notes", headers=LOCAL,
                                json={"set": GOLD.name, "id": "cody-quiz-02", "note": "lost"})
                except OSError:
                    pass
            finally:
                os.replace = real_replace
            assert notes_file.read_bytes() == before, "a failed save must leave the previous notes whole"
            client.post("/api/eval/notes", headers=LOCAL, json={"set": GOLD.name, "id": "cody-quiz-01", "note": " "})
            assert [r["id"] for r in read_jsonl(notes_file)] == ["cody-quiz-03"]
        assert tree_digest(root / "gold") == gold_before
        try:
            eval_store.write_note(GOLD.name, "cody-quiz-01", "x", gold_dir=root / "gold", notes_dir=root / "gold")
            raise AssertionError("wrote notes into the gold directory")
        except eval_store.EvalSetError:
            pass
        assert tree_digest(root / "gold") == gold_before
    assert tree_digest(REPO_ROOT / "data/gold") == repo_gold


def page_script() -> str:
    blocks = re.findall(r"<script>(.*?)</script>", ASSISTANT_HTML, re.S)
    assert len(blocks) == 1
    return blocks[0]


def test_eval_tab_script_parses_and_escapes():
    script = page_script()
    proc = subprocess.run([CTX["node"], "-e", "new Function(require('fs').readFileSync(0, 'utf8'))"],
                          input=script, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[:600]
    for needle in ('id="tabEval" hidden', 'id="tabBtnEval"', 'id="evalSetPick"', 'id="evalRunBtn"', 'id="evalRuns"',
                   'id="evalLog"', 'id="evalName"'):
        assert needle in ASSISTANT_HTML, needle
    eval_part = script[script.index("// Eval tab"):script.index("// Wiring")]
    for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("):
        assert banned not in eval_part, banned
    assert '"/api/run/" + encodeURIComponent(config.actionId)' in eval_part
    pure = script[script.index("// pure:start"):script.index("// pure:end")]
    program = (f'"use strict";\n{pure}\nprocess.stdout.write(JSON.stringify(['
               'jobProgress(["Scoring", "[1/40] a", "noise [9/9]", "[2/40] b", "Score: 1/2"]), jobProgress([]),'
               'splitRun([{kind: "header", m: 1}, {kind: "item", id: "a"}, {kind: "summary", s: 1}]),'
               'scoreText({correct: 1, scored: 4, score: 0.25, unanswered: 2, unscored: 1, tool_use: 3, items: 5})]));')
    out = subprocess.run([CTX["node"], "-e", program], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[:600]
    progress, empty, split, text = json.loads(out.stdout)
    assert progress == {"done": 2, "total": 40} and empty == {"done": 0, "total": 0}
    assert split == {"header": {"kind": "header", "m": 1}, "items": [{"kind": "item", "id": "a"}],
                     "summary": {"kind": "summary", "s": 1}}
    assert text == "1/4 correct (25.0%) · 2 unanswered · 1 unscored · tools used on 3/5"


def test_gold_docs_say_eval_only():
    schema = (REPO_ROOT / "data/gold/SCHEMA.md").read_text()
    for field in ("`choices`", "`correct`", "`known_incorrect`", "`answer_key_by`", "unscored"):
        assert field in schema, field
    assert "never training data" in schema


def run(node: str) -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["node"] = node
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS assistant eval: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    run(args.node)


if __name__ == "__main__":
    main()
