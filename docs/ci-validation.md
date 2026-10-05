# Hosted PR validation

## Scope

`PR Validation` runs on every pull request (including stacked PRs and docs-only
PRs), on pushes to `master`, and on manual dispatch. There are no changed-file
selectors, generated-baseline classifiers, path filters, or conditional full-test
jobs. Runtime-only, shared-helper-only, dependency-only, evidence-only and
wire-schema-only changes all receive the same complete validation.

Running full checks for docs-only changes is intentional: the small scheduling
saving is not worth another default-pass classification boundary. The three jobs
are independent, so a failure in one cannot silently prevent the others from
reporting their own results. Every job uses the Node version pinned in `.nvmrc`;
bump it deliberately rather than tracking the latest 22.x release implicitly.

## Gates

- **Unit, static, and build validation**: dependency-free CI guard regression tests,
  `npm ci`, typecheck, lint, card validation, the complete `npm test` suite, build,
  and PR diff whitespace checking.
- **Database integration validation**: fresh PostgreSQL 16 and MongoDB 7 services,
  explicit disposable connection configuration, and the complete
  `npm run test:integration` suite with a minimum of 12 tests.
- **AI harness validation**: Python 3.12 with `fastapi` and `httpx` installed, a compile
  check of `games/`, `harness/` and `scripts/`, the corpus/ingestion suite
  (`test_cyberpunk.py`), the generic harness suite (`test_harness_core.py`), the
  engine-candidate bridge, community deck rules with negative controls, and the
  Python-to-engine adapter boundary against the committed Demo matrix fixture,
  and the external simulator HTTP contract (`test_sim_bot.py`, 29/29 tests).
  The local inference boundary (`test_sim_mlx.py`, 29/29 tests) uses real Python
  subprocesses and injected tokenizers/generators. It requires no MLX or weights;
  actual Metal inference, latency and gameplay quality are Mac-side checks.
  These steps assert exact pass lines (for example `all 89 tests passed`), so
  adding or removing a Python test also updates the expected line here.

Both suite commands are piped to TAP logs using `set -euo pipefail`. A nonzero
command remains a failure even if it prints plausible successful output. The
report guard separately requires one complete final Node TAP summary, positive
test/plan counts, every test passed, and zero failures, cancellations, skips and
todos. A parent test's plan count need not equal the recursive test count.

The integration minimum is a coverage floor, not an exact ceiling: adding tests
needs no CI change, but legitimately reducing the suite requires explicit review
of the floor. A skipped or empty run is never acceptance evidence.

The guard tests include real Node-runner/CLI subprocesses, the exit-zero skipped
case, malformed/partial/concatenated logs, and workflow policy mutants. They are
policy regression tests, not a general-purpose YAML or GitHub Actions linter.
Run them locally without installing application dependencies:

```bash
node --test .github/scripts/*.test.mjs
```

TAP logs are uploaded on success and failure when produced and retained for 14
days. Missing logs after an earlier setup failure do not turn that failure green.
Artifacts are named by run and attempt. Credentials are not repository secrets;
these service credentials belong only to disposable job-local test databases.

## Acceptance boundary

CI does not regenerate fixtures to make tests pass. It validates the checked-out
candidate. A stale baseline is a real failed check and must be corrected by an
explicitly reviewed regeneration commit, never by skipping the relevant tests.

After an engine identity change, regenerate locally with
`npm run baseline:regenerate -- --preserved <last pre-change commit>` and commit
the result separately. The full 192-game matrix, its trace regeneration, and the
full Descriptor V2 corpus review run there, as deliberate milestone gates, not as
automatic jobs in this workflow.

The `master: require PR Validation` repository ruleset requires a pull request and
all three named jobs before merge, and blocks force-pushes and deletion of
`master`. Only PR diff whitespace checking is event-specific. Manual runs still
execute every complete suite; pushes to `master` validate the actual post-merge
tree.
