# API admission batch V66 (2026-11-21)

Plan section 6, scope 3c. This batch admits Panam Palmer: Strength Through Family, a Unit with "During your turn, you may Call a
Legend for free." and "{Attack} Discard 1. If you do, draw 1 for each friendly face-up Legend." It is the first free Call. The
card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Panam Palmer: Strength Through Family (`panam-palmer-strength-through-family`) | Unit, Green, RAM 4, cost 6, power 6, Aldecado/Merc/Nomad | During your turn, you may Call a Legend for free. {Attack} Discard 1. If you do, draw 1 for each friendly face-up Legend. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v66-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the continuous modifier `FREE_CALL_DURING_OWN_TURN`, and `thenDraw: "PER_FRIENDLY_FACE_UP_LEGEND"` on the
  controller's `DISCARD_CARDS`.
- A new free-Call pin table (`free-call-support.ts`). The play and trigger gates route the card there first, power and keyword
  derivation skip the modifier, and the ordered-attack validator leaves it to that pin.
- `effectiveCallCost`: 0 for the active player while they control a face-up field Unit with the pinned modifier, otherwise
  the ruleset's Call cost. Call enumeration, the Call action, its payment and the Call-payment validator all use it. The
  once-per-turn Call allowance is unchanged.
- The {Attack} discard pauses only for a choice among 2 or more hand cards. A lone card is discarded without a choice. After an
  actual discard it draws 1 for each friendly face-up Legend (Legends area and field), counted as it resolves. With an empty
  hand nothing is discarded and nothing is drawn.
- Engine identity `0.4.61-ready-blocker-attack-v65` -> `0.4.62-free-call-v66`.

## Rules readings

- "During your turn" covers every Call its controller makes in their own turn. In a Rival's turn (React) the Call costs as
  usual, and Panam never frees a Rival's Call.
- "You may Call for free": a free Call is never worse than a paid one, so the Call simply costs nothing. No paid alternative is
  offered.
- "If you do" depends on an actual discard.

## Tests

`tests/api-admission-batch-v66.test.ts` covers source projection and candidate match; the exact pin with forgeries across the
play, trigger and free-Call gates; a free Call with no payment source at all, and the once-per-turn allowance; the usual cost
without Panam, in a Rival's turn and for a Rival; the {Attack} discard choice and the draw per face-up Legend; a lone card
discarded without a choice; an empty hand drawing nothing; and union membership.

The reviewed union is now 116 cards, and coverage is 116/151.
