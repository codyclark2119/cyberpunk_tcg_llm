# API admission batch V93 (2026-11-25)

Plan section 6, bundle 14. This batch admits The Heist, a Program that trashes 4 cards, adds a Gear from among them to its
controller's hand, and may play that Gear for free instead. It is the engine's first card played from the trash by a Program. The card
is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| The Heist (`the-heist`) | Program, Yellow, RAM 2, cost 2, Merc, sellable | Trash 4. Add a Gear from among them to your hand. If that Gear's cost equals the value of a friendly Gig, you may play it for free instead. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v93-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `TRASH_THEN_ADD_GEAR_MAY_PLAY_IF_GIG_COST {count: 4}`, the play continuation field `trashedGearId` (the chosen
  Gear while hand or a host is chosen), and `trashedIds` widened from at most 3 to at most 4 cards.
- A new pin table (`packages/engine/src/trash-gear.ts`) owns any card with the effect; the play gate routes it there first and the
  trigger gate refuses it.
- The effect trashes the top 4 cards one at a time (an empty deck stops it, 11.10.2.1.1). The Gear among them that are still face up
  in the trash are offered; a lone Gear is taken without a choice, and with none nothing is added.
- The chosen Gear goes to hand, unless its printed cost equals the current value of one of its controller's rolled Gigs, the engine can
  play it and it has a legal host. Then its controller chooses "add it to your hand" or a host. Playing it equips it from the trash,
  readies it and counts it as played (11.20.2), with no payment.
- A played Gear's own play batch starts after the Program has gone to the trash (the Batch V92 `playedGearId` path, now shared by both
  continuations).
- Engine identity `0.4.90-hand-gear-play-v92` -> `0.4.91-trash-gear-v93`.

## Rules readings

- "Add a Gear from among them" is mandatory when one was trashed; the trashed cards are public, so there is nothing hidden to fail to
  find.
- "That Gear's cost" is its printed cost; "the value of a friendly Gig" is any one rolled Gig the controller controls.
- None of the snapshot's Gear has a {Play} ability; one would only be added to hand.

## Tests

`tests/api-admission-batch-v93.test.ts` covers:

- source projection and candidate match;
- the exact pin through the play gate (the trigger gate refuses it), with forgeries (cost, Quick, effect, tags, colors, scope) rejected;
- two trashed Gear with no matching Gig: the chosen one goes to hand and the rest stay trashed;
- a Gear matching a friendly Gig: the hand-or-host choice with its labels; playing it for free onto the chosen host, or adding it to hand;
- a lone unplayable Gear goes to hand without a choice; no Gear adds nothing; a 2-card deck trashes 2;
- a blue Gear played for free starts its own play batch (a first-blue-play Legend) after the Program has resolved;
- forged held and played Gear states rejected.

The reviewed union is now 143 cards, and coverage is 143/151.
