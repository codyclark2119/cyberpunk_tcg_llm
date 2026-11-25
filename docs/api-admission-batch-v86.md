# API admission batch V86 (2026-11-25)

Plan section 6, scope 3c. This batch admits T-Bug: Amateur Philosopher, a Unit whose {Defeated} lets its controller look at all their
face-down Legends and then Call one for free. It reuses Batch V84's free Call and extends it to a defeat in either player's turn, so the
Called Legend's {Call} ability can now resolve for the non-active player. The card is pinned literally in its engine gate (Cody's exact
per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| T-Bug: Amateur Philosopher (`t-bug-amateur-philosopher`) | Unit, Yellow, RAM 2, cost 4, power 4, Merc/Netrunner, not sellable | {Defeated} Look at all friendly face-down Legends. Then, you may Call a Legend for free. (You can only Call a Legend once per turn.) | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v86-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `MAY_CALL_LEGEND_FREE` takes an optional `lookAtAll: true`, and the turn history's `queuedCall` an optional `started: true`.
- The pin joins the free-Call table (`packages/engine/src/free-call-support.ts`).
- Look: before the Call choice, each face-down friendly Legend slot is looked at, as the private Legend look does (`LEGEND_LOOKED_AT`,
  private knowledge for the controller only). A Called Legend's knowledge ends when it turns face up.
- A queued Call now also waits for the end of an attack: `finishCombat` starts it, as `finishAction` does. The queue is marked
  `started` while the {Call} ability resolves, with its controller acting in the Main Phase; when it ends, the queue is cleared and the
  turn player acts again. The Legend activation, return-context and turn-state validators accept the non-active player acting only for
  that started Call.
- Engine identity `0.4.83-program-free-call-v85` -> `0.4.84-defeated-free-call-v86`.

## Rules readings

- The look and the Call are one {Defeated} effect, resolved by T-Bug's controller (its owner, as it is now in the trash), in either
  player's turn. Calls are counted per player per turn, so the Call is available in the rival's turn too.
- The Called Legend's {Call} ability is its own trigger: it resolves after the attack (or action) that defeated T-Bug, before the turn
  player continues.

## Tests

`tests/api-admission-batch-v86.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries (no look, {Play} trigger, power, tags, scope) rejected by every gate;
- T-Bug losing its own attack: looks at the two face-down Legends, offers their slots, Calls one for free, and the Legend's Draw 1
  after the attack ends;
- T-Bug defeated in the rival's turn: its controller Calls a modal Legend, which pauses for that player in the rival's Main Phase, draws,
  then returns the turn to the rival; tampered queues rejected;
- declining, and no look or Call with every Legend face up;
- union membership.

The reviewed union is now 136 cards, and coverage is 136/151.
