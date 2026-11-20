# API admission batch V43 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Blocker Unit whose {Play} obliges a chosen rival Unit to attack on its
controller's next turn if it can. It is one of the cards named in Cody's quiz set that the assistant thread asked for first
(2026-11-20). The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Mox Inciters (`mox-inciters`) | Unit, Blue, 3, power 2 | {Play} A rival Unit must attack next turn if it can. [Blocker] | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v43-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` adds a new effect, `FORCE_RIVAL_UNIT_ATTACK` with `duration` `NEXT_TURN`.
  - `game.ts` adds a new state record, `mustAttack`. Each `MUST_ATTACK` entry names the target, the source, the forcing
    player, the creation turn and the resolved PLAY occurrence.
  - It also adds two events, `MUST_ATTACK_CREATED` and `MUST_ATTACK_ENDED`. `MUST_ATTACK_ENDED` carries a reason:
    `ATTACKED`, `NEXT_TURN` or `LEFT_FIELD`.
- `must-attack-support.ts` adds a new pin table, `MUST_ATTACK_SHAPES`, which pins the whole Unit, its Blocker keyword and
  its {Play}. The trigger gate routes this metadata to it.
- `must-attack.ts`:
  - The {Play} offers the rival's field Units. One is forced, and with none nothing happens.
  - The record is kept like the V22 ready lock:
    - Declaring an attack with the Unit during its controller's turn fulfils it.
    - It ends at the start of the forcing player's next turn, or when the Unit leaves the field.
  - `validateMustAttack` re-derives the PLAY origin and the turn window.
- Enforcement:
  - `index.ts` does not offer `END_TURN` while a bound Unit could still declare an attack (`unmetMustAttack`).
  - `end-turn.ts` refuses it as well.
  - `combat.ts` fulfils the obligation when the attack is declared.
  - `turn.ts`, `card-movement.ts` and `bottom-deck.ts` end it.
- `observation.ts` shows each obligation publicly: target, source, forcing seat and creation turn.
- `trigger-state.ts` lets the effect pause only for its target in its own PLAY batch.
- Engine identity `0.4.38-type-reveal-v42` -> `0.4.39-must-attack-v43`. The baselines are regenerated once for the bundle
  this batch ships in, in a separate commit.

## Rules readings

- "A rival Unit": chosen when the {Play} resolves, from the rival's field Units, as with the other {Play} targets.
- "Must attack next turn if it can": during its controller's next turn, that player cannot end the turn while the Unit can
  legally declare an attack. They may still act in any order first, and they choose its target.
- "If it can": no obligation applies to a Unit that cannot attack, such as a spent or lagging Unit or one with a printed
  "can't attack". So a rival Mox Inciters choosing Misty Olszewski never forces Misty to attack (official Level 1 test,
  answer B).
- One declared attack meets the obligation. The obligation does not follow a Unit that leaves the field, because the Unit
  becomes a new object.

## Tests

`tests/api-admission-batch-v43.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - no Blocker, an {Attack} trigger, an added condition, or a second effect;
  - cost, power, tags or sellability.
- With two rival Units the controller chooses one. On the rival's next turn that player cannot end the turn while the Unit
  can attack. Declaring its attack ends the obligation, and ending the turn is then offered again.
- Misty can be chosen but cannot attack, so the turn can end. A spent bound Unit lets the turn end too. The obligation is
  gone once the forcing player's next turn starts.
- With no rival field Unit the {Play} does nothing.
- Union membership.

The reviewed union is now 92 cards, and coverage is 92/151.
