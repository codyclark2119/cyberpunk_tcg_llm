# API admission batch V78 (2026-11-25)

Plan section 6, scope 3c. This batch admits Shattered Memories, a BRAINDANCE Program that discards both hands and lets each player
draw. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Shattered Memories (`shattered-memories`) | Program, Red, RAM 2, Braindance, cost 4, sellable | Each player discards their hand and may draw 5. If the total number of discarded cards equals the value of a friendly Gig, draw 2. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v78-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `EACH_PLAYER_DISCARDS_HAND_MAY_DRAW {draw: 5, drawIfTotalMatchesFriendlyGig: 2}`; the event
  `OPTIONAL_DRAW_CHOSEN` (effect id, player, whether they draw); and `discardedIds` on the play continuation, the cards the effect
  discarded, kept while the draw choices are pending.
- A new pin table, `packages/engine/src/hand-reset.ts`. The effect routes there first; the play, Call, field-Legend, trigger and V77
  gates reject it.
- Resolving the effect discards the controller's hand, then the Rival's (`CARD_DISCARDED`, forced), and records them. The
  controller then chooses "Draw 5" or "Draw nothing"; then the acting player passes to the Rival for the same choice. The active
  player is unchanged throughout. After the Rival's choice the acting player returns to the controller, and if the number of
  discarded cards equals the current value of one of the controller's rolled Gigs, the controller draws 2.
- The choice id includes the recorded discards and the choosing player, so the two choices are distinct.
- The V77 exceptions that let a Rival hold a play choice (play state, turn state, action return) now go through one helper,
  `otherPlayerMayChoose`, which names both effects. V77's behaviour is unchanged.
- Engine identity `0.4.75-rival-reveal-v77` -> `0.4.76-hand-reset-v78`.

## Rules readings

- "Each player" acts in turn order from the controller: the controller's hand is discarded first and the controller chooses first.
  The discards come before either choice, so the total is fixed before anyone draws.
- "May draw 5" is each player's own choice, offered even with an empty hand. A player who draws 5 from a deck with fewer than 5
  cards loses under the usual draw rule, so drawing nothing is always available.
- "A friendly Gig" is one of the controller's own rolled Gigs. The bonus draw comes after both choices, as printed; it is checked
  against the Gigs' values at that time, which nothing in the effect changes.
- An empty pair of hands discards 0 cards, which matches no Gig (no die shows 0).
- Shattered Memories is a BRAINDANCE Program, so Judy Álvarez: Braindance Maestro (V76) triggers after it resolves.

## Tests

`tests/api-admission-batch-v78.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries rejected and no other gate admitting the card;
- discard order, the controller's choice and then the Rival's, labels, hidden draws, no bonus on a mismatch;
- the bonus draw of 2 when the total equals the controller's Gig, after the Rival's choice;
- empty hands;
- a loss for either player drawing 5 from a short deck, and declining safely;
- Judy's trigger after the reset;
- union membership.

The reviewed union is now 128 cards, and coverage is 128/151.
