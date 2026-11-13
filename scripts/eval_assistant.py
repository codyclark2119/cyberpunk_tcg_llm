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

The automatic context step (``loop.py``: ``search_rules`` and card-name
linking before the model speaks) and thinking are on by default, as in the
chat; ``--no-preload`` and ``--no-thinking`` turn each off so a comparison can
isolate it. The preload sees the question and its choice lines (the same text
``eval_retrieval.py`` measures), not the answer-format instructions. The header
records preload, thinking, the effective ``max_tokens``, both prompt versions
and a hash of the tool specs. ``tools_called`` lists the tools the model chose;
the automatic ones are in ``auto_tools``.

``--max-tokens`` may be 1..16384 (``loop.MAX_TOKENS_LIMIT``, the chat worker's
ceiling too): larger models think past 4096 tokens, so the ceiling was raised on
2026-11-12 while the defaults stayed. ``--max-tool-calls`` (1..16, default
``MAX_TOOL_CALLS``) goes to ``run_turn`` and into the system prompt, which states
the cap; the header records the effective cap, and when it is not the default
the rendered prompt differs too, so the header then also carries
``system_prompt_sha256``. A default run's header is unchanged.

Limits per model step (2026-11-13): the worker's prompt cap is
``--max-prompt-tokens`` (default 32,768; the worker also keeps ``--max-tokens``
of room in the model's context), and a step may take ``--worker-timeout``
seconds, by default ``max(600, 120 + 0.15 x --max-tokens)`` (600 s at the
default 2,048 tokens, 1,349 s at 8,192). The header records
``max_prompt_tokens`` when it is not the default and ``worker_timeout_s`` when
the effective timeout is not 600 s (never for ``--fake``), so a default run's
header is unchanged. The loop's prompt guard drops the oldest tool results to
stay under the cap (``loop.PromptGuard``), and a reply asking for more tool
calls than remain runs the ones that fit.

A run is crash-safe. Each finished question is appended to
``<runs-dir>/<name>.partial.jsonl`` (the header first, flushed and synced per
row); at the end the final ``<name>.jsonl`` is written atomically, byte for byte
what an uninterrupted run writes, and the partial is removed. ``--resume``
continues a partial whose header equals this run's (set and its sha256, model,
adapter, settings, prompt versions, tool specs): the ids already in it are
skipped and their rows kept. A header that differs is a hard error naming the
fields. Without ``--resume`` an existing partial is refused unless ``--force``,
which starts over.

