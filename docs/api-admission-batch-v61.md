# API admission batch V61 (2026-11-21)

Plan section 6, scope 3c. This batch admits Muamar Reyes: El Capitán, a Legend with "{Call} Choose one effect. A friendly Unit
can't be defeated in a fight this turn. // Draw 1." and "{Spend} Adjust a Gig by 1." It adds the engine's first protection
from a fight's defeat that lasts the whole turn. The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Muamar Reyes: El Capitán (`muamar-reyes-el-capita-n`) | Legend, Yellow, RAM 2, Fixer, sellable | {Call} Choose one effect. A friendly Unit can't be defeated in a fight this turn. // Draw 1. {Spend} Adjust a Gig by 1. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v61-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `FIGHT_DEFEAT_IMMUNITY_THIS_TURN` (a friendly Unit). `game.ts` adds `fightDefeatImmunities`: one record
  per resolved mode, naming its target, source, controller and turn.
- Muamar joins the V59/V60 Legend pin table; its Call resolves through the V60 modal Call.
- New `fight-immunity.ts`: the mode chooses a current friendly field Unit (one is forced, none does nothing). Records end at
  the end of the turn and when the Unit leaves the field, and `validateFightDefeatImmunities` checks the Legend, the chosen
  mode's occurrence, the turn and the target.
- The fight's defeat list drops the immune Unit, both when the fight is evaluated and when a paused fight's defeats are
  recomputed. The fight result is unchanged: the Unit still loses.
- The {Spend} adjustment is the existing undirected "adjust by 1" (decrease 1, keep or increase 1).
- Batch V58 follow-up: a paused fight's recomputed defeats now count the "while fighting" bonus in the defeat permission, as
  the fight's own evaluation already did.
- Engine identity `0.4.56-call-choose-one-v60` -> `0.4.57-fight-immunity-v61`.

## Rules readings

- "Can't be defeated in a fight" stops only the defeat that the fight itself causes (11.4.2.3). The Unit still loses, so
  "loses a fight" effects still see it, and other defeats this turn still apply.
- The immunity lasts the whole turn and covers every fight of that Unit, attacking or defending.

## Tests

`tests/api-admission-batch-v61.test.ts` covers source projection and candidate match; the exact pin with forgeries and the
refusing play gate; a power-6 Unit that loses to a power-8 Unit but stays on the field (control: it is defeated), with the
immunity ending at the end of the turn; a choice between two friendly Units, forged targets and turns, and departure; the
{Spend} adjustment's keep option; and union membership.

The reviewed union is now 111 cards, and coverage is 111/151.
