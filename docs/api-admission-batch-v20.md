# API admission batch V20 (2026-11-19)

Plan section 6, scope 3c. Two Units with a single `{Play}` primitive each. Each card is pinned literally in its
engine gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Hacked Corpo (`hacked-corpo`) | Unit, Blue, 4, power 3 | {Play} Trash 3. Add a Program from among them to your hand. | `COMBAT_TRIGGERS_V1` |
| Valentino Street Racer (`valentino-street-racer`) | Unit, Green, 3, power 3 | {Play} Give another friendly Unit with cost 5 or less {Adrenaline} this turn. | `COMBAT_TRIGGERS_V1` |

Both revisions are authored in `tests/api-admission-batch-v20-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain):
  - `mechanics.ts`: two new effects, `TRASH_THEN_RETURN_PROGRAM` (`count: 3`) and
    `GRANT_KEYWORD_UNTIL_END_OF_TURN` (`keyword: "ADRENALINE"`, target `ANOTHER_FRIENDLY_UNIT` with
    `costAtMost: 5`).
  - `game.ts`: the trigger continuation gains `trashedIds`, the cards the current primitive trashed. The game
    state gains `temporaryKeywords`, each grant with its source, target, end-of-turn expiry and the `{Play}`
    occurrence that made it. New events `KEYWORD_GRANTED` and `KEYWORD_GRANT_EXPIRED`.
  - No new policy or scope.
- Primitives (`play-pin-effects.ts`, run by the PLAY trigger batch in `trigger-resolution.ts`):
  - Trash-3 Program pick: trashes the controller's top card up to 3 times, one at a time. Programs among
    exactly those cards are offered. With none nothing returns, one returns automatically, and more pause for
    a `TARGET` choice. The chosen card moves to hand.
  - Adrenaline grant: the target set is the controller's other face-up field Units with printed cost 5 or
    less. Ready, spent and Lag do not matter. One target is chosen automatically, none means nothing happens,
    and more pause for a `TARGET` choice.
- Keyword grants:
  - `capabilities.ts`: a grant adds its keyword to the target's effective capabilities, with source origin
    `EFFECT`, while the target is a face-up field card and the grant's turn is current. The existing
    Adrenaline attack permission (11.23.2) reads effective keywords, so a lagging target may attack.
  - Expiry: at end of turn (`end-turn.ts`), and when the target leaves the field (`card-movement.ts`,
    `bottom-deck.ts`), because a card that returns is a new object.
  - Observation: `temporaryKeywords` is public.
- Validation:
  - `trigger-state.ts`: each primitive pauses only as its pinned `{Play}` ability in a `PLAY` batch, with
    2 or more strategic targets. A trash pause needs `trashedIds` to be exactly the top of the trash in
    order, fewer than 3 only when the deck is empty, and owned by the controller.
  - `state.ts`: each recorded grant needs a resolved current-turn `{Play}` occurrence of a pinned source and
    a target that is still an eligible friendly face-up field Unit.
- Gates: `play-pin-support.ts` pins both complete printed shapes. `supportsTriggerCard` routes either new
  effect only to this pin. The Adrenaline grant also requires the reviewed Adrenaline policy.
- Engine identity `0.4.15-attack-search-v19` -> `0.4.16-play-pins-v20`. The baselines are regenerated in a
  separate commit.

## Rules readings

- "Trash 3" follows 11.10.2.1, as for All Is Lost (V14): one card at a time, so trash order is deck order.
  With fewer than 3 cards the engine trashes what remains, and the player does not lose. Only drawing from an
  empty deck loses (1.14).
- "Add a Program from among them" is mandatory when a Program was trashed, and only those trashed cards count.
- "Another friendly Unit" excludes Valentino Street Racer itself. "Cost 5 or less" reads the printed cost.
- "This turn" ends at end of turn (8.16.2). The grant does not follow the card out of the field. This reading
  matches how the engine treats temporary power on hidden entry, extended to any departure, since a lagging
  card that returns would enter again.

## Tests

`tests/api-admission-batch-v20.test.ts` covers:

- Source projection and candidate match.
- Both exact pins, with single-field forgeries rejected. These include another trigger, a second effect, a
  Unit pick, cost, power, tags, color, sellability, a condition, an inherited ability and a printed keyword.
- Hacked Corpo:
  - Trashing in deck order, then a choice among the 2 trashed Programs. A forged Unit option and a short
    `trashedIds` are rejected.
  - One Program returns automatically, none returns nothing, and an empty deck trashes nothing without a loss.
- Valentino Street Racer:
  - A lagging Unit cannot attack before the grant and can after it.
  - The options exclude the Racer, a cost 6+ Unit and rival Units. A forged cost 6+ option and a forged grant
    target are rejected.
  - The grant is public, ends when the target leaves the field, and expires at end of turn.
  - A single eligible Unit is chosen automatically, and none means nothing happens.
- Union membership.

The reviewed union is now 67 cards, and coverage is 67/151.
