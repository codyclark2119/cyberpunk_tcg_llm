# API admission batch V38 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Unit with two printed abilities. Other friendly Units have +2 power while
attacking, and at the end of its controller's turn it readies up to 3 friendly Units. The card is pinned literally in
its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Saul Bright: Stormrider (`saul-bright-stormrider`) | Unit, Green, 8, power 14 | Other friendly Units have +2 power while attacking. At the end of your turn, ready up to 3 friendly Units. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v38-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - A new continuous modifier, `OTHER_FRIENDLY_ATTACKING_UNIT_POWER` with `amount` 2.
  - A new effect, `READY_UNITS_UP_TO` with `relation` FRIENDLY and `maximum` 3.
- State (`game.ts`): the trigger continuation's optional `readiedUnits` (1 or 2 ids) holds the Units already readied by
  the current choice.
- `characteristics.ts`:
  - An attacking friendly face-up field Unit gains +2 from each other friendly face-up field Unit with the pinned aura.
  - The contribution is live (10.22). Nothing is stored and nothing is cleaned up.
  - The source's own modifier contributes nothing to itself. `view.ts` lists the modifier as supported only under its
    pin.
- `ready-unit.ts`: `friendlyUnitReadyTargets` lists the controller's face-up field Units, Go Solo Legends included
  (4.2.1). As with the other readies, readiness is not a selector filter.
- Resolution and choices (`trigger-resolution.ts`, `trigger-queries.ts`):
  - The own-turn end trigger offers `MODE DONE` and each friendly Unit not yet chosen.
  - Each pick readies one Unit through `readyCardForEffect`, which still honors ready locks.
  - The ready finishes after 3 picks, when no Unit remains, or on `DONE`.
  - The choice id includes `readiedUnits` only when it is present.
- Validation (`trigger-state.ts`): the ready pauses only in its own END_TURN batch, for its pinned source, with at most 2
  readied friendly Units held and another still to choose.
- Gate (`attacking-ready-support.ts`):
  - The whole printed Unit is pinned. `supportsTriggerCard` delegates to it.
  - `validateEndTurnMetadata` accepts its own-turn end ability under this gate.
- Engine identity `0.4.33-gig-set-v37` -> `0.4.34-attacking-ready-v38`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- "Other friendly Units have +2 power while attacking": from the attack's declaration until its cleanup, the same window
  as the reviewed Arasaka aura. Saul never boosts itself, and each Saul on the field contributes.
- "Ready up to 3 friendly Units": any of the controller's field Units, Saul included, one pick at a time. The controller
  may stop at any point. Readying a ready Unit changes nothing.

## Tests

`tests/api-admission-batch-v38.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - no aura, the Arasaka aura, no end ready, an attack trigger, or a condition;
  - cost, power, tags, a keyword or sellability.
- The aura:
  - an attacking friendly Unit has 6 instead of 4, while a non-attacking friendly Unit and a rival Unit stay at 4;
  - Saul attacking stays at 14;
  - two Sauls give +4.
- At the end of the turn:
  - Saul and three spent friendly Units are offered, and the rival's Unit is not;
  - after two picks the held Units are recorded, and a forged rival Unit is rejected;
  - the third pick finishes, so the fourth Unit stays spent and the turn passes;
  - stopping after one leaves the rest spent.
- Saul alone is offered with `DONE`.
- Union membership.

The reviewed union is now 87 cards, and coverage is 87/151.
