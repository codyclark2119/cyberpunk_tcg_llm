# API admission batch V13 (2026-11-18)

Plan section 6, scope 3c. One Unit whose `{Defeated}` trigger returns another Unit from its
controller's trash to hand. The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Screw: Lovelorn Fool (`screw-lovelorn-fool`) | Unit, Red, 5, power 7 | {Defeated} Add another Unit from your trash to your hand. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v13-fixture.ts` from
`data/raw/cards/screw-lovelorn-fool.json` at commit `3eaadb3e` (the V7 snapshot). No erratum applies.
It is `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): a new effect `RETURN_TRASH_UNIT_TO_HAND` with
  `exclude: "SUBJECT"`. No new policy or scope.
- Scheduler (`trigger-resolution.ts`, `trigger-queries.ts`): the effect offers the Units in the
  ability controller's own trash other than the trigger subject. With none it resolves with no change,
  one is returned automatically, and more pause for a `TARGET` choice. The chosen card moves to hand
  face down and emits `CARD_TARGET_SELECTED` and `CARD_MOVED`.
- State validator (`trigger-state.ts`): this effect may pause only as a `TARGET` choice of a
  `WHEN_DEFEATED` binding in a `DEFEAT` batch whose source passes the exact trigger gate, with the
  exact current options.
- Gate: `supportsTriggerCard` pins Screw's complete printed shape and its single ability.
- Engine identity `0.4.8-defeat-second-each-v12` -> `0.4.9-defeated-trash-return-v13`; baselines
  regenerated in a separate commit.

## Rules readings

- "Another Unit" excludes Screw itself, which is already in the trash when the trigger resolves.
- "Your trash" is the trash of the ability's controller, and only cards that player owns are there.
  Trash is public, so offering its Units reveals nothing.
- Units are identified by printed card type in the trash, since no effect changes types outside the field.

## Tests

`tests/api-admission-batch-v13.test.ts`: source projection and candidate match; the exact pin with
single-field forgeries rejected; a defeat with two other own trash Units (choice offered to the
controller, Screw and rival trash excluded, a forged option for Screw rejected, the chosen Unit moved to
hand face down); one Unit returned automatically; no other Unit, with no change; union membership. The
reviewed union is now 56 cards, and coverage is 56/151.
