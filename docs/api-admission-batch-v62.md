# API admission batch V62 (2026-11-21)

Plan section 6, scope 3c. This batch admits Padre: Man of the Cross, a Legend with "{Call} Choose one effect. Spend a rival
Unit. // Draw 1." and "{Spend} Set a player's Gig to the same value as another player's Gig." With V60 to V62, all four
"{Call} Choose one" Legends that the coverage report deferred are admitted. The card is pinned literally in its engine gate
(Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Padre: Man of the Cross (`padre-man-of-the-cross`) | Legend, Green, RAM 2, Fixer/Ganger/Valentino, sellable | {Call} Choose one effect. Spend a rival Unit. // Draw 1. {Spend} Set a player's Gig to the same value as another player's Gig. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v62-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE` (mandatory).
- Padre joins the Legend pin table. Its Call's spend mode uses the existing targeted spend (one rival Unit; a lone Unit is
  forced). The targeted-spend detector leaves it to the Legend pin.
- The cross-player set chooses the Gig to set, then a Gig of a different player with a different value that fits the target's
  die (6.4.3, 6.5.1). A lone option on either step is taken without a choice; with no such pair it does nothing.
- `validateLegendActivationState` bounds the spend and set pauses.
- Engine identity `0.4.57-fight-immunity-v61` -> `0.4.58-cross-gig-set-v62`.

## Rules readings

- "A player's Gig ... another player's Gig": the two Gigs have different controllers. Either may be friendly or rival.
- The set is mandatory ("Set", not "You may set"). A Gig whose value equals every other player's Gig cannot be set (setting it
  would change nothing), so it is not offered.

## Tests

`tests/api-admission-batch-v62.test.ts` covers source projection and candidate match; the exact pin with forgeries and the
refusing play gate; the Call's spend mode on a chosen rival Unit; the {Spend} set (every Gig that another player can set is
offered, then only the other player's Gigs), equal values doing nothing, and a lone source taken without a choice; and union
membership.

The reviewed union is now 112 cards, and coverage is 112/151.
