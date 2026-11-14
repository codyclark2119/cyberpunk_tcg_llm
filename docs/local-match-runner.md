# Local match runner

Date: 2026-11-11. Engine identity at writing: `0.4.0-api-admission-6`
(`29d5a9e0…4960`). Scope 2 of the move to a local-only project, after the
[simulator bridge retirement](simulator-bot-retirement.md).

## What it is

Bots now play full games on this machine. `games/cyberpunk/local_match.py`
connects the TypeScript engine worker (`scripts/engine-worker.ts`, through
`games/cyberpunk/engine_adapter.py`) to the retained policy layer
(`games/cyberpunk/sim_bot.py`). `scripts/run_local_matches.py` is its CLI.

The engine stays the only rules authority. The runner implements no rules,
enumerates no actions and decides no legality.

## How a match runs

1. `EngineWorker.create_game` (new) sends the content bundle and a createGame
   `initialization` to the worker, unchanged except for the seed and a matchId
   derived from it (UUIDv5).
2. Until the state carries `match.outcome`: the runner reads who acts from the
   engine's `timing.actingPlayer`, asks the worker for that player's public
   `ModelInputV2`, and builds a `Decision` from the public observation and the
   engine's action descriptors only. Game states, events and hidden cards never
   reach a policy.
3. That engine seat's `PolicyRunner.choose` returns an offered `actionId`, with
   the usual 2,500 ms cap and baseline fallbacks (since
   [local-time-budget.md](local-time-budget.md): a `--budget-ms` setting, default 10,000 ms). The runner checks the id was
   offered and submits only that id through `applyAction`.
4. The match stops at the engine's outcome, at `--max-decisions` (default 2,000),
   when the turn passes `--max-turns` (default 120), when the acting player is
   offered nothing, or on a worker error. Every stop writes a result row.

With `baseline` on both seats a seed always replays the same game: the baseline
breaks ties on the offered id and the engine is deterministic.

## Decks and formats

The runner is format agnostic. The default setup is the fixed Demo content and
decks, printed by `scripts/local-match-setup.ts` from the existing test fixtures
(`demoStarterContext`, `demoStarterInput`). `--setup FILE` takes any JSON object
with `content` and `initialization` that the engine's `createGame` accepts;
committed replay fixtures already have that shape. The worker refuses a bundle
that does not pin its own engine identity.

## Match record

One JSONL file per match, written with `write_jsonl_atomic` under
`local/matches/<seed>.jsonl` (gitignored). An existing record is never replaced
without `--force`. Rows:

- `match`: `schemaVersion` 1, `matchId`, `seed`, `format`, `setupSource`,
  `players`, `decks`, `engine` (`version`, `artifactHash`), `contentManifestHash`,
  `seats` (`seat`, `policy`), `limits`, `initialStateHash`.
- `decision`: `index`, `turn`, `step`, `seat`, `playerId`, `policy`, `offered`
  (count), `actionId`, `label` (the public descriptor label), `reason`
  (`baseline`, `policy`, or a `*_fallback` such as `timeout_fallback` or
  `invalid_action_fallback`), `elapsedMs`, `stateHash` after the action.
- `result`: `status` (`finished`, `decision_cap`, `turn_cap`, `no_legal_actions`,
  `engine_error`), `detail`, `winnerSeat`, `loserSeat`, `reason` (the engine's
  outcome reason), `turns`, `decisions`, `selections`, `finalStateHash`.

Update 2026-11-11 ([local-time-budget.md](local-time-budget.md)): `schemaVersion`
2 adds `budgetMs` to the header and to each `seats` entry, `error` and
`workerEvent` to decision rows, and `errors` and `workerRestarts` to the result row
and the CLI summary.

Update 2026-11-12 ([local-match-records-v3.md](local-match-records-v3.md)):
`schemaVersion` 3 adds each seat's `modelPath`, `modelRevision` (read from the
local download metadata, else null), `adapterPath`, `adapterRevision` and
`promptVersion` to the header; `chosenIndex`, `baselineActionId`,
`baselineIndex`, `agreesWithBaseline`, `rawOutput`, `inputTokens` and
`outputTokens` to decision rows; and `baselineAgreement` per seat to the result
row and per policy to the CLI summary. `--training-dir DIR` (off by default)
also logs each model decision as a TrainingPosition plus a TrainingAttempt.

The record holds ids, public labels and hashes only, no states or events. A
viewer that needs board positions can replay the action ids through the engine.

```bash
python scripts/run_local_matches.py [--matches N] [--seed PREFIX] [--policy SEAT0 SEAT1]
    [--setup FILE] [--output-dir DIR] [--force] [--max-decisions N] [--max-turns N]
    [--model PATH] [--adapter PATH] [--budget-ms MS] [--training-dir DIR]
```

The CLI prints a JSON summary: statuses, wins by seat, end reasons, selection
counts, fallbacks and the slowest decision. An `mlx` seat requires native arm64
Python on Apple Silicon and a downloaded model ([local-mlx-bot.md](local-mlx-bot.md)).

## Measured on this change

Baseline vs baseline on the Demo decks, Linux container: games end by the engine's
outcome in roughly 100–140 decisions and 11–14 turns, about 13 s per game. Most of
that is the worker re-validating the full content bundle and state on every
request. Seat 0 won all of the few seeds tried; the baseline is a smoke-play
heuristic, so that says nothing about deck strength.

Update 2026-11-14: model games have since been run on the Mac. With prompt
`local-choice-v4` and the 10 s budget, 20 matches per model against the baseline
(both seats, 2026-11-12): Qwen3-8B-4bit won 16-4 and Qwen3-4B-4bit 14-6, with no
fallbacks; the intervals overlap. See
[local-strength-eval.md](local-strength-eval.md#results-2026-11-12). Records this
runner writes can be checked against the engine with the
[match record auditor](local-match-audit.md).

## Other changes

- `scripts/benchmark_sim_bot.py` now draws its default positions from real
  engine games: `--matches` baseline games (seed `--seed`), keeping decisions with
  more than one offered action, `--positions` of them evenly spaced. The synthetic
  smoke decision is gone; `--requests` still takes saved decision records. It
  still refuses anything but native Apple Silicon. Late-game prompts built from a
  full observation reach about 10,000 characters, so the 4,096-token prompt cap
  may produce `prompt_too_large` fallbacks; that is a real measurement to look at
  on the Mac.
- `SYSTEM_PROMPT` no longer says "Cyberpunk TCG Sim" or "The simulator owns
  legality". `PROMPT_VERSION` moved from `sim-choice-v1` to `local-choice-v2`.
  No adapter has been stamped against this prompt, so nothing is invalidated.
- The `scripts/mlx_sim_worker.py` docstring names `run_local_matches.py` instead
  of the removed `serve_sim_bot.py`.
- `scripts/test_local_match.py` prints `PASS local match runner: 12/12`, pinned in
  `pr-validation.yml`; the workflow guard requires the command. (Note added
  2026-11-12: that workflow was later removed; the pin now lives in the table at
  the top of `scripts/run_tests.sh`.)

## Left for later scopes

- Scope 3: a UI that reads these match records.
- Scope 4 or later: real MLX games and benchmark runs on the Mac, prompt size
  versus the token cap, a faster worker path (the bundle is resent per request),
  and renaming the `sim_*` modules.

(Update 2026-11-14: Mac MLX games, the benchmark, shorter prompts and the
`policy_*` rename have since landed; see [local-time-budget.md](local-time-budget.md),
[local-prompt-v3.md](local-prompt-v3.md) and
[local-strength-eval.md](local-strength-eval.md). The per-request bundle resend is
not addressed by those documents.)
