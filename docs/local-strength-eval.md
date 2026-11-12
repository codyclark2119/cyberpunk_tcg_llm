# Local strength eval

Date: 2026-11-12. Engine identity at writing: unchanged (no engine, wire or worker
file was touched). Follows [local match records v3](local-match-records-v3.md) and
[local prompt v4](local-prompt-v4.md). No real model ran for this change; the
numbers below for Mac runs are estimates from earlier timings, not measurements.

## What it measures

`scripts/eval_local_strength.py` plays many matches of each local-model
configuration against the deterministic baseline bot on the local engine and
summarises them. A configuration is one local model directory, one prompt version
and one decision budget; the CLI takes every combination of its repeated
`--model`, `--prompt-version` and `--budget-ms`.

Every configuration plays the same seed list. Match `i` uses seed
`<--seed>-<i // 2>` with the model in seat `i % 2`, so each seed is played once
with the model in each seat. In the Demo setup the seats hold different decks, so
this also gives each configuration each deck equally often. `--matches` (per
configuration) must be even.

Per configuration the summary (`games/cyberpunk/strength_eval.py`) gives:

| Field | Meaning |
| --- | --- |
| `wins`, `losses`, `draws`, `noResult`; `bySeat` | From the model's side, overall and per model seat. A draw is a stop with no winner: an engine outcome without one, or the turn or decision cap. `noResult` is anything else (`engine_error`, `no_legal_actions`) |
| `winRate`, `winRateInterval95` | wins / (wins + losses + draws), with a 95% Wilson score interval. `noResult` matches are left out |
| `baselineAgreement` | Over the model seat's decisions: `agree` / `decisions` (`rate`) and the mean of per-match rates. None ("n/a") when no record has the v3 agreement fields, never 0; `matchesWithout` counts v2 records left out |
| `fallbacks` | Model-seat decisions answered by the baseline instead, by failure code (`timeout`, `invalid_output`, `prompt_too_large`, ...), and their share of decisions |
| `latencyMs` | p50 / p95 / max of the model seat's per-decision elapsed ms (nearest rank), fallbacks included |
| `inputTokens` | Median and max prompt tokens the worker reported; None for records without them |
| `wallSeconds` | Sum of the configuration's match wall times; the run adds `loadSeconds` for model loads |
| `matchList` | Each record with its seed, model seat, outcome and agreement (the UI links these into the viewer) |

The summary reads only the match records (and the run's `timings.jsonl` for wall
time), so a run can be re-summarised at any time with `--summarize-only`, and the
play UI recomputes it on every view. The configuration is taken from each
record's header (model path, revision, adapter, prompt version, budget), never
from a file name. Records with two baseline or two non-baseline seats are listed
under `skipped`.

## Files

Everything goes under `local/strength/<run-id>/` (gitignored):

- `plan.json`: configurations (with model revisions), seeds, setup source, engine
  identity and limits. Re-running with the same `--run-id` resumes: finished
  matches are skipped and a model whose matches all exist is not loaded. A
  different plan under an existing run id is refused.
- `matches/<config>-<seed>-s<model seat>.jsonl`: ordinary schemaVersion 3 match
  records ([local-match-records-v3.md](local-match-records-v3.md)).
- `timings.jsonl`: wall time per match and per model load.
- `summary.json`: rewritten after every match.

Apart from timings, a run is deterministic given its seeds: the engine and the
baseline are, and the worker decodes greedily. The exception is a decision the
model answers after its budget, which falls back to the baseline; a slower or
busier machine can change those.

## Prompt versions

`policy_prompt.PROMPT_VERSIONS` is `local-choice-v3` and `local-choice-v4`. v3 is
rendered as v4 without the card reference (the v3 system prompt, no `Cards:`
section), which `scripts/test_local_prompt.py` already checks is byte-identical to
v3. `MLXPolicy` sends the prompt named by its `info["promptVersion"]`, and
`model_info(..., prompt_version=...)` records that version and its fingerprint in
the match header. The default remains v4. A larger `MAX_REFERENCE_TEXT_CHARS`
(suggested by the v4 report) is not a selectable option; trying it means a new
prompt version.

