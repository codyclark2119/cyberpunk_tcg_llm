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
runs; its notes must never write to data/gold. A long run must survive a
restart: a partial file per finished question, a resume that finishes it to the
same bytes as an uninterrupted run, and a refusal when the settings differ.
Everything runs on the
committed snapshot with the scorer's scripted fake model: no mlx, no weights,
no network.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
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
GOLD2 = REPO_ROOT / "data/gold/quiz_mc_2026-11-13.jsonl"
# Question numbers of Cody's 2026-11-13 quiz that are not word-for-word repeats of the 11-12 set.
SECOND_QUIZ_NEW = (1, 3, 4, 5, 11, 12, 13, 14, 16, 18, 19, 22, 23, 24, 25, 27, 29, 30, 31, 32, 35, 36, 37, 38)
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


def main_in_process(*args: str, model_cls=None):
    """(exit code, stdout, stderr) of the scorer's ``main`` with ``model_cls`` standing in for ``FakeModel``.

    An exception other than SystemExit (a simulated crash) propagates.
    """
    module = scorer()
    original = module.FakeModel
    module.FakeModel = model_cls or original
    out, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = module.main(list(args))
            except SystemExit as exc:
                code = exc.code
    finally:
        module.FakeModel = original
    return code, out.getvalue(), err.getvalue()


def question_of(messages) -> str:
    user = next(m["content"] for m in reversed(messages) if m["role"] == "user")
    return user.split("Question: ", 1)[1].split("\n", 1)[0]


def crashing_model(after: int):
    """A FakeModel that raises when the question after the first ``after`` is put to it: a killed process."""
    base = scorer().FakeModel

    class Crashing(base):
        asked: list = []

        async def generate(self, messages, tools, **kwargs):
            question = question_of(messages)
            if question not in Crashing.asked:
                Crashing.asked.append(question)
            if len(Crashing.asked) > after:
                raise RuntimeError("simulated crash")
            return await base.generate(self, messages, tools, **kwargs)

    return Crashing


def counting_model():
    """A FakeModel recording each question it was asked (class-level, since main builds its own instance)."""
    base = scorer().FakeModel

    class Counting(base):
        asked: list = []

        async def generate(self, messages, tools, **kwargs):
            question = question_of(messages)
            if question not in Counting.asked:
                Counting.asked.append(question)
            return await base.generate(self, messages, tools, **kwargs)

    return Counting


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
    listed = {s["name"]: s["scored"] for s in eval_store.list_sets(GOLD.parent)}
    assert listed == {GOLD.name: 38, GOLD2.name: 60}, listed


