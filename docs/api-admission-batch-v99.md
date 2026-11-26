# API admission batch V99 (2026-11-26)

Plan section 6, bundle 15. This batch admits Alt Cunningham: Mother of Daemons, a Unit that draws when a friendly equipped Unit or
Legend is spent, and lets its controller discard a card to stop a rival Unit stealing a Gig. The card is pinned literally in its engine
gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Alt Cunningham: Mother of Daemons (`alt-cunningham-mother-of-daemons`) | Unit, Yellow, cost 7, power 8, RAM 3, Merc, Netrunner, not sellable | When a friendly equipped Unit or Legend is spent, draw 1. When a rival Unit would steal a Gig, you may discard 1 with cost equal to that Gig's value. If you do, the Gig isn't stolen. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v99-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the guard `FRIENDLY_EQUIPPED_UNIT_OR_LEGEND_SPENT` (with `WHEN_SPENT`), the modifier
  `MAY_DISCARD_GIG_VALUE_COST_TO_PREVENT_RIVAL_STEAL`, the turn-history field `equippedSpends`, the Steal Step continuation field
  `prevention` (and `remaining` may be 0 with it), the trigger continuation field `stealPrevention`, and the events
  `GIG_STEAL_PREVENTED` and `GIG_STEAL_PREVENTION_DECLINED`.
- The card is a row in the spend-trigger pin table (`spend-trigger-support.ts`).
- The draw: when a card is turned spent while it is a face-up equipped Unit on the field or a face-up equipped Legend, each face-up
  field observer of its controller (Alt itself included) binds once, with the spent card as subject. The spend is recorded in
  `equippedSpends`, which the binding validators check. The bindings join batches as the other "when spent" bindings do (batch V69).
- The prevention (`packages/engine/src/steal-prevention.ts`): before a Gig moves, for each Gig a rival Unit would steal, in id order,
  its controller is offered "Let the Gig be stolen" or each hand card whose printed cost equals the Gig's value, while they control a
  face-up Alt on the field. A discard puts the card in the trash, and that Gig is not stolen (and counts as no steal). The offer is
  made only when such a card is in hand, and once per Gig however many sources there are.
- Both steal paths offer it: the Steal Step, after every Gig is selected (combat stage `GIG_STEAL_SELECTION`, the defender acting),
  and an effect steal in a trigger batch (Gorilla Arms' extra steal, a next-fight steal), after its Gig is chosen or forced.
- Validation of both pauses, the defender as the acting player, and the modifier allowed in characteristics and the keyword view.
- Labels for the offer's options. The observation's Steal Step `remaining` may be 0.
- Engine identity `0.4.96-inherited-gear-defeat-v98` -> `0.4.97-steal-prevention-v99`.

## Rules readings (to review)

- The offer pauses only when the defending player holds a card of the Gig's value, so the pause shows the attacker that they do.
  Offering an empty choice every time would hide this but add a forced decision to every steal against Alt.
- "Rival Unit" is any face-up card the engine treats as a Unit, so a field Legend that attacks counts.
- A prevented Gig is not replaced by another one: the attacker steals fewer Gigs.

## Tests

`tests/api-admission-batch-v99.test.ts` covers:

- source projection and candidate match;
- the exact pin through the spend-trigger gate and `supportsPlay`, with forgeries (no prevention, no guard, the first-spend guard,
  draw 2, power) rejected;
- an equipped friendly Unit's attack draws 1 and records the spend; an unequipped Unit's does not;
- Alt itself draws only while equipped;
- a rival attack's steal offered to the defender (only the matching card, labels, a forged acting player rejected), the discard keeping
  the Gig;
- the decline, no matching card, and no Alt;
- Gorilla Arms' extra steal offered in its trigger batch (a forged pause without `stealPrevention` rejected), prevented by a discard.

The reviewed union is now 149 cards, and coverage is 149/151.
