# API admission batch V25 (2026-11-19)

Plan section 6, scope 3c. A second "When this Unit steals a Gig" Unit, built on the Batch V24 steal-trigger
origin. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Wraith Marauders (`wraith-marauders`) | Unit, Green, 5, power 4 | When this Unit steals a Gig, ready another friendly Unit with power equal to the Gig's value. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v25-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- `mechanics.ts`: `READY_UNIT` gains the target `ANOTHER_FRIENDLY_UNIT` with `power: "EQUALS_STOLEN_GIG_VALUE"`.
- `ready-unit.ts`: `stolenGigReadyTargets` lists the eligible Units. Each one is a face-up Unit on its controller's
  field, other than the trigger subject. Its current power must equal the current value of the Gig the steal
  binding names.
- `trigger-resolution.ts` and `trigger-queries.ts`: with no eligible Unit, the ready does nothing. Otherwise the
  controller chooses one, and a single option is forced. The ready goes through the existing effect ready, so a
  ready lock (Batch V22) still prevents it.
- `trigger-state.ts`: this ready may pause only in a `STEAL` batch, for its own steal trigger with a named Gig, while
  an eligible Unit exists.
- Gates:
  - `steal-trigger-support.ts` adds the complete Wraith Marauders shape. The new target is admitted only through
    this pin.
  - The end-turn hidden-content check no longer claims this target.
- Option label: "Ready <Unit> (<id>, power N, spent|ready)".
- Engine identity `0.4.20-steal-triggers-v24` -> `0.4.21-steal-ready-v25`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "Another friendly Unit": the stealing Unit itself is never a choice, even when its power matches.
- "The Gig's value" is the value of the Gig this pending trigger is for (10.16.3: one pending trigger per stolen
  Gig). It is read when the trigger resolves, after the Gig has moved (11.5.1.7).
- "Ready" is not a selector filter. As with the Batch V8 Legend ready, an already-ready Unit is a legal choice
  that changes nothing. The effect is not optional, so with an eligible Unit the controller must choose one.

## Tests

`tests/api-admission-batch-v25.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with single-field forgeries rejected:
  - another trigger;
  - a Legend or self ready;
  - a second effect or a condition;
  - inheritance, cost, power, tags or sellability;
  - Goons' printed shape carrying this effect.
- Stealing a 4 with two spent power-4 Units and a spent power-6 Unit:
  - only the two power-4 Units are offered;
  - forged options for the power-6 Unit and for Wraith itself are rejected;
  - the chosen Unit readies, and then the attack ends with the attacker still spent.
- One matching Unit is readied automatically. With no matching Unit, the pending trigger does nothing.
- An already-ready matching Unit can be chosen and nothing readies.
- Union membership.

The reviewed union is now 74 cards, and coverage is 74/151.