def test_second_quiz_extends_the_first_unchanged():
    first = eval_store.load_mc_set(GOLD)
    items = eval_store.load_mc_set(GOLD2)
    assert len(items) == 64 and sum(1 for i in items if i["correct"] is not None) == 60
    new_ids = [f"cody-quiz2-{n:02d}" for n in SECOND_QUIZ_NEW]
    assert [i["id"] for i in items] == [i["id"] for i in first] + new_ids
    by_id = {i["id"]: i for i in items}
    for old in first:
        row = by_id[old["id"]]
        if old["id"] == "cody-quiz-04":
            # The 11-13 quiz repeats it and also marks A wrong (B "most likely", still unscored).
            assert row["known_incorrect"] == ["A", "D"] and row["correct"] is None
            continue
        assert row == old, old["id"]
    unscored = {i["id"]: i["known_incorrect"] for i in items if i["correct"] is None}
    assert unscored == {"cody-quiz-04": ["A", "D"], "cody-quiz-15": ["A"],
                        "cody-quiz2-01": ["A"], "cody-quiz2-14": ["D"]}, unscored
    assert all(i["answer_key_by"] == "Cody" and "2026-11-13" in i["source"] for i in items[40:])
    text = GOLD2.read_text(encoding="utf-8")
    for junk in ("&#39;", "&#34;", "“", "”", "’"):
        assert junk not in text, junk
    assert by_id["cody-quiz2-38"]["question"].startswith("Are these correct sequences during the Start phase")


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
        # Erratum records carry their page's own updated_at (snapshot data, inside preloaded get_card results);
        # anything else that looks like a timestamp would be the run's.
        undated = re.sub(rb'"page_updated_at": "[^"]*"', b"", a)
        # A timing would be a field ("elapsedMs"); the word itself is in snapshot text (TR 3.4.5: "After round
        # time has elapsed").
        assert not re.search(rb'"elapsed', a, re.I) and not re.search(rb"20\d\d-\d\d-\d\dT", undated), \
            "no timings or timestamps"
    header, items, summary = rows[0], rows[1:-1], rows[-1]
    from games.cyberpunk.assistant.loop import tool_specs_sha256
    assert header == {
        "kind": "header", "scorer_version": "eval-assistant-v2", "eval_prompt_version": "eval-mc-v1",
        "assistant_prompt_version": header["assistant_prompt_version"], "rules_version": header["rules_version"],
        "tournament_rules_version": "2026-10-28", "set": "data/gold/quiz_mc_2026-11-12.jsonl", "set_sha256": hashlib.sha256(GOLD.read_bytes()).hexdigest(),
        "set_items": 40, "items_run": 40, "ids": None, "limit": 0, "model": "fake", "adapter": None, "fake": True,
        "thinking": True, "max_tokens": 2048, "max_tool_calls": 6, "preload": True, "preload_k": 5,
        "preload_chars": 8000, "tool_specs_sha256": tool_specs_sha256()}, header
    from games.cyberpunk.assistant.loop import ASSISTANT_PROMPT_VERSION
    from games.cyberpunk.prompts import RULES_VERSION, TOURNAMENT_RULES_VERSION
    assert header["assistant_prompt_version"] == ASSISTANT_PROMPT_VERSION and header["rules_version"] == RULES_VERSION
    assert header["tournament_rules_version"] == TOURNAMENT_RULES_VERSION
    assert len(items) == 40 and summary["kind"] == "summary"
    keys = {"kind", "id", "chosen", "correct", "outcome", "parse", "known_incorrect", "known_incorrect_hit",
            "tools_called", "auto_tools", "tool_errors", "rule_ids", "card_slugs", "errata_ids", "stop_reason", "hit_tool_cap",
            "hit_length", "answer", "trace"}
    gold = {i["id"]: i for i in eval_store.load_mc_set(GOLD)}
    for record in items:
        assert set(record) == keys, sorted(set(record) ^ keys)
        assert record["correct"] == gold[record["id"]]["correct"]
        assert record["tools_called"] == ["search_rules"] and record["rule_ids"], record["id"]
        auto = record["auto_tools"]
        cards = [t for t in auto[1:] if t != "get_rule"]
        # The search, then the linked cards, then the implied-rule get_rule steps (preload.implied_rules).
        assert auto == ["search_rules", *cards] + ["get_rule"] * (len(auto) - 1 - len(cards)), auto
        assert set(cards) <= {"get_card", "find_card"}, auto
        assert all("implied" in s for s in record["trace"][:len(auto)] if s["tool"] == "get_rule")
        assert [s["kind"] for s in record["trace"]] == ["tool"] * len(auto) + ["model", "tool", "model"]
        assert all(s.get("auto") for s in record["trace"][:len(auto)])
        assert record["trace"][len(auto) - 1]["step"] == len(auto), "the automatic steps come first"
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


