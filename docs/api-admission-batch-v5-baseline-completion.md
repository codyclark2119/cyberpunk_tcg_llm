# Batch V5 generated baseline and final acceptance

## Status and dependency

**Preparation only: no artifact regeneration or final gate result is claimed.** This
runbook is the initial change on `review/api-admission-batch-v5-baseline`, branched from
PR #11's corrected head `2655d42cf83faecf91a3b285aeea410ce35385f7`.

The dependent PR initially targets `review/api-admission-batch-v5-detonate`, not
`master`. Its diff should contain only baseline-completion work relative to that branch.
Do not merge the completion PR into the admission branch. Validate their combined tree,
then merge #11 and retarget the completion PR to `master` as described below.

PR #10 merged the runtime capability at `f4562acd84e6e4f31dee0285fe97f9eaa6fe4ee8`.
PR #11 adds the reviewed Detonate revision, evidence and legal replays. Its latest fix
separates the specific unreviewed-bundle exception from three mandatory state-validation
cases and tests both complete replays with reversed legal-action lists. The earlier
73/73 local result belongs to `445183d5`; it is not a result for the corrected head.
The six suites now have an expected count of 78, subject to actual execution.

The inherited runtime identity reported for V5 is:

```text
0.4.0-api-admission-5
e5bcf81771ad6430ad8bc16d5f8508b35c0d77e3dc96b6f6264ddea4e2366c06
```

Recompute `engineIdentity()` before and after this work. This preparation does not
recompute that hash or advance the engine version. Generated fixtures still carry the
pre-V5 pins; regenerating them is the work to perform, not a completed result.

## Scope and safeguards

The completion change should contain authoritative generated wire schemas, current
replay/review fixtures and a final verification record. Preserve the real card revisions,
fixed Demo decks, source/rules captures, the three new Detonate evidence files, and
explicitly frozen historical evidence. No runtime or lockfile change is planned.

Do not hand-edit hashes, weaken tests, silently accept a changed gameplay trajectory,
or refresh the source corpus to make a comparison pass. A discovered code defect needs
an explicit reviewed correction and an assessment of which checks it invalidates.

Use one dedicated checkout with its own correctly resolved workspace dependencies.
Record the starting commit, staged/unstaged/untracked state and engine identity. If there
is unrelated local work, stop and preserve it rather than resetting, stashing or staging
it automatically. Do not symlink another checkout's `@tcg/*` workspace packages.
Keep logs, old snapshots and large traces outside the repository. Never commit credentials,
`.env`, test database dumps or temporary scripts accidentally.

Run the stages sequentially and stop on a failing command. When logging through `tee`,
use `set -o pipefail` so a nonzero command is not hidden by successful logging.

## 1. Revalidate the corrected admission slice

On the completion branch, verify the corrected #11 commit is an ancestor:

```bash
git merge-base --is-ancestor 2655d42cf83faecf91a3b285aeea410ce35385f7 HEAD &&
git status --short &&
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/api-admission-batch-v5-foundation.test.ts \
  tests/api-admission-batch-v5.test.ts \
  tests/api-admission-batch-v5-detonate.test.ts \
  tests/api-admission-batch-v5-evidence.test.ts \
  tests/api-admission-batch-v5-legal-replay.test.ts \
  tests/api-admission-batch-v5-public-actions.test.ts &&
npm run typecheck &&
npm run lint &&
npm run validate:cards &&
git diff --check
```

Require actual test execution with zero failures, skips or todos. Inspect status output;
a successful `git status` exit is not evidence that the checkout is clean.

The specific exception test must detect the expected root custom Zod diagnostic. EMPTY,
WRONG_SCOPE and MIXED must successfully build a bundle and then reach the registered
state validators. MAIN and REACT ordering tests must reverse nontrivial action lists
and retain the same chosen actions, events, states and final hashes.

Independently check the retained source evidence against the pinned local AI checkout:

