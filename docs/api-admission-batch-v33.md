# API admission batch V33 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Unit whose {Play} lets its controller discard 2 Programs from hand. If
they do, they bottom-deck a rival Unit with no Gear attached. It extends the V32 primitive. The card is pinned literally
in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Maman Brigitte: Spirit of Death (`maman-brigitte-spirit-of-death`) | Unit, Blue, 5, power 3 | {Play} You may discard 2 Programs. If you do, bottom-deck a rival unequipped Unit. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v33-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`): `DISCARD_PROGRAMS_THEN_BOTTOM_DECK` now takes a `count` of 1 or 2, and its `then` clause
  may say `unequipped`.
- `program-discard.ts`: an `unequipped` bottom-deck leaves out any rival Unit with Gear attached (4.12).
- Resolution and validation are the V32 ones:
  - The two Programs are chosen one at a time. Declining is offered only before the first, and a single remaining
    Program is discarded without a choice.
  - The bottom-deck waits until both discards are held.
- Gate (`program-discard-support.ts`): a second whole-card pin.
- Engine identity `0.4.28-program-discard-v32` -> `0.4.29-program-discard-two-v33`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "You may discard 2 Programs": the controller needs 2 Programs in hand to choose it. With fewer, nothing happens.
  Once they start, they discard both.
- "A rival unequipped Unit": a rival Unit with no Gear attached. With none, the discards still happen and nothing is
  bottom-decked.

## Tests

`tests/api-admission-batch-v33.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - one Program, or any rival Unit;
  - an attack trigger, or a second ability;
  - cost, power, tags, a keyword or sellability.
- {Play}:
  - three Programs are offered, and after the first the decline is gone;
  - a target phase before the second discard is rejected;
  - an equipped rival Unit is never offered, and a forged option for it is rejected.
- With one Program nothing is offered. With exactly two, the second is forced, and an only unequipped rival Unit is
  bottom-decked while the equipped one stays. Declining keeps both Programs.
- Union membership.

The reviewed union is now 82 cards, and coverage is 82/151.
