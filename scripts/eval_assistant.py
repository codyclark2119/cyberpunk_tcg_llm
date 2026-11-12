#!/usr/bin/env python3
"""Score the local chat assistant on a multiple-choice gold set, keeping every trace.

Why: Cody's 40-question quiz (data/gold/quiz_mc_2026-11-12.jsonl) showed the
assistant failing most rules questions, and there was no way to measure a fix.
This puts each question and its lettered choices to the same ``run_turn`` the
chat page uses (same system prompt, same tools), asks for the reasoning and a
final ``Answer: <letter>`` line, parses that letter strictly, and writes one
record per question with what was chosen, the key, the outcome, every tool the
model called, the rules and cards those tools returned and the full trace, so a
wrong answer can be diagnosed (no retrieval? wrong rule? misread card?) rather
than just counted.

The question wrapper lives here, not in loop.py, and is versioned
(``EVAL_PROMPT_VERSION``): changing its wording changes the measurement, so it
moves the version. The output is deterministic and timestamp-free (timings are
dropped from the trace) and is never overwritten without ``--force``. Items
whose ``correct`` is null are run but marked ``unscored``.

The set is eval-only: never train on it.

Usage:
    python scripts/eval_assistant.py --set data/gold/quiz_mc_2026-11-12.jsonl \\
        --model models/qwen3-8b-4bit --name baseline-qwen3-8b
    python scripts/eval_assistant.py --set data/gold/quiz_mc_2026-11-12.jsonl --fake --name smoke \\
        --runs-dir /tmp/runs        # scripted fake model, for tests only
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.assistant.eval_store import (RUN_NAME_RE, RUNS_DIR, EvalSetError, load_mc_set,  # noqa: E402
                                                  summarize)
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, DEFAULT_MAX_TOKENS,  # noqa: E402
                                            MAX_TOOL_CALLS, run_turn)
from games.cyberpunk.prompts import RULES_VERSION  # noqa: E402
from harness.core.io import file_sha256, write_jsonl_atomic  # noqa: E402

EVAL_PROMPT_VERSION = "eval-mc-v1"
SCORER_VERSION = "eval-assistant-v1"
IDS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(,[A-Za-z0-9][A-Za-z0-9._-]*)*$")
# One line that is only the answer: "Answer: B", "answer: b.", "**Answer:** (B)". Anything else on the
# line ("Answer: B because ...") is not an answer line, so a hedge is never read as a choice.
ANSWER_LINE_RE = re.compile(r"^[ \t]*(?:\*\*)?answer(?:\*\*)?[ \t]*:[ \t]*(?:\*\*)?[ \t]*\(?([A-Za-z])\)?"
                            r"(?:\*\*)?[ \t]*[.!]?[ \t]*(?:\*\*)?[ \t]*$", re.I | re.M)


def question_message(item: dict) -> str:
    """The user message for one item (version ``EVAL_PROMPT_VERSION``)."""
    letters = [c["letter"] for c in item["choices"]]
    choices = "\n".join(f"{c['letter']}. {c['text']}" for c in item["choices"])
    return (f"Multiple-choice question about the rules and cards. Check the rules and cards with your tools "
            f"before you answer.\n\nQuestion: {item['question']}\n\nChoices:\n{choices}\n\n"
            f"Explain your reasoning briefly, citing the rules and cards you used. Then end with one final line "
            f"of exactly this form:\nAnswer: <letter>\nwhere <letter> is one of {', '.join(letters)}.")


def parse_answer_letter(text: str, letters: list[str]) -> tuple[str | None, str]:
    """(letter, how): the LAST strict ``Answer: X`` line; X must be one of ``letters``.

    ``how`` is ``ok``, ``no_answer_line`` or ``not_a_choice``. No letter means unanswered.
    """
    matches = ANSWER_LINE_RE.findall(text or "")
    if not matches:
        return None, "no_answer_line"
    letter = matches[-1].upper()
    if letter not in letters:
        return None, "not_a_choice"
    return letter, "ok"


def outcome_of(chosen: str | None, correct: str | None) -> str:
    if correct is None:
        return "unscored"
    if chosen is None:
        return "unanswered"
    return "correct" if chosen == correct else "wrong"


def _drop_timings(trace: list[dict]) -> list[dict]:
    return [{k: v for k, v in step.items() if k != "elapsedMs"} for step in trace]


def item_record(item: dict, turn) -> dict:
    letters = [c["letter"] for c in item["choices"]]
    chosen, parse = parse_answer_letter(turn.answer if turn.ok else "", letters)
    known = list(item.get("known_incorrect") or [])
    tools_called = [s.get("tool") for s in turn.trace if s.get("kind") == "tool"]
    return {
        "kind": "item", "id": item["id"], "chosen": chosen, "correct": item.get("correct"),
        "outcome": outcome_of(chosen, item.get("correct")), "parse": parse,
        "known_incorrect": known, "known_incorrect_hit": chosen is not None and chosen in known,
        "tools_called": tools_called,
        "tool_errors": sum(1 for s in turn.trace if s.get("kind") == "tool" and not s.get("ok")),
        "rule_ids": list(turn.sources.get("rule_ids") or []),
        "card_slugs": list(turn.sources.get("card_slugs") or []),
        "errata_ids": list(turn.sources.get("errata_ids") or []),
        "stop_reason": turn.stop_reason,
        "hit_tool_cap": turn.stop_reason == "tool_cap",
        "hit_length": turn.stop_reason == "length" or any(
            s.get("kind") == "model" and s.get("finishReason") == "length" for s in turn.trace),
        "answer": turn.answer, "trace": _drop_timings(turn.trace),
    }


class FakeModel:
    """Scripted stand-in for tests only: one search_rules call, then a hash-chosen letter.

    Deterministic per question: the letter is picked from a sha256 of the
    question line, and every fifth hash bucket answers with no Answer line, so
    a run exercises correct, wrong and unanswered outcomes without a model.
    """

    label = "fake"

    async def generate(self, messages, tools, *, max_tokens, enable_thinking):
        user = next(m["content"] for m in reversed(messages) if m["role"] == "user")
        question = user.split("Question: ", 1)[1].split("\n", 1)[0]
        letters = re.findall(r"^([A-Z])\. ", user, re.M)
        digest = int(hashlib.sha256(question.encode("utf-8")).hexdigest(), 16)
        base = {"ok": True, "finishReason": "stop", "promptTokens": 0, "generationTokens": 0, "elapsedMs": 0}
        if messages[-1]["role"] != "tool":
            call = json.dumps({"name": "search_rules", "arguments": {"query": question[:200], "k": 3}})
            return {**base, "text": f"<tool_call>\n{call}\n</tool_call>"}
        if digest % 5 == 0:
            return {**base, "text": "The rules found do not settle it."}
        return {**base, "text": f"Fake reasoning from the search.\nAnswer: {letters[digest % len(letters)]}"}


def header_row(args, set_path: Path, items: list[dict], selected: list[dict]) -> dict:
    try:
        shown = str(set_path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        shown = str(set_path)
    return {"kind": "header", "scorer_version": SCORER_VERSION, "eval_prompt_version": EVAL_PROMPT_VERSION,
            "assistant_prompt_version": ASSISTANT_PROMPT_VERSION, "rules_version": RULES_VERSION,
            "set": shown, "set_sha256": file_sha256(set_path), "set_items": len(items),
            "items_run": len(selected), "ids": args.ids, "limit": args.limit,
            "model": "fake" if args.fake else args.model, "adapter": args.adapter, "fake": bool(args.fake),
            "thinking": bool(args.thinking), "max_tokens": args.max_tokens, "max_tool_calls": MAX_TOOL_CALLS}


async def run_items(model, selected: list[dict], *, thinking: bool, max_tokens: int) -> list[dict]:
    records = []
    for n, item in enumerate(selected, 1):
        turn = await run_turn([], question_message(item), model, max_tokens=max_tokens, enable_thinking=thinking)
        record = item_record(item, turn)
        records.append(record)
        print(f"[{n}/{len(selected)}] {item['id']}: chose {record['chosen'] or '-'}, key {record['correct'] or '-'}"
              f" -> {record['outcome']} ({len(record['tools_called'])} tool call(s), {turn.stop_reason})", flush=True)
    return records


def select(items: list[dict], ids: str | None, limit: int) -> list[dict]:
    selected = items
    if ids:
        wanted = ids.split(",")
        known = {i["id"] for i in items}
        missing = [w for w in wanted if w not in known]
        if missing:
            raise EvalSetError(f"unknown id(s): {', '.join(missing)}")
        selected = [i for i in items if i["id"] in set(wanted)]
    return selected[:limit] if limit else selected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", required=True, help="multiple-choice gold set (.jsonl)")
    parser.add_argument("--model", help="local MLX model directory, e.g. models/qwen3-8b-4bit")
    parser.add_argument("--adapter", help="optional LoRA adapter directory for --model")
    parser.add_argument("--fake", action="store_true", help="scripted fake model (tests only)")
    parser.add_argument("--thinking", action="store_true", help="let Qwen3 think before answering")
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS, help="generation limit per model step")
    parser.add_argument("--limit", type=int, default=0, help="run only the first N selected items (0: all)")
    parser.add_argument("--ids", help="comma-separated item ids to run")
    parser.add_argument("--name", required=True, help="run name; writes <runs-dir>/<name>.jsonl")
    parser.add_argument("--runs-dir", default=str(RUNS_DIR), help="where runs go (default eval/runs)")
    parser.add_argument("--force", action="store_true", help="replace an existing run of the same name")
    args = parser.parse_args(argv)
    if bool(args.fake) == bool(args.model):
        parser.error("give exactly one of --model or --fake")
    if args.adapter and not args.model:
        parser.error("--adapter needs --model")
    if not RUN_NAME_RE.match(args.name):
        parser.error("--name must be 1-80 letters, digits, '.', '_' or '-', starting with a letter or digit")
    if not 1 <= args.max_tokens <= 4096:
        parser.error("--max-tokens must be 1..4096")
    if args.limit < 0:
        parser.error("--limit must be 0 or more")
    if args.ids is not None and not IDS_RE.match(args.ids):
        parser.error("--ids must be comma-separated ids")
    set_path = Path(args.set)
    set_path = set_path if set_path.is_absolute() else REPO_ROOT / set_path
    runs_dir = Path(args.runs_dir)
    runs_dir = runs_dir if runs_dir.is_absolute() else REPO_ROOT / runs_dir
    out = runs_dir / f"{args.name}.jsonl"
    if out.exists() and not args.force:
        parser.error(f"{out} exists; pass --force to replace it")
    try:
        items = load_mc_set(set_path)
        selected = select(items, args.ids, args.limit)
    except EvalSetError as exc:
        parser.error(str(exc))
    if args.fake:
        model = FakeModel()
    else:
        from games.cyberpunk.assistant.mlx_chat import make_chat_model
        try:
            model = make_chat_model(args.model, adapter=args.adapter)
        except ValueError as exc:
            parser.error(str(exc))
    print(f"Scoring {len(selected)} of {len(items)} item(s) from {set_path.name} with {model.label} "
          f"(thinking {'on' if args.thinking else 'off'}, prompt {EVAL_PROMPT_VERSION}) -> {out}", flush=True)

    async def go():
        try:
            return await run_items(model, selected, thinking=args.thinking, max_tokens=args.max_tokens)
        finally:
            close = getattr(model, "close", None)
            if close is not None:
                await close()

    records = asyncio.run(go())
    summary = summarize(records)
    rows = [header_row(args, set_path, items, selected), *records, {"kind": "summary", **summary}]
    if out.exists() and not args.force:  # Created while the run was going: still never overwrite.
        print(f"{out} appeared during the run; not overwriting (pass --force).", file=sys.stderr)
        return 1
    write_jsonl_atomic(out, rows)
    score = (f"{summary['correct']}/{summary['scored']} scored correct ({summary['score']:.1%})"
             if summary["scored"] else "no scored items")
    print(f"Score: {score}; unanswered {summary['unanswered']}; wrong {summary['wrong']}; "
          f"unscored {summary['unscored']}; known-incorrect picks {summary['known_incorrect_hits']}; "
          f"tool use {summary['tool_use']}/{summary['items']} ({(summary['tool_use_rate'] or 0):.1%})", flush=True)
    print(f"Wrote {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
