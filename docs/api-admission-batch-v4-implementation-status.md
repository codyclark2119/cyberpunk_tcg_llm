# Batch V4 implementation and validation status

PR #9 remains draft. The implementation contract is `api-admission-batch-v4.md`;
expanded verification instructions and explicit limitations are in
`api-admission-batch-v4-validation.md`.

## Implemented runtime

`FRIENDLY_PLAY_POWER_V1` explicitly requires the existing play, trigger, combat,
React, resolution and Gig-value policies. A reviewed unconditional Unit PLAY/friendly
+2 shape runs through the trigger scheduler, not a Program continuation. Friendly
face-up effective battlefield Units are eligible, including the source and field
Legends when that policy is enabled. Ready/spent and Lag do not filter power targets.
Persisted +2 uses distinct effect/ability/ordinal provenance alongside unchanged
legacy -1/+5 formats. Application is additive; duplicate occurrences fail closed.
The shared public-zone/hidden-target/end-turn lifetime paths remain authoritative.
No CardId dispatch, English parsing, arbitrary amount admission, MOVE_CARD, Python
rules code or changes to earlier immutable card revisions/Demo lists are introduced.

## User-reported local baseline

At `54b67bcdb1d820816abf80e5216fac134e946361`, the user supplied a complete TAP result
showing 13/13 original V4 focused tests, zero failures/skips/todos, and previously
reported typecheck/lint/diff checks without errors. The source verifier output is
SOURCE_MATCH with no matching errata. These are user-local results, not CI results.

The missing scheduler policy was repaired in the V4 fixture only. The runtime
fail-closed dependency was not weakened.

## Added verification implementation

The follow-up adds 26 tests (eight cross-mechanic, eight lifetime, six negative,
four evidence), a shared labeled trusted scenario fixture, two captured evidence
projections, an independent capture/check command and a ten-case sequential mutation
runner. Exact commands and the source-versus-target lifetime matrix are in the
validation document. Tests and review tooling do not change the engine artifact.

The copied processed Jonin record hashes to
`2a6baf11cb8876d5f45deca998affd375d1c76bbc9686bd2b856470ff7d8d65c`, agreeing with the
user's verifier and pinned candidate. Twenty id/text rules records are retained
without wording corrections. Their source is the same pinned AI snapshot, not a
new corpus capture. Existing raw Jonin source bytes remain untouched.

The new TypeScript files were syntax-parsed and the mutation runner passed Node's
syntax check. Project dependencies could not be obtained in the drafting environment;
**the additional tests, cross-repository capture --check, mutation runner, project
typecheck/lint and broader gates have not run here.** Authored coverage is not a
passing result. The mutation runner must show named behavioral assertions, not just
nonzero process exits, and must restore all protected inputs exactly.

## Uncertified lifetime boundary

A distinct source entering Hand or Removed while its +2 remains on another target
is still rejected by the current historical-source validator. The new test pins
atomic rejection as an explicit unsupported interaction, not as correct general
card-game semantics or a reason to discard the target's resolved modifier. Cards
requiring hidden/control-changing source lifetimes need separate representation and
privacy review. The source-to-Trash case and target-to-Hand expiry are distinct.

## Generated baseline and full gates

Runtime identity remains `0.4.0-api-admission-4`. No old replay fixture, generated wire
schema, lockfile or runtime source is changed by the verification follow-up. The
original PR runtime patch still needs authoritative contracts/fixture regeneration,
repeatability checks, preserved-replay compatibility, the 192-game matrix and dependent
reviews, Descriptor V2, unit/integration tests, card validation and build on the exact
commit intended for merge. No full-gate success is claimed. Keep PR #9 draft until
that evidence is present; never run trace writers alongside matrix/descriptor readers.