def test_scorer_switches_preload_and_thinking_off_for_the_comparison():
    with tempfile.TemporaryDirectory() as tmp:
        ids = "cody-quiz-03,cody-quiz-09"
        base = run_scorer("--set", str(GOLD), "--fake", "--name", "off", "--runs-dir", tmp, "--ids", ids,
                          "--no-preload", "--no-thinking")
        assert base.returncode == 0, base.stderr
        assert "thinking off, preload off, max tokens 1024" in base.stdout
        both = run_scorer("--set", str(GOLD), "--fake", "--name", "on", "--runs-dir", tmp, "--ids", ids,
                          "--preload-k", "3", "--max-tokens", "900")
        assert both.returncode == 0, both.stderr
        off_rows, on_rows = read_jsonl(Path(tmp) / "off.jsonl"), read_jsonl(Path(tmp) / "on.jsonl")
        for bad in (["--preload-k", "0"], ["--preload-k", "21"], ["--preload-chars", "-1"]):
            refused = run_scorer("--set", str(GOLD), "--fake", "--name", "bad", "--runs-dir", tmp, *bad)
            assert refused.returncode == 2, bad
    off, on = off_rows[0], on_rows[0]
    assert (off["preload"], off["thinking"], off["max_tokens"], off["preload_k"], off["preload_chars"]) == (
        False, False, 1024, None, None)
    assert (on["preload"], on["thinking"], on["max_tokens"], on["preload_k"], on["preload_chars"]) == (
        True, True, 900, 3, 8000)
    assert off["tool_specs_sha256"] == on["tool_specs_sha256"] and len(on["tool_specs_sha256"]) == 64
    for record in off_rows[1:-1]:
        assert record["auto_tools"] == [] and [s["kind"] for s in record["trace"]] == ["model", "tool", "model"]
    for record in on_rows[1:-1]:
        first = record["trace"][0]
        assert first["auto"] is True and first["tool"] == "search_rules" and first["arguments"]["k"] == 3
        item = next(i for i in eval_store.load_mc_set(GOLD) if i["id"] == record["id"])
        # The preload searches the question and its choices, never the answer-format instructions.
        assert first["arguments"]["query"] == scorer().preload_text(item)[:500]
        assert "Answer:" not in first["arguments"]["query"] and item["question"] in first["arguments"]["query"]
    # ... which is the text eval_retrieval.py measures recall on, so its numbers describe this search.
    spec = importlib.util.spec_from_file_location("eval_retrieval", REPO_ROOT / "scripts/eval_retrieval.py")
    retrieval = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    spec.loader.exec_module(retrieval)
    for item in eval_store.load_mc_set(GOLD):
        assert retrieval.query_for(item) == scorer().preload_text(item), item["id"]


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
    trace = [{"step": 1, "kind": "tool", "auto": True, "tool": "search_rules", "ok": False, "elapsedMs": 2.0},
             {"step": 2, "kind": "model", "ok": True, "finishReason": "length", "elapsedMs": 3.0},
             {"step": 3, "kind": "tool", "tool": "get_card", "ok": False, "elapsedMs": 1.0}]
    turn = SimpleNamespace(ok=True, answer="Answer: D", stop_reason="answer", trace=trace, sources=sources)
    record = scorer().item_record(item, turn)
    assert record["chosen"] == "D" and record["known_incorrect_hit"] is True and record["outcome"] == "unscored"
    assert record["hit_length"] is True and record["hit_tool_cap"] is False and record["tool_errors"] == 1
    assert record["tools_called"] == ["get_card"] and record["card_slugs"] == ["v-streetkid"]
    assert record["auto_tools"] == ["search_rules"], "automatic steps are not the model's tool use"
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


# Long runs: the token ceiling, the tool-call cap and crash-safe partial runs ----------------


def test_scorer_token_ceiling_and_tool_cap_bounds():
    from games.cyberpunk.assistant.loop import MAX_TOKENS_LIMIT, MAX_TOOL_CALLS_LIMIT
    assert (MAX_TOKENS_LIMIT, MAX_TOOL_CALLS_LIMIT) == (16384, 16)
    with tempfile.TemporaryDirectory() as tmp:
        base = ["--set", str(GOLD), "--fake", "--runs-dir", tmp, "--limit", "1"]
        for name, extra in (("t8192", ["--max-tokens", "8192"]), ("t16384", ["--max-tokens", "16384"]),
                            ("c16", ["--max-tool-calls", "16"]), ("c1", ["--max-tool-calls", "1"])):
            code, _, err = main_in_process(*base, "--name", name, *extra)
            assert code == 0, (extra, err)
        assert read_jsonl(Path(tmp) / "t8192.jsonl")[0]["max_tokens"] == 8192
        assert read_jsonl(Path(tmp) / "c16.jsonl")[0]["max_tool_calls"] == 16
        for extra, needle in ((["--max-tokens", "16385"], "1..16384"), (["--max-tokens", "0"], "1..16384"),
                              (["--max-tool-calls", "0"], "1..16"), (["--max-tool-calls", "17"], "1..16"),
                              (["--max-tool-calls", "x"], "invalid int")):
            code, _, err = main_in_process(*base, "--name", "bad", *extra)
            assert code == 2 and needle in err, (extra, err)
        code, _, err = main_in_process(*base, "--name", "x.partial")
        assert code == 2 and ".partial" in err, err
        assert sorted(p.name for p in Path(tmp).iterdir()) == ["c1.jsonl", "c16.jsonl", "t16384.jsonl", "t8192.jsonl"]


