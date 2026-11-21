# API admission batch V51 (2026-11-20)

Plan section 6, scope 3c. This batch admits one power-0 Unit that defeats whatever beats it. It adds the engine's first
printed "loses a fight" trigger, which resolves in the same post-fight batch that V46 built for Safety Override. The card is
pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Maelstrom Zealots (`maelstrom-zealots`) | Unit, Green, 4, power 0, Ganger/Maelstrom, unsellable | When this Unit loses a fight, defeat the opposing rival Unit. (Units with power 0 don't steal Gigs.) | `TARGETED_DEFEAT_V1` |

The revision is authored in `tests/api-admission-batch-v51-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`. The reminder text is a rule (9.20.1.1), not
an ability.

## Engine change

- Grammar: `mechanics.ts` adds the trigger `WHEN_FIGHT_LOST`; `game.ts` adds the binding kind and lets a post-fight batch's
  fired outcomes be empty, since it may carry only printed "loses a fight" bindings.
- `targeted-defeat-support.ts` pins the whole Unit in its whole-ability table; any card with the trigger routes there.
- `fight-outcome.ts` adds `fightLostBindings`: each losing Unit's own binding, captured before the fight's defeats move it,
  naming the opposing Unit as a fired next-fight outcome does. `completeFightResult` and `advanceDefeats` add them to the
  post-fight DEFEAT batch, which now also begins when nothing is defeated in the fight but a loser has the trigger.
- "Defeat the opposing rival Unit" reuses the V46 `OPPOSING_UNIT` target: the opposing Unit while it is still a face-up rival
  field Unit. The targeted-defeat validators accept the printed trigger wherever they accept a fired outcome; the defeating
  source is the Unit itself, wherever the fight left it.
- A post-fight batch must still carry a fired outcome or a printed "loses a fight" binding.
- Engine identity `0.4.46-steel-dragon-v50` -> `0.4.47-fight-lost-v51`.

## Rules readings

- 11.4.1.2-11.4.1.3: Zealots, with power 0, loses every fight, including a tie at 0.
- 11.4.2.3 and 11.4.3: losers are defeated, and pending effects resolve after the fight ends. The trigger resolves then, with
  the fight's {Defeated} triggers, like Safety Override (V46). It resolves even though Zealots is in the trash.
- 11.4.2.3.2: a power-0 Unit defeats nothing in a fight, so a 0-0 fight defeats neither Unit, but Zealots still lost, and its
  trigger defeats the other Unit.
- "The opposing rival Unit": the Unit it fought, if that Unit is still a rival Unit on the field.

## Tests

`tests/api-admission-batch-v51.test.ts` covers source projection and candidate match; the exact pin with forgeries (wins,
any rival, a second effect, a condition, power, cost, tags, Blocker); Zealots attacking Psycho Squad and defending against
Octant on the rival's turn, both opposing Units defeated after Zealots; a 0-0 fight against Secondhand Bombus; Zealots with
Safety Override registered, defeating the opposing Unit once; and union membership. Every paused state in those fights
validates.

The reviewed union is now 100 cards, and coverage is 100/151.
