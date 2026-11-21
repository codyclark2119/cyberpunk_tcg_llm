# API admission batch V72 (2026-11-21)

Plan section 6, scope 3c. This batch admits Rita Wheeler: No Stupid Questions, a Blocker Unit with "The first time this Unit is
spent each turn, draw 1, then discard 1." It builds on the V69 "when spent" trigger. The card is pinned literally in its engine
gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Rita Wheeler: No Stupid Questions (`rita-wheeler-no-stupid-questions`) | Unit, Blue, RAM 2, cost 4, power 4, Ganger/Mox, not sellable | {Blocker} The first time this Unit is spent each turn, draw 1, then discard 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v72-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the ability guard `FIRST_SPEND_PER_TURN`, `drawFirst: 1` on `DISCARD_CARDS`, and `firstSpends` on the turn history.
- `noteSpent` records a card with a first-spend trigger the first time it is spent each turn, and binds that trigger only then.
- Resolution: the draw comes first, then the controller's discard (a lone hand card is discarded without a choice).
- The spend-trigger pin table gains Rita's shape. The ordered-attack metadata check, which reads any own-hand discard, accepts a
  spend-trigger pin.
- Validators: a first-spend binding needs its card in `firstSpends`; the discard pause is Rita's own, after its draw, for a choice
  among 2 or more cards.
- Engine identity `0.4.67-spend-adjust-draw-v71` -> `0.4.68-first-spend-v72`.

## Rules readings

- Every spend counts toward "the first time" (V69: attacking, blocking, an effect), so a later spend the same turn, after she is
  readied, does not trigger.
- "Draw 1, then discard 1": the drawn card may be the discard.

## Tests

`tests/api-admission-batch-v72.test.ts` covers source projection and candidate match; the exact pin with forgeries; her first spend
by attacking (draw, then a discard choice that includes the drawn card); her first spend by blocking (the defender draws and
discards); no trigger for a later spend the same turn; and union membership.

The reviewed union is now 122 cards, and coverage is 122/151.
