#!/usr/bin/env python3
"""Report the local bot's prompt size over real engine positions, without a model.

Why: on Apple Silicon, a gameplay decision's time is almost all prompt prefill
(the answer is about 6 tokens), so prompt length is decision latency, and
mlx_policy_worker.py refuses any prompt over --max-prompt-tokens (4,096 by default).
This plays --matches baseline-vs-baseline games on the local engine (seeds
<seed>-0, <seed>-1, ..., the same as benchmark_policy_bot.py), renders every
decision the policy would receive with the current prompt (PROMPT_VERSION),
with local-choice-v3 (the same prompt without its card reference) and with
the retired local-choice-v2 JSON prompt, and reports characters per
position: min, median, p95 and max overall and for the early, middle and late
third of each game's decisions, plus an approximate token count at
--chars-per-token (the 2026-11-11 Mac run with Qwen3-8B saw about 3). Counts
cover the system and user messages; the chat template adds a few tokens more.
The exact count needs the model's tokenizer: run benchmark_policy_bot.py on a Mac.
--sample also prints the largest position's full prompt to stderr. The play
UI's "Prompt size" tab (scripts/play_local.py) runs the same measurement.
No model, network or GPU is used; it needs node and installed npm dependencies.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

# The measurement lives in games/cyberpunk/prompt_size.py so the play UI's
# "Prompt size" tab runs the same code; these names stay importable from here.
from games.cyberpunk.prompt_size import (V2_SYSTEM_PROMPT, baseline_games, largest_prompt,  # noqa: F401
                                         prompt_chars, report, stats, v2_messages, v3_messages)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--matches", type=int, default=3, help="baseline games to measure")
    parser.add_argument("--seed", default="benchmark", help="match seed prefix; match i uses <seed>-<i>")
    parser.add_argument("--chars-per-token", type=float, default=3.0,
                        help="assumed characters per token for the approximate counts (default 3)")
    parser.add_argument("--sample", action="store_true",
                        help="also print the largest position's full prompt (system, then user) to stderr")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if args.matches < 1 or not args.chars_per_token > 0:
        parser.error("--matches and --chars-per-token must be positive")
    seeds = [f"{args.seed}-{index}" for index in range(args.matches)]
    games = asyncio.run(baseline_games(seeds, args.node))
    result = report(games, args.chars_per_token)
    result["seeds"] = seeds
    sample = largest_prompt(games, args.chars_per_token)
    result["largest"] = {key: value for key, value in sample.items() if key not in ("system", "user")}
    for name, version in result["versions"].items():
        print(f"{name}: characters per position (system + user), ~tokens at "
              f"{args.chars_per_token:g} chars/token", file=sys.stderr)
        for phase, row in version.items():
            print(f"  {phase:5} n={row['positions']:4}  min {row['min']:6}  median {row['median']:6}  "
                  f"p95 {row['p95']:6}  max {row['max']:6}  (~{row['approxTokens']['median']} / "
                  f"~{row['approxTokens']['max']} tokens median / max)", file=sys.stderr)
    if args.sample:
        print(f"\nLargest {sample['promptVersion']} prompt: game {sample['game']}, decision "
              f"{sample['decision']}, turn {sample['turn']}, {sample['chars']} chars "
              f"(~{sample['approxTokens']} tokens)\n--- system ---\n{sample['system']}\n"
              f"--- user ---\n{sample['user']}\n", file=sys.stderr)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
