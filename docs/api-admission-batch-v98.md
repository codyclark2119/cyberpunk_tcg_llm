# API admission batch V98 (2026-11-26)

Plan section 6, bundle 15. This batch admits Overwatch: Panam's Gift, a Gear whose host inherits a paid {Quick} ability that discards
a card and defeats a spent rival Unit costing no more than it. The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Overwatch: Panam's Gift (`overwatch-panam-s-gift`) | Gear, Green, cost 4, power 4, RAM 4, Weapon, sellable | {Quick} 1 €$, {Spend} Discard 1. Defeat a spent rival Unit with cost equal to or less than the discarded card's cost. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v98-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `DISCARD_ONE_FOR_DEFEAT_COST`, the defeat cost bound `AT_MOST_DISCARDED`, and the play continuation field
  `discardedCostId`.
- The card is a row in the Quick activation pin table (`quick-activation-support.ts`), with its equip rule, power grant and
  `inherited: "EQUIPPED_HOST"` ability pinned. The targeted-defeat gate defers a Gear with a Quick activation to that pin.
- `packages/engine/src/gear-activation.ts`: the activation names the Gear, whose revision holds the ability, and {Spend} spends its
  host (rules 4.11.3 and 11.23.3: the host has the ability "as if printed on" it). The ability is offered while the Gear is equipped
  and face up and its host is ready, face up and not lagging, in its controller's Main Phase or React Step, and while the Eddie is
  payable with the host spent.
- "Discard 1" pauses for a choice among 2 or more hand cards; a lone card is discarded at once, and an empty hand discards nothing.
  The discarded card is held as `discardedCostId`, and the defeat's targets are the spent rival Units whose cost is at most its
  printed cost. With no discard there is no bound and so no target.
- A defeat made in the React Step returns to it. If the attacker was defeated, the attack ends (`ATTACKER_INVALID`). The defeated
  Unit's owner orders its trash when its Gear goes with it, and the trigger batch of the defeat (for example a {Defeated} ability)
  pauses the attack in `TRIGGER_RESOLUTION` and then returns to the React Step, as a Gear's play batch does in batch V92.
- Validation: a new `validateGearActivationState` (payment, discard and defeat pauses), plus the Gear branches in the targeted-defeat
  origin, source and aftermath checks, the trigger-batch combat check and the React return check.
- Labels for the activation ("Pay 1 and spend <host> to discard 1, then defeat ...") and each discard option.
- Engine identity `0.4.95-queued-program-play-v97` -> `0.4.96-inherited-gear-defeat-v98`.

## Rules readings (to review)

- "Discard 1" is read as the first effect, not a cost: the costs end at {Spend}, as on other cards with this layout. So the ability
  can be used with an empty hand, and then defeats nothing.
- The card that defeats the Unit is recorded as the Gear (the ability's printed source), not the host.

## Tests

`tests/api-admission-batch-v98.test.ts` covers:

- source projection and candidate match;
- the exact pin through the Quick activation gate and `supportsPlay`, with forgeries (not inherited, Main timing, a fixed cost
  bound, any readiness, no power grant, power) rejected;
- the Main Phase use: the label, the host spent and the Gear not, the discard choice and its label, the bound from the discarded
  card (a costlier or ready Unit is not offered), forged pauses (ready host, no discard, a discard still in hand) rejected;
- a lone hand card and a lone target forced; an empty hand defeats nothing;
- not offered with a spent or lagging host, or for an unequipped Gear;
- a React Step use that defeats the equipped attacker: its owner orders the trash and the attack ends;
- a React Step use whose {Defeated} trigger makes the reacting player discard before the attack ends.

The reviewed union is now 148 cards, and coverage is 148/151.