def test_step_limits_reach_the_header_only_when_not_the_default():
    s = scorer()
    items = eval_store.load_mc_set(GOLD)

    def header(*extra):
        """The header of a real-model run with the defaults, ``extra`` being (field, value) pairs."""
        args = argparse.Namespace(set=str(GOLD), ids=None, limit=0, model="models/x", adapter=None, fake=False,
                                  thinking=True, max_tokens=2048, max_tool_calls=6, preload=True, preload_k=5,
                                  preload_chars=8000, max_prompt_tokens=32768, worker_timeout=None)
        for key, value in zip(extra[::2], extra[1::2]):
            setattr(args, key, value)
        return s.header_row(args, GOLD, items, items)

    default = header()
    assert "worker_timeout_s" not in default and "max_prompt_tokens" not in default, default
    assert s.effective_timeout(argparse.Namespace(fake=False, worker_timeout=None, max_tokens=2048)) == 600
    long = header("max_tokens", 8192)
    assert long["worker_timeout_s"] == 1349 and "max_prompt_tokens" not in long
    assert header("worker_timeout", 900.0)["worker_timeout_s"] == 900
    assert header("worker_timeout", 600.0).get("worker_timeout_s") is None, "600 s is the default: not recorded"
    assert header("max_prompt_tokens", 65536)["max_prompt_tokens"] == 65536
    # The fake model has no worker, so no timeout: a fake run's header never carries one.
    fake = argparse.Namespace(fake=True, worker_timeout=None, max_tokens=8192)
    assert s.effective_timeout(fake) is None
    with tempfile.TemporaryDirectory() as tmp:
        base = ["--set", str(GOLD), "--fake", "--runs-dir", tmp, "--limit", "1"]
        code, out, err = main_in_process(*base, "--name", "big", "--max-tokens", "8192", "--max-prompt-tokens", "65536")
        assert code == 0, err
        row = read_jsonl(Path(tmp) / "big.jsonl")[0]
        assert row["max_prompt_tokens"] == 65536 and "worker_timeout_s" not in row and "prompt cap 65536" in out
        for extra, needle in ((["--max-prompt-tokens", "0"], "1..131072"),
                              (["--max-prompt-tokens", "131073"], "1..131072"),
                              (["--worker-timeout", "0"], "1..86400"), (["--worker-timeout", "x"], "invalid float")):
            code, _, err = main_in_process(*base, "--name", "bad", *extra)
            assert code == 2 and needle in err, (extra, err)


def test_max_tool_calls_reaches_run_turn_the_prompt_and_the_header():
    from games.cyberpunk.assistant.loop import MAX_TOOL_CALLS, SYSTEM_PROMPT, cap_message, system_prompt

    class ToolHungry:
        """Calls search_rules forever, a new query each time, and records the system prompt it saw."""
        label = "hungry"
        prompts: list = []

        async def generate(self, messages, tools, *, max_tokens, enable_thinking):
            ToolHungry.prompts.append(messages[0]["content"])
            n = sum(len(m.get("tool_calls") or []) for m in messages)
            call = json.dumps({"name": "search_rules", "arguments": {"query": f"attack {n}", "k": 1}})
            return {"ok": True, "text": f"<tool_call>\n{call}\n</tool_call>", "finishReason": "stop",
                    "promptTokens": 0, "generationTokens": 0, "elapsedMs": 0}

    with tempfile.TemporaryDirectory() as tmp:
        base = ["--set", str(GOLD), "--fake", "--runs-dir", tmp, "--limit", "2", "--no-preload"]
        for cap in (3, 10, None):
            ToolHungry.prompts = []
            name = f"cap{cap}"
            code, _, err = main_in_process(*base, "--name", name, *(["--max-tool-calls", str(cap)] if cap else []),
                                           model_cls=ToolHungry)
            assert code == 0, err
            rows = read_jsonl(Path(tmp) / f"{name}.jsonl")
            header, items = rows[0], rows[1:-1]
            effective = cap or MAX_TOOL_CALLS
            assert header["max_tool_calls"] == effective
            if cap is None:
                assert "system_prompt_sha256" not in header, "a default run's header is unchanged"
                assert set(ToolHungry.prompts) == {SYSTEM_PROMPT}
            else:
                assert header["system_prompt_sha256"] == hashlib.sha256(system_prompt(cap).encode()).hexdigest()
                assert set(ToolHungry.prompts) == {system_prompt(cap)}
                assert f"At most {cap} tool calls" in ToolHungry.prompts[0]
            for record in items:
                ran = [s for s in record["trace"] if s["kind"] == "tool" and s.get("errorKind") != "cap_exceeded"]
                assert len(ran) == effective and record["stop_reason"] == "tool_cap" and record["hit_tool_cap"]
                assert record["answer"] == cap_message(effective)
            assert len(ToolHungry.prompts) == 2 * (effective + 1), "each question asks once more than the cap"


