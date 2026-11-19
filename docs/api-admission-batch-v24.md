# API admission batch V24 (2026-11-19)

Plan section 6, scope 3c. A Unit with a "When this Unit steals a Gig" trigger. This batch adds the steal-trigger
origin that the later steal-trigger cards build on. The card is pinned literally in its engine gate (Cody's exact
per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Maelstrom Goons (`maelstrom-goons`) | Unit, Yellow, 3, power 3 | When this Unit steals a Gig, if it's equipped, a Rival discards 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v24-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (domain):
  - `mechanics.ts`: a new trigger, `WHEN_GIG_STOLEN`, and a new condition, `SUBJECT_IS_EQUIPPED`. The condition
    holds when the subject is face up on the field with at least one attached Gear.
  - `game.ts`: a new trigger origin, `STEAL`, carrying the attacker and the Gigs it stole. A trigger binding may
    name a `gigInstanceId`, and only a steal binding does.
- `combat-resolution.ts`: after the stolen Gigs move (and unless the steal ended the match), steal triggers are
  discovered. If there are any, they resolve as a trigger batch, and the attack ends after them. Otherwise the
  attack ends as before.
- `trigger-queries.ts`: discovery returns one binding per stolen Gig for each "When this Unit steals a Gig"
  ability of the attacker. Each binding names its Gig, and the Gig is part of the pending effect's identity. A
  binding without a Gig hashes exactly as before.
- `trigger-resolution.ts`: a `STEAL` batch returns to the end of the attack. Bindings that tie on source and
  ability are ordered by Gig.
- Validation (`trigger-state.ts`):
  - A `STEAL` batch pauses a Gig-area attack by its own subject.
  - Its Gigs are distinct, sorted, rolled, and in the attacking player's Gig area.
  - Its bindings equal fresh discovery, one per stolen Gig.
  - Every steal binding names one of those Gigs, and no other binding names a Gig.
  - The rival discard may pause for a steal trigger only after the "if it's equipped" condition held.
- Gates:
  - `steal-trigger-support.ts` pins the complete printed shape. `supportsTriggerCard` admits a steal trigger, or
    any use of the equipped condition, only through this pin.
  - The hidden-content discard check accepts the pin.
- Engine identity `0.4.19-gig-swap-v23` -> `0.4.20-steal-triggers-v24`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- 11.5.1.7: effects that trigger when a Gig is stolen become pending after the stolen Gig is moved.
- 11.5.1.6.2 and 10.16.3: Gigs stolen at the same time are separate stolen Gigs, and the trigger becomes pending
  once for each.
- 9.20.2: after stealing, all pending effects resolve, and then the Steal Step and the attack end.
- 10.16.1.1: "if it's equipped" is a condition beyond the trigger. The trigger is pending either way, and the
  condition is checked only when it resolves.
- "A Rival discards 1": the affected Rival chooses the card from their own hand, as in Batch V17. One card is
  discarded automatically, and an empty hand discards nothing.

## Tests

`tests/api-admission-batch-v24.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with single-field forgeries rejected: another trigger, no condition or another condition, an
  own-hand discard, a second effect, inheritance, a keyword, cost, power, tags, colors, sellability and scope.
- Goons equipped with one Gear:
  - steals a Gig, which moves before the trigger is pending;
  - the Rival chooses from their own hand, and a forged option from the attacker's hand is rejected;
  - the discard happens, and then the attack ends and the Main Phase resumes.
- Unequipped Goons: the trigger is pending, the condition fails at resolution, and nobody discards.
- A single card is discarded automatically, and an empty hand discards nothing.
- Goons with power 11 steals 2 Gigs. The trigger is pending twice with distinct identities, and the Rival
  discards twice.
- Forged batches are rejected:
  - a Gig that was not stolen;
  - a subject other than the attacker;
  - a steal binding without its Gig.
- Union membership.

The reviewed union is now 73 cards, and coverage is 73/151.
