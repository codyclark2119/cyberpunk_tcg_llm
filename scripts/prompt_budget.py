#!/usr/bin/env python3
"""Print how much of the local assistant's prompt is fixed overhead: system prompt and tool specs.

Why: the quiz diagnosis (2026-11-12) found the 8B 4-bit model read about 11k
characters (roughly 3k tokens) of system prompt and twelve tool specs before
the question on every model step. This measures that overhead the same way
every time, so a change to a tool description or the prompt shows its cost:
characters per tool spec (its JSON as ``json.dumps`` writes it, the form the
chat template serialises), the system prompt's characters and the totals.

With ``--tokenizer <local model dir>`` and ``transformers`` installed it also
counts real tokens with that tokenizer, per spec and for the system prompt, and
the whole rendered prefix through the chat template when the tokenizer has one.
Without a loadable tokenizer (the usual case on Linux) it reports characters
only and says why; it never downloads anything.

Usage:
    python scripts/prompt_budget.py
    python scripts/prompt_budget.py --json
    python scripts/prompt_budget.py --tokenizer models/qwen3-8b-4bit
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.assistant.loop import ASSISTANT_PROMPT_VERSION, SYSTEM_PROMPT, tool_specs_sha256  # noqa: E402
from games.cyberpunk.assistant.tools import tool_specs  # noqa: E402


def spec_chars(spec: dict) -> int:
    return len(json.dumps(spec, ensure_ascii=False))


def load_tokenizer(path: str | None):
    """(tokenizer or None, reason it is None). Local files only."""
    if not path:
        return None, "no --tokenizer given; characters only"
    local = Path(path).expanduser()
    local = local if local.is_absolute() else REPO_ROOT / local
    if not local.is_dir():
        return None, f"{path} is not a local directory; characters only"
    try:
        from transformers import AutoTokenizer
    except ImportError:
        return None, "transformers is not installed; characters only"
    try:
        return AutoTokenizer.from_pretrained(str(local), local_files_only=True), None
    except Exception as exc:  # a broken or partial model directory: report and fall back
        return None, f"tokenizer did not load ({type(exc).__name__}); characters only"


def budget(tokenizer=None) -> dict:
    specs = tool_specs()

    def tokens(text: str) -> int | None:
        return None if tokenizer is None else len(tokenizer.encode(text, add_special_tokens=False))

    rows = []
    for spec in specs:
        text = json.dumps(spec, ensure_ascii=False)
        rows.append({"tool": spec["function"]["name"], "chars": len(text),
                     "description_chars": len(spec["function"]["description"]), "tokens": tokens(text)})
    tool_chars = sum(r["chars"] for r in rows)
    report = {"prompt_version": ASSISTANT_PROMPT_VERSION, "tool_specs_sha256": tool_specs_sha256(),
              "tools": rows, "tool_count": len(rows), "tool_chars": tool_chars,
              "system_prompt_chars": len(SYSTEM_PROMPT), "total_chars": tool_chars + len(SYSTEM_PROMPT),
              "tool_tokens": None, "system_prompt_tokens": tokens(SYSTEM_PROMPT), "rendered_prefix_tokens": None}
    if tokenizer is not None:
        report["tool_tokens"] = sum(r["tokens"] for r in rows)
        try:
            ids = tokenizer.apply_chat_template([{"role": "system", "content": SYSTEM_PROMPT}], tools=specs,
                                                tokenize=True, add_generation_prompt=False)
            if hasattr(ids, "keys") and "input_ids" in ids:  # transformers 5 returns a BatchEncoding, not a list
                ids = ids["input_ids"]
            report["rendered_prefix_tokens"] = len(ids)
        except Exception:  # no chat template, or one without tools: the per-part counts still stand
            pass
    return report


def render(report: dict, note: str | None) -> str:
    width = max(len(r["tool"]) for r in report["tools"])
    lines = [f"Prompt overhead, prompt {report['prompt_version']}, tool specs sha256 {report['tool_specs_sha256'][:12]}"]
    lines.append(f"{'tool':<{width}}  {'chars':>6}  {'desc':>5}  {'tokens':>6}")
    for r in report["tools"]:
        lines.append(f"{r['tool']:<{width}}  {r['chars']:>6}  {r['description_chars']:>5}  "
                     f"{'-' if r['tokens'] is None else r['tokens']:>6}")
    tok = report["tool_tokens"]
    lines.append(f"tool specs: {report['tool_count']} tools, {report['tool_chars']} chars"
                 + ("" if tok is None else f", {tok} tokens"))
    sys_tok = report["system_prompt_tokens"]
    lines.append(f"system prompt: {report['system_prompt_chars']} chars"
                 + ("" if sys_tok is None else f", {sys_tok} tokens"))
    lines.append(f"total: {report['total_chars']} chars"
                 + ("" if report["rendered_prefix_tokens"] is None
                    else f"; rendered through the chat template: {report['rendered_prefix_tokens']} tokens"))
    if note:
        lines.append(f"({note})")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tokenizer", help="local model directory whose tokenizer counts real tokens")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    args = parser.parse_args(argv)
    tokenizer, note = load_tokenizer(args.tokenizer)
    report = budget(tokenizer)
    report["tokenizer_note"] = note
    print(json.dumps(report, indent=1, ensure_ascii=False) if args.json else render(report, note))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
