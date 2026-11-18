# API admission batch V15 (2026-11-18)

Plan section 6, scope 3c. Two Programs that bottom-deck Units. Each card is pinned literally in its engine
gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Les Élémens (`les-e-le-mens`) | Program, Blue, 5 | Bottom-deck a Rival's lowest-power Unit. (If there are multiple, choose 1.) | `NONCOMBAT_PLAY_V1` |
| Unlikely Bond (`unlikely-bond`) | Program, Blue, 4 | Bottom-deck a ready friendly Unit. If you do, bottom-deck a spent rival Unit. | `NONCOMBAT_PLAY_V1` |

The revisions are authored in `tests/api-admission-batch-v15-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): a new effect `BOTTOM_DECK_UNIT` with a `target` (relation, optional
  readiness, optional `lowestPower`) and an optional `then` target for an "if you do" clause. The Program
  continuation (domain `game.ts`) gains `bottomDecked`, the Unit the first clause moved while the second
  clause awaits a choice. No new policy or scope.
- Primitive (`bottom-deck.ts`, registered in `effects.ts`): targets are public effective Units on the
  field. With none the primitive ends, one is bottom-decked automatically, and more pause for a `TARGET`
  choice by the Program's controller. The Unit and its equipped Gear go face down to the bottom of the
  owner's deck in a seeded random order, ready, with statuses and temporary power cleared and the Gear
  detached. A Legend in the deck is then removed from the game.
- Play flow (`play.ts`, `play-state.ts`): the choice and its validator. A pause needs at least 2 targets;
  in the second clause `bottomDecked` must name a Unit already in its owner's deck (or a removed Legend).
  The choice id includes `bottomDecked`, so the two choices of one Unlikely Bond differ. `bottomDecked`
  exists only during this primitive.
- Gate: `supportsPlay` pins both complete printed shapes in the `NONCOMBAT_PLAY_V1` Program branch, and
  rejects this effect on any other shape.
- Engine identity `0.4.10-trash-return-unit-v14` -> `0.4.11-bottom-deck-unit-v15`; baselines regenerated
  in a separate commit.

## Rules readings

- 11.15.1 and 11.15.1.2: the owner places the card on the bottom of their own deck, face down (11.15.1.1).
- 4.12.3 and 11.15.1.3: an equipped Unit and its Gear are randomized together before placement. A Unit
  with no Gear consumes no randomness.
- 4.4 and 4.4.2: a Legend fighting as a Unit is in an invalid area in the deck and is removed from the
  game. Its Gear stays in the deck.
- "Lowest-power" uses current effective power and keeps every tied Unit; the Program's controller chooses
  one ("If there are multiple, choose 1"). Spent and ready Units both count.
- "If you do" applies only when the friendly Unit was bottom-decked; with no ready friendly Unit nothing
  happens, even if a spent rival Unit exists. Each clause is its own bottom-deck, not one simultaneous group.
- A Unit's readiness, Lag and Go Solo do not survive the move; the card is ready like any deck card.

## Tests

`tests/api-admission-batch-v15.test.ts`: source projection and candidate match; the exact pins with
single-field forgeries rejected; Les Élémens offering only the tied lowest-power rival Units (a forged
higher-power option rejected, the chosen Unit face down at the bottom of its owner's deck); a single
lowest-power Unit forced with its Gear randomized alongside it, and no rival Unit doing nothing; Unlikely
Bond choosing a ready friendly Unit, then a spent rival Unit (a dropped or wrong `bottomDecked` record
rejected), skipping both clauses with no ready friendly Unit, forcing one of each, and bottom-decking a
friendly Unit alone when no rival Unit is spent; union membership. The reviewed union is now 59 cards, and
coverage is 59/151.
