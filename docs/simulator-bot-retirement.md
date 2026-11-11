# Retiring the external simulator bot bridge

Recorded 2026-11-11.

> Later on 2026-11-11 the `sim_*` modules were renamed, since no simulator remains.
> The names below are as they were when this was recorded.
>
> | Old | New |
> | --- | --- |
> | `games/cyberpunk/sim_bot.py` | `games/cyberpunk/policy_bot.py` |
> | `games/cyberpunk/sim_prompt.py` | `games/cyberpunk/policy_prompt.py` |
> | `games/cyberpunk/sim_mlx.py` | `games/cyberpunk/policy_mlx.py` |
> | `scripts/benchmark_sim_bot.py` | `scripts/benchmark_policy_bot.py` |
> | `scripts/mlx_sim_worker.py` | `scripts/mlx_policy_worker.py` |
> | `scripts/test_sim_bot.py` | `scripts/test_policy_bot.py` |
> | `scripts/test_sim_mlx.py` | `scripts/test_policy_mlx.py` |
> | `run_tests.sh` steps `py-sim-bot`, `py-sim-mlx` | `py-policy-bot`, `py-policy-mlx` |

## Why

The external Cyberpunk TCG Sim website that the v1alpha1 HTTP bot bridge served
received a cease and desist. The project no longer connects to it, hosts a bot for
it, or keeps its operator's material. From now on everything runs locally: this
repository's deterministic engine plus local MLX models on the Apple Silicon
development Mac. No external simulator, bot registration or public bot endpoint
remains in scope.

## What was removed

- The HTTP transport: `build_app` (FastAPI `POST /ready` and `POST /sync`, the
  2 MiB body limit and 5-second read limit) in `games/cyberpunk/sim_bot.py`.
- `scripts/serve_sim_bot.py`: the Uvicorn CLI, `--policy baseline|mlx` serving and
  `--profile-url` registration JSON.
- The simulator contract: `BotProfile` and the `community.cyberpunk-tcg-llm` bot ID,
  the `cyberpunk-tcg-sim` game string, `apiVersion` `v1alpha1`, the 3000 ms
  `timeoutMs` profile value, ready checks, the `state_sync` envelope, the
  `possibleActions` alias and the waiting/finished acknowledgement path.
- `docs/ai-source/simulator-bot-v1alpha1.txt`, a copy of the simulator operator's
  third-party developer guide.
- `requirements-bot.txt` (FastAPI and Uvicorn for the bridge). `requirements-mlx-bot.txt`
  no longer includes it; its pins are unchanged. `requirements.txt` still lists
  FastAPI and Uvicorn for the harness monitor web UI.
- `httpx` from the CI install step; only the HTTP tests used it. CI still installs
  `fastapi` for the harness monitor tests in `test_harness_core.py`.

## What was kept, and where it lives

All in `games/cyberpunk/` unless noted. Module names are unchanged so that the
retained MLX worker needs no edit.

- `sim_bot.py` is now the local action-selection policy layer:
  - `Decision`, validated on construction: nonempty identifiers, a nonnegative
    `sequence`, an optional positive finite `deadline_ms`, object-valued
    `snapshot`/`turn`/`metadata`, a string `prompt`, and a nonempty list of
    action objects with unique nonempty string `actionId`s. Invalid input raises
    `DecisionError` and never reaches a policy.
  - `decision_from_record` builds one from a camelCase JSON record (`requestId`,
    `matchId`, `sequence`, `playerId`, `legalActions`, `deadlineMs`, ...). Unknown
    keys are ignored and `legalActions` has no alias.
  - `baseline_action_id`, unchanged: the deterministic, order-independent
    smoke-play ranking.
  - `PolicyRunner.choose(decision)` (formerly `BotService.sync`) returns a
    `Selection(action_id, reason, elapsed_ms)`. It keeps the 2500 ms cap (or
    the decision's smaller deadline) less a response reserve, the cap of 8
    outstanding policy calls, deep-copied policy input, and the `deadline`, `busy`,
    `timeout`, `invalid_action` and `policy_error` fallbacks to the baseline.
    Only an offered `actionId` is ever returned. Logs still omit snapshots and prompts.
- `sim_prompt.py` (`SYSTEM_PROMPT`, `build_choice_messages`, `parse_choice`) and
  `sim_mlx.py` (`local_path`, `make_worker`, `MLXPolicy`): unchanged apart from a
  docstring.
- `scripts/mlx_sim_worker.py` and `harness/core/local_worker.py`: unchanged.
- `scripts/benchmark_sim_bot.py` now times decisions through `PolicyRunner`. The
  synthetic probe is a `Decision`, and `--requests` takes decision records.
  Old acting `/sync` bodies still load when they carry `legalActions`.
  `--bot-id` is gone. It still refuses to run outside native Apple Silicon.

## Tests and CI

`scripts/test_sim_bot.py` now tests the policy layer and prints
`PASS policy layer: 24/24`. It dropped the HTTP, ready-check, JSON body, base-path,
alias, non-acting and CLI tests, and added tests for record parsing, the runner's
own deadline cap and non-`Decision` input. `scripts/test_sim_mlx.py` dropped the
HTTP lifespan, serve CLI profile and non-acting tests, gained a direct runner test,
and prints `PASS local MLX bot: 27/27`. `pr-validation.yml` pins both lines; the
workflow guard still requires both commands in full CI.

## Left for scope 2

- Drive `PolicyRunner` from the local engine: build each `Decision` from the
  engine's public observation and engine-enumerated legal actions, and submit
  the returned `actionId` back through the engine.
- Move `benchmark_sim_bot.py` onto that local engine runner, so its realistic
  inputs are engine positions rather than hand-written decision records.
- `SYSTEM_PROMPT` still says "Cyberpunk TCG Sim" and "The simulator owns legality".
  Rewording it changes model input, so do it with a `PROMPT_VERSION` bump.
- The `scripts/mlx_sim_worker.py` docstring still names `serve_sim_bot.py`. It was
  left unchanged in this scope.
- Consider renaming the `sim_*` modules once nothing depends on the old names.

[simulator-bot.md](simulator-bot.md) and [local-mlx-bot.md](local-mlx-bot.md)
remain as dated records of the retired bridge.
