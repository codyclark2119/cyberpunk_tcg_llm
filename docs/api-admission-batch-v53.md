# API admission batch V53 (2026-11-20)

Plan section 6, scope 3c. This batch admits Viktor Vektor: Drop Your Illusions, the engine's first cost reduction that a
field Unit gives to other cards, and its first per-turn record of a player's first CYBERWARE Gear. The card is pinned
literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Viktor Vektor: Drop Your Illusions (`viktor-vektor-drop-your-illusions`) | Unit, Yellow, 5, power 5, RAM 2, Ripperdoc, unsellable | Play your first CYBERWARE Gear each turn for -3 €$, to a minimum of 1 €$. | `PLAY_COST_REDUCTION_V1` |

The revision is authored in `tests/api-admission-batch-v53-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `mechanics.ts` adds the modifier `FIRST_GEAR_PLAY_COST_REDUCTION` (`Cyberware`, 3, minimum 1). `game.ts` adds the
  content-gated `turnHistory.firstCyberwareGearPlays`: each player's first CYBERWARE Gear played this turn.
- `play-cost-support.ts` pins the whole Unit in the V11 Unit table, and refuses it without the reviewed trigger policy that
  keeps the turn history. `playPaymentAmount` applies the card's own reductions first, then each face-up friendly field
  Unit's first-Gear reduction.
- A Gear is recorded when it is equipped (11.20.2: it is played only then). The recorded Gear stays reduced while its own
  play finishes, so its payment amount never changes mid-play.
- `validateFirstGearHistory` rejects a record without the reviewed reader, on another turn, empty, or naming a card that is
  not that player's own CYBERWARE Gear.
- The characteristic and view modifier checks treat the reduction as payment-only, like the V11 reductions.
- Engine identity `0.4.48-never-stop-fighting-v52` -> `0.4.49-first-cyberware-v53`.

## Rules readings

- "Your first CYBERWARE Gear each turn" is the first one the player plays that turn, whether or not Viktor was on the field
  then. A CYBERWARE Gear played before Viktor arrived uses up the reduction.
- 3.11.1.2 and 11.11.4.2: only the amount paid changes; the Gear's cost stays its printed cost, and a free play ignores the
  reduction. No admitted effect plays a Gear for free yet, so only paid plays are recorded today.
- Two Viktors each reduce the first CYBERWARE Gear by 3, still to a minimum of 1.
- Zetatech Berserk applies its own per-Legend reduction first; Viktor's then applies to the result, minimum 1.

## Tests

`tests/api-admission-batch-v53.test.ts` covers source projection and candidate match; the exact pin with forgeries (no
reduction, a second reduction, an ability, power, cost, tags, sellable, Blocker); Sandevistan, Mantis Blades and Zetatech
Berserk amounts with Viktor on the field, the record after Sandevistan is played, and full prices after it; a fixture Gear
that is not CYBERWARE; a CYBERWARE Gear played before Viktor; a rival's Viktor; the record clearing at end of turn; forged
records; and union membership.

The reviewed union is now 102 cards, and coverage is 102/151.
