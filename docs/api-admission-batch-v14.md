# API admission batch V14 (2026-11-18)

Plan section 6, scope 3c. One Program that trashes the top 3 cards of its controller's deck and returns
a Unit from among them. The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| All Is Lost (`all-is-lost`) | Program, Red, 1 | Trash 3. Add a Unit from among them to your hand. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v14-fixture.ts` from `data/raw/cards/all-is-lost.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): a new effect `TRASH_THEN_RETURN_UNIT` with `count: 3`. The Program
  continuation (domain `game.ts`) gains `trashedIds`, the cards the current primitive trashed. No new
  policy or scope.
- Primitive (`trash-return.ts`, registered in `effects.ts`): trashes the top card of the controller's
  deck up to 3 times, one at a time (11.10.2.1.1). Units among exactly those cards are offered. With none
  nothing returns, one returns automatically, and more pause for a `TARGET` choice. The chosen card moves
  to hand face down with `CARD_TARGET_SELECTED`.
- Play flow (`play.ts`, `play-state.ts`): the choice and its validator. A pause needs `trashedIds` to be
  exactly the top of the trash in order, fewer than 3 only when the deck is empty, owned by the
  controller, and at least 2 Units to choose from. `trashedIds` exists only during this primitive.
- Gate: `supportsPlay` pins All Is Lost's complete printed shape in the `NONCOMBAT_PLAY_V1` Program branch,
  and rejects this effect on any other shape.
- Engine identity `0.4.9-defeated-trash-return-v13` -> `0.4.10-trash-return-unit-v14`; baselines
  regenerated in a separate commit.

## Rules readings

- "Trash 3" follows 11.10.2.1: reveal the top card and move it to the trash, 3 times, one at a time, so
  the trash order is deck order.
- With fewer than 3 cards in the deck, the engine trashes what remains and the player does not lose.
  Only drawing from an empty deck loses (1.14); the rules name no loss for trashing. This is a reading to
  confirm, not a cited rule.
- "Add a Unit from among them" is mandatory when a Unit was trashed, and only those trashed cards count,
  not Units already in the trash. Card type is the printed type, since nothing changes types in the trash.

## Tests

`tests/api-admission-batch-v14.test.ts`: source projection and candidate match; the exact pin with
single-field forgeries rejected; a choice between two trashed Units (individual trashing in deck order, a
forged non-Unit option and a forged trashed record rejected, the chosen Unit in hand and the Program in
the trash); one Unit returned automatically; no Unit, with nothing returned; a 2-card deck and an empty
deck without a loss; union membership. The reviewed union is now 57 cards, and coverage is 57/151.
