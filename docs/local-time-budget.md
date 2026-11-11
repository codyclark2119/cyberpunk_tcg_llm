# Local decision budget and late model answers

2026-11-11. Scope: `games/cyberpunk/sim_bot.py`, `games/cyberpunk/sim_mlx.py`,
`harness/core/local_worker.py`, `games/cyberpunk/local_match.py`,
`games/cyberpunk/play_app.py`, `scripts/run_local_matches.py`,
`scripts/benchmark_sim_bot.py`. Prompt text and `PROMPT_VERSION` are unchanged.

## What the first Mac run showed

M3 Max, 64 GB, Qwen3-8B-4bit, master `14026d3`:

- `benchmark_sim_bot.py`, 100 decisions at the 2,500 ms budget: 15 model choices
  and 85 timeout fallbacks. Every prompt over about 1,950 tokens timed out.
  Generations are about 6 tokens, so prefill dominates; the long positions needed
  2.6–5.1 s.
- `run_local_matches.py --policy mlx baseline --seed 1`: the mlx seat made 71
  decisions, 0 model choices, 5 `timeout_fallback` and 66 `policy_error_fallback`.
  Each timeout was followed by a run of 0.2–0.5 ms policy errors. The record did
  not store the error code; the inferred cause was the worker refusing new
  requests (`worker_busy`) while it finished the late generation.

## Why the 2,500 ms cap was dropped

The 2,500 ms `PolicyRunner` cap and the 30 s worker watchdog were inherited from
the retired simulator bridge, whose server gave each decision 3,000 ms
([simulator-bot-retirement.md](simulator-bot-retirement.md)). Local play has no
external deadline: the engine waits for the policy. The cap only threw away
answers the model was about to give. The budget is now a setting:

- `PolicyRunner(max_decision_ms=...)`, default `DEFAULT_DECISION_BUDGET_MS =
  10_000` in `sim_bot.py`. 10 s covers the slowest measured position (5.1 s) with
  room for longer ones; prompt shortening is the next change.
- `--budget-ms` on `run_local_matches.py` and `benchmark_sim_bot.py`, and a
  "Bot budget ms" field in the play UI (human match and bot-vs-bot job).
  Accepted values are 1–600,000 ms.
- The match header records each seat's `budgetMs` (`null` for a baseline or human
  seat, which has nothing to time) and the largest as `budgetMs`. The record's
  `schemaVersion` is now 2. The benchmark report keeps `serviceBudgetMs`.
- The worker watchdog follows the budget: `max(30 s, 3 x budget)`
  (`sim_mlx.watchdog_seconds`). It only has to stop a wedged worker.

Existing tests that need short budgets pass them explicitly.

## Late answers: drain, do not restart

A timeout cancels the policy call, but the worker keeps generating. Before this
change the next request failed at once with `worker_busy` until that generation
ended, so one slow position cost a run of decisions.

Fix chosen: **wait for the abandoned answer to finish and discard it before the
next request is written.** Restarting the worker instead would reload the weights
(tens of seconds or more) on every timeout, far more than the few seconds a late
answer needs.

- `LocalWorker` marks an exchange *abandoned* when its caller is cancelled. A new
  request waits for an abandoned exchange (`drain_abandoned`) and then sends. A
  *live* exchange is never waited on: a second live caller still fails fast with
  `worker_busy`, so there is no GPU queue.
- `MLXPolicy.prepare()` runs the same drain before the runner starts the next
  decision's clock, so the wait does not eat into that decision's budget.
- A late answer can never be applied to a later decision: each exchange writes one
  request with a fresh id and reads exactly one reply that must carry that id
  (anything else stops the worker). Request N+1 is not written until exchange N
  has read its reply, and ids keep increasing across restarts. The abandoned
  reply is counted (`late_replies_discarded`) and dropped.
- If the worker has died (EOF, protocol fault, watchdog), `prepare()` restarts it
  once per match (`MLXPolicy.begin_match` resets the allowance; seats sharing a
  worker share one `MLXPolicy`). The decision row records `workerEvent:
  "worker_restarted"` (or `"worker_restart_failed"`), and the result row counts
  `workerRestarts`. After that the match continues on the baseline.

## Failure codes in records

Decision rows now carry `error` next to `reason` (`null` on a model or baseline
choice); result rows and the CLI summary count them as `errors`. The play UI's
record viewer shows an Error column and the decision's error and worker event.

| `error` | Meaning |
| --- | --- |
| `timeout` | the policy did not answer within the budget |
| `deadline_exceeded` | the budget was spent before the policy was called |
| `runner_busy` | the runner's outstanding-call cap was reached |
| `invalid_action` | the policy returned an id the engine did not offer |
| `invalid_output` | the model's text was not exactly one in-range `{"choice": n}` |
| `prompt_too_large` | the rendered prompt exceeded `--max-prompt-tokens` |
| `incomplete_output`, `generation_failed` | the worker reported a generation fault |
| `worker_error` | the worker replied with an unrecognized error |
| `worker_busy` | another live caller was using the worker |
| `worker_unavailable` | the worker is dead or closed (EOF, protocol fault, watchdog) |
| `policy_cancelled`, `policy_error` | any other policy failure; never its message |

Codes come from an exception's `code` attribute only when it is a short
lowercase identifier, so no prompt or model text can reach a record.

## Tests

No model is loaded. `scripts/test_sim_mlx.py` uses its fake worker subprocess: a
worker slow only on its first request gives one `timeout` and then four model
choices with no `worker_busy`; a worker whose first (late) answer says choice 0
and later ones choice 1 shows the next decision gets its own answer; a worker
that crashes once is restarted once and the next decision is a model choice; an
always-crashing worker is restarted only once per match. `test_sim_bot.py`,
`test_local_match.py` and `test_play_app.py` cover the default and configured
budget, the header, the error codes in rows and the viewer fields.

## Not measured here

No Mac run was repeated for this change. The next Mac run should report the
`errors` counts and `workerRestarts` alongside the selection counts.
