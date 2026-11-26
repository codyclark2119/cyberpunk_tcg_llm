# API admission batch V96 (2026-11-26)

Plan section 6, bundle 15. This batch admits We Gotta Live Together, a Program with a conditional alternative cost that plays up to
two cheap Units from its controller's trash for free. The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| We Gotta Live Together (`we-gotta-live-together`) | Program, Green, cost 5, RAM 2, Aldecado/Nomad, sellable | If a Rival controls at least 2 more Gigs than you, play this Program for 3 €$. Play up to 2 Units with cost 3 or less from your trash for free. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v96-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the modifier `ALTERNATIVE_PLAY_COST_IF_RIVAL_GIG_LEAD`, the effect `PLAY_TRASH_UNITS_FREE`, the play continuation field
  `trashPlayedIds` (the Units played so far), and the trigger continuation field `freePlaySource` (the resolved Program behind a
  two-Unit play batch).
- `packages/engine/src/trash-units-play.ts` holds the pin table, the gate (routed first from `supportsPlay`), and the runtime.
- The play amount is the lower of the ordinary amount and 3 while some Rival controls at least 2 more Gigs than the player. It is read
  wherever the amount is computed, as for the batch V83 alternative cost.
- The effect offers the controller's face-up trash Units with printed cost 3 or less that the engine can play, one at a time, with
  "Play no more Units" always offered. Each chosen Unit enters the field ready and lagging, and is played without paying.
- Once the Program has resolved, the played Units' {Play} triggers become pending in one batch. The first Unit is the batch's origin,
  and the second is its effect play (`effectPlays`, as for the batch V48 free play), justified by `freePlaySource`. Each play records its
  first-blue-play ordinal in play order. A single played Unit starts an ordinary play batch.
- Engine identity `0.4.93-deck-top-play-v95` -> `0.4.94-trash-units-play-v96`.

## Rules readings

- "Up to 2" makes every play optional, so even a lone eligible Unit is offered with the option to stop.
- "Play this Program for 3 €$" replaces the cost to pay. The card's cost value stays 5 (3.11.1.2).
- The plays happen as the Program resolves; their {Play} triggers wait until it has resolved, then resolve together in the order the
  controller chooses (as for any play's triggers).

## Tests

`tests/api-admission-batch-v96.test.ts` covers:

- source projection and candidate match;
- the exact pin through its gate and `supportsPlay`, with forgeries (no or another alternative cost, cost, tags, Quick) rejected;
- the alternative amount: 5 without a lead or with a 1-Gig lead, 3 with a lead of 2 or more;
- two Units played one at a time (a cost-8 Unit is not offered), with option labels; a forged played Unit off the field rejected;
  both {Play} triggers in one batch with the second as an effect play, and a forged batch without `freePlaySource` rejected;
- stopping at once; a lone Unit still optional; nothing offered without an eligible Unit.

The reviewed union is now 146 cards, and coverage is 146/151.
