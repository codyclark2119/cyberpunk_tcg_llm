# API admission batch V88 (2026-11-25)

Plan section 6, bundle 13. This batch admits Meredith Stout: Stone Cold Corpo, a {Blocker} Unit that fights Legends harder and lets
its controller recover a card from the trash when a Rival adjusts or swaps their Gigs. It adds a new trigger, raised by an opponent's
effect, and a while-fighting power that depends on the opposing card. The card is pinned literally in its engine gate (Cody's exact
per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Meredith Stout: Stone Cold Corpo (`meredith-stout-stone-cold-corpo`) | Unit, Red, RAM 1, cost 4, power 5, Corpo/Militech, not sellable | {Blocker} This Unit has +2 power while fighting a Legend. When a Rival adjusts or swaps 1 or more friendly Gigs, you may add a card from your trash to your hand. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v88-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the trigger `WHEN_RIVAL_CHANGES_FRIENDLY_GIGS`, the effect `MAY_RETURN_TRASH_CARD_TO_HAND`, and the modifier
  `POWER_WHILE_FIGHTING_LEGEND {amount: 2}`. A trigger binding may name `changeEffectId`, the effect that changed the Gig. The trigger
  origin `GIG_CHANGE {subjectIds}`, the continuation's `effectGigChanges` and the turn history's `gigChangeTriggers` mirror Batch V69's
  `SPEND` origin, `effectSpends` and `spendTriggers`.
- A new pin table (`packages/engine/src/gig-change-trigger-support.ts`) owns any card with the trigger, the effect or the modifier.
  Both the play and the trigger gate route such a card there first.
- `noteRivalGigChange` runs after an effect really adjusts a Gig (a Program, or a trigger) and after any swap. Each face-up field
  observer of a player whose Gig changed, other than the effect's controller, binds once per effect. Inside a trigger batch the binding
  joins it, after the batch's earlier effects. Otherwise it waits in the turn history for the action's next batch, or for its end, where
  a `GIG_CHANGE` batch resolves it and returns where a `SPEND` batch would.
- The effect offers "Add no card" or "Add <card> from your trash to your hand" for each card in its controller's trash; with an empty
  trash it does nothing. The non-active player makes this choice in the active player's turn.
- `whileFightingBonus` now takes the opposing card: a pinned field Unit with the modifier adds +2 when that card is a Legend (a
  {Go Solo} Legend on the field). Both fight comparisons and the fight's defeat permission use it.
- Engine identity `0.4.85-spent-look-call-v87` -> `0.4.86-rival-gig-change-v88`.

## Rules readings

- "Adjusts" is rule 6.4 (increase or decrease). Setting a Gig (6.5) is not an adjustment, and a declined "up to" adjustment changes
  nothing, so neither triggers. A swap (6.7) always moves one of each player's Gigs, so a Rival's swap always triggers.
- "1 or more" makes it one trigger per effect, however many friendly Gigs that effect changed.
- "A card" is any card in the controller's trash, Meredith included if she is there by then.

## Tests

`tests/api-admission-batch-v88.test.ts` covers:

- source projection and candidate match;
- the exact pin through the play and trigger gates, rejected by the spend table, with forgeries (no Blocker, no Legend power, a
  Unit-only return, a spend trigger, power, tags, sellable) rejected;
- a Rival's Program increasing her controller's Gig: a `GIG_CHANGE` batch after it, the non-active player choosing a trash card, or
  declining;
- her controller's own adjust, a Rival's adjust of the Rival's own Gig, and a declined adjust, none of which trigger;
- an empty trash;
- a Rival's {Play} adjust joining the `PLAY` batch;
- a Rival's swap triggering her, and her controller's own swap not;
- +2 power when a {Go Solo} Legend attacks her, and none when a Unit does;
- tampered bindings, origins and queues rejected;
- union membership.

The reviewed union is now 138 cards, and coverage is 138/151.
