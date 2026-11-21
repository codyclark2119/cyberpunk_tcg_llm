# API admission batch V70 (2026-11-21)

Plan section 6, scope 3c. This batch admits Tetratronic Rippler, a Gear whose host inherits "When this Unit or Legend is spent,
search the top card of your deck. You may trash it. (Otherwise, keep it on the top of your deck.)" It builds on the V69 "when
spent" trigger. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Tetratronic Rippler (`tetratronic-rippler`) | Gear, Blue, RAM 2, cost 1, power 1, Cyberware, sellable | (Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is spent, search the top card of your deck. You may trash it. (Otherwise, keep it on the top of your deck.) | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v70-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `SEARCH_TOP_MAY_TRASH` (`count: 1`).
- Resolution in a trigger batch: the controller's top card goes into the search continuation, which the observation layer
  already shows only to the searching player. The choice is "keep it on top" or the card itself (trash it). Trashing makes it
  public. An empty deck does nothing.
- The spend-trigger pin table gains Rippler's shape.
- Validators: the pause holds the controller's current top card, for a `WHEN_SPENT` trigger, with the controller acting. The
  trigger-state continuation check and the search-state router accept this search.
- The exact-capture checks for attack and Steal Step batches now skip recorded "when spent" bindings, which V69 validates on their
  own (V69 did this for the Blocker batch). A paused attack batch holding a spend trigger reaches these checks for the first time
  here.
- Choice labels read "Trash ... from the top of your deck" and "Keep it on the top of your deck".
- Engine identity `0.4.65-spend-triggers-v69` -> `0.4.66-spend-search-top-v70`.

## Rules readings

- "Search the top card" is a private look (11.17): only the controller sees the card, and the choice itself is a pause even with
  one card, since keeping and trashing are both legal.
- Rippler is now also a Cyberware Gear with cost 2 or less for Viktor Vektor: You Might Feel a Little Pinch (V68). As a blue Gear,
  its free play counts toward the first-blue-play history.

## Tests

`tests/api-admission-batch-v70.test.ts` covers source projection and candidate match; the exact pin with forgeries; an attacking
host's spend pausing for the controller's keep-or-trash choice, with the card visible only to the controller, then trashing it or
keeping it on top; nothing with an empty deck; and union membership.

The reviewed union is now 120 cards, and coverage is 120/151.
