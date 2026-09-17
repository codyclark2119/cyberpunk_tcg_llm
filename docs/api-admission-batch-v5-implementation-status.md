# Batch V5 implementation status — foundation only

This is the first code slice on draft PR #10, based on the reviewed contract at
`5323666dde0ce0c3dc506cd138cf5ce9cf026647`. It is not a completed Detonate admission.

## Implemented

- Keep `DefeatUnitTargetSchema` unchanged. Add the separate literal-2 rival-only
  `DefeatGearTargetSchema` and the `DefeatTargetSchema` target discriminator union.
  The historical outer effect kind remains `DEFEAT_UNIT`; old Unit payload values
  and their serialized shapes do not change.
- Reserve `TARGETED_GEAR_DEFEAT_V1` in the execution-scope schema and the optional
  `targetedGearDefeat` policy. No existing ruleset opts into it.
- Add `reviewTargetedGearDefeatShape` and its explicit dependency predicate. This
  checks the complete intended Quick Program shape, including provenance,
  source statistics, exactly one unconditional effect, and no extra mechanics.
  It is intentionally named **review**, not execution support.
- Retain the original `supportsTargetedDefeatCard` function byte-for-byte. Its
  existing keyword and source-shape restrictions are not relaxed.
- Retain the old metadata catch-all while the new lifecycle is incomplete. It
  additionally claims the reserved new scope even with no abilities. Consequently
  the existing `validateState` metadata chain rejects hidden new-scope sources
  through the unchanged old acceptance gate. There is no ownership partition yet.
- Keep `listDefeatableUnits` Unit-only with an explicit target-kind guard. It
  accepts the widened input type but returns no targets for the new Gear member;
  it does not accidentally reuse Unit threshold, type or area semantics for Gear.
- Advance engine version to `0.4.0-api-admission-5` with the schema/runtime change.
  No final artifact hash or regenerated baseline is claimed.

`supportsPlay`, `supportsReactPlay`, `defeatSupport`, target/aftermath continuation
validators and shared movement execution have not been broadened. A valid shape
probe remains unplayable. No real Detonate CardRevision, deck membership or
source evidence is published by this slice. Tests use explicitly synthetic probes.

## Foundation tests

`tests/api-admission-batch-v5-foundation.test.ts` contains ten authored tests:

1. Existing Unit selectors and effects round-trip without payload changes.
2. Gear is a separate literal-two/rival-only target, rejecting other thresholds,
   relations, D20 selectors and extra parameters.
3. Shape review is name/text independent and does not enable Main or React play.
4. Minotaur and Over the Edge retain their old gate; Quick/Gear mutations reject.
5. The new shape review rejects conditional, extra and wrong-source metadata.
6. Every named policy prerequisite is checked independently.
7. Empty, mixed and wrong-scope sources retain metadata-validator coverage.
8. Actual `validateState` reload rejects a hidden new-scope source, including an
   empty-ability source, against a valid extended-catalog positive control.
9. A gameplay deck cannot initialize just because its Gear shape was reviewed.
10. Legacy Unit enumeration does not offer Gear targets.

The intentionally closed-execution tests describe this development stage, not a
permanent game rule. Replace those assertions with positive gameplay and negative
forgery tests in the same change that completes lifecycle validation and admission.
Do not merely delete the safety checks or expose shape review as executable support.

## Incorporated final review constraints

The contract now names `combat-state.ts`'s ordinary React step whitelist and the
forced single-Gear owner-order invariant. It also records the earlier return for
trigger/targeted-defeat continuations: the dedicated validator must check the
otherwise-bypassed attacker, locked-target, stage and actor invariants itself.

The final metadata ownership split must register the new validator in
`packages/engine/src/state.ts::validateState` alongside the current ordered chain.
The existing `action-return.ts` noncombat ORDER exception is a structural precedent
for a narrowly bounded exception, not permission to add an ORDER pause in React.

Proof 12 now requires the same attack and locked target to survive Gear removal,
not just a changed power query. The inference clause records the reviewer's
713-node pattern/subtree search and does not assert exhaustive corpus absence.

## Still required

The next implementation slice must wire the Gear selector, source admission,
metadata registration/ownership, `defeatSupport`, paused Main/React validation,
aftermath facts, Program completion and locked-attack survival coherently. At
least two eligible Gear targets must force a real persisted React target choice.
Single-Gear owner ordering must remain synchronous.

Capture actual raw/processed/candidate/printing/errata/rules evidence and the
separately labelled `REVIEWED_INFERENCE` destination decision. Add legal-play and
explicitly labelled arranged scenarios, both areas, own-Gear-power thresholds,
zero/one/many choices, stale/forged state tests and named behavioral mutations.

Keep the shared departure/defeat pipeline. Do not expand generic movement,
conditional target invalidation, hidden targeting, cross-owner movement, or V4's
source-lifetime limitation in this batch.

## Validation status and local loop

The changed/new TypeScript files were syntax-parsed with no diagnostics in the
authoring environment. Original copied source bytes were checked against their
Git blob IDs, and the original two-card acceptance function was compared exactly.
These are static checks, not TypeScript project checking or gameplay execution.

The authoring environment could not retrieve the repository/dependencies, so the
ten tests, project typecheck and lint have **not** been executed here.

```bash
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/api-admission-batch-v5-foundation.test.ts
npm run typecheck
npm run lint
git diff --check
```

Do not launch regeneration or the matrix for this intermediate slice. The new
identity makes the old generated baseline stale by design; do not manually patch
its hashes. Complete the runtime and focused proofs first, then run the full
contract/replay/regeneration/compatibility/matrix/Descriptor/integration gates.
Integration acceptance requires real execution with configured databases and no
skipped tests. Keep PR #10 draft.
