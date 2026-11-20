# API admission batch V35 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Unit whose {Play} searches the top 4 cards of its controller's deck. The
controller adds any number of them whose cost equals a friendly Gig's value, and bottom-decks the rest. The card is
pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Hanako Arasaka: In a Gilded Cage (`hanako-arasaka-in-a-gilded-cage`) | Unit, Yellow, 4, power 1 | {Play} Search the top 4 cards of your deck. Reveal any number of cards with cost equal to any friendly Gig values and add them to your hand. Bottom-deck the rest. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v35-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`): a new effect, `SEARCH_COST_MATCHING_GIGS` with `count` 4.
- `search-state.ts`:
  - The search reuses the reviewed V19 primitive: a private look, then a reveal of each taken card, then the rest
    bottom-decked in a seeded random order.
  - `isSearchEffect` and `searchMaxTake` cover both searches. "Any number" lets every looked-at card be taken.
  - The selector keeps looked-at cards whose printed Eddie cost equals the value of one of the controller's own
    rolled Gigs.
  - The trigger-search validator accepts the new search only for its own PLAY occurrence and pinned source.
- Resolution and choices (`trigger-resolution.ts`, `trigger-queries.ts`):
  - The V19 begin and continue paths serve both searches.
  - The controller takes one card at a time, or finishes with `MODE DONE`.
  - With no eligible card left, the search finishes.
- Validation (`trigger-state.ts`): the search continuation exists only for a current search effect. The new search
  pauses only in its own PLAY batch.
- Gate (`gig-search-support.ts`): the whole printed Unit is pinned. `supportsTriggerCard` delegates to it.
- Engine identity `0.4.30-gear-defeat-draw-v34` -> `0.4.31-gig-cost-search-v35`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "Cost equal to any friendly Gig values": a card's printed cost against the Gigs in the controller's own Gig area
  (6.1.2). A Rival's Gig does not count, and a card with no Eddie cost never matches.
- "Reveal any number": taking none is allowed (11.17.4.1, a hidden search may fail to find). Taken cards are revealed.
- "Bottom-deck the rest": every looked-at card not taken, in random order. With no eligible card there is no choice,
  and all 4 are bottom-decked.

## Tests

`tests/api-admission-batch-v35.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - a Gear search, an attack trigger, a condition, or a second ability;
  - cost, power, tags, a keyword or sellability.
- {Play} with a friendly 3 and 4 and a rival 2:
  - only the cost-3 and cost-4 cards are offered, and a forged cost-2 option or held selection is rejected;
  - after one is taken the other is still offered;
  - both are revealed into hand, and the other two go to the bottom.
- Stopping after one, or taking none, bottom-decks the rest. With no match, there is no choice and all 4 are
  bottom-decked.
- Union membership.

The reviewed union is now 84 cards, and coverage is 84/151.
