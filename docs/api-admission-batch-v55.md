# API admission batch V55 (2026-11-20)

Plan section 6, scope 3c. This batch admits Gilded Matón, whose {Play} defeats a friendly Gear and then, "if you do", a rival
Unit with cost 3 or less. It adds the engine's first "if you do" second defeat. The card is pinned literally in its engine
gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Gilded Matón (`gilded-mato-n`) | Unit, Yellow, 4, power 3, RAM 2, Ganger/Valentino, unsellable | {Play} You may defeat a friendly Gear. If you do, defeat a rival Unit with cost 3 or less. | `TARGETED_GEAR_DEFEAT_V1` |

The revision is authored in `tests/api-admission-batch-v55-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `mechanics.ts` adds the Gear relation `FRIENDLY`, lets the Unit cost bound be 3 as well as 2, and adds `then` to
  the defeat effect: a second Unit target that applies once the first defeat happened. `game.ts` adds the targeted-defeat
  phase `THEN` and a `then` marker that stays through that clause's owner order.
- `targeted-gear-defeat-support.ts` pins the whole Unit beside Heywood Ripperdoc (V34).
- `targeted-defeat.ts`: once the Gear's defeat batch has moved, a `then` effect lists its second targets. None ends the
  effect; one is defeated without a choice; two or more pause for the controller's choice, with no decline. That defeat
  then goes through the usual owner order.
- `targeted-defeat-state.ts` accepts the `THEN` pause only with its exact current choice, and the `then` marker only when this
  source has already defeated a Gear in the batch. The post-movement defeat facts allow the source's two defeats.
- Engine identity `0.4.50-towerfall-v54` -> `0.4.51-if-you-do-defeat-v55`.

## Rules readings

- "You may": the controller can decline the Gear defeat, and with no friendly Gear nothing is offered. Either way the second
  clause does not apply.
- "If you do, defeat a rival Unit ...": mandatory once the Gear was defeated, and listed after the Gear has moved. The Gear's
  own {Defeated} triggers become pending in the same batch as usual.
- "Cost 3 or less" reads the Unit's referenced cost, as V31's "cost 2 or less" does.

## Tests

`tests/api-admission-batch-v55.test.ts` covers source projection and candidate match; the exact pin with forgeries (any Gear,
mandatory, no second defeat, cost 2, any relation, cost, power, tags, sellable); a {Play} that offers only the friendly Gear
and a decline, then a choice of the two rival Units with cost 3 or less, with a forged option and a missing first defeat
rejected; a forced second defeat that pauses for the rival's trash order of the Unit and its Gear; a Gear defeat with no
eligible rival Unit; a decline; no friendly Gear; and union membership.

The reviewed union is now 104 cards, and coverage is 104/151.
