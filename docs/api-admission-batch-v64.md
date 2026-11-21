# API admission batch V64 (2026-11-21)

Plan section 6, scope 3c. This batch admits Nadia: Fighting Through Grief, a Unit with "If a Rival controls more Gigs than you,
this Unit can attack their Gig area the turn it's played." The card is pinned literally in its engine gate (Cody's exact
per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Nadia: Fighting Through Grief (`nadia-fighting-through-grief`) | Unit, Green, RAM 2, cost 6, power 8, Medtech/Trauma Team | If a Rival controls more Gigs than you, this Unit can attack their Gig area the turn it's played. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v64-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the continuous modifier `CAN_ATTACK_GIG_AREA_WHILE_LAGGING_IF` with the condition `RIVAL_CONTROLS_MORE_GIGS`,
  whose `minimum` now also accepts 1.
- A new attack-permission pin table (`attack-permission-support.ts`). The play gate routes the modifier there first; power
  and keyword derivation skip it.
- Attack legality: a lagging Unit (not Going Solo, no Adrenaline) may attack while its controller has a Rival with more Gigs.
  Its targets are then the Gig area only. A Unit with both a rival-Unit and a Gig-area permission has both kinds of target.
- Engine identity `0.4.59-legend-must-attack-v63` -> `0.4.60-lagging-gig-attack-v64`.

## Rules readings

- "The turn it's played" is the Lag window (11.3.1). Once Nadia no longer lags she attacks as any Unit does.
- The condition is checked live, as for the V39 conditional Adrenaline: when attacks are listed and declared and while the
  attack is pending, not fixed when she is played. If it stops holding before the fight, the attack ends (9.21.3) through
  the existing post-reaction target check. Stolen Gigs move only after every steal is selected, so the steal itself cannot
  invalidate the target midway.

## Tests

`tests/api-admission-batch-v64.test.ts` covers source projection and candidate match; the exact pin with forgeries; a played
Nadia attacking only the Gig area of a Rival with more Gigs; no attack with equal or fewer rival Gigs; normal targets once she
no longer lags; and union membership.

The reviewed union is now 114 cards, and coverage is 114/151.
