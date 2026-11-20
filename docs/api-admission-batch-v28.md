# API admission batch V28 (2026-11-19)

Plan section 6, scope 3c. This batch admits one Unit with two triggered abilities. Each ability's amount is
counted from the values of friendly Gigs: even values for {Attack}, odd values for {Defeated}. The card is
pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Jackie Welles: Ride or Die Choom (`jackie-welles-ride-or-die-choom`) | Unit, Yellow, 6, power 8 | {Attack} Give this Unit +2 power this turn for each friendly Gig with an even value. {Defeated} Draw 1 for each friendly Gig with an odd value. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v28-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`). Two new effects:
  - `POWER_PER_FRIENDLY_GIG` (target `SOURCE_SUBJECT`, amount 2, parity `EVEN`).
  - `DRAW_PER_FRIENDLY_GIG` (count 1, parity `ODD`).
- State (`game.ts`): a scaled temporary power modifier. Its amount is a positive multiple of 2, and it carries
  `scaled: "FRIENDLY_EVEN_GIGS"`, so a +2 from one even Gig can't be mistaken for the fixed friendly +2.
  - The existing modifiers are byte-identical.
  - Code that read the occurrence id now narrows on `origin`, not on `amount !== -1`.
- `gig-parity.ts`:
  - Counts the controller's rolled Gigs in their own Gig area with the given parity.
  - The {Attack} effect applies one modifier of 2 x that count to the attacking Unit, with no modifier when the
    count is 0.
  - The {Defeated} effect draws that count.
  - Both fail closed unless the source passes its pin and the occurrence is its own self ATTACK, or its
    DEFEATED trigger.
- `temporary-power.ts` validates the scaled modifier:
  - the source and target are the same reviewed Unit, face up on the field or in the trash;
  - the modifier is for the current turn;
  - its effect id is that Unit's own ATTACK occurrence, already resolved;
  - the amount is at most 2 for every Gig in the game.
- Gate: `gig-parity-support.ts` pins the complete ability list in printed order, and `supportsTriggerCard`
  delegates to it.
- Engine identity `0.4.23-steal-increase-v27` -> `0.4.24-gig-parity-v28`. The baselines are regenerated once for
  the bundle this batch ships in, in a separate commit.

## Rules readings

- 6.1.2, 6.1.3: friendly Gigs are the Gigs in your Gig area. Dice in the fixer area and a Rival's Gigs never
  count. A stolen Gig counts for its new controller.
- 6.3: a Gig's value is its current top face. The count is taken once, when the effect resolves. A later
  change to a Gig's value does not change the power already given.
- 5.3.2.2: the power lasts this turn and tracks the Unit until it enters a hidden area, like the other
  "this turn" power.
- {Defeated} resolves after the Unit has left the field. The odd Gigs are counted for the Unit's controller at
  that time.

## Tests

`tests/api-admission-batch-v28.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - a Play trigger, or a draw on attack;
  - either ability missing, or the abilities reordered;
  - an added condition or keyword;
  - cost, power, tags or sellability.
- {Attack} with two friendly even Gigs, one friendly odd Gig and a rival even Gig:
  - power is 12, from a single +4 modifier;
  - an inflated amount is rejected, and so is a forged occurrence id;
  - the modifier is gone at the end of the turn.
- {Attack} with no friendly even Gig gives no modifier.
- {Defeated}: Jackie attacks a spent power-15 Unit and loses the fight. It draws 2 with two friendly odd Gigs
  (a Rival's odd Gig does not count), and draws 0 with none.
- Union membership.

The reviewed union is now 77 cards, and coverage is 77/151.
