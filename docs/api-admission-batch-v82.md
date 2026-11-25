# API admission batch V82 (2026-11-25)

Plan section 6, scope 3c. This batch admits Panam Palmer: Nomad Cavalry, a Legend whose paid {Spend} moves one of its Gear to an
unequipped friendly Unit and readies that Unit, and whose end-of-turn trigger readies every equipped friendly Unit and Legend when there
are at least 5. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Panam Palmer: Nomad Cavalry (`panam-palmer-nomad-cavalry`) | Legend, Green, RAM 2, Aldecado/Merc/Nomad, sellable | 2 €$, {Spend} Move a Gear from this Legend to an unequipped friendly Unit. If you do, ready that Unit. At the end of your turn, if 5 or more friendly Units and/or Legends are equipped, ready them. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v82-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effects `MOVE_SOURCE_GEAR_TO_UNEQUIPPED_UNIT_THEN_READY` and `READY_EQUIPPED_FRIENDLY_IF_AT_LEAST {minimum: 5}`; the
  play continuation field `movedGearId` (the Gear chosen, while its Unit is chosen); and the event `GEAR_MOVED {effectId,
  gearInstanceId, fromHostId, toHostId}`.
- The pin joins the Legend pin table (`packages/engine/src/legend-spend-support.ts`): the paid {Spend} (2 €$, Main) and the own-turn
  end trigger, with the new module `packages/engine/src/gear-move.ts`.
- The move: the Gear attached to Panam are offered (a lone one is taken without a choice), then the controller's face-up field Units
  with no Gear (a lone one is taken without a choice). The Gear leaves Panam, enters the field and attaches to the Unit, and the Unit
  readies (a ready lock still prevents it, as for any effect ready). With no Gear on Panam or no unequipped Unit, nothing moves and
  nothing readies.
- The end-of-turn trigger joins the own-turn end batch like other Legends-area triggers. As it resolves it counts the controller's
  face-up Units and Legends (field or Legends area) with at least one Gear, records the check (`CONDITION_EVALUATED`), and with 5 or
  more readies each of them that is spent, with no choice.
- Engine identity `0.4.79-gig-reroll-v81` -> `0.4.80-gear-move-v82`.

## Rules readings

- "An unequipped friendly Unit" is a friendly field Unit with no Gear attached. The Gear's own equip clause (a friendly Unit or
  face-up Legend) always admits such a Unit.
- "If you do" holds whenever a Gear moved; a Unit that is already ready simply stays ready.
- "If 5 or more ... are equipped" is read as an intervening condition checked when the trigger resolves (10.16.1.1), as Batch V29
  does; the trigger is discovered every own-turn end. "Ready them" readies exactly the counted cards, Panam included when equipped.

## Tests

`tests/api-admission-batch-v82.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries (another cost, Quick, no end-turn ability, a start-of-turn trigger, tags, colors) rejected;
- a lone Gear moved to a lone spent Unit without a choice, readying it and granting the Gear's power;
- the Gear choice and then the Unit choice, with an equipped Unit not offered;
- no Gear on Panam, and no unequipped Unit;
- the end-of-turn ready with 5 equipped cards and none with 4;
- a tampered held Gear rejected;
- union membership.

The reviewed union is now 132 cards, and coverage is 132/151.
