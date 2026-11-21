# API admission batch V60 (2026-11-21)

Plan section 6, scope 3c. This batch admits two Legends with "{Call} Choose one effect." and a {Spend} Gig adjustment: Wakako
Okada: Peace and Harmony and Dexter DeShawn: Off the Grid. It adds the engine's first modal Call ability. Each card is pinned
literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Wakako Okada: Peace and Harmony (`wakako-okada-peace-and-harmony`) | Legend, Blue, RAM 2, Fixer/Tyger Claws, sellable | {Call} Choose one effect. Give a rival Unit -2 power this turn. // Draw 1. {Spend}: Decrease a Gig by up to 2. | `VALUE_CONDITIONS_V1` |
| Dexter DeShawn: Off the Grid (`dexter-deshawn-off-the-grid`) | Legend, Red, RAM 2, Fixer, sellable | {Call} Choose one effect. Give a friendly Unit +2 power this turn. // Draw 1. {Spend}: Increase a Gig by up to 2. | `VALUE_CONDITIONS_V1` |

The revisions are authored in `tests/api-admission-batch-v60-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar: a `choose` with no `allInstead` condition is a plain "Choose one effect."; `ADJUST_GIG_UP_TO` accepts a maximum of 2;
  temporary power gains a `LEGEND_CALL` variant for the Called Legend's -2 or +2.
- Both Legends join the V59 Legend pin table, which now also requires the React policy (the power modes are React-time effects).
- Calling a pinned Legend with a modal Call ability starts the activation continuation at its mode choice, in Main or in the
  React Step it was Called from. The chosen mode then resolves like a {Spend} effect. The mode choice and continuation use
  the Called ability, not the first printed one.
- The power mode targets rival Units (Wakako) or the controller's field Units (Dexter); a lone Unit is taken without a choice
  and none does nothing. `validateTemporaryPower` checks the Legend, the mode's relation and the turn.
- The {Spend} adjustment uses the existing directional Gig adjustment: any rolled Gig, then 0 up to 2 within the die's faces.
- `validateLegendActivationState` now bounds the mode pause, power target, swap and adjustment pauses. The friendly-play-power
  and min-Gig Program detectors leave these Legends to their pin.
- Engine identity `0.4.55-legend-spend-v59` -> `0.4.56-call-choose-one-v60`.

## Rules readings

- Both printed modes are always offered, even when the power mode would find no Unit; it then does nothing.
- "A Gig" for the {Spend} adjustment is either player's rolled Gig, like Afterparty's adjustment.

## Tests

`tests/api-admission-batch-v60.test.ts` covers source projection and candidate match for both cards; each exact pin with
forgeries (a both-instead condition, no choice, draw 2, adjust 3, the other direction, Quick, tags, swapped modes), the Call
gate and the refusing play gate; Wakako's Call with both modes offered, -2 on a chosen rival Unit that ends with the turn, a
forged target, and the draw mode; Dexter's +2 on a lone friendly Unit; Wakako Called in React against the attacker; both
{Spend} adjustments with their amount bounds; no {Spend} while face down; and union membership.

The reviewed union is now 110 cards, and coverage is 110/151.