def test_partial_is_written_per_row_and_the_final_file_is_unchanged_by_it():
    module = scorer()
    base_cls = module.FakeModel
    seen_rows: list[int] = []

    class Probe(base_cls):
        """Before each new question, counts the rows already flushed to the partial."""
        asked: list = []

        async def generate(self, messages, tools, **kwargs):
            question = question_of(messages)
            if question not in Probe.asked:
                Probe.asked.append(question)
                seen_rows.append(len(eval_store.read_partial_rows(Path(CTX["tmp"]) / "p.partial.jsonl")))
            return await base_cls.generate(self, messages, tools, **kwargs)

    with tempfile.TemporaryDirectory() as tmp:
        CTX["tmp"] = tmp
        code, out, err = main_in_process("--set", str(GOLD), "--fake", "--name", "p", "--runs-dir", tmp,
                                         "--limit", "6", model_cls=Probe)
        assert code == 0, err
        assert seen_rows == [1, 2, 3, 4, 5, 6], seen_rows  # the header, then one more row per finished question
        assert not (Path(tmp) / "p.partial.jsonl").exists(), "the partial is removed once the run is final"
        final = (Path(tmp) / "p.jsonl").read_bytes()
        # The same run computed without any partial: header, run_items' records, summary, one atomic write.
        rows = read_jsonl(Path(tmp) / "p.jsonl")
        selected = eval_store.load_mc_set(GOLD)[:6]
        with contextlib.redirect_stdout(io.StringIO()):
            records = asyncio.run(module.run_items(base_cls(), selected, thinking=True, max_tokens=2048))
        direct = Path(tmp) / "direct.jsonl"
        module.write_jsonl_atomic(direct, [rows[0], *records, {"kind": "summary", **eval_store.summarize(records)}])
        assert direct.read_bytes() == final, "the partial path must not change the final file"


def test_a_killed_run_resumes_to_the_uninterrupted_bytes():
    with tempfile.TemporaryDirectory() as tmp:
        base = ["--set", str(GOLD), "--fake", "--runs-dir", tmp, "--limit", "8"]
        assert main_in_process(*base, "--name", "ref")[0] == 0
        reference = (Path(tmp) / "ref.jsonl").read_bytes()
        try:
            main_in_process(*base, "--name", "k", model_cls=crashing_model(3))
            raise AssertionError("the simulated crash did not propagate")
        except RuntimeError:
            pass
        partial = Path(tmp) / "k.partial.jsonl"
        assert not (Path(tmp) / "k.jsonl").exists()
        rows = eval_store.read_partial_rows(partial)
        assert rows[0] == read_jsonl(Path(tmp) / "ref.jsonl")[0] and len(rows) == 4, len(rows)
        assert [r["id"] for r in rows[1:]] == [f"cody-quiz-{n:02d}" for n in (1, 2, 3)]
        # The Runs view lists it as incomplete, never as a finished run and never as a crash.
        listed = {r["name"]: r for r in eval_store.list_runs(Path(tmp))}
        assert listed["k.partial.jsonl"]["incomplete"] is True and "error" not in listed["k.partial.jsonl"]
        assert listed["k.partial.jsonl"]["summary"]["items"] == 3 and "incomplete" not in listed["ref.jsonl"]
        # Without --resume an existing partial is refused and left alone.
        before = partial.read_bytes()
        code, out, err = main_in_process(*base, "--name", "k")
        assert code == 2 and "--resume" in err and "[1/" not in out and partial.read_bytes() == before, err
        # A row torn mid-write (no newline) is dropped: that question runs again.
        with partial.open("a", encoding="utf-8") as handle:
            handle.write('{"kind": "item", "id": "cody-quiz-04", "cho')
        counting = counting_model()
        code, out, err = main_in_process(*base, "--name", "k", "--resume", model_cls=counting)
        assert code == 0, err
        assert "Resuming k.partial.jsonl: 3 of 8" in out and "[4/8] cody-quiz-04" in out and "[1/8]" not in out
        gold = {i["id"]: i["question"] for i in eval_store.load_mc_set(GOLD)}
        assert counting.asked == [gold[f"cody-quiz-{n:02d}"].split("\n", 1)[0] for n in range(4, 9)], \
            "a resumed run asks only the questions the partial lacks"
        assert (Path(tmp) / "k.jsonl").read_bytes() == reference, "resumed and uninterrupted runs must match"
        assert not partial.exists()