Sampling and a pass mark (2026-11-13). Cody's standard: "The ideal passing would
be mixing the questions into a 40 question quiz and getting minimum 35 correct."
``--sample N --seed S`` draws N questions from the set's keyed items only (``correct``
not null), so every sampled question counts and the denominator is N: the keyed
items are ranked by ``sha256(f"{S}:{id}")``, the first N are taken and they run in
set order. The draw depends only on the seed and the ids, never on file order, so
the same seed always gives the same questions and several seeds can be averaged.
``--seed`` is required with ``--sample``, and ``--sample`` excludes ``--ids`` and
``--limit``. ``--pass-mark K`` (1..items run) adds ``pass_mark`` and ``passed``
(correct >= K) to the summary and ends the score line with ``PASS (K/N needed)`` or
``FAIL (K/N needed)``. The header records ``sample``, ``seed``, ``sampled_ids`` and
``pass_mark`` only when given (a default run's header and summary are unchanged),
and a resume compares them like every other setting.

Linked cards (2026-11-13). An item may carry ``cards``, the card slugs the
question links (the official test's, imported by ``scripts/import_test_attempt.py``).
For such an item the preload runs ``get_card`` on exactly those cards, in order,
after its usual ``search_rules``, instead of guessing cards from names in the text:
the test says which card it means, and several cards share a name (Adam Smasher).
``cards: []`` means no card steps. The steps are auto steps in the trace like any
other (``link.given`` true), the record names them in ``linked_cards``, and the
header records ``linked_cards: true`` when the set has any ``cards`` field and the
preload is on. Items without ``cards`` run exactly as before, so runs of the other
sets are byte-identical. When the set's rows carry ``official`` and ``--pass-mark``
is absent, the official pass rule (``pass_percent``) is printed as a note only.

The set is eval-only: never train on it.

Usage:
    python scripts/eval_assistant.py --set data/gold/quiz_mc_2026-11-12.jsonl \\
        --model models/qwen3-8b-4bit --name baseline-qwen3-8b --no-preload --no-thinking
    python scripts/eval_assistant.py --set data/gold/quiz_mc_2026-11-12.jsonl \\
        --model models/qwen3.8-27b-8bit --name v3-both-27b-8192-c10 --max-tokens 8192 --max-tool-calls 10
    python scripts/eval_assistant.py ... --resume   # the same command again continues a stopped run
    python scripts/eval_assistant.py --set data/gold/quiz_mc_2026-11-13.jsonl --model models/qwen3-8b-4bit \\
        --name q2-s1-8b --max-tokens 4096 --sample 40 --seed 1 --pass-mark 35
    python scripts/eval_assistant.py --set data/gold/official_basic_test.jsonl --model models/qwen3-8b-4bit \\
        --name off-v7-8b --max-tokens 4096 --pass-mark 34
    python scripts/eval_assistant.py --set data/gold/quiz_mc_2026-11-12.jsonl --fake --name smoke \\
        --runs-dir /tmp/runs        # scripted fake model, for tests only
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.assistant.eval_store import (PARTIAL_SUFFIX, RUN_NAME_RE, RUNS_DIR,  # noqa: E402
                                                  EvalSetError, load_mc_set, partial_path, read_partial_rows,
                                                  summarize)
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, DEFAULT_PRELOAD,  # noqa: E402
                                            DEFAULT_THINKING, MAX_TOKENS_LIMIT, MAX_TOOL_CALLS,
                                            MAX_TOOL_CALLS_LIMIT, default_max_tokens, run_turn, system_prompt,
                                            tool_specs_sha256)
from games.cyberpunk.assistant.preload import DEFAULT_PRELOAD_CHARS, DEFAULT_PRELOAD_K  # noqa: E402
from games.cyberpunk.prompts import RULES_VERSION, TOURNAMENT_RULES_VERSION  # noqa: E402
from harness.core.chat_worker import (DEFAULT_MAX_PROMPT_TOKENS, DEFAULT_RESPONSE_TIMEOUT,  # noqa: E402
                                      MAX_PROMPT_TOKENS_LIMIT, step_timeout)
from harness.core.io import file_sha256, write_jsonl_atomic  # noqa: E402

EVAL_PROMPT_VERSION = "eval-mc-v1"
SCORER_VERSION = "eval-assistant-v2"  # v2: preload, auto_tools, thinking default on
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


def preload_text(item: dict) -> str:
    """What the automatic context step searches and links: the question and its lettered choice lines."""
    return item["question"] + "\n" + "\n".join(f"{c['letter']}. {c['text']}" for c in item["choices"])


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
    model_tools = [s for s in turn.trace if s.get("kind") == "tool" and not s.get("auto")]
    tools_called = [s.get("tool") for s in model_tools]
    record = {
        "kind": "item", "id": item["id"], "chosen": chosen, "correct": item.get("correct"),
        "outcome": outcome_of(chosen, item.get("correct")), "parse": parse,
        "known_incorrect": known, "known_incorrect_hit": chosen is not None and chosen in known,
        "tools_called": tools_called,
        "auto_tools": [s.get("tool") for s in turn.trace if s.get("kind") == "tool" and s.get("auto")],
        "tool_errors": sum(1 for s in model_tools if not s.get("ok")),
        "rule_ids": list(turn.sources.get("rule_ids") or []),
        "card_slugs": list(turn.sources.get("card_slugs") or []),
        "errata_ids": list(turn.sources.get("errata_ids") or []),
        "stop_reason": turn.stop_reason,
        "hit_tool_cap": turn.stop_reason == "tool_cap",
        "hit_length": turn.stop_reason == "length" or any(
            s.get("kind") == "model" and s.get("finishReason") == "length" for s in turn.trace),
        "answer": turn.answer, "trace": _drop_timings(turn.trace),
    }
    if "cards" in item:  # only for a set with linked cards, so other sets' records are unchanged
        record["linked_cards"] = list(item["cards"])
    return record


class FakeModel:
    """Scripted stand-in for tests only: one search_rules call, then a hash-chosen letter.

    Deterministic per question: the letter is picked from a sha256 of the
    question line, and every fifth hash bucket answers with no Answer line, so
    a run exercises correct, wrong and unanswered outcomes without a model.
    It makes its own call once whether or not the preload ran: it answers once
    it sees its own call (arguments ``{"query": <question>, "k": 3}``).
    """

    label = "fake"

    async def generate(self, messages, tools, *, max_tokens, enable_thinking):
        user = next(m["content"] for m in reversed(messages) if m["role"] == "user")
        question = user.split("Question: ", 1)[1].split("\n", 1)[0]
        letters = re.findall(r"^([A-Z])\. ", user, re.M)
        digest = int(hashlib.sha256(question.encode("utf-8")).hexdigest(), 16)
        base = {"ok": True, "finishReason": "stop", "promptTokens": 0, "generationTokens": 0, "elapsedMs": 0}
        own = {"query": question[:200], "k": 3}
        made = any(c["function"]["arguments"] == own for m in messages for c in m.get("tool_calls") or [])
        if not made:
            call = json.dumps({"name": "search_rules", "arguments": own})
            return {**base, "text": f"<tool_call>\n{call}\n</tool_call>"}
        if digest % 5 == 0:
            return {**base, "text": "The rules found do not settle it."}
        return {**base, "text": f"Fake reasoning from the search.\nAnswer: {letters[digest % len(letters)]}"}


def header_row(args, set_path: Path, items: list[dict], selected: list[dict]) -> dict:
    try:
        shown = str(set_path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        shown = str(set_path)
    header = {"kind": "header", "scorer_version": SCORER_VERSION, "eval_prompt_version": EVAL_PROMPT_VERSION,
            "assistant_prompt_version": ASSISTANT_PROMPT_VERSION, "rules_version": RULES_VERSION,
            "tournament_rules_version": TOURNAMENT_RULES_VERSION, "set": shown, "set_sha256": file_sha256(set_path), "set_items": len(items),
            "items_run": len(selected), "ids": args.ids, "limit": args.limit,
            "model": "fake" if args.fake else args.model, "adapter": args.adapter, "fake": bool(args.fake),
            "thinking": bool(args.thinking), "max_tokens": args.max_tokens, "max_tool_calls": args.max_tool_calls,
            "preload": bool(args.preload), "preload_k": args.preload_k if args.preload else None,
            "preload_chars": args.preload_chars if args.preload else None,
            "tool_specs_sha256": tool_specs_sha256()}
    if args.max_prompt_tokens != DEFAULT_MAX_PROMPT_TOKENS:
        header["max_prompt_tokens"] = args.max_prompt_tokens
    timeout = effective_timeout(args)
    if timeout is not None and timeout != DEFAULT_RESPONSE_TIMEOUT:
        # Absent at 600 s (every default run, and every run before the timeout scaled), so those headers
        # are unchanged; a longer step limit is part of how a run was made.
        header["worker_timeout_s"] = timeout
    sample, pass_mark = getattr(args, "sample", None), getattr(args, "pass_mark", None)
    if sample is not None:
        # Absent unless sampled, so a default run's header is unchanged; the ids make the draw readable without
        # recomputing it, and a resume compares them like any other setting.
        header.update({"sample": sample, "seed": args.seed, "sampled_ids": [i["id"] for i in selected]})
    if pass_mark is not None:
        header["pass_mark"] = pass_mark
    if args.preload and any("cards" in i for i in items):
        header["linked_cards"] = True  # absent otherwise, so other sets' headers are unchanged
    if args.max_tool_calls != MAX_TOOL_CALLS:
        # The prompt states the cap, so it is not the versioned default; say so (absent at the default, so a
        # default run's header is byte-identical to the runs made before the flag existed).
        header["system_prompt_sha256"] = hashlib.sha256(system_prompt(args.max_tool_calls).encode("utf-8")).hexdigest()
    return header


def effective_timeout(args) -> float | None:
    """Seconds one model step may take: ``--worker-timeout``, else ``step_timeout(--max-tokens)``; None for
    the fake model, which has no worker."""
    if args.fake:
        return None
    return float(args.worker_timeout) if args.worker_timeout is not None else step_timeout(args.max_tokens)


def resume_problem(rows: list[dict], header: dict, selected: list[dict]) -> str | None:
    """Why a partial's rows cannot be resumed by a run with ``header``, or None."""
    if not rows or not isinstance(rows[0], dict) or rows[0].get("kind") != "header":
        return "its first row is not a run header"
    theirs, ours = rows[0], json.loads(json.dumps(header, ensure_ascii=False))
    differ = [k for k in [*ours, *(k for k in theirs if k not in ours)] if theirs.get(k, "<absent>") != ours.get(k)]
    if differ:
        return "its header differs from this run's in: " + "; ".join(
            f"{k} (partial {json.dumps(theirs.get(k))}, now {json.dumps(ours.get(k))})" for k in differ)
    wanted, seen = {i["id"] for i in selected}, set()
    for row in rows[1:]:
        if not isinstance(row, dict) or row.get("kind") != "item" or row.get("id") not in wanted or row["id"] in seen:
            return "it holds a row that is not one of this run's questions, or a question twice"
        seen.add(row["id"])
    return None


def append_row(handle, row: dict) -> None:
    """One row of a partial run, in the same serialization as ``write_jsonl_atomic``, flushed and synced."""
    handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    handle.flush()
    os.fsync(handle.fileno())


async def run_items(model, selected: list[dict], *, thinking: bool, max_tokens: int, preload: bool = DEFAULT_PRELOAD,
                    preload_k: int = DEFAULT_PRELOAD_K, preload_chars: int = DEFAULT_PRELOAD_CHARS,
                    max_tool_calls: int = MAX_TOOL_CALLS, on_record=None, done: int = 0,
                    total: int | None = None) -> list[dict]:
    """Records for ``selected``, in order; ``on_record(record)`` runs as each one finishes.

    ``done`` and ``total`` only number the progress lines, so a resumed run counts on from where it stopped.
    """
    records = []
    total = len(selected) if total is None else total
    for n, item in enumerate(selected, done + 1):
        turn = await run_turn([], question_message(item), model, max_tokens=max_tokens, enable_thinking=thinking,
                              preload=preload, preload_text=preload_text(item), preload_k=preload_k,
                              preload_chars=preload_chars, max_tool_calls=max_tool_calls,
                              preload_cards=item.get("cards"))
        record = item_record(item, turn)
        records.append(record)
        if on_record is not None:
            on_record(record)
        print(f"[{n}/{total}] {item['id']}: chose {record['chosen'] or '-'}, key {record['correct'] or '-'}"
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


def sample_items(items: list[dict], n: int, seed: int) -> list[dict]:
    """``n`` keyed items (``correct`` not null) of ``items``, in their order: the first ``n`` by
    ``sha256(f"{seed}:{id}")``. The draw depends only on the seed and the ids, never on the order of ``items``."""
    keyed = [i for i in items if i.get("correct") is not None]
    if not 1 <= n <= len(keyed):
        raise EvalSetError(f"--sample must be 1..{len(keyed)} (the set's keyed items)")
    ranked = sorted(keyed, key=lambda i: (hashlib.sha256(f"{seed}:{i['id']}".encode("utf-8")).hexdigest(), i["id"]))
    chosen = {i["id"] for i in ranked[:n]}
    return [i for i in items if i["id"] in chosen]


def with_pass_mark(summary: dict, pass_mark: int | None) -> dict:
    """The summary with ``pass_mark`` and ``passed`` (correct >= pass_mark) when a pass mark was given."""
    if pass_mark is None:
        return summary
    return {**summary, "pass_mark": pass_mark, "passed": summary["correct"] >= pass_mark}


def official_pass_note(items: list[dict], selected: list[dict]) -> str | None:
    """The official test's pass rule for ``selected``, from the rows' ``official.pass_percent``, or None."""
    rules = sorted({i["official"]["pass_percent"] for i in items if isinstance(i.get("official"), dict)
                    and isinstance(i["official"].get("pass_percent"), int)})
    if not rules:
        return None
    n = len(selected)
    marks = ", ".join(f"{p}% ({-(-p * n // 100)}/{n})" for p in rules)
    return (f"Note: the official test passes at >= {marks}; this run judges no pass mark "
            f"(add --pass-mark to judge one).")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", required=True, help="multiple-choice gold set (.jsonl)")
    parser.add_argument("--model", help="local MLX model directory, e.g. models/qwen3-8b-4bit")
    parser.add_argument("--adapter", help="optional LoRA adapter directory for --model")
    parser.add_argument("--fake", action="store_true", help="scripted fake model (tests only)")
    parser.add_argument("--thinking", action=argparse.BooleanOptionalAction, default=DEFAULT_THINKING,
                        help="let Qwen3 think before answering (default on; --no-thinking to compare)")
    parser.add_argument("--max-tokens", type=int, default=None,
                        help=f"generation limit per model step, 1..{MAX_TOKENS_LIMIT} "
                             "(default 2048 thinking, 1024 not)")
    parser.add_argument("--max-tool-calls", type=int, default=MAX_TOOL_CALLS,
                        help=f"model tool calls per question, 1..{MAX_TOOL_CALLS_LIMIT} (default {MAX_TOOL_CALLS})")
    parser.add_argument("--max-prompt-tokens", type=int, default=DEFAULT_MAX_PROMPT_TOKENS,
                        help=f"prompt cap per model step, 1..{MAX_PROMPT_TOKENS_LIMIT} (default "
                             f"{DEFAULT_MAX_PROMPT_TOKENS}; the worker also keeps --max-tokens of room in the "
                             "model's context)")
    parser.add_argument("--worker-timeout", type=float, default=None,
                        help="seconds one model step may take (default: max(600, 120 + 0.15 x --max-tokens))")
    parser.add_argument("--preload", action=argparse.BooleanOptionalAction, default=DEFAULT_PRELOAD,
                        help="run search_rules and card linking before the model speaks (default on)")
    parser.add_argument("--preload-k", type=int, default=DEFAULT_PRELOAD_K, help="rules passages preloaded (1..20)")
    parser.add_argument("--preload-chars", type=int, default=DEFAULT_PRELOAD_CHARS,
                        help="character budget for preloaded results")
    parser.add_argument("--limit", type=int, default=None, help="run only the first N selected items (0: all)")
    parser.add_argument("--ids", help="comma-separated item ids to run")
    parser.add_argument("--sample", type=int, default=None,
                        help="draw N of the set's keyed questions (needs --seed; not with --ids or --limit)")
    parser.add_argument("--seed", type=int, default=None, help="seed for --sample, a whole number >= 0")
    parser.add_argument("--pass-mark", type=int, default=None,
                        help="correct answers needed to pass, 1..items run (e.g. 35 of a 40-question sample)")
    parser.add_argument("--name", required=True, help="run name; writes <runs-dir>/<name>.jsonl")
    parser.add_argument("--runs-dir", default=str(RUNS_DIR), help="where runs go (default eval/runs)")
    parser.add_argument("--force", action="store_true",
                        help="replace an existing run of the same name, or discard its unfinished partial")
    parser.add_argument("--resume", action="store_true",
                        help="continue <name>.partial.jsonl from a stopped run with the same settings")
    args = parser.parse_args(argv)
    if bool(args.fake) == bool(args.model):
        parser.error("give exactly one of --model or --fake")
    if args.adapter and not args.model:
        parser.error("--adapter needs --model")
    if not RUN_NAME_RE.match(args.name):
        parser.error("--name must be 1-80 letters, digits, '.', '_' or '-', starting with a letter or digit")
    if f"{args.name}.jsonl".endswith(PARTIAL_SUFFIX):
        parser.error("--name must not end in '.partial': that is where an unfinished run is kept")
    if args.max_tokens is None:
        args.max_tokens = default_max_tokens(args.thinking)
    if not 1 <= args.max_tokens <= MAX_TOKENS_LIMIT:
        parser.error(f"--max-tokens must be 1..{MAX_TOKENS_LIMIT}")
    if not 1 <= args.max_tool_calls <= MAX_TOOL_CALLS_LIMIT:
        parser.error(f"--max-tool-calls must be 1..{MAX_TOOL_CALLS_LIMIT}")
    if not 1 <= args.max_prompt_tokens <= MAX_PROMPT_TOKENS_LIMIT:
        parser.error(f"--max-prompt-tokens must be 1..{MAX_PROMPT_TOKENS_LIMIT}")
    if args.worker_timeout is not None and not 1 <= args.worker_timeout <= 86400:
        parser.error("--worker-timeout must be 1..86400 seconds")
    if not 1 <= args.preload_k <= 20:
        parser.error("--preload-k must be 1..20")
    if not 0 <= args.preload_chars <= 100000:
        parser.error("--preload-chars must be 0..100000")
    if args.sample is not None:
        if args.seed is None:
            parser.error("--sample needs --seed")
        if args.ids is not None or args.limit is not None:
            parser.error("--sample cannot be combined with --ids or --limit")
    elif args.seed is not None:
        parser.error("--seed is only used with --sample")
    if args.seed is not None and args.seed < 0:
        parser.error("--seed must be a whole number >= 0")
    if args.limit is None:
        args.limit = 0  # recorded as 0, as before the flag could be absent
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
        if args.sample is not None:
            selected = sample_items(items, args.sample, args.seed)
        else:
            selected = select(items, args.ids, args.limit)
    except EvalSetError as exc:
        parser.error(str(exc))
    if args.pass_mark is not None and not 1 <= args.pass_mark <= len(selected):
        parser.error(f"--pass-mark must be 1..{len(selected)} (the items run)")
    header = header_row(args, set_path, items, selected)
    partial = partial_path(runs_dir, args.name)
    done: dict[str, dict] = {}
    if partial.exists():
        if args.resume:
            try:
                rows = read_partial_rows(partial)
            except (OSError, ValueError) as exc:
                parser.error(f"cannot resume {partial}: unreadable: {exc}")
            problem = resume_problem(rows, header, selected)
            if problem:
                parser.error(f"cannot resume {partial}: {problem}")
            done = {row["id"]: row for row in rows[1:]}
        elif not args.force:
            parser.error(f"{partial} exists from an unfinished run; pass --resume to continue it "
                         "or --force to start over")
    remaining = [item for item in selected if item["id"] not in done]
    if args.fake:
        model = FakeModel()
    else:
        from games.cyberpunk.assistant.mlx_chat import make_chat_model
        try:
            model = make_chat_model(args.model, adapter=args.adapter, response_timeout=effective_timeout(args),
                                    max_prompt_tokens=args.max_prompt_tokens)
        except ValueError as exc:
            parser.error(str(exc))
    print(f"Scoring {len(selected)} of {len(items)} item(s) from {set_path.name} with {model.label} "
          f"(thinking {'on' if args.thinking else 'off'}, preload {'on' if args.preload else 'off'}, "
          f"max tokens {args.max_tokens}, prompt {EVAL_PROMPT_VERSION}) -> {out}", flush=True)
    if "worker_timeout_s" in header or "max_prompt_tokens" in header:
        print(f"Model step limits: {header.get('worker_timeout_s', DEFAULT_RESPONSE_TIMEOUT):.0f} s per step, "
              f"prompt cap {args.max_prompt_tokens} tokens (recorded in the header).", flush=True)
    if args.max_tool_calls != MAX_TOOL_CALLS:
        print(f"Tool-call cap {args.max_tool_calls} (default {MAX_TOOL_CALLS}): the system prompt states it, so "
              f"the header records system_prompt_sha256.", flush=True)
    if args.sample is not None:
        print(f"Sample: {args.sample} keyed question(s), seed {args.seed}.", flush=True)
    if args.pass_mark is None:
        note = official_pass_note(items, selected)
        if note:
            print(note, flush=True)
    if done:
        print(f"Resuming {partial.name}: {len(done)} of {len(selected)} item(s) already done.", flush=True)
    # The partial is rewritten whole (header and the rows kept), then appended to row by row.
    write_jsonl_atomic(partial, [header, *(done[i["id"]] for i in selected if i["id"] in done)])

    async def go():
        try:
            with partial.open("a", encoding="utf-8") as handle:
                return await run_items(model, remaining, thinking=args.thinking, max_tokens=args.max_tokens,
                                       preload=args.preload, preload_k=args.preload_k,
                                       preload_chars=args.preload_chars, max_tool_calls=args.max_tool_calls,
                                       on_record=lambda record: append_row(handle, record), done=len(done),
                                       total=len(selected))
        finally:
            close = getattr(model, "close", None)
            if close is not None:
                await close()

    fresh = {record["id"]: record for record in asyncio.run(go())}
    records = [done.get(item["id"]) or fresh[item["id"]] for item in selected]
    summary = with_pass_mark(summarize(records), args.pass_mark)
    rows = [header, *records, {"kind": "summary", **summary}]
    if out.exists() and not args.force:  # Created while the run was going: still never overwrite.
        print(f"{out} appeared during the run; not overwriting (pass --force). The rows are in {partial}.",
              file=sys.stderr)
        return 1
    write_jsonl_atomic(out, rows)
    partial.unlink()
    score = (f"{summary['correct']}/{summary['scored']} scored correct ({summary['score']:.1%})"
             if summary["scored"] else "no scored items")
    print(f"Score: {score}; unanswered {summary['unanswered']}; wrong {summary['wrong']}; "
          f"unscored {summary['unscored']}; known-incorrect picks {summary['known_incorrect_hits']}; "
          f"tool use {summary['tool_use']}/{summary['items']} ({(summary['tool_use_rate'] or 0):.1%})"
          + (f"; {'PASS' if summary['passed'] else 'FAIL'} ({args.pass_mark}/{summary['items']} needed)"
             if args.pass_mark is not None else ""), flush=True)
    print(f"Wrote {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
