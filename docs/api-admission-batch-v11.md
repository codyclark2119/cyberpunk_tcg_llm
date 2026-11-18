# API admission batch V11 (2026-11-18)

Plan section 6, scope 3c. Three Units whose only text lowers the amount paid to play them. Each
admitted card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Octant (`octant`) | Unit, Red, 7, power 8 | Play this Unit for -1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$. | `PLAY_COST_REDUCTION_V1` |
| Trauma Team Operatives (`trauma-team-operatives`) | Unit, Yellow, 6, power 7 | Play this Unit for -1 €$ for each Unit in your trash, to a minimum of 1 €$. | `PLAY_COST_REDUCTION_V1` |
| MaxTac Heavy (`maxtac-heavy`) | Unit, Green, 7, power 8 | Play this Unit for -1 €$ for each of a Rival’s Units, to a minimum of 1 €$. | `PLAY_COST_REDUCTION_V1` |

Revisions are authored in `tests/api-admission-batch-v11-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. All three are `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): new continuous modifier `SELF_PLAY_COST_REDUCTION` with
  `per: FRIENDLY_GIG_VALUE_AT_LEAST_8 | FRIENDLY_TRASH_UNIT | RIVAL_UNIT`, `amount: 1` and `minimum: 1`.
  New execution scope `PLAY_COST_REDUCTION_V1` (domain `card.ts`) and turn-slice policy
  `playCostReduction: "PLAY_COST_REDUCTION_V1"` (domain `ruleset.ts`).
- `play-cost-support.ts`: the gate, with the `COST_REDUCTION_SHAPES` pin table, and
  `playPaymentAmount`, the amount a player pays to play a card now. Cards without the modifier pay their
  printed cost, so earlier cards are unchanged.
- Payment (`play.ts`, `play-support.ts`, `play-state.ts`): play legality, the payment continuation and
  its state validator use `playPaymentAmount` instead of the printed amount. The card's cost value
  (`cost-value.ts`) stays printed, per rule 3.11.1.2.
- The modifier is payment-only: `characteristics.ts` and `view.ts` skip it for power once the gate
  passes. Hidden copies are validated at initialization and in `validateState`.
- Engine identity `0.4.6-mass-defeat-program-ban-v10` -> `0.4.7-play-cost-reduction-v11`; baselines
  regenerated in a separate commit.

## Rules readings

- The amount is counted when the play starts and does not change during payment. Paying spends
  Eddies and Legends only, so no counted quantity can move mid-payment.
- Octant counts only its controller's rolled Gigs in the Gig area with current value 8 or more.
- Trauma Team Operatives counts cards in its controller's trash whose printed type is Unit.
- MaxTac Heavy counts field Units controlled by one Rival (the largest count when there are several;
  two-player games have one). Its controller's own Units never count.
- "To a minimum of 1 €$" floors the reduced amount at 1; it never raises a printed cost.

## Tests

`tests/api-admission-batch-v11.test.ts`: source projection and candidate match; exact pins with
single-field forgeries rejected, and the reduction rejected without its policy; Octant counting only
friendly 8+ Gigs, keeping its cost value, unplayable one Eddie short and played for the reduced
amount; Trauma Team Operatives counting only its controller's trashed Units; MaxTac Heavy flooring at 1
against seven rival Units and ignoring its controller's own; union membership. The reviewed union is
now 53 cards, and coverage is 53/151.
