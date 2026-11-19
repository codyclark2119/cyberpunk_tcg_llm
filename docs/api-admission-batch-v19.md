# API admission batch V19 (2026-11-19)

Plan section 6, scope 3c. A Unit whose [Attack] ability searches the top of its controller's deck for a
Gear. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Sketchy Ripper (`sketchy-ripper`) | Unit, Yellow, 2, power 0 | [Attack] Search the top 3 cards of your deck. Reveal a Gear and add it to your hand. Bottom-deck the rest. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v19-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): `SEARCH_GEAR.maxCost` becomes optional. Absent means "a Gear" with no
  cost limit. The reviewed Call search keeps its explicit limit.
- The search inside an attack trigger batch:
  - `trigger-resolution.ts`: the pending search records the looked-at cards and pauses for the attacking
    player's choice. Choosing a Gear, or taking none, finishes the search through the reviewed Call-search
    completion: the Gear is revealed into hand, and the rest are bottom-decked in seeded random order. The
    attack then continues.
  - `trigger-queries.ts`: the choice offers "take none" and each looked-at Gear.
- Validation:
  - `search-state.ts`: an attack search must be the attacking Unit's own pinned ability, current in its
    `ATTACK` batch. The looked-at cards are the current top of the deck, and every option is a looked-at Gear.
  - `trigger-state.ts`: a search continuation exists exactly while that search is current.
  - `action-return.ts`: the search belongs to its trigger batch.
- Gates: `attack-search-support.ts` pins the complete printed shape (type, colors, RAM, tags, cost, power,
  sellability, keywords, and the single ability with its trigger, count and take). `supportsTriggerCard` admits
  any Gear-search ability only through this pin.
- Choice labels: "Reveal and take" a Gear, or "Take no Gear".
- Engine identity `0.4.14-go-solo-play-v18` -> `0.4.15-attack-search-v19`. The baselines are regenerated in a
  separate commit.

## Rules readings

- 11.17.1.1: "Search 3" looks at the top 3 cards. 11.17.3: with fewer cards, it looks at as many as there are.
- 11.17.4.1: a hidden search may purposely fail to find, and the rule's own example is this card's text. The
  player may therefore take no Gear even when one is there.
- "Bottom-deck the rest": every looked-at card not taken goes to the bottom, including all three when none
  is taken. The order is seeded random, as for the reviewed Call search.
- Only the searching player sees the looked-at cards. The taken Gear is revealed. A search that finds no Gear
  ends without a choice and reveals nothing, as for the reviewed Call search.
- Power 0: "Units with power 0 don't steal Gigs" is reminder text for the existing combat rule.

## Tests

`tests/api-admission-batch-v19.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with single-field forgeries rejected: another trigger, count, take, a cost cap, a second
  effect, a condition, a keyword, cost, power, tags, sellability and an inherited ability.
- Attacking with two Gears among the top 3:
  - The attacking player chooses among only the looked-at Gears, or none.
  - Only that player's observation shows the looked-at cards.
  - A forged option for a looked-at Unit is rejected.
  - The chosen Gear is revealed into hand, the unlooked deck moves up, and the other two go to the bottom.
  - The attack continues to the Rival's React Step.
- Taking no Gear bottom-decks all three. With no Gear, there is no choice, and nothing is revealed.
- Union membership.

The reviewed union is now 65 cards, and coverage is 65/151.
