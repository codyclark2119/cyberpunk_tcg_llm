# API admission batch V100 (2026-11-26)

Plan section 6, bundle 16. This batch admits Jackie Welles: Mama's Favorite, a Go Solo Legend whose controller may pay 1 €$ to have it
defeated (removed from the game) instead of a friendly Unit. It adds the engine's first optional, paid replacement of a defeat. The card
is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Jackie Welles: Mama's Favorite (`jackie-welles-mama-s-favorite`) | Legend, Green, cost 6, power 8, RAM 2, Merc, sellable | [Go Solo] If a friendly Unit would be defeated, you may spend 1 €$ to defeat this Legend instead. (Remove it from the game.) | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v100-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the modifier `MAY_SPEND_TO_DEFEAT_THIS_LEGEND_INSTEAD_OF_FRIENDLY_UNIT {cost: 1}`, the defeat-continuation field
  `legendReplacement {answered, replaced: [{targetId, legendId}]}`, and the event `DEFEAT_REPLACEMENT_DECLINED {cardInstanceId,
  legendId, playerId}`. An accepted replacement emits `PAYMENT_MADE`, then the existing `DEFEAT_REPLACED` when the defeats happen.
- A second pin table in `packages/engine/src/defeat-replacement-support.ts` owns any Legend with the modifier. The play, trigger and
  field-Legend gates route it there first, and the power and keyword derivations skip it.
- `packages/engine/src/legend-defeat-replacement.ts`: once a defeat set is declared (a lost fight, or an effect defeat) and before any
  owner order, each declared defeat of a face-up field Unit, in declaration order, is offered to its controller while they control a
  face-up pinned Legend (in their Legends area, or on the field after Go Solo) that is not itself being defeated, and can pay 1 €$.
  The offer is one choice: decline, or one exact payment source (Eddies and Legends, 11.20.1). It pauses in the defeat-order step, in
  both the combat and the effect-defeat flows. Paying spends the source at once, and "when spent" triggers bind as for any spend
  (Batch V69).
- `defeatReplacement` now names a mandatory Gear replacement (Batch V89) first, else the Legend chosen for that defeat; `defeatBatch` is
  the replacing card with its own Gear. `defeatCards` is otherwise unchanged: the Legend is defeated by the same source, the Unit is
  not, and a Legend leaving play is removed from the game as before.
- The combat-outcome and targeted-defeat validators check that the recorded answers are distinct, in declaration order, each replaced
  by a distinct current pinned Legend of the Unit's controller, and that an open offer is exactly the next one, before any order.
- Engine identity `0.4.97-steal-prevention-v99` -> `0.4.98-legend-defeat-replacement-v100`.

## Rules readings

- 10.26: a mandatory replacement applies first. With a Deadman Transmitter on the Unit, the Gear is defeated instead and no Unit would
  be defeated, so nothing is offered.
- "Spend 1 €$" is paid like any other €$ cost, from any source, Jackie included: she may be spent to pay and then be defeated.
- One Legend replaces at most one defeat in a set (it can be defeated only once), never its own defeat, and not while it is itself in
  the set. With several pinned Legends the copies are identical, so the lowest id is offered.
- A replaced Unit is not defeated (its {Defeated} abilities do not trigger); a Unit that lost a fight still lost it.
- The offer is made per declared defeat, so a Unit's controller who is not the active player answers it (the Rival's effect defeating
  their Unit, or a fight lost by the defending Unit).

## Tests

`tests/api-admission-batch-v100.test.ts` covers:

- source projection and candidate match;
- the exact pin through the play, trigger and field-Legend gates, with forgeries (no Go Solo, an extra Blocker, power, cost, tags,
  sellability, scope) rejected, and the Gear table not admitting it;
- a friendly Unit losing a fight: the offer, its labels, paying with an Eddie, the Legend removed and the Unit kept;
- declining, paying with Jackie herself, and no €$ (nothing offered);
- Jackie on the field after Go Solo replacing another Unit's defeat; a Deadman Transmitter applying first;
- a rival Program's effect defeat offered to the defeated Unit's controller, replaced without its {Defeated} trigger;
- Jackie's own defeat not offered, and a forged offer or an early owner order rejected.

The reviewed union is now 150 cards, and coverage is 150/151. The last card, Rebecca: Having a Moment, stays deferred: its source
rules text is null.
