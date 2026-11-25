# API admission batch V89 (2026-11-25)

Plan section 6, bundle 13. This batch admits Deadman Transmitter, a Gear whose host is never defeated while it holds the Gear: the
Gear is defeated instead. It adds the engine's first replacement effect (rules 10.24 to 10.29). The card is pinned literally in its
engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Deadman Transmitter (`deadman-transmitter`) | Gear, Red, RAM 3, cost 3, power 1, Cyberware/Trauma Team, sellable | (Equip to a friendly Unit or face-up Legend.) If this Unit would be defeated, defeat its "DEADMAN TRANSMITTER" instead. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v89-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the modifier `DEFEAT_THIS_GEAR_INSTEAD_OF_HOST`, and the event `DEFEAT_REPLACED {cardInstanceId, replacementId, defeatedBy}`.
- A new pin table (`packages/engine/src/defeat-replacement-support.ts`) owns any Gear with the modifier. Both the play and the trigger
  gate route it there first, and the power and keyword derivations skip it (it changes neither).
- `defeatReplacement(state, unit, context)` names the Gear that replaces a field Unit's defeat: a face-up Gear attached to it, of the
  same controller, with the pinned modifier. `defeatBatch` now takes the context and, for such a Unit, is that Gear alone, so the
  owner is never asked to order cards that will not move. `unfinishedDefeatOrder` and `defeatOrderChoice` take the context too.
- `defeatCards` replaces each such defeat before anything is declared (10.25): it emits `DEFEAT_REPLACED`, then `CARD_DEFEATED` for
  the Gear, and moves only the Gear. It now returns what was actually defeated, and the fight, effect-defeat and Gear-defeat paths use
  that list for the DEFEAT origin and for effect defeats in a batch. The host's {Defeated} abilities do not trigger.
- Engine identity `0.4.86-rival-gig-change-v88` -> `0.4.87-defeat-replacement-v89`.

## Rules readings

- "Its DEADMAN TRANSMITTER" is read as this Gear. With two attached, both replacements could apply; 10.28.1 lets the controller
  choose, and since the copies are identical the engine takes the lowest id. The other one stays, and does not apply again to the
  Gear's own defeat (10.29.1).
- A Unit that loses a fight still lost it (its "loses a fight" abilities still apply); it simply is not defeated.
- A replacement only applies to a defeat. A fight-defeat immunity or prevention, which removes the defeat itself, comes first.

## Tests

`tests/api-admission-batch-v89.test.ts` covers:

- source projection and candidate match;
- the exact pin through the play and trigger gates, rejected by the capability table, with forgeries (no printed power, an extra
  Blocker grant, power, cost, tags, scope) rejected;
- a host losing a fight: the replacement event, the Gear defeated, the host on the field with no trash order offered;
- a second Gear staying attached; two Transmitters, of which only the lowest-id one goes; no Transmitter, where the host is defeated;
- an effect defeat (Wild in the Streets) replaced, with the host's {Defeated} ability not triggering;
- a Transmitter controlled by another player, and a Gear target, replacing nothing;
- union membership.

The reviewed union is now 139 cards, and coverage is 139/151.
