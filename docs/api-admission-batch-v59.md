# API admission batch V59 (2026-11-20)

Plan section 6, scope 3c. This batch admits Hanako Arasaka: Daughter of the Emperor, a Legend with a {Spend} Gig swap and a
start-of-turn draw. It adds the engine's first Legend ability used from the Legends area and its first "at the start of your
turn" effect (8.6.2.2). The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Hanako Arasaka: Daughter of the Emperor (`hanako-arasaka-daughter-of-the-emperor`) | Legend, Green, RAM 2, Arasaka/Corpo/Netrunner, sellable | {Spend} Swap a friendly Gig with a rival Gig. At the start of your turn, draw 1 for each friendly value-pair of Gigs. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v59-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the trigger `WHEN_OWN_TURN_STARTS`; `SWAP_GIGS` without `optional` is a mandatory swap; the effect
  `DRAW_PER_FRIENDLY_VALUE_PAIR`.
- New `legend-spend-support.ts` pins the whole Legend and counts value-pairs (6.6, 6.6.1: each Gig counts toward one pair
  only). The Call gate routes the card there; the play, trigger and React gates refuse it.
- `canActivate` offers a pinned Legend's {Spend} ability in its controller's Main phase while the Legend is face up and ready in
  the Legends area. Activation spends it, and the swap resolves through the play continuation: the friendly Gig first, then the
  rival Gig, each taken without a choice when only one is eligible. With no Gig on either side the swap does nothing.
  `validateLegendActivationState` bounds the paused swap.
- New `legend-spend.ts`: at the start of the active player's turn, after the win check and the 8.6.2.1 expirations and before
  READY and the turn's draw, each face-up pinned Legend they control resolves its start-of-turn draw, in card id order.
- The value-condition metadata check leaves the Legend to its own pin.
- Engine identity `0.4.54-fight-power-v58` -> `0.4.55-legend-spend-v59`.

## Rules readings

- "{Spend}" on a Legend spends the face-up Legend in the Legends area, like a Unit's {Spend}. It is a Main-phase ability; it is
  not {Quick}.
- The swap is mandatory when both players have a Gig in their Gig areas. It changes control of the two Gigs (6.7); values stay.
- The start-of-turn draw counts value-pairs when it resolves. The start-of-turn effects resolve with no choices, so no trigger
  ordering is offered; a later card with a choice there needs that window.

## Tests

`tests/api-admission-batch-v59.test.ts` covers source projection and candidate match; the exact pin with forgeries (optional
swap, Quick, paid, a second draw, a condition, a missing trigger, Go Solo, RAM, tags, unsellable), the Call gate and the
refusing play, trigger and React gates; value-pair counting (3,3,3 is one pair); the forced swap and when it is offered
(not face down, not spent); the chosen swap with its paused validation and a forged held Gig; a swap with no rival Gig; the
start-of-turn draw of 2 for Gigs 3,3,3,5,5 against a face-down control, on its controller's turn only; and union membership.

The reviewed union is now 108 cards, and coverage is 108/151.
