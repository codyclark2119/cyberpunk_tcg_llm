# API admission batch V84 (2026-11-25)

Plan section 6, scope 3c. This batch admits Tyger's Whisper, a 0-power Unit whose {Play} lets its controller Call a Legend for free.
It adds the engine's first Call made inside an effect, which later batches (T-Bug, Chrome Reverie, Arasaka Emergency Radioport)
reuse. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Tyger's Whisper (`tyger-s-whisper`) | Unit, Green, RAM 1, cost 2, power 0, Fixer/Tyger Claws, not sellable | {Play} You may Call a Legend for free. (You can only Call a Legend once per turn.) | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v84-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `MAY_CALL_LEGEND_FREE` and the turn history `queuedCall {playerId, legendId}`.
- The pin joins the free-Call Unit table (`packages/engine/src/free-call-support.ts`), next to Batch V66's Panam Palmer: Strength
  Through Family.
- New module `packages/engine/src/free-call-effect.ts`.
- The Call itself is split out of `TurnMutation.call` (`revealCalledLegend`: face up, counted against the turn's Call limit,
  `LEGEND_CALLED`) from the start of the Legend's {Call} ability (`startCallAbility`). A paid Call runs both, as before.
- The {Play} trigger offers "Call no Legend" and "Call face-down Legend N for free" for each face-down friendly Legend that may be
  Called (by public slot, as the private Legend look does). With the turn's Call used, or no face-down Legend, it resolves without
  a choice.
- A Legend Called this way with a {Call} ability is queued in the turn history. When the action's trigger batches are done (after any
  queued "when spent" bindings), `finishAction` starts that ability exactly as a paid Call would, returning to the Main Phase.
- Engine identity `0.4.81-attack-lock-v83` -> `0.4.82-free-call-v84`.

## Rules readings

- "Call a Legend for free" is a Call: the Legend turns face up and the turn's one Call is used, without any payment.
- The Legend's {Call} ability is its own trigger, so it resolves after the {Play} effect and the rest of its batch, not inside it.
- "You may" makes the Call optional; declining leaves the turn's Call available.

## Tests

`tests/api-admission-batch-v84.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries (cost, power, trigger, a second Call, an added draw, tags, sellable) rejected by every gate;
- the offered slots and labels, the free Call (no payment, no Eddie spent), and the Legend's Draw 1 after the {Play} resolves;
- declining, with the turn's Call still available;
- no choice with the turn's Call used or every Legend face up;
- a Legend without a {Call} ability, with nothing queued;
- a modal {Call} pausing for its mode after the {Play}, and tampered choice and queue states rejected;
- union membership.

The reviewed union is now 134 cards, and coverage is 134/151.
