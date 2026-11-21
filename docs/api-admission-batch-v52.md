# API admission batch V52 (2026-11-20)

Plan section 6, scope 3c. This batch admits Johnny Silverhand: Never Stop Fighting. It adds the engine's first effect that
decides a fight's winner (11.4.1.4) and its first "the first time this Unit wins a fight each turn" history. The card is pinned
literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Johnny Silverhand: Never Stop Fighting (`johnny-silverhand-never-stop-fighting`) | Unit, Red, 6, power 8, RAM 2, Merc/Rocker/Samurai, unsellable | The first time this Unit wins a fight each turn, ready it. This Unit wins all fights against CORPO Units. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v52-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). Its one erratum covers only the Beta Iconic Rare printing's misprinted Sell tag; every
version is unsellable, as the source record already says. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `mechanics.ts` adds the modifier `WINS_FIGHTS_AGAINST_CLASSIFICATION` (`Corpo` only) and the guard
  `FIRST_FIGHT_WIN_PER_TURN`. `game.ts` adds an optional `forcedWinnerId` to the fight result and a content-gated
  `turnHistory.fightWins` count per Unit.
- New `fight-win-support.ts` pins the whole Unit. Any card with the modifier or the guard routes there from the play and
  trigger gates; the effect and field-Legend gates refuse it, and the end-turn metadata check defers to it for its ready.
- `evaluateFight` asks `forcedFightWinner`: a pinned Unit whose opponent is CORPO wins, and the opponent is the only loser.
  If both Units would win by such text, neither override applies. A winner with power 0 still defeats nothing.
- `resolveCombat` counts the winner's win before the fight's trigger window. The fight-won binding with the guard is
  discovered and validated only when that count is 1.
- `validateFightWinHistory` rejects counts without the reviewed reader, on another turn, or for a Unit without the guard.
- Engine identity `0.4.47-fight-lost-v51` -> `0.4.48-never-stop-fighting-v52`.

## Rules readings

- 11.4.1.4: "wins all fights against CORPO Units" supersedes the power comparison, so Johnny wins against a stronger or
  equal-power CORPO Unit, and 11.4.1.1.1 makes the CORPO Unit the only loser. This applies whether Johnny attacks or defends.
- A tie against a non-CORPO Unit is no win (11.4.1.3), so it does not ready Johnny and does not use up his first win.
- "The first time ... each turn" counts wins per Unit per turn, on any player's turn. Readying a Unit that is already ready
  does nothing, but still uses up the first win.
- The count belongs to the card's instance for the rest of the turn. If Johnny left the field and returned in the same turn,
  the engine would still count his earlier win; no admitted card can do that today.

## Tests

`tests/api-admission-batch-v52.test.ts` covers source projection and candidate match; the exact pin with forgeries (no guard,
no override, no ready, lost instead of won, a second effect, a condition, power, cost, sellable, Blocker); a first win over
Psycho Squad that readies Johnny and a second win that turn over Hacked Corpo that does not; an 8-8 tie with Octant; an
equal-power win over Sandayu Oda (CORPO) with `forcedWinnerId`; defending against Yorinobu Arasaka (power 9, CORPO) on the
rival's turn; forged fight-win history; and union membership.

The reviewed union is now 101 cards, and coverage is 101/151.
