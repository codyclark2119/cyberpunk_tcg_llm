# Batch V4: cross-mechanic, lifetime and evidence checks

These checks extend draft PR #9. They do not constitute a completed admission certificate.
The original 13 tests and read-only source verifier passed in the user's local run on
`54b67bcdb1d820816abf80e5216fac134e946361`. The additional 26 tests and ten mutations
below are authored, not claimed executed. No runtime file or old golden is changed by
this test/review-tooling addition.

## Scenario boundary

`tests/api-admission-batch-v4-scenarios.ts` composes the existing advanced attack-power
bundle with Jonin and explicitly synthetic RAM/defender support. It rejects conflicting
snapshots for the same CardId/revision and validates a 42-card constructed deck with
three Legends. It does not alter real card revisions or the Demo format.

The isolated scenarios begin with legal initialization and four ordinary draw/roll/end
turns. A **trusted, explicitly arranged fixture** then supplies old ready Units, hands,
face-up Legends and Eddies. No RNG, modifier, trigger receipt or fight result is patched.
From that validated boundary, the tested Jonin plays, Go Solo entry, payments, target
choices, Goro attack trigger, rival Floor It, fighting and stealing use `applyAction`.
These are not presented as complete games reached solely through legal setup/actions.
The original Batch V4 headline replay remains the separate legal-path proof.

## Group 1: cross-mechanic proofs

`tests/api-admission-batch-v4-cross-mechanics.test.ts` adds eight tests:

- Content composition preserves all earlier immutable revisions and legal RAM admission.
- Paid Jonin play changes effective, not printed, power and emits the actual play/payment facts.
- A paid Go Solo Legend is an effective Unit target; Legends-area cards, Gear and rivals are excluded.
- Two independently paid Jonins stack on the same physical target with different occurrence IDs.
- Real Goro +2/+5 and rival Floor It -1 yield 10 power, beat a synthetic power-9 defender,
  emit the real fight/defeat facts, and retain turn-duration modifiers after attack cleanup.
- The actual Gig resolver steals one at power 9 and two at mixed power 10.
- A previously played non-lagging Jonin attacks at zero but steals only after a separate +2.
- Mixed modifiers survive JSON validation and are represented in both viewers' observations.

## Group 2: lifetime proofs and limits

`tests/api-admission-batch-v4-lifecycle.test.ts` adds eight tests through the validated
`moveCardForEffect` trusted boundary and/or ordinary `END_TURN`. It does not add a
player movement action or a generic MOVE_CARD handler.

Source-to-Trash does not remove the buff on a **different** target. Public target
Trash/Removed movement retains the physical-card duration; field-Legend departure
uses the existing Removed processing. Actual target-to-Hand movement invokes expiry,
removes live hidden-card references and expires only that target's occurrences.
Unrelated movement cannot expire a buff. End-turn expiry happens once, including after
another occurrence already expired on hidden entry.

**Explicit unsupported boundary:** a separate Jonin source entering Hand or Removed
while its target retains +2 is rejected by the current persisted-source validator.
The test requires atomic rejection and retention of the original state. This is an
implementation limitation, not a ruling that source departure should remove a resolved
buff. Hidden-source receipt/privacy semantics and arbitrary control-changing lifetimes
are not certified. Do not broaden admission to cards that require them on the strength
of these tests. Public source departure after resolution and target hidden entry are
different cases. Interrupting a pending effect is not simulated as normal gameplay.

## Group 3: evidence and negative controls

The new `card-sources` snapshot retains the actual processed Jonin record and bridge
candidate from AI commit `af9e0e1dd93b7eb77db5883bdd18809c8446d856`, its manifest,
raw source references and empty matching-errata result. The processed canonical hash is
`2a6baf11cb8876d5f45deca998affd375d1c76bbc9686bd2b856470ff7d8d65c`.
The rules snapshot projects the **exact id/text fields** of twenty selected records,
preserving wording and formatting, with full-file SHA-256/Git-blob pins. It is not a
new rules text, corpus refresh or source-to-mechanics parser.

Four offline evidence tests check the source hash chain, authored revision facts,
canonical serialization, retained rules and rejection of changed/rehash-edited data.
An offline round-trip is **not** evidence of independent upstream regeneration. Run:

```bash
node --import tsx scripts/verify-api-admission-batch-v4-source.ts \
  --ai-root ../tcg_ai_training/cyberpunk_llm

node --import tsx scripts/capture-api-admission-batch-v4-evidence.ts \
  --ai-root ../tcg_ai_training/cyberpunk_llm --check
```

The capture command revalidates the AI source checkout and independently rebuilds both
new projections twice before comparing their bytes to the committed files. It does not
read those committed projections as capture inputs. `--check` is the default;
`--write` is the explicit generation mode and touches only the two new V4 evidence files.
It does not claim to reproduce an unavailable historical V2/V3 capture script.

Six additional negative tests isolate amount, provenance, extra modifiers, dependency,
target relation and duplicate application from unrelated invalid-state failures.
The sequential mutation runner tests ten boundaries (including application, additive
storage, actual hidden-entry wiring and real end-turn expiry):

```bash
node scripts/check-api-admission-batch-v4-mutations.mjs
```

It requires a green baseline first and recognizes a caught mutant only when the named
test fails with its corresponding assertion marker. Import/syntax errors, timeouts,
killed processes, unrelated errors and stale-golden failures do not count. Runtime
files are saved byte-for-byte, restored in `finally`, and checked together with all
hashed engine inputs, wire schemas and fixtures. The restored baseline must pass again.
Logs, original-byte backups and the JSON report are written outside the repository.
Nothing is staged, committed, reset or regenerated by this runner.

Run it with **no concurrent editor changes, tests, generators, matrix or descriptor
jobs**. A same-checkout mutation lock prevents overlapping instances of this runner,
not other programs. SIGKILL/power loss cannot execute cleanup: inspect the retained
backup/report directory and leftover lock before another run; never use a blanket
`git restore` to recover dirty files.

## Local order

```bash
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/api-admission-batch-v4.test.ts \
  tests/api-admission-batch-v4-cross-mechanics.test.ts \
  tests/api-admission-batch-v4-lifecycle.test.ts \
  tests/api-admission-batch-v4-negative.test.ts \
  tests/api-admission-batch-v4-evidence.test.ts

npm run typecheck
npm run lint
git diff --check

# Then the two source commands above, then the mutation runner (not in parallel).
```

There are 39 authored tests across those five files. Record observed counts, failures
and skips; do not copy that count as a passing result before execution. The new files
were syntax-checked in the drafting environment, and the captured processed record's
canonical hash was independently recomputed there. Project dependencies/network access
were unavailable, so no new engine-test, typecheck, lint or mutation pass is claimed here.

## Still required before merge

The engine remains `0.4.0-api-admission-4`; this addition changes none of its identity
inputs. PR #9's **original** runtime change still requires generated contracts, replay
fixture regeneration/checks, historical replay compatibility, the matrix and its
reviews, Descriptor V2, full tests, integration and build against the final commit.
Keep the PR draft. Do not start expensive regeneration until these focused groups and
mutations are green and any discovered runtime defects are resolved.
