# API admission batch V46 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Quick Program that sets up a delayed defeat for the next fight its
controller's Unit loses this turn. It is one of the cards named in Cody's quiz set that the assistant thread asked for first
(2026-11-20). The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Safety Override (`safety-override`) | Program, Yellow, 2, Quickhack | {Quick} The next time a friendly Unit loses a fight this turn, defeat the opposing rival Unit. | `TARGETED_DEFEAT_V1` |

The revision is authored in `tests/api-admission-batch-v46-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` adds a new effect, `REGISTER_NEXT_FIGHT_OUTCOME` with `on: "FRIENDLY_UNIT_LOSES"`, which carries the
    registered effect. It also adds a new defeat target, `OPPOSING_UNIT`.
  - `game.ts` adds a new state record, `fightOutcomeEffects` (`NEXT_FIGHT_OUTCOME` entries), and three events:
    `FIGHT_OUTCOME_EFFECT_CREATED`, `FIGHT_OUTCOME_EFFECT_FIRED` and `FIGHT_OUTCOME_EFFECT_EXPIRED`.
  - A new trigger binding kind, `DELAYED_FIGHT_OUTCOME`, names the opposing Unit (`opposingId`).
  - The `DEFEAT` trigger origin gains an optional `fight` (the fight result and the fired effects). Its `defeated` list may
    be empty only when `fight` is present. The combat defeat continuation carries the fired effects while an owner orders a
    trash batch.
- `targeted-defeat-support.ts` pins the whole Program in the existing targeted-defeat pin table.
- `fight-outcome.ts`:
  - When the Program resolves, the registration is created for the rest of the turn.
  - When a fight is decided, each registration whose controller has a losing Unit fires and is consumed.
  - Fired effects become pending together with the fight's DEFEATED triggers, after the losers are defeated. With no
    defeat, they form the post-fight batch alone.
  - Registrations that never fire expire at the end of the turn.
- The fired effect is a `DEFEAT_UNIT` of the opposing Unit, with no target choice. It runs through the existing
  targeted-defeat flow, so a defeated Unit's Gear is ordered by its owner, and its DEFEATED triggers join the batch.
- `trigger-state.ts`, `targeted-defeat-state.ts` and `combat-outcome-state.ts` validate a post-fight batch:
  - the historical fight;
  - exactly the registrations it fired, each with its source;
  - one binding per fired effect;
  - the effect defeat's facts.
- `observation.ts` shows registrations publicly.
- Engine identity `0.4.41-effect-sell-v45` -> `0.4.42-fight-outcome-v46`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- "The next time a friendly Unit loses a fight this turn": the first fight this turn in which a Unit its controller controls
  loses, whether it attacked or defended. A tie is a loss for both Units (11.4.1.3). A won fight does not fire it.
- Timing follows 11.4.2.2.1: the effect becomes pending when the loser is determined, and resolves after the fight ends.
  So the fight's losers are defeated first (11.4.2.3).
- "Defeat the opposing rival Unit": the other Unit of that fight, if it is still a rival Unit on the field. In a tie it
  has already been defeated by the fight, so the effect does nothing.
- As a Quick Program it can be played in Main or by the defending player in the React Step (9.7). Played as a React, the
  "friendly Unit" is the defender.
- The engine's existing "when this Unit wins a fight" triggers (Satori) still resolve before the fight's defeats; that
  older approximation is unchanged by this batch.

## Tests

`tests/api-admission-batch-v46.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - no Quick, an immediate defeat, a second effect or a condition;
  - cost, tags or sellability.
- Played in Main: the attacker loses, is defeated by the fight, and then the winning defender is defeated by the effect.
- Played as a React by the defender: the losing defender is defeated, then the winning attacker.
- A tie defeats both Units by the fight, and the fired effect finds nothing. A won fight leaves the registration waiting,
  and it expires at the end of the turn.
- Forged registrations are invalid: wrong id, controller or turn, or a duplicate.
- Union membership.

The reviewed union is now 95 cards, and coverage is 95/151.
