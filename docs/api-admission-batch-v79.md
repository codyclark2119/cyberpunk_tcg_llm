# API admission batch V79 (2026-11-25)

Plan section 6, scope 3c. This batch admits Gunpoint Diplomacy, a Program that gives a friendly Unit a next attack on ready Units and
+3 power, or, when its controller is behind on Street Cred, lets a Rival choose one of the two. The card is pinned literally in its
engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Gunpoint Diplomacy (`gunpoint-diplomacy`) | Program, Red, RAM 3, Ganger/Plan, cost 4, sellable | Give a friendly Unit these effects. If you have less ☆ (Street Cred) than a Rival, they instead choose one effect for you. The next time this Unit attacks this turn, it may attack ready Units. // Give this Unit +3 power this turn. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v79-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `FRIENDLY_UNIT_READY_ATTACK_AND_POWER {power: 3, rivalChoosesOneIf: "STREET_CRED_LESS_THAN_RIVAL"}`; the event
  `READY_UNIT_ATTACK_GRANTED` (effect id, Unit); a `PROGRAM_UNIT_GRANT` variant of the temporary power modifier (+3, keyed by the
  effect id); `grantTargetId` on the play continuation (the chosen Unit while the Rival chooses); and `readyUnitAttackGrants` in the
  turn history.
- A new pin table, `packages/engine/src/ready-attack-grant.ts`. The effect routes there first; the play, Call, field-Legend, trigger and
  V78 gates reject it.
- Resolving the effect chooses a friendly field Unit: none means nothing happens, a lone Unit is chosen without a choice, otherwise the
  controller chooses ("Give X these effects"). Then, if the controller has less Street Cred than the Rival, the acting player passes to
  the Rival, who chooses "Its next attack this turn may target ready Units" or "Give it +3 power this turn" (`EFFECT_MODE_CHOSEN`, index
  0 or 1). Otherwise the Unit gets both.
- The ready-Unit grant is a turn-history entry for the Unit. While it is unused, the Unit's attack targets include ready rival Units.
  When the Unit declares an attack the entry is marked `inAttack`, so the locked target stays legal through the react window and
  resolution, and the entry is removed when that attack ends (completed, or ended early). It is also removed if the Unit leaves the
  field, and the turn history resets each turn.
- The Rival-choice exceptions (play state, turn state, action return) name this effect through `otherPlayerMayChoose`.
- Engine identity `0.4.76-hand-reset-v78` -> `0.4.77-ready-attack-grant-v79`.

## Rules readings

- The controller chooses the Unit first; the Rival then chooses an effect for that Unit. Street Cred is compared as the effect resolves,
  with the existing Null-aware comparison (5.11.4): a player with no rolled Gigs is behind any numeric Street Cred, and equal Street
  Cred is not "less".
- "May attack ready Units" widens the Unit's attack targets to every ready rival Unit for one attack. It does not force a ready target,
  and the attack consumes the grant whatever it targets.
- "The next time this Unit attacks this turn": an unused grant does nothing after the turn ends. A Unit that leaves the field and
  returns is a new object without the grant.
- Gunpoint Diplomacy has no {Quick}, so it is played only in its controller's own main phase and the Unit is the active player's.

## Tests

`tests/api-admission-batch-v79.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries rejected and no other gate admitting the card;
- the controller's Unit choice and labels, both effects, an attack on a ready Unit through the react window to its defeat, and the grant
  ending with that attack while the power lasts;
- a lone Unit chosen without a choice, and no Unit;
- less Street Cred: the Rival's choice of each effect, and equal Street Cred giving both;
- the grant ending when the Unit leaves the field;
- union membership.

The reviewed union is now 129 cards, and coverage is 129/151.
