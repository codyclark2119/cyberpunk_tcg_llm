# API admission batch V22 (2026-11-19)

Plan section 6, scope 3c. A Unit and a Program that stop a rival Unit from readying until their controller's
next turn. Each card is pinned literally (Cody's exact per-card check, 2026-11-15): Pacifica Netrunner in the
`{Play}` pin table, Memory Relapse in the targeted-spend pin table.

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Pacifica Netrunner (`pacifica-netrunner`) | Unit, Green, 4, power 1 | {Play} If your ☆ (Street Cred) is an even number, a rival Unit can't ready until your next turn. | `COMBAT_TRIGGERS_V1` |
| Memory Relapse (`memory-relapse`) | Program, Green, 4 | Spend a rival Unit. It can't ready until your next turn. If your ☆ (Street Cred) is an even number, draw 1. | `TARGETED_SPEND_V1` |

Both revisions are authored in `tests/api-admission-batch-v22-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain):
  - `mechanics.ts`: `SPEND_UNIT` gains an optional `preventReady: "UNTIL_YOUR_NEXT_TURN"`, which locks the
    spent Unit too. A new effect, `PREVENT_UNIT_READY`, takes the spend selector's target, an optional
    resolution-time condition (`STREET_CRED_IS_EVEN` only) and `duration: "UNTIL_YOUR_NEXT_TURN"`.
  - `game.ts`: the game state gains `readyLocks`. Each records its target, its source, the locking player,
    the turn it was made and the occurrence that made it (with a trigger ordinal for a `{Play}`, none for a
    Program). New events `READY_LOCKED`, `READY_LOCK_EXPIRED` (reason `NEXT_TURN` or `LEFT_FIELD`) and
    `READY_PREVENTED`.
  - No new policy or scope.
- Primitive (`ready-lock.ts`):
  - Memory Relapse: the existing Program spend (`targeted-spend.ts`) applies the lock after spending its
    chosen Unit. The conditional draw is the existing `CONDITIONAL_DRAW` primitive.
  - Pacifica Netrunner: the PLAY trigger batch (`trigger-resolution.ts`) checks the condition, then offers the
    rival field Units through the spend selector. One Unit is chosen automatically; two or more pause for a
    `TARGET` choice.
- Prevention: the 8.6.3 Ready Phase (`turn.ts`) and effect readying (`ready-unit.ts`) skip a locked Unit and
  emit `READY_PREVENTED` instead.
- Expiry: in the locking player's next Start Phase, after the 8.6.1 Gig check and before readying (8.6.2.1),
  or when the target leaves the field (`card-movement.ts`, `bottom-deck.ts`).
- Observation: `readyLocks` is public, with the locking player as a seat.
- Validation (`state.ts`): locks are unique and ordered. The target stays a face-up rival field Unit. A
  `{Play}` lock needs its pinned source and a resolved occurrence whose id is recomputed at its creation turn; a
  Program lock needs the pinned Program and its owner as the locking player. A lock lives on its own turn and
  the rival's turn, and on the locking player's next turn only at `TURN_START` or in a game that ended there.
  A paused Pacifica choice needs its condition still true and two or more rival Units.
- Gates: `play-pin-support.ts` and `targeted-spend-support.ts` pin the complete printed shapes. A ready lock
  needs the targeted-spend policy, whose selector it uses. `hasValueConditionMetadata` leaves Memory Relapse's
  even-Street-Cred draw to its targeted-spend pin.
- Engine identity `0.4.17-steal-restrictions-v21` -> `0.4.18-ready-locks-v22`. The baselines are regenerated
  in a separate commit.

## Rules readings

- "Can't ready" is a prevention, so it beats the Ready Phase and any readying effect (2.6). It does not spend
  the Unit: Pacifica Netrunner may lock a ready Unit, which stays ready and can still attack, but once spent
  cannot ready until the lock ends.
- The Street Cred condition is checked on resolution, not when the `{Play}` triggers (10.16.1.1). No Gigs is
  Null, never even (the existing `STREET_CRED_IS_EVEN` reading).
- Like the earlier targeted spends, readiness is not a selector filter: Memory Relapse may choose a Unit that
  is already spent, and it is still locked.
- "Until your next turn" ends at the start of that turn (8.6.2.1), before that player's Ready Phase. The
  rival's Ready Phase in between is the one the lock stops.
- A Unit that leaves the field is a new object, so the lock ends there. A Go Solo Legend is a Unit on the field
  and can be locked; it is removed from the game when it leaves (11.29.1).

## Tests

`tests/api-admission-batch-v22.test.ts` covers:

- Source projection and candidate match.
- Both exact pins, with single-field forgeries rejected: no condition, another target relation or cost limit,
  another trigger, a second effect, power, sellability and a keyword (Pacifica Netrunner); no lock, no draw,
  draw 2, a cost-limited target, cost and tags (Memory Relapse).
- Memory Relapse: with two rival Units, ready and spent are both offered. The chosen Unit is spent and locked,
  the lock is public, the even-Street-Cred draw happens, and a Program lock with a trigger ordinal is rejected.
  The rival's Ready Phase prevents only the locked Unit, which then can't attack. The lock expires at the
  locking player's next turn, and the Unit readies in its controller's following Ready Phase.
- Memory Relapse with odd Street Cred and one rival Unit: the target is forced and there is no draw.
- Pacifica Netrunner: with even Street Cred both rival Units are offered and a forged friendly option is
  rejected. The locked Unit stays spent through the rival's Ready Phase. Forged locks (wrong creation turn,
  stale, wrong locking player, wrong ordinal, friendly target, duplicate) are rejected. With odd Street Cred
  nothing happens.
- Effect readying is prevented, and the lock ends when its Unit leaves the field.
- Union membership.

The reviewed union is now 71 cards, and coverage is 71/151.
