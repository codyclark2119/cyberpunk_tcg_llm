# API admission batch V54 (2026-11-20)

Plan section 6, scope 3c. This batch admits Towerfall, the second modal Program after Pyramid Song (V44). It adds effects that
reach every rival Unit at once: a -5 power modifier on each, and a bottom-deck of every rival Unit with power 0. The card is
pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Towerfall (`towerfall`) | Program, Blue, 6, RAM 4, Braindance, sellable | Choose one effect. If you have less ☆ (Street Cred) than a Rival, choose both instead. Give all rival Units -5 power this turn. // Bottom-deck all rival Units with power 0. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v54-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `mechanics.ts` adds the power target `ALL_RIVAL_UNITS` and the bottom-deck flag `all`. `game.ts` adds a -5
  temporary modifier marked `scaled: "ALL_RIVAL_UNITS"`, one per target from one effect.
- `modal-program-support.ts` pins Towerfall beside Pyramid Song, with the existing `STREET_CRED_LESS_THAN_RIVAL` condition as
  its "choose both instead".
- The power primitive applies the modifier to each rival Unit on the field as it resolves, in id order, with no choice.
  Modifier ordering and the uniqueness check now separate same-effect modifiers by target, for this marker only.
- `bottom-deck.ts` moves every qualifying Unit, with its Gear, in one step. Each owner's cards go to the bottom of their deck
  in one random order. The single-Unit path is unchanged and draws the same random numbers.
- Neither all-target primitive ever pauses, and the play-state validators reject a pause on one.
- Engine identity `0.4.49-first-cyberware-v53` -> `0.4.50-towerfall-v54`.

## Rules readings

- "All rival Units" means the rival Units on the field when the effect resolves. Units that arrive later are unaffected.
- With both effects, they resolve in printed order. The -5 applies first, so a rival Unit with 5 or less power has power 0
  or less, which counts as 0 (2.10.1), and is bottom-decked too.
- 11.15.1: an owner places all of their bottom-decked cards on the bottom of their deck in a random order, face down. A
  bottom-decked Unit's temporary modifiers end as it enters the hidden deck (5.3.2.2).
- Street Cred is the sum of a player's rolled Gigs; with equal Street Cred the player chooses one effect.

## Tests

`tests/api-admission-batch-v54.test.ts` covers source projection and candidate match; the exact pin with forgeries (not
modal, another condition, one rival Unit, one bottom-deck, -4, swapped modes, cost, Quick); the power mode on three rival
Units with no choice; the bottom-deck mode on two power-0 Units at once; "choose both" with less Street Cred, bottom-decking
a power-4 Unit after its -5; forged duplicate and friendly-target modifiers; and union membership.

The reviewed union is now 103 cards, and coverage is 103/151.