## Reading the interval

The Wilson interval is the range of true win rates consistent with the observed
count at 95% confidence. It is wide for small runs: 10 wins in 20 games gives
about [0.30, 0.70]; 50 in 100 about [0.40, 0.60]. Two configurations differ
reliably only when their intervals barely overlap or not at all; overlapping
intervals mean "not shown different", not "equal". Matches on the same seeds are
paired, so an informal look at which seeds flipped (the per-match list) helps more
than the interval alone. As a rule of thumb, telling a 10-point difference near
50% apart takes a few hundred games per configuration.

## Suggested first Mac run

Both 4-bit Qwen3 models at v4, 20 matches each (10 seeds, both seats), default
10 s budget:

```bash
python scripts/eval_local_strength.py --run-id qwen3-v4-first \
  --model models/qwen3-8b-4bit --model models/qwen3-4b-4bit --matches 20
```

Estimated wall time, from the v3 timings (8B about 1.4 s and 4B about 0.84 s per
decision) times about 1.5 for v4's longer prompt, 40-70 model decisions per match
and a few seconds of engine and baseline time per match:

| Model | s per decision (v4, est.) | per match | 20 matches |
| --- | --- | --- | --- |
| Qwen3-8B-4bit | ~2.1 | ~1.5-2.6 min | ~30-50 min |
| Qwen3-4B-4bit | ~1.3 | ~1-1.6 min | ~20-32 min |

So roughly 50-85 minutes for the pair, plus model loads. It resumes if
interrupted (rerun the same command). Adding
`--prompt-version local-choice-v3 --prompt-version local-choice-v4` compares both
prompts on the same seeds and doubles the run. The play UI's "Strength" tab
launches the same command and shows the summaries side by side.

## Play UI

`scripts/play_local.py` gains a "Strength" tab. Launching goes through the
monitor's allowlisted `Runner` like the bot-vs-bot job (one job at a time, shared
with it): up to three models chosen from the `models/*` directories with a
`config.json` found at server start (plus `--model`, if given), up to two prompt
versions from `PROMPT_VERSIONS`, matches, seed prefix, budget and max turns;
`--output-root` is fixed to `<records>/../strength`. While a job runs, its log and
the run's summary refresh every few seconds. Past runs are listed; selecting
several and pressing "Compare" shows each configuration's W-L-D per seat, win rate
and interval, agreement, fallbacks, latency, tokens and wall time in one table,
and each match opens in the existing record viewer
(`GET /api/strength/{run}/records/{name}`).

## What it does not measure

- Strength against anything but the baseline heuristic. Beating the baseline is
  not playing well; the baseline is a fixed, simple bot.
- Other decks or formats unless `--setup` gives them; by default only the fixed
  Demo pair is played.
- Decision quality per move. Agreement says only how often the model chose what
  the baseline would have; fallbacks are decisions the baseline made for it, so a
  configuration with many fallbacks is partly measuring the baseline.
- Latency under other load or on other machines; timings are of the machine that
  ran it.
- Statistical significance between configurations beyond the per-configuration
  interval; no paired test is computed.

## Tests

`scripts/test_strength_eval.py`, `PASS strength eval: 10/10` (pinned as
`py-strength-eval` in `scripts/run_tests.sh`): Wilson and percentile values;
every summary number on hand-built records, draws and no-result matches included;
v2 records reported as n/a; the CLI on the real engine with a fake MLX worker
subprocess (seat alternation on the same seeds for two prompt versions, prompt
version reaching the model, one model load for both); resume skipping finished
matches, replaying a missing one identically and refusing a changed plan;
argument checks and `--summarize-only`; the UI's allowlisted launch, run listing,
summary and record routes, and the page script parsing. `scripts/test_play_app.py`
stays 13/13 (its action-list check now expects the strength action too). `scripts/test_policy_mlx.py`
stays 33/33; one fixture's placeholder prompt version `"v"` became `PROMPT_VERSION`,
since `MLXPolicy` now refuses a version it cannot render.
