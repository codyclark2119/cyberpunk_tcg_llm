# API admission batch V81 (2026-11-25)

Plan section 6, scope 3c. This batch admits Kerry Eurodyne: Axe, Attitude, Audience, a Legend whose two static roll riders change its
controller's start-of-turn Gig roll. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Kerry Eurodyne: Axe, Attitude, Audience (`kerry-eurodyne-axe-attitude-audience`) | Legend, Yellow, RAM 2, Rocker/Samurai, sellable | When you roll in a Gig from your fixer area, you may ignore the result and reroll it once. When you roll a min or max value on a Gig, draw 1. If it's a d20, draw 3 instead. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v81-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: two modifiers, `MAY_REROLL_FIXER_GIG_ONCE` and `DRAW_ON_EXTREME_GIG_ROLL {count: 1, d20Count: 3}`; a resolution field
  `gigRerollContinuation {gigInstanceId}`; and the event `GIG_REROLL_CHOSEN {gigInstanceId, reroll}`.
- The pin joins the Legend pin table (`packages/engine/src/legend-spend-support.ts`) with no abilities and exactly these two
  modifiers, in this order. The new module `packages/engine/src/gig-reroll.ts` holds the roll flow and its state check. The modifiers
  are excluded from power and keyword derivation, as other non-power modifiers are.
- Rolling in a Gig (8.6.5) is unchanged without the Legend face up. With it, after the Gig is rolled and placed, and only if no
  overtime win ended the game, the roller gets an optional choice: "Ignore the dX result (N) and reroll it" or "Keep the dX result (N)".
  A reroll rolls the same die again (the next RNG draw, a second `GIG_DIE_ROLLED`) and is never offered twice. Then a kept value of 1 or
  the die's maximum draws 1, or 3 on a d20, and the Main Phase begins. Drawing from an empty deck loses as usual.
- The choice is exclusive (no other continuation, effect or combat), belongs to the active player, names their own just-rolled,
  unmodified Gig, and needs the face-up Legend; anything else fails the state check.
- Engine identity `0.4.78-rocker-grant-v80` -> `0.4.79-gig-reroll-v81`.

## Rules readings

- "Ignore the result" is read literally: the ignored roll has no effect, so it never triggers the min-or-max draw. Only the kept
  value, first or rerolled, counts. No ruling covers this yet; it is the one reading choice in this batch.
- "When you roll in a Gig from your fixer area" is the Start-phase roll (8.6.5), the only Gig roll in the engine. The draw rider reads
  "when you roll", so it applies to that roll too; nothing else rolls Gigs, and adjusting or setting a value is not a roll.
- A face-down Legend has no abilities, so only a face-up Kerry applies. Spent or ready does not matter for a static ability.
- An overtime win on placement ends the game before the reroll choice or the draw.

## Tests

`tests/api-admission-batch-v81.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries (either modifier missing, swapped order, tags, colors, not sellable) rejected;
- a face-down Kerry: no choice and no draw on a max value;
- the reroll offer and its labels, and keeping a middle value (no draw);
- keeping a 1 or a 6 on a d6 (draw 1);
- an ignored 1 rerolled to a 5 (no draw, no second offer) and a 4 rerolled to an 8 on a d8 (draw 1);
- a kept d20 at 20 (draw 3) and a d20 reroll to 1 with 2 cards in the deck (loses to the empty draw);
- tampered states (modified Gig, face-down Kerry, orphan choice) rejected, and the Rival cannot act;
- union membership.

The reviewed union is now 131 cards, and coverage is 131/151.
