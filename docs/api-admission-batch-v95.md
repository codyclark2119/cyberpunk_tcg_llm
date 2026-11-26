# API admission batch V95 (2026-11-25)

Plan section 6, bundle 14. This batch admits Judy Álvarez: Nothing to Doubt, a Unit whose paid {Spend} ability reveals the top card
of its controller's deck, which the controller may play for free or otherwise adds to hand. It is the engine's first paid Main-timing
Unit activation and its first card play from the deck. The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Judy Álvarez: Nothing to Doubt (`judy-a-lvarez-nothing-to-doubt`) | Unit, Blue, cost 6, power 6, RAM 5, Ganger/Mox/Techie, not sellable | 1 €$, {Spend} Reveal the top card of your deck. You may play it for free. Otherwise, add it to your hand. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v95-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). Its one erratum corrects the printed artist credit and does not touch the rules text. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `REVEAL_TOP_MAY_PLAY_FREE_ELSE_HAND`, and the play continuation fields `deckPlayId` (the revealed Unit or
  Program chosen to play, never present at a decision) and `freeFromDeck` (a card played from the deck, which pays nothing).
- The card is a row in the Quick-activation pin table (`quick-activation-support.ts`), which now also admits this one Main-timing
  activation; the activation validator accepts it only outside combat.
- `packages/engine/src/deck-top-play.ts`: the ability reveals the top card (public to both players while the choice is pending). A
  Unit, Program or Gear the engine can play (a Gear with a legal host) offers "add it to your hand" or "play it for free" (for a Gear,
  each legal host); anything else goes to hand without a choice. An empty deck reveals nothing.
- A chosen Gear is equipped at once, ready and counted as played, and its play batch follows the ability (as for batches V92 and V93).
- A chosen Unit or Program is played once the ability has resolved, through the ordinary play with a cost of 0: a Unit enters ready
  and lagging, a Program resolves and goes to the trash, and each counts as played with its own play triggers.
- `startPlay` now takes the play's origin (hand, trash or deck) instead of a trash flag.
- Engine identity `0.4.92-trash-program-play-v94` -> `0.4.93-deck-top-play-v95`.

## Rules readings

- "Play it for free" is an ordinary play with no cost (11.11.4); the card's own costs are not paid.
- The play is the whole of the ability's remaining text, so playing a Unit or Program as the ability finishes is the same as playing it
  inside the ability.
- A card the engine cannot play may only be added to hand (fail-closed); no deck in the snapshot needs that path.

## Tests

`tests/api-admission-batch-v95.test.ts` covers:

- source projection and candidate match;
- the exact pin through the Quick-activation gate and `supportsPlay`, with forgeries (cost, Quick, power, sellable, tags) rejected;
- a revealed Unit played for free (ready, lagging, only the activation's 1 €$ paid), with the activation and option labels, the
  revealed card public to the Rival, and a forged held `deckPlayId` rejected;
- declining adds the card to hand; an empty deck reveals nothing;
- a revealed Gear played for free onto a chosen host;
- a revealed Program played for free that counts as played, keeps its own pausing effect (the Rival's choice), rejects a forged pause
  without `freeFromDeck`, and then goes to the trash.

The reviewed union is now 145 cards, and coverage is 145/151.
