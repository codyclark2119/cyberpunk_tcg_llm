# API admission batch V41 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Go Solo Legend. Its {Attack} reveals the top card of its deck, adds it to
hand, and gains power equal to that card's cost this turn. Its {Defeated} makes a Rival discard 1. It is one of the cards
named in Cody's quiz set that the assistant thread asked for first (2026-11-20). The card is pinned literally in its engine
gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Sasha Yakovleva: Won't Let You Down (`sasha-yakovleva-won-t-let-you-down`) | Legend, Blue, 5, power 0 | [Go Solo] {Attack} Reveal the top card of your deck and add it to your hand. This Unit gains power equal to that card's cost this turn. {Defeated} A Rival discards 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v41-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` adds a new effect, `REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST` with `count` 1.
  - `game.ts` adds a new "this turn" power modifier, `scaled: "REVEALED_CARD_COST"`. It names the revealed card, so its
    amount can be checked against that card's printed cost.
- `legend-reveal-support.ts` adds a new pin table, `LEGEND_REVEAL_SHAPES`. It pins the whole Legend, its Go Solo keyword
  and both abilities in printed order, and it requires the same policies as V40. The trigger, field-Legend and play gates
  route this metadata to that pin. Calling the Legend goes through the trigger gate.
- `legend-reveal.ts` resolves the {Attack} effect:
  - It emits `CARD_REVEALED` for the top card and moves the card to hand.
  - If the card's printed cost is above 0 and Sasha is still a face-up field card, it adds the power modifier.
  - An empty deck reveals nothing. It is not a draw, so it cannot lose the game.
- `temporary-power.ts` validates the new modifier:
  - The amount must equal the named card's cost.
  - The source must pass its pin and be face-up on the field or removed (Go Solo).
  - It must come from a resolved current-turn ATTACK occurrence.
- `trigger-state.ts` lets the plain {Defeated} Rival discard pause only for this pin. `ordered-effects-support.ts` accepts
  its `DISCARD_CARDS` metadata under the same pin.
- Engine identity `0.4.36-legend-steal-v40` -> `0.4.37-legend-reveal-v41`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- A 0-power Unit can declare an attack on the Gig area (official Level 1 test, answer A). Nothing in 9.3 requires power.
- "Reveal ... and add it to your hand" is not a draw (11.17 search is separate too). An empty deck does nothing.
- "That card's cost" is its printed cost. A card without a numeric cost gives 0.
- "This turn": the power lasts until the end of the turn (5.3.2.2).
- [Defeated] on a Go Solo Legend: it is defeated and then removed from the game rather than trashed. Its {Defeated}
  ability still triggers, as for any defeated Unit (captured before the move).
- "A Rival discards 1": the Rival chooses from their own hand, as in V17, V24 and V40.

## Tests

`tests/api-admission-batch-v41.test.ts` covers:

- Source projection and candidate match.
- The exact pin through the trigger, field-Legend, Call and play gates. Forgeries are rejected:
  - no {Defeated}, an own discard, a {Play} reveal, swapped ability order, or an added condition;
  - no Go Solo;
  - cost, power, tags, sellability or the plain field-Legend scope.
- At 0 power Sasha goes solo and attacks the Gig area:
  - The top card is revealed, not drawn, and goes to hand.
  - Sasha's power becomes that card's cost and stays there after the attack. A forged amount is rejected.
- An empty deck reveals nothing and does not end the game.
- When Sasha loses a fight against a bigger spent rival Unit, it is removed from the game. The Rival then chooses a card
  to discard.
- Union membership.

The reviewed union is now 90 cards, and coverage is 90/151.
