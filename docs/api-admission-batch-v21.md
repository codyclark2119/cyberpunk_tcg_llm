# API admission batch V21 (2026-11-19)

Plan section 6, scope 3c. Two Units whose `{Play}` restricts rival stealing until their controller's next turn.
Each card is pinned literally in the `{Play}` pin table (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Chrome Fang (`chrome-fang`) | Unit, Red, 5, power 6 | {Play} Until your next turn, rival Units can't steal friendly Gigs with value higher than their power. | `COMBAT_TRIGGERS_V1` |
| Westbrook Netrunner (`westbrook-netrunner`) | Unit, Blue, 4, power 5 | {Play} Until your next turn, rival Legends can't steal friendly Gigs with value less than their power. | `COMBAT_TRIGGERS_V1` |

Both revisions are authored in `tests/api-admission-batch-v21-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain):
  - `mechanics.ts`: a new effect, `RESTRICT_RIVAL_GIG_STEAL`, with `actor` (`UNIT` or `LEGEND`), `forbidden`
    (`VALUE_ABOVE_POWER` or `VALUE_BELOW_POWER`) and `duration: "UNTIL_YOUR_NEXT_TURN"`.
  - `game.ts`: the game state gains `gigStealRestrictions`. Each records its actor and comparison, its source,
    the protected player, the turn it was made and the `{Play}` occurrence that made it. New events
    `GIG_STEAL_RESTRICTED` and `GIG_STEAL_RESTRICTION_EXPIRED`.
  - No new policy or scope.
- Primitive (`play-pin-effects.ts`, run by the PLAY trigger batch in `trigger-resolution.ts`): records the
  restriction at once. There is no choice.
- Stealing (`combat-outcome-queries.ts`, `combat-resolution.ts`, `combat-outcome-state.ts`): a new
  `stealableGigsFor` filters the defender's rolled Gigs by every restriction protecting the defender that
  matches the attacker's effective types, comparing each Gig's current value with the attacker's effective
  power. The steal count, the forced steal, the `STEAL_GIGS` choice and its validation all use it.
- Expiry: in the protected player's next Start Phase, after the 8.6.1 Gig check and before readying
  (`turn.ts`, 8.6.2.1). The restriction does not depend on its source staying on the field.
- Observation: `gigStealRestrictions` is public, with the protected player as a seat.
- Validation (`state.ts`): restrictions are unique and ordered. Each needs a pinned source ability and a
  resolved `{Play}` occurrence whose id is recomputed at its creation turn. It lives on its own turn and the
  rival's turn. On the protected player's next turn it may exist only at `TURN_START` (before 8.6.2.1) or
  in a game that ended there.
- Gates: `play-pin-support.ts` pins both complete printed shapes. `hasPinnedPlayEffect` routes the new effect
  to that pin.
- Engine identity `0.4.16-play-pins-v20` -> `0.4.17-steal-restrictions-v21`. The baselines are regenerated in
  a separate commit.

## Rules readings

- "Can't steal" restricts the actor's ability to steal, so it applies before Gigs are selected (11.5.1.3).
  A restricted Gig is never offered and does not count toward 9.20.1.3: an attacker with allowance 1 and only
  restricted Gigs steals nothing. The alternative reading, select and then fail to steal (11.5.1.5), was not
  taken because that rule covers effects on a selected Gig ("would be stolen"), not a restriction on the actor.
- "Their power" is the attacker's effective power at the Steal Step. "Higher than" and "less than" are strict,
  so a Gig equal to that power can be stolen.
- A Legend on the field is also a Unit there (`effectiveCardTypes`), so Chrome Fang restricts a Go Solo
  Legend too, while Westbrook Netrunner restricts only Legends.
- "Until your next turn" ends at the start of that turn (8.6.2.1). The attack can still be declared, since
  the Gig area stays a valid target (9.3.2).

## Tests

`tests/api-admission-batch-v21.test.ts` covers:

- Source projection and candidate match.
- Both exact pins, with single-field forgeries rejected. These include the swapped actor or comparison,
  another trigger, a second effect, cost, power, tags, color, sellability, a condition, an inherited ability
  and a keyword.
- Chrome Fang:
  - The restriction is public and lasts into the rival's turn. A rival Unit's steal choice offers only Gigs
    at or below its power, and a forged restricted option is rejected.
  - A Gig equal to the attacker's power can be stolen. The restriction expires at the start of its
    controller's next turn, with an event.
  - With only higher Gigs nothing is stolen. Forged restrictions (wrong creation turn, wrong protected
    player, wrong actor, stale) are rejected.
  - A Go Solo Legend is restricted as a Unit.
- Westbrook Netrunner: after Adam Smasher's `{Play}` defeats it, the restriction still holds. A rival Legend
  is offered only Gigs at or above its power, and a rival Unit that is not a Legend is unaffected.
- Union membership.

The reviewed union is now 69 cards, and coverage is 69/151.