```bash
node --import tsx scripts/verify-api-admission-batch-v5-source.ts \
  --ai-root ../tcg_ai_training/cyberpunk_llm &&
node --import tsx scripts/capture-api-admission-batch-v5-evidence.ts \
  --ai-root ../tcg_ai_training/cyberpunk_llm --check
```

The scripts require the reviewed AI commit `af9e0e1dd93b7eb77db5883bdd18809c8446d856`.
Do not switch or overwrite the AI checkout automatically. A mismatch requires review;
`--write` is not a remedy for failed source verification.

## 2. Preserve committed baselines before any writer runs

The approved pre-V5 reference is PR #9's merge
`3efe0f72b0f8f04c1268b87633fbba4fdf7c269f`. Preserve its original replay bytes separately
from the current corrected branch, whose extra source fixtures must also be protected:

```bash
set -o pipefail
export V5_BASELINE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tcg-v5-baseline.XXXXXX")"
git rev-parse HEAD > "$V5_BASELINE_DIR/head.txt"
git status --short > "$V5_BASELINE_DIR/status-before.txt"
mkdir "$V5_BASELINE_DIR/preserved" "$V5_BASELINE_DIR/before"
git archive 3efe0f72b0f8f04c1268b87633fbba4fdf7c269f \
  tests/fixtures packages/wire/schemas \
  | tar -xf - -C "$V5_BASELINE_DIR/preserved"
git archive HEAD tests/fixtures packages/wire/schemas \
  | tar -xf - -C "$V5_BASELINE_DIR/before"
```

Retain file inventories and SHA-256 manifests of both snapshots. Archives describe Git
commits, not uncommitted local changes; record or resolve those before continuing.

Run the existing compatibility audit against untouched pre-V5 decisions:

```bash
node --import tsx scripts/audit-replay-compatibility.ts \
  "$V5_BASELINE_DIR/preserved/tests/fixtures" \
  2>&1 | tee "$V5_BASELINE_DIR/replay-compatibility.log"
```

Require its final PASS summary. Record the actual family and decision counts, not a
copied historical total. Do not overwrite the originals or substitute regenerated
trajectories when an original decision fails.

## 3. Export contracts and regenerate the current replay fixtures

Run `npm run contracts:export`, retain its output file hashes, export a second time and
require identical output bytes. Review the actual schema changes against V4: the V5
Gear target member, execution scope and policy are expected additions. Classify schema
changes separately from replay hash changes. No engine-identity input should change.

Before replay generation, build an explicit inventory of authoritative scripts and the
files each writes. `git ls-files 'scripts/generate-*.ts'` is discovery only, not a command
to execute everything blindly. Separate the full matrix writer from ordinary replay/wire
writers. Exclude frozen historical evidence and source-capture commands from regeneration.
The previous milestone's 28-generator result is historical, not a presumed current count.

Run the reviewed ordinary replay/wire generator set serially, recording every exit code
and output. Snapshot output bytes, run the same set a second time in the same order and
require byte identity. No unnamed script or manually edited JSON belongs in the result.

**Shared writer:** `scripts/generate-reboot-multiplicity-replays.ts` also rewrites three
files in `/tmp/tcg-reboot-model-a-traces`, even with `--check`. Its current artifacts
include the Reboot replay, acceptance summary and historical-prefix overlap replay.
Run this generator and its own `--check` before the final full matrix and downstream
reviews. The later full matrix must finalize all traces used by those readers.

Do not run a replay generator, mutation runner or other runtime/trace writer concurrently
with the matrix, Descriptor V2 or any dependent review. After the matrix/reviews are
finalized, a writer requires renewed trace verification and affected checks.

## 4. Generate and check the full Demo matrix

```bash
npm run test:matrix &&
npm run test:matrix -- --check
```

Record the two complete summaries, their matrix hashes, all coordinate outcomes and the
trace-file inventory/hash manifest. The expected unchanged Demo behavior is 192 attempted,
192 completed and 192 supported terminals, distributed as 118 START_TURN_GIGS,
69 OVERTIME_GIGS and 5 EMPTY_DRAW, with no errors, deadlocks or cap hits. These are targets,
not fresh V5 results. A differing outcome needs investigation, not a new expected value.

