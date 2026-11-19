# API admission batch V17 (2026-11-18)

Plan section 6, scope 3c. Two printed Blocker Units whose ability triggers "When this Unit uses [Blocker]".
Each card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| La Llorona: Ghost of the Past (`la-llorona-ghost-of-the-past`) | Unit, Red, 3, power 3 | [Blocker]. When this Unit uses [Blocker], increase a Gig by up to 3. | `COMBAT_TRIGGERS_V1` |
| Augmented Negotiators (`augmented-negotiators`) | Unit, Yellow, 3, power 2 | [Blocker]. When this Unit uses [Blocker], a Rival discards 1. | `COMBAT_TRIGGERS_V1` |

Both revisions are authored in `tests/api-admission-batch-v17-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain):
  - `mechanics.ts`: a new trigger, `WHEN_BLOCKER_USED`. `DISCARD_CARDS` gains `player: "RIVAL"`.
  - `game.ts`: a new trigger origin, `BLOCK`, whose subject is the blocking Unit. The binding kind gains
    `WHEN_BLOCKER_USED`.
  - No new policy or scope.
- Declaring a Blocker (`rival-reactions.ts`): after the attack is redirected, a `BLOCK` trigger batch begins
  when the blocking Unit has a Blocker-used ability. Otherwise the path is unchanged.
- Trigger flow:
  - `trigger-queries.ts`: discovery takes only the blocking Unit's own Blocker-used abilities.
  - `trigger-resolution.ts`: when the batch finishes, the attack returns to the React Step, which reopens
    for the defending player.
- Rival discard:
  - `discard.ts`, `trigger-queries.ts`, `trigger-resolution.ts`: the affected player is the controller's
    rival. That player makes the `DISCARD` choice from their own hand. One card is discarded
    automatically, and an empty hand discards nothing.
- Validation (`trigger-state.ts`):
  - A `BLOCK` batch requires the spent blocking Unit to be the current defending Unit.
  - Every Blocker-used binding must be captured once.
  - The rival discard may pause only as the reviewed unconditional Blocker-used ability.
- Gates:
  - `blocker-trigger-support.ts` pins both complete printed shapes: type, cost, power, colors, RAM, tags,
    sellability, the printed `BLOCKER` keyword and the one ability. `supportsTriggerCard` accepts a keyword
    card only through this pin.
  - `value-conditions-support.ts`: a Blocker-used Gig increase is not value-condition metadata.
  - `ordered-effects-support.ts`: the rival discard is accepted by its own pin.
- Engine identity `0.4.12-cost-reduction-v16` -> `0.4.13-blocker-used-v17`. The baselines are regenerated
  in a separate commit.

## Rules readings

- 9.11: "If a reaction triggers one or more effects, those effects become pending. Both players must
  resolve all pending effects before the defending player may take another reaction." The batch resolves
  in full, then the React Step reopens. The attacker and target are rechecked as for every reaction.
- 9.9.1 and 11.28.3: the Blocker becomes the defending Unit before its ability resolves.
- "Increase a Gig by up to 3": any rolled Gig, either player's, by 0 to 3, never above the die's maximum.
  This is the same choice as the existing reviewed increase.
- "A Rival discards 1": in a two-player game the Rival is the attacking player. The affected player chooses
  the card (`CHOSEN_BY_AFFECTED_PLAYER`, as for every reviewed discard), so the blocking player never sees
  that hand.
- The trigger is the Blocker's own ability. Another Unit blocking, or La Llorona being attacked without
  blocking, triggers nothing.

## Tests

`tests/api-admission-batch-v17.test.ts` covers:

- Source projection and candidate match.
- Both exact pins, with single-field forgeries rejected. These include another trigger, a missing or extra
  keyword, cost, power, tags, sellability, a second effect, an inherited ability, a larger or decreasing
  adjustment, and an own-hand discard.
- La Llorona blocking:
  - The defending player chooses the attacker's Gig and +3. A forged +4 is rejected.
  - The React Step reopens with the blocker as the target.
  - A single Gig at its maximum resolves automatically at +0.
  - A vanilla Blocker creates no pending effect.
- Augmented Negotiators blocking:
  - The attacking player chooses which of their own cards to discard. A forged option from the defender's
    hand is rejected.
  - One card is discarded automatically, and an empty hand discards nothing.
- Union membership.

The reviewed union is now 63 cards, and coverage is 63/151.
