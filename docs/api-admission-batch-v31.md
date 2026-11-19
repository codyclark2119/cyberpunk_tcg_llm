# API admission batch V31 (2026-11-19)

Plan section 6, scope 3b. This batch admits one Unit with two abilities. Its {Play} defeats a rival Unit by cost.
Its {Defeated} makes a Rival discard, and discard once more when the discarded card's cost matches a friendly Gig.
The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Caliber: Totentanz's Top Dog (`caliber-totentanz-s-top-dog`) | Unit, Yellow, 5, power 5 | {Play} Defeat a rival Unit with cost 2 or less. {Defeated} A Rival discards 1. If the card's cost equals the value of a friendly Gig, that Rival discards 1 more. | `TARGETED_DEFEAT_V1` |

The revision is authored in `tests/api-admission-batch-v31-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - The Unit-defeat filter gains an optional `cost` bound (`AT_MOST` 2), alongside the power bound (`ANY` here).
  - `DISCARD_CARDS` gains an optional `more` clause: "if the discarded card's cost equals the value of a friendly
    Gig, discard 1 more".
- State (`game.ts`): the trigger continuation may hold `discardedCardId`, the first discarded card, while the second
  discard is open.
- `targeted-defeat-queries.ts`: the cost bound uses the Unit's referenced cost. A Unit with no numeric cost is not
  eligible.
- `discard.ts`: the match compares the discarded card's printed Eddie cost with the effect controller's own rolled
  Gigs. A card with no numeric cost matches nothing.
- Resolution (`trigger-resolution.ts`):
  - After the first discard, the match is evaluated and recorded.
  - If it holds and the Rival still has a card, the same Rival chooses one more discard.
  - Otherwise the effect ends.
- Validation:
  - `trigger-state.ts` accepts the defeated rival discard only for the pinned source's own DEFEAT occurrence. The
    held card must be in that Rival's trash and still match. `discardedCardId` exists only for a current `more`
    discard.
  - `defeat.ts` and the ordered-metadata check accept the card through its targeted-defeat pin.
- Gate (`targeted-defeat-support.ts`): a defeat card with more than one ability is admitted only by its whole
  ability list in printed order. The single-ability pins are unchanged. The card is not a trigger-scope card, so
  `supportsTriggerCard` rejects it.
- Engine identity `0.4.26-value-pair-spend-v30` -> `0.4.27-defeat-discard-v31`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "Defeat a rival Unit with cost 2 or less" is mandatory: one eligible Unit is defeated without a choice, and with
  none nothing happens.
- "A Rival discards 1": the affected Rival chooses their own discard, as in V17 and V24.
- "The card's cost": the discarded card's printed cost. "A friendly Gig" is a Gig in the controller's own Gig area
  (6.1.2), so a Rival's Gig of that value does not count. The second discard is by the same Rival.

## Tests

`tests/api-admission-batch-v31.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - any cost, or no second discard;
  - either ability missing, or the abilities reordered;
  - an attack trigger, or the trigger scope;
  - cost, power, tags or sellability.
- {Play}:
  - only the two cost-2 rival Units are offered, and a cost-3 Unit survives;
  - with one cost-2 Unit, it is defeated without a choice.
- {Defeated} after Caliber loses a fight:
  - the Rival chooses. Discarding a cost-3 card with a friendly 3 opens a second discard;
  - a forged held card is rejected;
  - discarding a cost-4 card, matched only by the Rival's own 4, ends the effect after one discard.
- Union membership.

The reviewed union is now 80 cards, and coverage is 80/151.
