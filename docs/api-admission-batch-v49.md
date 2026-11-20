# API admission batch V49 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Unit with a paid Quick activation and a first-steal trigger. It is one of
the cards named in Cody's quiz set that the assistant thread asked for first (2026-11-20). It adds the engine's first
activation with an Eddie cost, its first activation taken as a reaction (9.10, 11.30.1), and its first power loss scaled by
another card's power. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Rogue Amendiares: Queen of the Afterlife (`rogue-amendiares-queen-of-the-afterlife`) | Unit, Blue, 5, power 4, Fixer/Merc, unsellable | The first time another friendly Unit steals a Gig with value less than its power each turn, ready 2 Eddies. {Quick} 2 €$, {Spend} A rival Unit loses power equal to this Unit's power this turn. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v49-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`. The printed Quick is carried by the
activation's timing, not by a card keyword: Quick on a Program is a play permission, and this Quick belongs to one effect.

## Engine change

- Grammar:
  - `mechanics.ts` lets an activation's timing be `QUICK`, adds the guard `FIRST_OTHER_FRIENDLY_STEAL_BELOW_POWER_PER_TURN`
    for the friendly-steal trigger, and adds `scale: "SOURCE_POWER"` to `POWER_UNTIL_END_OF_TURN` (the amount, -1, is
    multiplied by the source's power).
  - `game.ts` adds a temporary power modifier scaled by `SOURCE_POWER`, whose origin is the activation's effect id and the
    event sequence it was activated at (repeated activations in one turn share the effect id), and the turn history
    `belowPowerSteals`.
- `quick-activation-support.ts` adds a new pin table, `QUICK_ACTIVATION_SHAPES`, which pins the whole Unit. The play and
  trigger gates route any Quick activation, paid activation, power scale or the new guard to it first. The Call and field
  Legend gates refuse it, and the delayed-effect and end-turn metadata checks defer its "ready 2 Eddies" to it.
- Activation:
  - `canActivate` offers a Quick activation in its controller's MAIN and in its controller's React Step, on a ready,
    non-lagging, face-up field Unit (8.14.1), only when the Eddie cost can be paid.
  - The React Step lists it after Quick Programs and before Blockers.
  - `activateAbility` spends the source, then for a paid activation pauses for payment with the existing payment choice,
    returning afterwards to the decision it was taken from. Kerry's unpaid activation is byte-identical.
  - The activation resolves its own ability rather than the card's first one.
  - `quick-activation.ts` validates the paused activation: its spent field source, the window, the exact payment, and the
    rival-Unit choice that pauses only with 2 or more rival Units.
- Power loss: the source's power is read as the effect resolves; a source with no positive power makes no modifier. The
  modifier lasts the turn, and its validator recomputes the activation's effect id.
- First steal:
  - Content-gated history: when the content holds the pinned card, each Unit's steal (Steal Step or effect steal) of a Gig
    with value less than its power, read before the Gig moves, is recorded for its controller, at most once per stealer
    and at most twice a turn: the first such steal, and the first by a different Unit. No other content records it, so
    no existing replay changes.
  - An observer fires on the first record unless it made it, and then on the second. It must be on its controller's field.
  - "Ready 2 Eddies" uses the existing ready primitive; a choice among 3 or more spent Eddies may now pause in a steal batch.
- `compareTemporaryPower` orders same-effect modifiers by their sequence.
- Engine identity `0.4.44-free-play-v48` -> `0.4.45-quick-activation-v49`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- 9.10 and 11.30.1: Quick lets the effect also be activated as a reaction to a rival Unit's attack; it can still be
  activated in its controller's MAIN.
- The costs are paid together: Rogue is spent and 2 Eddies are paid. Rogue cannot activate while lagging (8.14.1) or spent.
- "Loses power equal to this Unit's power": Rogue's power when the effect resolves, normally 4. The loss lasts the turn.
- "The first time another friendly Unit steals ... each turn": counted per turn and per controller, whether or not Rogue was
  on the field at the first steal (like the first-attack history). A steal by Rogue itself is not "another" Unit's, so for
  Rogue the first steal by a different Unit counts instead.
- "A Gig with value less than its power": the Gig's value against the stealer's power as the steal begins, before any Gig
  moves.

## Tests

`tests/api-admission-batch-v49.test.ts` covers:

- Source projection and candidate match.
- The exact pin, accepted by the play and trigger gates and refused by the Call and field Legend gates, with forgeries
  rejected: main timing, cheaper, no spend, unscaled, friendly target, any steal, ready 1, no trigger, a condition, power,
  cost, sellable, tags or a Quick keyword.
- As a reaction to Octant attacking a spent Psycho Squad: pay 2, spend Rogue, Octant drops to 4 and loses the fight; the
  activation returns to the React Step; the loss ends with the turn.
- In MAIN with two rival Units: the payment and target pauses validate, forged pauses are refused, and the chosen Unit
  loses 4.
- No activation while lagging, spent or unable to pay. A readied Rogue activates again as a distinct occurrence; a
  duplicated or retargeted modifier is refused.
- Psycho Squad's below-power steal readies 2 Eddies; Emergency Atlus' later one does not.
- Rogue's own steal does not count; Psycho Squad's next one does.
- A steal of a Gig worth the stealer's power is not recorded; the next qualifying steal is the first.
- Without the card the history is never recorded and a forged one is refused; duplicated or misattributed records are
  refused.
- Union membership.

The reviewed union is now 98 cards, and coverage is 98/151.
