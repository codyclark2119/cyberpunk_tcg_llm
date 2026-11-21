# API admission batch V57 (2026-11-20)

Plan section 6, scope 3c. This batch admits Take Control, a Quick Program that makes a rival Unit steal 1 fewer Gig this turn.
It adds the engine's first per-Unit change to how many Gigs a Unit steals. The card is pinned literally in its engine gate
(Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Take Control (`take-control`) | Program, Green, 2, RAM 2, Quickhack, sellable | {Quick} A rival Unit steals 1 fewer Gig this turn. If that Unit is an AI, DRONE, or VEHICLE, draw 1. | `COMBAT_REACT_V1` |

The revision is authored in `tests/api-admission-batch-v57-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `mechanics.ts` adds the effect `STEAL_FEWER_THIS_TURN` (a rival Unit, 1, with its AI/DRONE/VEHICLE draw).
  `game.ts` adds `stealReductions`: one record per resolved effect, naming its target, source, controller and turn.
- New `steal-reduction-support.ts` pins the whole Program. The play gate routes it there; the trigger, effect and React gates
  refuse it, so its Quick play goes only through the pin.
- New `steal-reduction.ts`: the effect chooses a current rival field Unit (one is forced, none does nothing), records the
  reduction, then checks the classification and draws. Reductions end at the end of the turn and when the Unit leaves the
  field, and `validateStealReductions` checks each one's Program, turn and target.
- Every steal count reads the reduction, never below 0: an attack's Gig steal (through `RulesView`), its paused steal
  validation, and the V47 effect steal.
- Engine identity `0.4.52-go-solo-tax-v56` -> `0.4.53-steal-fewer-v57`.

## Rules readings

- "Steals 1 fewer Gig this turn" lowers the number of Gigs the Unit steals when it steals this turn, whether from an attack or
  an effect. A Unit that would steal 1 then steals none.
- "That Unit" is the chosen Unit, checked as the effect resolves; the draw does not depend on the steal.
- The reduction is public, but the model observation does not show it yet; adding it is a wire change for a later batch.

## Tests

`tests/api-admission-batch-v57.test.ts` covers source projection and candidate match; the exact pin with
forgeries (not Quick, also Blocker, a second effect, a condition, cost, tags, unsellable) and the refusing gates; Main-phase
plays on a DRONE (draws 1) and an NCPD Unit (no draw), ending with the turn; a React play on the rival's turn that cuts a
power-15 attacker's 2 steals to 1; the reduction ending when its Unit leaves; forged targets and turns; and union membership.

The reviewed union is now 106 cards, and coverage is 106/151.
