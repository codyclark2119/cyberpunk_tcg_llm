# API admission batch V74 (2026-11-21)

Plan section 6, scope 3c. This batch admits Goro Takemura: Vengeful Bodyguard, a Legend with a paid {Quick} {Spend} ability that
gives a friendly Unit {Blocker}, and a trigger on any friendly Unit using {Blocker}. The card is pinned literally in its engine gate
(Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Goro Takemura: Vengeful Bodyguard (`goro-takemura-vengeful-bodyguard`) | Legend, Green, RAM 2, Arasaka/Corpo, sellable | {Quick} 1 €$, {Spend} Give a friendly Unit with cost 4 or less {Blocker} this turn. If you control a value-pair of Gigs, also give it +1 power this turn. When a friendly Unit uses {Blocker}, you may discard 1. If you do, draw 1. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v74-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - the effect `GRANT_BLOCKER_THIS_TURN {target: {FRIENDLY_UNIT, costAtMost: 4}, alsoPowerIf: {CONTROLS_VALUE_PAIR, amount: 1}}`;
  - the trigger `WHEN_FRIENDLY_UNIT_USES_BLOCKER`;
  - `DISCARD_CARDS` gains `optional: true` (a "may" discard with a decline option) and `thenDrawOne: true` ("If you do, draw 1").
- State: a `BLOCKER` variant of the temporary keyword grant, and a `BLOCKER_GRANT_BONUS` variant of the temporary power modifier.
  Both carry the activation's effect id and its sequence, so repeated activations in one turn stay apart.
- The pin joins the Legend {Spend} table (`legend-spend-support.ts`). Any Blocker grant, friendly Blocker-used trigger or
  optional/draw-one discard routes there first, so no other gate can admit it.
- A Legend's {Quick} ability is a {Spend} ability that is also offered in its controller's React Step. React enumeration now
  includes face-up Legends, and the Legend activation validator accepts the Quick window and its Eddie payment (paid after the
  Legend is spent, as for V63).
- Resolution: with no friendly Unit of cost 4 or less nothing happens, a lone one is chosen without a choice, and 2 or more pause
  for the controller's choice. The grant is a temporary keyword, so every existing Blocker check (React offers, attack targets)
  reads it. The value pair is checked as the effect resolves; with one, the same Unit gets +1 power this turn.
- A Blocker declaration's trigger batch also discovers each face-up friendly source of the blocking Unit's controller with the
  new trigger. The discard choice lists "Discard nothing" first; an empty hand skips it. Only an actual discard draws 1.
- Labels: "Activate Goro Takemura: Pay 1 and spend to give a friendly Unit with cost 4 or less Blocker this turn", "Give X (id)
  Blocker this turn" and "Discard nothing".
- Engine identity `0.4.70-call-trash-program-v73` -> `0.4.71-quick-blocker-grant-v74`.

## Rules readings

- {Quick} (11.30.2): the ability can be used in the Main Phase and in its controller's React Step. Here the React Step belongs to
  the defending player, so Goro answers a rival's attack. After it resolves, the same React Step continues.
- "Cost 4 or less" reads the printed Eddie cost; ready, spent and Lag do not matter, as for the earlier "cost 5 or less" Adrenaline grant.
- "If you control a value-pair of Gigs" (6.6) is read once, as the effect resolves. The +1 stays this turn even if the pair
  later breaks, and it outlives the Blocker grant if the Unit leaves the field, like any power this turn (5.3.2.2).
- "When a friendly Unit uses {Blocker}" fires for any friendly Blocker, printed or granted, and joins the Blocker-used batch
  (9.11). With the blocking Unit's own trigger, the controller orders both.

## Tests

`tests/api-admission-batch-v74.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries rejected by the Legend, Call and trigger gates, and the Unit Quick gate never admitting it;
- a Main Phase activation: payment, the cost-5 Unit never offered, the choice, Blocker and +1 with a pair, expiry at turn end;
- no pair (Blocker only, forced lone target) and no target (the cost is still paid);
- a React Step activation that makes a ready Unit a Blocker, its block, the may discard, and the draw;
- a printed Blocker firing the trigger, a decline drawing nothing, and an empty hand never pausing;
- face down: no activation and no trigger;
- ordering with the blocking Unit's own Blocker-used trigger;
- union membership.

The reviewed union is now 124 cards, and coverage is 124/151.
