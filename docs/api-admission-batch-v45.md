# API admission batch V45 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Program that sells the top card of its controller's deck, then draws 2 if
the controller's Gigs show both an even and an odd value. It is one of the cards named in Cody's quiz set that the assistant
thread asked for first (2026-11-20). The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Bootleg Black Sapphire Show (`bootleg-black-sapphire-show`) | Program, Yellow, 5, Braindance | Sell the top card of your deck. If you control a Gig with an even value and a Gig with an odd value, draw 2. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v45-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` adds a new effect, `SELL_TOP_OF_DECK` with `count: 1`, and a new condition,
    `FRIENDLY_GIGS_EVEN_AND_ODD`.
  - `game.ts` adds a card status, `EFFECT_SOLD`, which marks an Eddie that an effect sold.
- `program-sell-support.ts` adds a new pin table, `SELL_PROGRAM_SHAPES`, which pins the whole Program and both effects in
  printed order. The play gate routes any effect sell or the new condition to it first. The trigger, field Legend and
  effect gates refuse them.
- `program-sell.ts` resolves the sell:
  - The top card moves face-down and ready to the Eddies area, with no reveal. It gets the `EFFECT_SOLD` mark.
  - The turn's sell counter is raised to the limit, so the "Sell a Card" action is no longer offered this turn.
  - With an empty deck nothing is sold.
- `CONDITIONAL_DRAW` evaluates the new condition at resolution: a friendly rolled Gig with an even value and another with
  an odd value.
- `state.ts` admits an Eddie without a Sell tag only with the `EFFECT_SOLD` mark. The mark exists once, only in the Eddies
  area, and only when the content holds a reviewed effect-sell Program. `card-movement.ts` drops the mark when the card
  moves.
- Engine identity `0.4.40-modal-program-v44` -> `0.4.41-effect-sell-v45`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- "Sell the top card of your deck": 11.12.2.1 says an effect that puts a card into the Eddies area needs no Sell tag, and
  the card is placed face-down. Nobody looks at it, so it stays hidden from both players.
- 11.12.2.2 says an effect that says "Sell" counts as the player's "Sell a Card" Main phase action. This batch reads that as
  using up the turn's sell, not as a precondition. So a player who already sold this turn still sells with Bootleg. This is
  an open reading worth confirming with the rules team.
- "If you control a Gig with an even value and a Gig with an odd value": checked when the second sentence resolves, after
  the sell. Gigs in the fixer area do not count (5.10.3).

## Tests

`tests/api-admission-batch-v45.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - no sell, the draw first, draw 3, another condition, an unconditional draw, or a play condition;
  - Quick, cost, tags or sellability.
- An unsellable Mox Inciters on top of the deck is sold face-down and ready, with no reveal, and neither player's
  observation shows it. With Gigs at 3 and 4 the Program draws 2. Afterwards selling from hand is no longer offered.
- With only even, only odd, one or no Gigs nothing is drawn, and a sell made earlier this turn does not stop the effect
  sell.
- With an empty deck nothing is sold.
- The `EFFECT_SOLD` mark is exact: required on an unsellable Eddie, refused in hand or twice, and refused without the
  reviewed Program in the content.
- Union membership.

The reviewed union is now 94 cards, and coverage is 94/151.
