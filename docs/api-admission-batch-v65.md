# API admission batch V65 (2026-11-21)

Plan section 6, scope 3c. This batch admits Valentino Guerrera, a Unit with "If you have more ☆ (Street Cred) than a Rival, this
Unit can attack ready Units with {Blocker}." The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Valentino Guerrera (`valentino-guerrera`) | Unit, Red, RAM 2, cost 3, power 4, Ganger/Valentino | If you have more ☆ (Street Cred) than a Rival, this Unit can attack ready Units with {Blocker}. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v65-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the continuous modifier `CAN_ATTACK_READY_BLOCKERS_IF` with the existing condition `STREET_CRED_GREATER_THAN_RIVAL`.
- The card joins the V64 attack-permission pin table.
- Attack targets: while the condition holds, ready rival field Units with an effective {Blocker} join the spent rival Units.
  The condition is checked live, like V64's: if it stops holding before the fight, an attack on a ready Blocker ends
  (9.21.3).
- Blocker eligibility: the Unit being attacked cannot use {Blocker} to redirect the attack to itself. Before this batch an
  attacked Unit was always spent and so could never block, so no earlier position changes.
- Engine identity `0.4.60-lagging-gig-attack-v64` -> `0.4.61-ready-blocker-attack-v65`.

## Rules readings

- Street Cred is the total value of a player's Gigs, compared through the existing Null-aware condition.
- {Blocker} redirects an attack "to it instead" (9.9.1). An attacked Blocker is already the target, so using {Blocker} would
  only spend it and fire its "uses {Blocker}" triggers. That is not offered. Another ready Blocker may still redirect.

## Tests

`tests/api-admission-batch-v65.test.ts` covers source projection and candidate match; the exact pin with forgeries; with more
Street Cred, a ready Blocker (and spent Units) as targets but not a ready non-Blocker, no self-redirect, and the fight
defeating the Blocker; no ready-Blocker target with equal or less Street Cred; another Blocker still redirecting; and union
membership.

The reviewed union is now 115 cards, and coverage is 115/151.
