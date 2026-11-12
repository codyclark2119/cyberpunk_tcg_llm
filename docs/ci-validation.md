# Validation

## Scope

Validation is local-first. GitHub runs nothing automatically: no workflow triggers on
pull requests or pushes. `scripts/run_tests.sh` is the single command that decides
whether a tree is acceptable, and the same script runs on a laptop, in the pre-push
hook, in the local console and in the manual GitHub workflow.

There are no changed-file selectors, generated-baseline classifiers, path filters or
conditional steps. A docs-only change gets the same validation as a runtime change;
the small time saving is not worth another default-pass boundary. Use the Node
version pinned in `.nvmrc` (`nvm use`) and Python 3 with `fastapi` installed
(`python -m pip install fastapi httpx numpy`; `httpx` is used by the console tests,
`numpy` by the rules-retrieval tests' fake embedding index).

## Commands and tiers

```bash
scripts/run_tests.sh --quick         # before every push
scripts/run_tests.sh                 # full tier (the default) before asking for a merge
scripts/run_tests.sh --only unit     # one step; repeat --only for several
scripts/run_tests.sh --list          # step names and tiers
```

- **Quick tier**: the validation-guard tests (`scripts/validation/*.test.mjs`),
  typecheck, lint, card validation, the complete `npm test` suite, a Python
  dependency check, a compile check of `games/`, `harness/` and `scripts/`, and the
  Python suites: corpus and ingestion, harness core, engine candidates, the local
  policy layer, the local MLX worker boundary (no MLX or weights needed), the
  Python-to-engine adapter, the local match runner and the validation console. It
  needs no Docker.
- **Full tier**: every quick step plus the build, `git diff --check` against the
  merge-base with `origin/master` (override with `RUN_TESTS_BASE`), community deck
  rules with negative controls (272/272, and no negative control may print
  `<-- LOOK`), and the Mongo integration suite with at least 3 tests.

By default every selected step runs and all failures are reported at the end;
`--fail-fast` stops at the first. Exit status is 0 only when every selected step
passed. Each step's output is kept in `${TMPDIR:-/tmp}/run_tests.<pid>/<step>.log`.

## Where the pins live

The pin table at the top of `scripts/run_tests.sh` is the only place that names steps,
tiers, commands and expected output. Each row checks the exit status (with
`pipefail`) and, where pinned, an exact pass line such as `all 89 tests passed`.
Adding or removing a Python test means updating that row in the same change.

Node suites are checked by `scripts/validation/assert-test-summary.mjs`: one complete
final TAP summary, positive test and plan counts, every test passed, and zero
failures, cancellations, skips and todos. A nonzero command stays a failure even if it
prints plausible output, and a skipped or empty run is never acceptance evidence. The
integration minimum of 3 is a floor: adding tests needs no change, but reducing the
suite requires reviewing the floor. The guard's own regression tests (real Node-runner
and CLI subprocesses, the exit-zero skipped case, malformed, partial and concatenated
logs) run as the first quick step and need no installed dependencies:

```bash
node --test scripts/validation/*.test.mjs
```

## Docker and the integration database

Only the full tier's integration step needs a database. When `TEST_MONGODB_URI` is
unset, it points it at the `docker-compose.yml` service on `MONGO_PORT` (default 27017)
and runs `npm run infra:up` (`docker compose up -d --wait`, MongoDB 7). When the URI is
set, or with `--no-infra`, it starts nothing and waits for the database to be
reachable. So a machine without Docker can run the quick tier, single steps, or the
full tier with `--no-infra` against a Mongo it already has. Integration tests create
and remove randomized databases. PostgreSQL and its integration tests were retired on
2026-11-11 (see the README); the floor dropped from 12 to 3 with them.

## Pre-push hook

`npm run hooks:install` sets `core.hooksPath` to `.githooks`, whose `pre-push` hook
runs `scripts/run_tests.sh --quick`. The hook is opt-in per clone;
`npm run hooks:uninstall` turns it off. Bypass it once with
`SKIP_LOCAL_VALIDATION=1 git push` (or `git push --no-verify`).

## Local console

`npm run validate:ui` serves `scripts/validation_console.py` on loopback
(`http://127.0.0.1:8766`). It offers Quick, Full, Full without Docker (`--no-infra`)
and Single step actions, the last listed from `run_tests.sh --list`. The browser names
an action id only; the command line is built server-side from a fixed allowlist.

## Manual GitHub workflow

`.github/workflows/manual-validation.yml` has only a `workflow_dispatch` trigger, with
a `tier` input (`quick`, the default, or `full`). Its one job on `ubuntu-latest`
starts a MongoDB 7 service container, sets up Node from `.nvmrc` and
Python 3.12, installs `fastapi`, `httpx` and `numpy`, runs `npm ci`, then
`scripts/run_tests.sh --no-infra` (plus `--quick` for the quick tier). The step logs
are uploaded on success and failure and kept for 14 days. The workflow contains no
pass lines; it is a clean-machine run of the same script, not a separate gate.

## Branch protection

Because no workflow runs on pull requests, the required status checks in the
`master: require PR Validation` repository ruleset can never report. Cody must remove
those required checks from the ruleset by hand in the repository settings, keeping
the pull-request requirement and the blocks on force-pushes and deletion of `master`.
Until then, pull requests to `master` cannot merge.

## Acceptance boundary

Validation does not regenerate fixtures to make tests pass; it checks the tree as it
is. A stale baseline is a real failure and is corrected by an explicitly reviewed
regeneration commit, never by skipping the relevant steps.

After an engine identity change, regenerate locally with
`npm run baseline:regenerate -- --preserved <last pre-change commit>` and commit the
result separately. The full 192-game matrix, its trace regeneration and the full
Descriptor V2 corpus review run there as deliberate milestone gates, not as
`run_tests.sh` steps.
