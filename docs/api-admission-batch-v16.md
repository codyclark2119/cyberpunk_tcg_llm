# API admission batch V16 (2026-11-18)

Plan section 6, scope 3c. The batch extends the V11 self play-cost reduction beyond plain Units, to a
Program and a Gear. The Program also defeats a rival Unit by a power comparison. Each card is pinned
literally in its engine gates (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Carnage at the Colosseum (`carnage-at-the-colosseum`) | Program, Red, 6 | Play this Program for -1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$. Defeat a rival Unit with less power than a friendly Unit. | `TARGETED_DEFEAT_V1` |
| Zetatech Berserk (`zetatech-berserk`) | Gear, Green, 6, power 3 | Play this Gear for -1 €$ for each friendly face-up Legend, to a minimum of 1 €$. | `PLAY_COST_REDUCTION_V1` |

Both revisions are authored in `tests/api-admission-batch-v16-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`):
  - The Unit-defeat power filter gains `LESS_THAN_FRIENDLY_UNIT`.
  - The self play-cost reduction gains the count `FRIENDLY_FACE_UP_LEGEND`.
  - No new policy or scope.
- Defeat targets (`targeted-defeat-queries.ts`): a rival Unit is eligible when its referenced power is
  below the highest referenced power among the controller's face-up field Units (Go Solo Legends included).
  With no friendly Unit there is no bound and no target. The listing is recomputed at choice, resolution
  and revalidation like every other filter.
- Gates:
  - `targeted-defeat-support.ts`: every pinned shape now includes its continuous modifiers (`[]` for the
    earlier cards). Carnage is pinned with its reduction.
  - `play-cost-support.ts`: `supportsPlayCostReductionUnit` is renamed `supportsPlayCostReduction`. A
    Program reduction is accepted only when the card's whole shape passes the targeted-defeat pin. A Gear
    reduction is pinned literally (equip rule, printed-power grant, then the reduction, in that order).
  - `attachments.ts`: `supportsGear` routes a `PLAY_COST_REDUCTION_V1` Gear to that gate.
  - The count for the reduction is taken when the play starts, as in V11.
- Engine identity `0.4.11-bottom-deck-unit-v15` -> `0.4.12-cost-reduction-v16`. The baselines are
  regenerated in a separate commit.

## Rules readings

- 3.11.1.2: the reduction changes only the amount paid. The cost value stays printed (6 for both).
- "Less power than a friendly Unit": some friendly Unit has more power, so the bound is the strongest
  friendly Unit. Negative power is referenced as 0 on both sides, as for every other power filter.
- "Friendly face-up Legend": 4.4 makes the Legends area and the field both valid Legend areas, so a face-up
  Legend fighting as a Unit counts alongside the Legends area. Face-down and rival Legends do not.
- The Gear's power is granted to its host as for every simple Gear (3.17.3). Its own text applies to itself
  only (4.11.2).

## Tests

`tests/api-admission-batch-v16.test.ts` covers:

- Source projection and candidate match.
- Both cards' exact pins, with single-field forgeries rejected, including a removed reduction, a swapped
  count, a different power filter, a modifier order change and the plain Gear scope.
- Carnage's payment: 1 less per friendly Gig of 8+, with the cost value unchanged.
- Carnage's targets: only rival Units below the strongest friendly Unit. A forged equal-power option is
  rejected. With no friendly Unit, or none stronger, nothing is defeated.
- Zetatech Berserk's payment, counting only the player's own face-up Legends, then equipping and granting
  +3 to its host.
- Union membership.

The reviewed union is now 61 cards, and coverage is 61/151.
