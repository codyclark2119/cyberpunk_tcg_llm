# API admission batch V71 (2026-11-21)

Plan section 6, scope 3c. This batch admits Zetatech Faceplate, a Gear whose host inherits "When this Unit or Legend is spent,
adjust a Gig by up to 1. Then, if you control 3 or more Gigs with different values, draw 1." It builds on the V69 "when spent"
trigger. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Zetatech Faceplate (`zetatech-faceplate`) | Gear, Yellow, RAM 2, cost 2, power 2, Cyberware/Zetatech, sellable | (Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is spent, adjust a Gig by up to 1. Then, if you control 3 or more Gigs with different values, draw 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v71-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `then: { kind: "DRAW_IF_DISTINCT_FRIENDLY_GIG_VALUES", minimum: 3, count: 1 }` on `ADJUST_GIG_UP_TO`.
- Resolution in a trigger batch: the existing Gig and amount choices, then the condition is checked and the draw made. It is
  checked whether or not a Gig was adjusted, and with no Gig to adjust.
- The spend-trigger pin table gains Faceplate's shape.
- Engine identity `0.4.66-spend-search-top-v70` -> `0.4.67-spend-adjust-draw-v71`.

## Rules readings

- "Adjust a Gig" is any player's Gig (as for the other "adjust a Gig" cards). Adjusting by 0 is allowed ("up to 1").
- "3 or more Gigs with different values" counts the distinct current values among the controller's own rolled Gigs, after the
  adjustment (10.16.1.1: conditions are checked on resolution).

## Tests

`tests/api-admission-batch-v71.test.ts` covers source projection and candidate match; the exact pin with forgeries; an adjustment
that makes 3 different friendly values and draws; keeping the value (two values, no draw); adjusting a rival Gig, which does not
count; and union membership.

The reviewed union is now 121 cards, and coverage is 121/151.
