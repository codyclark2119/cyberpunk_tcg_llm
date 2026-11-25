# API admission batch V77 (2026-11-25)

Plan section 6, scope 3c. This batch admits Fool on the Hill, a Program whose revealed cards a Rival sends to its controller's hand
or trash. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Fool on the Hill (`fool-on-the-hill`) | Program, Green, RAM 3, Merc, cost 2, sellable | Reveal the top 2 cards of your deck. A Rival chooses whether you add them to your hand or trash them. If you trash them, draw 2. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v77-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH {count: 2, drawIfTrashed: 2}`; the event `DESTINATION_CHOSEN`
  (effect id, choosing player, `HAND` or `TRASH`).
- A new pin table, `packages/engine/src/rival-reveal.ts`. The effect routes there first; the play, Call, field-Legend and trigger
  gates reject it.
- Resolving the effect emits `CARD_REVEALED` for each revealed card, then hands the acting player to the Rival, who gets a `MODE`
  choice: "Put the revealed cards into their owner's hand" or "Trash the revealed cards (their owner draws 2)". The turn's active
  player is unchanged; the play-state, turn-state and action-return checks accept the Rival as actor for this choice only.
- While the choice is pending, observation shows the revealed cards to both players as inspected cards.
- After the choice the acting player returns to the controller, the cards move, and on trash the controller draws 2. Drawing from
  an empty deck ends the game there, and the Program finishes into the trash as other plays do on a game end.
- Engine identity `0.4.74-braindance-legend-v76` -> `0.4.75-rival-reveal-v77`.

## Rules readings

- "A Rival" is the opponent: the engine plays two-player matches.
- The revealed cards are public to both players until the Rival chooses, and they stay on top of the deck until then.
- A deck with one card reveals that card and the Rival still chooses; an empty deck reveals nothing and asks nothing.
- "If you trash them, draw 2" applies only when cards were revealed and the Rival chose trash. Drawing 2 from a deck with fewer than
  2 cards loses the game under the usual draw rule.

## Tests

`tests/api-admission-batch-v77.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries rejected and no other gate admitting the card;
- the reveal to both players, the Rival's choice, its labels, and the hand outcome;
- the trash outcome with the draw of 2;
- a one-card deck (the reveal, the choice, and the loss on drawing) and an empty deck (no reveal, no choice);
- union membership.

The reviewed union is now 127 cards, and coverage is 127/151.
