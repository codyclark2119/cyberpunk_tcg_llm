# API admission batch V7 (2026-11-15)

Plan section 6, scope 3b. The first batch admitted on shared engine primitives instead of a new
bespoke execution scope per card, under Cody's 2026-11-15 decision to keep the exact per-card
admission check.

## Cards

| Card | Type | Text | Scope | Runs on |
|---|---|---|---|---|
| Royce: Don't Call Me Simon (`royce-don-t-call-me-simon`) | Unit, Red, 5, power 4 | {Play} Defeat a rival Unit with power 2 or less. If you have more ☆ (Street Cred) than a Rival, defeat a rival Unit with power 3 or less instead. | `TARGETED_DEFEAT_V1` | Unit-defeat filter with an `instead` bound |
| Wild in the Streets (`wild-in-the-streets`) | Program, Green, 5 | Defeat a spent Unit. | `TARGETED_DEFEAT_V1` | Unit-defeat filter, `power: ANY`, `readiness: SPENT` |
| Delamain: Rideshare AI (`delamain-rideshare-ai`) | Unit, Blue, 3, power 0 | {Play} Draw 2. (Units with power 0 don't steal Gigs.) | `COMBAT_TRIGGERS_V1` | Existing PLAY trigger scheduler and `DRAW` |

Revisions are authored in `tests/api-admission-batch-v7-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e`. Source records are evidence only; the mechanics are authored there. None of
the three cards has an erratum. All three are `SOURCE_MATCH` against the engine-candidate catalog.

## Engine change

- `DefeatUnitTargetSchema` (domain `mechanics.ts`): the `AT_MOST` bound is any nonnegative integer
  (was the literal 5); new `power: { kind: "ANY" }`; optional `readiness: "SPENT"`; optional
  `instead: { condition: STREET_CRED_GREATER_THAN_RIVAL, power: AT_MOST n }`, which replaces the bound
  while the condition holds. The grammar admits nothing by itself.
- `listDefeatableUnits` applies the readiness filter and evaluates the `instead` condition against the
  current state each time targets are listed (choice construction, resolution, revalidation).
- `supportsTargetedDefeatCard` now checks a literal pin table (`TARGETED_DEFEAT_SHAPES`): complete
  type, colors, RAM, tags, cost, sellability, power and effect list per admitted card. Minotaur and Over
  the Edge keep exactly their previous shapes.
- `supportsTriggerCard` pins Delamain's complete shape (Blue Unit, cost 3, power 0, tag AI, one PLAY
  ability drawing 2).
- Engine identity `0.4.2-lag-order` -> `0.4.3-defeat-filter-v7`; baselines regenerated in a separate
  commit.

## Rules readings

- Royce's defeat is mandatory and targets only rival Units. With no eligible Unit it does nothing; one
  eligible Unit is defeated without a choice; two or more pause for the controller's choice.
- Royce's Street Cred comparison uses the existing Null-aware `STREET_CRED_GREATER_THAN_RIVAL`
  (rule 5.11.4), evaluated at resolution.
- Wild in the Streets may defeat the caster's own spent Unit ("a spent Unit" names no controller) and
  has no power limit.
- Delamain's power-0 reminder text is already the reviewed Gig-steal policy (`gigSteal.nonPositive: 0`).

## Tests

`tests/api-admission-batch-v7.test.ts`: source projection and candidate match; each card passes only
its own pin and every single-field change is rejected; Royce behind/ahead target sets, choice and
forced resolution; Wild spent-only on both sides and the no-target case; Delamain draws exactly 2; the
reviewed union admits all three. The reviewed union is now 42 cards, and coverage is 42/151.
