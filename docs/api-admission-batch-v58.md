# API admission batch V58 (2026-11-20)

Plan section 6, scope 3c. This batch admits Synapse Burnout, a Quick Program that gives a friendly Unit +1 power for each
friendly face-up Legend while it fights rival Units this turn. It adds the engine's first power that applies only while
fighting (11.4.2.1). The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Synapse Burnout (`synapse-burnout`) | Program, Green, 1, RAM 1, Quickhack, sellable | {Quick} A friendly Unit has +1 power for each friendly face-up Legend while fighting rival Units this turn. | `COMBAT_REACT_V1` |

The revision is authored in `tests/api-admission-batch-v58-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `mechanics.ts` adds the effect `FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN` (a friendly Unit, +1).
  `game.ts` adds `fightPowerGrants`: one record per resolved effect, naming its target, source, controller and turn.
- New `fight-power-grant-support.ts` pins the whole Program. The play gate routes it there; the trigger, effect and React
  gates refuse it, so its Quick play goes only through the pin.
- New `fight-power-grant.ts`: the effect chooses a current friendly field Unit (one is forced, none does nothing) and
  records the grant. Grants end at the end of the turn and when the Unit leaves the field, and `validateFightPowerGrants`
  checks each one's Program, turn and target.
- `evaluateFight` adds the bonus to the granted Unit's power before the comparison, counting the controller's face-up
  Legends (Legends area and field Legends) when the fight is calculated. Effective power elsewhere, such as Gig steals, does
  not change.
- Engine identity `0.4.53-steal-fewer-v57` -> `0.4.54-fight-power-v58`.

## Rules readings

- "While fighting" applies only to the fight's power comparison (11.4.2.1). Every fight is against a rival's Unit, so the
  grant applies to every fight of that Unit this turn, attacking or defending.
- The Legend count is taken when the fight is calculated, not when the Program resolves, so a Legend called or flipped in
  between counts. A field Legend counts too, including the granted Unit itself if it is one.
- The grant is public, but the model observation does not show it yet; adding it is a wire change for a later batch.

## Tests

`tests/api-admission-batch-v58.test.ts` covers source projection and candidate match; the exact pin with forgeries (not
Quick, also Blocker, a second effect, a condition, cost, RAM, tags, unsellable) and the refusing gates; an attack where a
power-6 Unit beats a power-8 Unit with 3 face-up Legends, ties with 2 and still loses with 1 (face-down Legends do not count),
with no change to effective power outside the fight; a choice between two friendly Units that ends with the turn; a React
play on the rival's turn that lets the defending Unit win; the grant ending when its Unit leaves; forged targets and turns;
and union membership.

The reviewed union is now 107 cards, and coverage is 107/151.
