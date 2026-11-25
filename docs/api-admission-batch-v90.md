# API admission batch V90 (2026-11-25)

Plan section 6, bundle 13. This batch admits Cyberpsychosis, a Quick Program that pumps an equipped Unit and then defeats it at the
end of the turn if it stole or fought. It adds the engine's first conditional end-of-turn defeat (rule 8.16.1). The card is pinned
literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Cyberpsychosis (`cyberpsychosis`) | Program, Yellow, RAM 2, cost 3, Quickhack, sellable | {Quick} Give an equipped Unit +3 power this turn for each of its equipped Gears. If that Unit steals or fights, defeat it at the end of this turn. | `TARGETED_DEFEAT_V1` |

The revision is authored in `tests/api-admission-batch-v90-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `EQUIPPED_UNIT_POWER_PER_GEAR_THIS_TURN {amount: 3, ifStealsOrFights: {timing: END_OF_TURN, effect}}`, the
  defeat target `TRIGGER_SUBJECT`, the binding kind `DELAYED_END_TURN_DEFEAT`, the turn-history record `endTurnDefeats`, the power
  modifier `PROGRAM_PER_EQUIPPED_GEAR`, and the events `END_TURN_DEFEAT_REGISTERED` and `END_TURN_DEFEAT_ARMED`.
- The card's shape is pinned in the targeted-defeat table (`targeted-defeat-support.ts`), next to Batch V46's Safety Override.
- `packages/engine/src/end-turn-defeat.ts`: the target is any player's face-up field Unit with at least one attached Gear (a lone one is
  taken without a choice). The power is +3 per Gear counted as the effect resolves, and a record is registered on that Unit, unarmed.
- The record is armed when its Unit fights (attacker or defender, as `FIGHT_STARTED` is emitted) or steals a Gig (an attack's steal,
  or an effect steal it is the actor of). A Unit that leaves the field before the END_TURN batch drops its record (2.4).
- In the END_TURN batch each armed record becomes a `DELAYED_END_TURN_DEFEAT` binding of the Program's controller, which may be the
  non-active player. It resolves the registered defeat through the targeted-defeat machinery, so the owner orders the trash and
  Batch V89's Deadman Transmitter replaces it. The END_TURN batch ordering (8.16.1) and its {Defeated} triggers apply as usual.
- Engine identity `0.4.87-defeat-replacement-v89` -> `0.4.88-end-turn-defeat-v90`.

## Rules readings

- "Steals" means steals a Gig: an attack that steals nothing (no Gig to take, or power 0) does not arm the defeat.
- "Fights" counts either side of a fight, and only fights after the Program resolves. Played in the React Step of an attack, the
  fight that follows counts. A fight that is prevented never starts, so it does not count.
- The +3 per Gear is fixed as the effect resolves, as Batch V75's per-Gear power is. Gear moved on or off later does not change it.
- "Defeat it" names that Unit only while it is the same object; if it left the field and came back it is a new object.

## Tests

`tests/api-admission-batch-v90.test.ts` covers:

- source projection and candidate match;
- the exact pin through the play and targeted-defeat gates, with forgeries (amount, no end-of-turn defeat, a different defeat
  target, not Quick, cost, tags, scope) rejected;
- only equipped Units offered, of either player, +3 per Gear, and no defeat when the Unit neither stole nor fought;
- a fight (14 power beats 8), then the defeat at end of turn with the owner's trash order;
- a Gig steal arming it;
- a Unit defeated in its fight taking its record with it, and a Deadman Transmitter defeated in its place at end of turn;
- the Program played in the Rival's attack on their attacker, defeating it at the end of the Rival's turn;
- forged records (identity, subject off the field, ability) rejected;
- union membership.

The reviewed union is now 140 cards, and coverage is 140/151.