def test_resume_refuses_a_different_header_and_force_starts_over():
    with tempfile.TemporaryDirectory() as tmp:
        base = ["--set", str(GOLD), "--fake", "--runs-dir", tmp, "--limit", "5", "--name", "m"]
        try:
            main_in_process(*base, model_cls=crashing_model(2))
            raise AssertionError("no crash")
        except RuntimeError:
            pass
        partial = Path(tmp) / "m.partial.jsonl"
        before = partial.read_bytes()
        for extra, fields in ((["--max-tokens", "900"], ["max_tokens"]),
                              (["--max-tool-calls", "10"], ["max_tool_calls", "system_prompt_sha256"]),
                              (["--no-preload"], ["preload", "preload_k", "preload_chars"]),
                              (["--limit", "4"], ["items_run", "limit"])):
            counting = counting_model()
            code, out, err = main_in_process(*base, *extra, "--resume", model_cls=counting)  # the last --limit wins
            assert code == 2 and "header differs" in err, (extra, err)
            named = err.split("header differs from this run's in: ", 1)[1]
            assert [part.split(" (", 1)[0] for part in named.strip().split("; ")] == fields, (extra, named)
            assert counting.asked == [] and "/5]" not in out, out
            assert partial.read_bytes() == before, "a refused resume leaves the partial alone"
        # --force without --resume discards the partial and runs everything again.
        counting = counting_model()
        code, out, err = main_in_process(*base, "--force", model_cls=counting)
        assert code == 0 and len(counting.asked) == 5 and "[1/5]" in out, err
        assert not partial.exists() and len(read_jsonl(Path(tmp) / "m.jsonl")) == 7


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
                       "--model", "models/qwen3-8b-4bit", "--max-tokens", "512", "--limit", "3",
                       "--ids", "cody-quiz-01,cody-quiz-02", "--runs-dir", str(root / "runs")], cmd
        # The page's two toggles become the scorer's switch-offs; unset ones follow the page's defaults
        # (thinking and preload on), and an unset max tokens is left to the scorer.
        off = runner.build_cmd(action, {"name": "ab-1", "thinking": False, "preload": False})
        assert off[off.index("--name") + 2:] == ["--model", "models/qwen3-8b-4bit", "--no-thinking", "--no-preload",
                                                  "--limit", "0", "--runs-dir", str(root / "runs")], off
        default = runner.build_cmd(action, {"name": "ab-2"})
        assert "--no-thinking" not in default and "--no-preload" not in default and "--max-tokens" not in default
        bad_values = [{"name": "--force"}, {"name": "../x"}, {"name": "a b"}, {"name": ""}, {"name": "x" * 81},
                      {"name": "ok", "max_tokens": 0}, {"name": "ok", "max_tokens": "9; rm"},
                      {"name": "ok", "limit": -1}, {"name": "ok", "ids": "a,,b"}, {"name": "ok", "ids": "--force"},
                      {"name": "ok", "thinking": "yes"}, {"name": "ok", "preload": 1},
                      {"name": "ok", "no_thinking": True}, {"name": "ok", "no_preload": True},
                      {"name": "ok", "model": "/etc"},
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


def test_eval_form_passes_max_tool_calls_and_resume_and_checks_them():
    with eval_dirs() as root:
        client, chat, app = app_client(root)
        runner: EvalRunner = app.state.runner
        action = runner.actions_by_id["eval-assistant"]
        keys = {spec.get("key") for spec in action["args"]}
        assert {"max_tool_calls", "resume", "max_tokens"} <= keys
        cmd = runner.build_cmd(action, {"name": "big-1", "max_tokens": 8192, "max_tool_calls": 10, "resume": True})
        tail = cmd[cmd.index("--model") + 2:]
        assert tail == ["--max-tokens", "8192", "--max-tool-calls", "10", "--limit", "0", "--resume",
                        "--runs-dir", str(root / "runs")], tail
        default = runner.build_cmd(action, {"name": "big-2"})
        assert "--max-tool-calls" not in default and "--resume" not in default, "unset: the scorer's defaults"
        assert "--max-tokens" in runner.build_cmd(action, {"name": "big-3", "max_tokens": 16384})
        for values in ({"name": "ok", "max_tool_calls": 0}, {"name": "ok", "max_tool_calls": 17},
                       {"name": "ok", "max_tool_calls": "10"}, {"name": "ok", "max_tool_calls": True},
                       {"name": "ok", "max_tool_calls": 2.5}, {"name": "ok", "max_tokens": 16385},
                       {"name": "ok", "resume": "yes"}, {"name": "ok.partial"}):
            try:
                runner.build_cmd(action, values)
                raise AssertionError(f"accepted {values}")
            except ValueError:
                pass
        # An incomplete run of that name: refused unless resumed or replaced.
        (root / "runs" / "half.partial.jsonl").write_text('{"kind": "header"}\n')
        for values, ok in (({"name": "half"}, False), ({"name": "half", "resume": True}, True),
                           ({"name": "half", "force": True}, True), ({"name": "half", "resume": False}, False)):
            try:
                runner.build_cmd(action, values)
                assert ok, values
            except ValueError as exc:
                assert not ok and "incomplete run" in str(exc), (values, exc)
        with client:
            config = client.get("/api/eval/config", headers=LOCAL).json()
            assert (config["maxTokensLimit"], config["maxToolCalls"], config["maxToolCallsLimit"]) == (16384, 6, 16)
            refused = client.post("/api/run/eval-assistant", headers=LOCAL,
                                  json={"values": {"name": "ok", "max_tool_calls": 99}})
            assert refused.status_code == 400 and "max_tool_calls" in refused.json()["error"]


# The Eval tab: routes, notes and the page --------------------------------------------------


def test_eval_routes_reject_a_foreign_host():
    with eval_dirs() as root:
        client, _, _ = app_client(root)
        routes = (("get", "/api/eval/config", None), ("get", f"/api/eval/sets/{GOLD.name}", None),
                  ("post", "/api/eval/notes", {"set": GOLD.name, "id": "cody-quiz-01", "note": "x"}),
                  ("get", "/api/eval/runs", None), ("get", "/api/eval/runs/none.jsonl", None),
                  ("get", "/api/eval/runs/none.partial.jsonl", None),
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
        try:
            main_in_process("--set", str(root / "gold" / GOLD.name), "--fake", "--name", "half",
                            "--runs-dir", str(root / "runs"), "--limit", "5", model_cls=crashing_model(2))
            raise AssertionError("no crash")
        except RuntimeError:
            pass
        with (root / "runs" / "half.partial.jsonl").open("a") as handle:
            handle.write('{"kind": "item", "id": "cody-qu')  # killed mid-row
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
            assert [r["name"] for r in runs] == ["broken.jsonl", "half.partial.jsonl", "smoke.jsonl"]
            assert "error" in runs[0] and runs[2]["summary"]["items"] == 5 and runs[2]["model"] == "fake"
            half = runs[1]
            assert half["incomplete"] is True and "error" not in half and half["summary"]["items"] == 2, half
            assert half["model"] == "fake" and "incomplete" not in runs[2]
            partial_rows = client.get("/api/eval/runs/half.partial.jsonl", headers=LOCAL).json()["rows"]
            assert [r["kind"] for r in partial_rows] == ["header", "item", "item"]
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
                   'id="evalLog"', 'id="evalName"', 'id="evalMaxToolCalls"', 'id="evalResume"',
                   'id="evalMaxTokens" min="1" max="16384"'):
        assert needle in ASSISTANT_HTML, needle
    eval_part = script[script.index("// Eval tab"):script.index("// Wiring")]
    for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("):
        assert banned not in eval_part, banned
    assert '"/api/run/" + encodeURIComponent(config.actionId)' in eval_part
    for needle in ("values.max_tool_calls = maxToolCalls", 'resume: $("evalResume").checked', "run.incomplete",
                   "run.header.max_tool_calls", "run.header.system_prompt_sha256"):
        assert needle in eval_part, needle
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
