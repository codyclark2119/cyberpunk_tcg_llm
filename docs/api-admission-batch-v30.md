# API admission batch V30 (2026-11-19)

Plan section 6, scope 3c. This batch admits one Unit. Its {Play} spends a rival Unit for each friendly value-pair
of Gigs, and it can attack rival Units, but not the Gig area, the turn it's played. The card is pinned literally
in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Sandayu Oda: Hanako's Guardian (`sandayu-oda-hanako-s-guardian`) | Unit, Green, 7, power 8 | {Play} Spend a rival Unit for each friendly value-pair of Gigs. This Unit can attack rival Units the turn it's played. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v30-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - A new effect, `SPEND_UNITS_PER_VALUE_PAIR` (rival Units).
  - A new continuous modifier, `CAN_ATTACK_RIVAL_UNITS_WHILE_LAGGING`.
- State (`game.ts`): the trigger continuation may hold `spendsRemaining` while the spend picks are open.
- `conditions.ts`: `friendlyValuePairCount` counts the controller's own rolled Gigs in pairs of equal value. Each
  Gig counts towards one pair at most, so three Gigs of one value make one pair.
- Resolution (`trigger-resolution.ts`):
  - The pairs are counted once, when the effect resolves. With no pair, or no rival Unit, the effect ends.
  - Otherwise each spend is its own pick from the rival Units, and a single rival Unit is forced.
  - Readiness is not a selector filter, as with the existing rival spend. Spending an already-spent Unit changes
    nothing.
- Validation (`trigger-state.ts`): the pause is allowed only for the pinned source's own PLAY occurrence, with 1 to
  (current pairs) spends left and 2 or more rival Units. `spendsRemaining` exists only for this effect.
- Attack permission (`combat-queries.ts`):
  - A lagging Unit with the pinned modifier is a valid attacker.
  - While it attacks only by that permission, the rival Gig area is not a target. It is still a target once the
    Unit stops lagging, or if Go Solo or Adrenaline applies.
  - Printed and imposed attack prohibitions still win.
  - `characteristics.ts` and `view.ts` accept the modifier as a permission only, never as power or a keyword.
- Gate: `value-pair-support.ts` pins the complete shape, including the modifier.
- Engine identity `0.4.25-value-pair-v29` -> `0.4.26-value-pair-spend-v30`. The baselines are regenerated once for
  the bundle this batch ships in, in a separate commit.

## Rules readings

- 6.6, 6.6.1: a value-pair is 2 dice with the same value in the same Gig area, and a Gig counts towards one pair
  at most. This follows the rule's own "for each friendly value-pair" example. Only the controller's Gig area
  counts.
- "Spend a rival Unit for each ...": the spend instruction is repeated once for each pair. Each repetition chooses
  any rival Unit, under the same selector as the existing "Spend a rival Unit". The count is fixed when the effect
  resolves.
- 11.3.1: Units that entered the field this turn lag and can't attack. The printed permission lifts that only for
  attacks on rival Units, and only spent rival Units can be attacked (9.3.2).

## Tests

`tests/api-admission-batch-v30.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - without the attack permission, or without the {Play} spend;
  - an attack trigger, or a single plain spend;
  - an added condition or keyword;
  - cost, power, tags or sellability.
- Two friendly value-pairs and three rival Units:
  - two picks, each from all three Units;
  - an inflated spend count is rejected;
  - the third Unit stays ready.
- Three Gigs of one value, plus a rival Gig of that value, make one pair. With one rival Unit the spend is forced.
- No friendly value-pair: nothing is spent.
- The turn it's played, it can attack a spent rival Unit and is never offered the Gig area. With no spent rival
  Unit it can't attack.
- Union membership.

The reviewed union is now 79 cards, and coverage is 79/151.
