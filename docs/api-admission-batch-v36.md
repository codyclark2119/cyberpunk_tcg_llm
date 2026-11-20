# API admission batch V36 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Program that searches the top 3 cards of its controller's deck. The
controller adds 1 to hand, may add 1 more for each friendly min Gig, and bottom-decks the rest. It is the first Program
whose resolution searches the deck. The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Three Mouths One Desire (`three-mouths-one-desire`) | Program, Blue, 2 | Search the top 3 cards of your deck. Add 1 to your hand. You may add 1 more for each friendly min Gig. Bottom-deck the rest. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v36-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`): a new effect, `SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG` with `count` 3.
- `effects.ts`:
  - The Program's handler opens the search continuation over the top 3 cards. Its choices pause the play
    continuation.
  - The search takes one card at a time, up to 1 plus the number of friendly min Gigs, then bottom-decks the rest in
    a seeded random order, as the V19 search does.
  - Taken cards are added without a reveal, because the text says "add", not "reveal".
  - A lone mandatory card is taken without a choice.
- `search-state.ts`:
  - Every looked-at card is eligible.
  - `MODE DONE` is offered only after the first card.
  - A new validator checks the resolving Program source, the looked-at cards, the bound and the exact choice.
- `play.ts` and `play-state.ts`: `continuePlay` hands search choices to the search continuation and completes the
  primitive when it closes. The Program validator accepts the search as a pausing primitive and leaves its choice to the
  search validator.
- Gate (`program-search-support.ts`): the whole printed Program is pinned. `supportsPlay` delegates to it.
- Engine identity `0.4.31-gig-cost-search-v35` -> `0.4.32-program-search-v36`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "Friendly min Gig": a Gig in the controller's own Gig area at its lowest value, which is 1 for every Gig die (6.3.1).
  A Rival's min Gig does not count. The count is read during resolution.
- "Add 1 to your hand": mandatory, and any looked-at card qualifies. There is no criterion to fail to find
  (11.17.4.1 covers searches for specific targets only).
- "You may add 1 more for each friendly min Gig": optional, so the controller may stop after the first card.
- "Bottom-deck the rest": every looked-at card not taken. With fewer than 3 cards in the deck, the search covers what
  is there (11.17.3), and an empty deck adds nothing.

## Tests

`tests/api-admission-batch-v36.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - a Gear search, a second effect, a condition, or the trigger scope;
  - cost, tags, a keyword or sellability.
- With no friendly min Gig (a Rival's 1 does not count):
  - all 3 cards are offered without `DONE`, and a forged `DONE` is rejected;
  - the taken card is not revealed, the other 2 are bottom-decked, and the Program is trashed.
- With two friendly min Gigs, up to 3 are taken one at a time, `DONE` is offered after the first, and a forged
  held card is rejected. Stopping after one bottom-decks the other 2.
- A lone card is taken without a choice, and an empty deck adds nothing.
- Union membership.

The reviewed union is now 85 cards, and coverage is 85/151.
