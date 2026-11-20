# API admission batch V26 (2026-11-19)

Plan section 6, scope 3c. A Unit that watches friendly steals: "When a friendly Unit steals a d6". It is built
on the Batch V24 steal-trigger origin. The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| 6th Street Recruits (`6th-street-recruits`) | Unit, Red, 4, power 6 | When a friendly Unit steals a d6, increase a Gig by up to 6. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v26-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (domain):
  - `mechanics.ts`: a new trigger, `WHEN_FRIENDLY_UNIT_STEALS_GIG`, and a new ability guard, `STOLEN_GIG_IS_D6`.
    `ADJUST_GIG_UP_TO.maximum` may be 6.
  - `game.ts`: the binding kind enum gains the new trigger.
- `trigger-queries.ts`: for each stolen Gig, discovery adds a binding for every face-up field source of the
  stealing Unit's controller with this trigger, when the stolen die is a d6. The stealing Unit is included. The
  binding names the Gig, as in Batch V24.
- `trigger-state.ts`: such a binding is valid only in a `STEAL` batch. Its source must be on the field and
  controlled by the stealing Unit's controller, it must carry the d6 guard, and the Gig it names must be a stolen
  d6.
- The increase uses the existing triggered Gig adjustment. The controller chooses any rolled Gig in a Gig area,
  then an amount from 0 up to 6, capped by the die's faces. A single Gig is forced.
- Gates:
  - `steal-trigger-support.ts` adds the complete Recruits shape, including its trigger and guard. Any use of the
    trigger or guard is admitted only through this pin.
  - The value-condition hidden-content check no longer claims this increase.
- Engine identity `0.4.21-steal-ready-v25` -> `0.4.22-friendly-steal-v26`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "A friendly Unit" includes Recruits itself, because the card does not say "another".
  A rival's steal never triggers it.
- "Steals a d6" is the trigger condition, so it is checked when the trigger would become pending (10.16.1). Each
  stolen d6 is a separate trigger (10.16.3), and the trigger becomes pending after the move (11.5.1.7).
- "A Gig" is any Gig, friendly or rival, as with Batch V17's La Llorona. The increase may be 0, and a Gig at its
  maximum offers only 0.
- When the stealing Unit has its own steal trigger (Batch V24 and V25), both triggers are pending at once, and
  their controller orders them (10.16.2).

## Tests

`tests/api-admission-batch-v26.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with single-field forgeries rejected: an own-steal trigger, no d6 guard, maximum 4, a decrease,
  a second effect, inheritance, cost, power, tags, sellability, and the guard on another card's ability.
- A friendly Unit steals the rival's d6 (chosen over a d8):
  - Recruits' controller chooses among all three Gigs, then an amount from 0 to 6;
  - a forged 7 is rejected;
  - the chosen Gig rises by 6, and the attack ends.
- A d6 at 3 offers 0 to 3. Stealing a d8 triggers nothing, and a rival's Recruits never triggers.
- Recruits stealing a d6 triggers its own ability.
- Wraith Marauders stealing a d6 next to Recruits: both triggers are pending, the controller orders them, and both
  resolve.
- A forged binding for a stolen d8 is rejected.
- Union membership.

The reviewed union is now 75 cards, and coverage is 75/151.
