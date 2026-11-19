# API admission batch V27 (2026-11-19)

Plan section 6, scope 3c. A steal-trigger Unit that increases the Gig it stole. It also has a second, own-turn-end
ability. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| V: Roamer of the Badlands (`v-roamer-of-the-badlands`) | Unit, Red, 5, power 6 | When this Unit steals a Gig, increase it by up to 5. At the end of your turn, if you control 2 or more Gigs with 8+ value, draw 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v27-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - `ADJUST_GIG_UP_TO` gains the target `STOLEN_GIG` ("increase it"), and its maximum may be 5.
  - A new condition, `GIG_COUNT_WITH_VALUE_AT_LEAST` (minimum 8, count 2), counts the controller's own rolled Gigs.
- `trigger-queries.ts`: for `STOLEN_GIG`, the only Gig offered is the one the steal binding names, while it is
  rolled and in a Gig area. The pick is therefore forced, and only the amount is a choice. The amount runs from 0
  to 5, capped by the die's faces.
- The own-turn-end draw uses the existing end-of-turn trigger batch and `CONDITIONAL_DRAW`. The trigger is always
  pending, and the condition is evaluated when it resolves.
- Gates:
  - `steal-trigger-support.ts` now pins each card's complete ability list in printed order, not a single ability.
    The earlier pins are unchanged in content. The V: Roamer shape pins both abilities.
  - The end-turn and value-condition hidden-content checks accept this pin.
- Engine identity `0.4.22-friendly-steal-v26` -> `0.4.23-steal-increase-v27`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- 11.5.1.2: a Gig's value can't change during stealing. The increase is a steal trigger, so it resolves after the
  Gig changes control (11.5.1.7).
- "Increase it": the Gig this pending trigger is for (10.16.3). Stealing 2 Gigs gives one increase for each. Zero
  is allowed, and a Gig at its maximum keeps its value with no choice.
- 10.16.1.1: "if you control 2 or more Gigs with 8+ value" is a condition beyond the trigger. The draw trigger
  is pending at every end of its controller's turn, and the condition is checked when it resolves. Only the
  controller's own Gigs count.

## Tests

`tests/api-admission-batch-v27.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - any-Gig target or maximum 6;
  - either ability missing, or the abilities reordered;
  - draw 2, or an unconditional draw;
  - cost, power, tags or sellability.
- Stealing a d8 at 2:
  - the stolen Gig is forced, and the amounts are 0 to 5;
  - a forged 6 and a forged other Gig are rejected;
  - the Gig rises to 7, and the attack ends.
- A d6 at 4 offers 0 to 2, and a d4 at 4 resolves with no choice.
- End of turn:
  - two own Gigs of 8+ draw 1;
  - one own 8+ plus a rival 8 is pending, evaluates false and draws nothing.
- Union membership.

The reviewed union is now 76 cards, and coverage is 76/151.
