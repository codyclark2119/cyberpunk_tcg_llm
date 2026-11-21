# API admission batch V56 (2026-11-20)

Plan section 6, scope 3c. This batch admits Riot Shield, a Gear that gives its host {Blocker} and makes a Rival's {Go Solo}
cost 2 more. It adds the engine's first effect that changes what another player pays. The card is pinned literally in its
engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Riot Shield (`riot-shield`) | Gear, Green, 2, power 1, RAM 2, Weapon, sellable | (Equip to a friendly Unit or face-up Legend.) {Blocker} Rivals must pay +2 €$ to use {Go Solo}. | `GEAR_CAPABILITIES_V1` |

The revision is authored in `tests/api-admission-batch-v56-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`. Its {Blocker} is an inherited host keyword,
as on Mandibular Upgrade.

## Engine change

- Grammar: `mechanics.ts` adds the modifier `RIVAL_GO_SOLO_COST_INCREASE` (2).
- `capability-support.ts` pins the whole Gear: printed power to its host, {Blocker} to its host and the tax. It needs the
  reviewed Gear, capability, React and field-Legend policies.
- `legend-entry.ts` adds `legendEntryAmount`: a {Go Solo} costs the printed cost plus each tax on face-up Gear that a Rival
  controls, attached on that Rival's field or Legends area. Legal actions, the payment, its forced sources and the paused
  payment's validation all read that amount. Playing a Legend as a Unit any other way pays its printed cost.
- The characteristic and view modifier checks treat the tax as having no power effect.
- Engine identity `0.4.51-if-you-do-defeat-v55` -> `0.4.52-go-solo-tax-v56`.

## Rules readings

- "Rivals must pay +2 €$": only the Gear controller's Rivals, and only to use {Go Solo}. Each Riot Shield adds its own +2.
- The tax is part of what is paid, so {Go Solo} is offered only when the higher amount can be paid. The Legend's printed
  cost is unchanged (3.11.1.2).

## Tests

`tests/api-admission-batch-v56.test.ts` covers source projection and candidate match; the exact pin with forgeries (no tax,
no Blocker, no printed power, an ability, cost, power, tags, unsellable); the host's {Blocker}; V's {Go Solo} at 5 with no
Riot Shield, at 7 with a rival Riot Shield (not offered with 6 sources, then paid in full with 7); two rival Riot Shields at
9; the actor's own Riot Shield adding nothing; and union membership.

The reviewed union is now 105 cards, and coverage is 105/151.
