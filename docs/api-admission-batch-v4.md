# API Admission Batch V4 — temporary power generalization and Japantown Jonin

## Goal

Admit `japantown-jonin` through the API Content Bridge by generalizing the existing typed temporary-power path just enough to support its printed `{Play}` ability:

> Give a friendly Unit +2 power this turn.

This milestone must reuse the deterministic TypeScript engine as the sole rules authority. Source markup and bridge hints remain evidence only and must never synthesize executable mechanics.

## Candidate

`japantown-jonin` is a RED Unit with printed cost 2, power 0, RED RAM 2, `Tyger Claws`, and no Eddie sell permission. Its raw source text is:

```text
{Play} Give a friendly Unit +2 power this turn.
(Units with power 0 don't steal Gigs.)
```

The reminder text does not create card-specific behavior; the existing general steal rules continue to govern power-0 Units.

## Existing capability to generalize

The engine already supports `POWER_UNTIL_END_OF_TURN` for reviewed `-1` and `+5` shapes, including:

- authoritative target enumeration;
- persisted temporary modifiers;
- effective-power calculation;
- public observation;
- end-of-turn expiry;
- deterministic replay and hashing.

Batch V4 should add a reviewed `+2` friendly-Unit occurrence without weakening the admission gates for the existing Floor It `-1` or attack-condition-power `+5` implementations.

## Intended executable shape

The reviewed revision should author exactly one triggered ability:

```text
WHEN_PLAYED
→ choose one friendly face-up Unit on the battlefield
→ POWER_UNTIL_END_OF_TURN +2
```

This is a Unit `{Play}` trigger and therefore belongs in the trigger scheduler, not the Program play-continuation path used by Floor It.

Field Legends that are effectively Units should follow existing effective-card-type rules rather than receiving a card-specific exception.

## Typed runtime changes

The intended minimum runtime work is:

1. extend `POWER_UNTIL_END_OF_TURN` with a typed `FRIENDLY_UNIT` target class;
2. extend `TemporaryPowerModifierSchema` with an explicit `+2` occurrence;
3. retain occurrence identity for triggered modifiers so independent applications cannot collapse;
4. enumerate friendly public Unit targets through trigger resolution;
5. apply and validate the selected +2 modifier through the same authoritative temporary-power subsystem;
6. expire it through the existing end-of-turn / hidden-entry lifecycle;
7. keep all existing -1/+5 paths byte- and behavior-compatible except for unavoidable engine identity pins.

Do not turn temporary power into arbitrary runtime scripting.

## Admission boundary

The domain/state representation may become more general, but content admission must stay narrow.

The Japantown Jonin reviewed support shape should require:

- reviewed provenance;
- `SUPPORTED` execution status;
- Unit type;
- numeric printed cost;
- no unrelated keywords, restrictions, modifiers or equip clause;
- exactly one ability;
- `WHEN_PLAYED`;
- no activation or conditions;
- exactly one `POWER_UNTIL_END_OF_TURN` effect;
- target class exactly `FRIENDLY_UNIT`;
- amount exactly `+2`;
- end-of-turn duration.

Nearby variants must fail closed: +1/+3/arbitrary amount, rival target, extra effects, extra keywords, conditions, activation, unreviewed provenance, or unsupported execution.

Runtime support code must not dispatch on the literal CardId `japantown-jonin`.

## Target and lifetime semantics

A legal target is one friendly face-up effective Unit on the battlefield at resolution time. The source itself may be selected if otherwise legal.

Stale or forged target choices must fail closed. Hidden cards and rival Units are never legal targets.

The +2 modifier:

- affects effective power immediately;
- never changes printed power or the immutable revision;
- lasts for the remainder of the current turn;
- expires at the normal end-of-turn boundary;
- follows the existing public-zone duration lifecycle;
- remains an independent occurrence when multiple temporary modifiers apply.

## Regression requirements

Floor It must retain the same -1 targeting, timing, expiry and ModelInput V2 behavior.

The existing +5 attack-condition-power path must retain its trigger/condition semantics, occurrence provenance, magnitude and expiry.

The new schema must not collapse independent temporary-power occurrences.

## Source / evidence chain

Capture and pin the same evidence chain used by Batches V2/V3:

```text
raw API record
→ processed normalized record
→ engine candidate
→ reviewed immutable revision
```

Pin raw source SHA-256, raw and processed canonical hashes, candidate `sourceRecordHash`, printings, matching errata and the relevant comprehensive-rules records.

The evidence capture script must prove it can regenerate the prior committed admission evidence byte-for-byte before its new output is trusted.

## Focused proofs

Batch V4 tests should prove:

1. exact source/candidate/provenance integrity;
2. semantic gate isolation and no card-name dispatch;
3. friendly target enumeration only;
4. stale/forged target rejection;
5. exactly +2 effective power with printed power unchanged;
6. independent modifier stacking;
7. normal end-of-turn expiration;
8. existing power-0 steal behavior without a special-case handler;
9. public observation/privacy preservation;
10. Descriptor V2 action preservation;
11. deterministic replay independent of incidental `actionId` ordering.

Mutation-test at least: amount check, target relation, reviewed provenance, expiry, modifier application, unsupported extra mechanics, and occurrence collapse.

## Engine identity and generated artifacts

This milestone changes runtime/domain state and therefore advances engine identity to the next admission version, planned as:

```text
0.4.0-api-admission-4
```

The final artifact hash must be reported only after the runtime tree is complete. Do not hand-edit generated hashes.

Regenerate wire contracts and all artifact-pinned fixtures from authoritative generators. A second generation must be byte-identical. Classify fixture differences as hash-only, legal-action-order-only, or semantic; any semantic change outside Batch V4 requires investigation.

## Required gates

These are requirements, not claimed results:

```bash
node --import tsx --test --test-concurrency=1 tests/api-admission-batch-v4.test.ts
npm run typecheck
npm run lint
npm run validate:cards
npm run build
git diff --check
npm run contracts:export
npm run test:matrix
npm run test:matrix -- --check
npm run review:descriptor-v2
npm run review:descriptor-v2 -- --check
npm test
npm run test:integration
```

Existing Demo expectations remain 192/192 supported terminal with the 118 / 69 / 5 outcome distribution unless an investigated regression proves otherwise.

Descriptor V2 must remain at zero duplicate descriptors, unprojectable actions, action-set mismatches and privacy failures.

## Non-goals

This PR does not implement conditional target permissions, rule 9.26.3 target invalidation, generic `MOVE_CARD`, arbitrary zone movement, arbitrary temporary effects, runtime English parsing, source-hint-to-mechanics conversion, or bulk candidate admission.

## Merge criteria

Keep the PR draft until Japantown Jonin is an immutable reviewed revision, +2 temporary power is implemented without weakening prior gates, focused mutants are caught, generated artifacts are deterministic, preserved replay semantics remain compatible, the Demo matrix and Descriptor V2 audits stay clean, and the full typecheck/lint/build/card-validation/test/integration gates pass.