The check can rewrite traces even when committed artifacts are only compared. Verify
that the finalized traces reproduce byte-for-byte and match the recorded matrix. Do not
reuse stale traces solely because their filenames are present.

## 5. Run matrix-dependent reviews against those finalized traces

```bash
node --import tsx scripts/review-reboot-multiplicity-matrix.ts &&
node --import tsx scripts/review-reboot-multiplicity-matrix.ts --check &&
node --import tsx scripts/review-demo-matrix-positions.ts &&
node --import tsx scripts/review-demo-matrix-positions.ts --check &&
npm run review:descriptor-v2 &&
npm run review:descriptor-v2 -- --check
```

Require every review to refer to the new matrix hash. Record actual positions and legal
actions reviewed. Descriptor V2 must have zero duplicate positions/groups, unprojectable
actions, action-set mismatches and privacy failures. Preserve the trace hashes through
this reader phase; do not run the Reboot writer afterward without rechecking provenance.

## 6. Classify differences and record reproducibility

Compare against the preserved committed bytes, not an already regenerated working copy:

- HASH_ONLY: only explicitly identified engine/content/position/action/review pins differ.
- ORDER_ONLY: only stored legal-action list ordering differs in addition to pins; chosen
  actions, event order, observations and final game state are unchanged.
- SEMANTIC: any other behavior difference. Investigate and resolve before acceptance.

Do not implement classification by deleting every field containing `hash` or sorting
all arrays. Action chronology, event order and choice order can be semantically material.
Keep the untouched-original replay audit as an independent compatibility check, not the
classifier's own proof. Confirm frozen evidence and the three new source fixtures remain
byte-identical. Record the actual changed/unchanged counts and an explicit file manifest.

Prior mutation evidence may be reused only with its original commit, result, test scope
and unchanged relevant inputs established. Generated-file churn alone does not demand a
new runtime mutation run. This does not waive the newly changed #11 tests or transfer a
historical mutation result to changed runtime code.

## 7. Complete final repository gates

Run the full suite and the configured integration gate on the combined candidate:

```bash
npm test &&
node -e 'for (const key of ["TEST_DATABASE_URL", "TEST_MONGODB_URI"]) { if (!process.env[key]) throw new Error("Missing " + key); }' &&
npm run test:integration &&
npm run build &&
npm run typecheck &&
npm run lint &&
npm run validate:cards &&
git diff --check
```

Use disposable local test databases, never production resources. Do not log connection
strings. The environment preflight only prevents an unset-variable skip; additionally
require the expected integration tests to execute with zero skipped tests and zero
failures. An exit-0 all-skipped run is explicitly not acceptance evidence.

Record exact full-suite counts and confirm every focused V5 test is present. Recompute
engine identity and compare all inputs with the preflight snapshot. Inspect Git status
and both staged/unstaged diffs; verification of a worktree is not verification of a
partial index. Commit only the intended artifacts and verification record. Confirm the
committed tree is the one that was tested, preferably with an isolated clean-checkout
gate that does not depend on untracked local files.

## Verification record and coordinated merge

The final record must include commit/tree identifiers, Node/dependency context, each
command and exit code, actual tests/skips, generator and output manifests, both-pass
byte checks, engine/matrix/review hashes, trace provenance, fixture classifications,
original replay compatibility and the attribution of local versus CI evidence.
All these results remain pending at preparation time; do not copy earlier V4 or #11
results into a fresh PASS table.

Once the combined completion tree is green, review #11 and this PR together. Merge #11,
keep its branch until this PR has been retargeted to `master`, and compare the proposed
final tree with the verified tree. With a squash/rebase or any intervening master change,
check content rather than relying only on commit ancestry. Re-run affected gates for
changed inputs; a new commit ID alone does not force another identical matrix run.

Only merge the completion PR after that check. Until then keep it draft. Preparation
neither merges #11 nor declares the V5 milestone complete.
