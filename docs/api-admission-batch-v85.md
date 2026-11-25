# API admission batch V85 (2026-11-25)

Plan section 6, scope 3c. This batch admits Chrome Reverie, a Program that locks a rival Unit from attacking until its controller's
next turn and then, with a min Gig, lets its controller Call a Legend for free. It reuses Batch V83's attack lock and Batch V84's free
Call. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Chrome Reverie (`chrome-reverie`) | Program, Blue, RAM 1, cost 3, Braindance, sellable | A rival Unit can't attack until your next turn. If you control a min Gig, you may Call a Legend for free. (You can only Call a Legend once per turn.) | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v85-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN` takes an optional `target: "RIVAL_UNIT"`; `MAY_CALL_LEGEND_FREE` takes an
  optional `condition`; and `FRIENDLY_GIG_IS_MIN`'s die type is optional (without it, any friendly min Gig counts). Existing
  revisions are unchanged.
- The pin joins the free-Call table (`packages/engine/src/free-call-support.ts`). That table now pins each card's execution scope
  and its abilities' `choose` too, so a Program and a Unit cannot stand in for each other and a modal forgery is rejected.
- Attack lock: with `RIVAL_UNIT`, only the locking player's rivals' face-up field Units are offered (a lone one is locked without a
  choice; none does nothing). The lock validator accepts a lock from this pinned Program and keeps a rival-only lock on a rival Unit.
- Program free Call: the condition is checked as the effect resolves (`CONDITION_EVALUATED`). If it holds and a face-down Legend may
  be Called this turn, the Program pauses for "Call no Legend" or "Call face-down Legend N for free"; otherwise nothing happens. The
  Call and its queued {Call} ability work as in Batch V84. A non-modal Program may now pause on this second effect.
- Engine identity `0.4.82-free-call-v84` -> `0.4.83-program-free-call-v85`.

## Rules readings

- "A min Gig" is a Gig at 1 (6.3.1). "If you control a min Gig" counts any rolled Gig in the controller's Gig area at 1.
- The condition is checked when the Call would happen, after the lock.
- With no rival Unit, nothing is locked and the Call can still happen.

## Tests

`tests/api-admission-batch-v85.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries (any Unit, no condition, a d4-only condition, reordered effects, modal, cost, scope, tags) rejected;
- a lone rival Unit locked without a choice, the free Call offered with a min Gig, and the Legend's Draw 1 after the Program;
- a choice between two rival Units with friendly Units never offered, then declining the Call;
- no Call offered without a min Gig or with the turn's Call used, and the Call still offered with no rival Unit;
- tampered pauses (no min Gig, Call used, a friendly Unit under a rival-only lock) rejected;
- union membership.

The reviewed union is now 135 cards, and coverage is 135/151.
