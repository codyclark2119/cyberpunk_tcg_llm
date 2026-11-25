# API admission batch V91 (2026-11-25)

Plan section 6, bundle 13. This batch admits El Sombrerón: La Venganza Lenta, a Unit whose {Attack} ability may be paid for. It adds
the engine's first payment inside a triggered ability. The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| El Sombrerón: La Venganza Lenta (`el-sombrero-n-la-venganza-lenta`) | Unit, Red, RAM 4, cost 5, power 4, Ganger/Valentino, not sellable | {Attack} You may pay 2 €$. If you do, this Unit gains power equal to a friendly max Gig this turn. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v91-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `MAY_PAY_FOR_POWER_EQUAL_TO_FRIENDLY_MAX_GIG {cost: 2}`, the trigger phase `PAYMENT` with the continuation fields
  `paymentSelected` (chosen, not yet spent) and `paid` (spent, while the Gig is chosen), and the power modifier `PAID_MAX_GIG`.
- A new pin table (`packages/engine/src/paid-attack-power-support.ts`) owns any card with the effect; the play and trigger gates route
  it there first.
- `packages/engine/src/paid-attack-power.ts`: with no exact way to pay 2 €$, nothing is offered. Otherwise the controller accepts or
  declines (`OPTIONAL`). Accepting pays: a forced set of sources is taken at once, otherwise each source is chosen in the
  `PAYMENT_SELECTION` step, using the same candidate and forced-remainder rules as card play (Eddies and Legends, 11.20.1). The sources
  are spent together, and "when spent" triggers bind as for any spend (Batch V69).
- After paying, the Unit gains the value of a friendly max Gig (6.3.2: a rolled Gig in its Gig area at its die's top face) until end
  of turn. Max Gigs of different values are a choice; one value (or several Gigs of the same value) is taken without a choice; none
  gives nothing.
- The `PAYMENT_SELECTION` step now also belongs to a trigger continuation in its `PAYMENT` phase.
- Engine identity `0.4.88-end-turn-defeat-v90` -> `0.4.89-paid-attack-power-v91`.

## Rules readings

- "If you do" is met by paying; the Gig is read after paying, so paying with no max Gig is allowed and gains nothing.
- "A friendly max Gig" names one Gig. With max Gigs of different values the controller chooses, as "a" reads; the engine does not
  assume the highest.
- If the Unit has left the field by then, the payment still happens and the power is not gained.

## Tests

`tests/api-admission-batch-v91.test.ts` covers:

- source projection and candidate match;
- the exact pin through the play and trigger gates, with forgeries (trigger, keyword, power, cost, tags, scope) rejected;
- accepting, paying 2 of 11 sources one by one, and gaining the max Gig's value for the fight, with the accept and decline labels;
- declining (no payment, no power), paying with no max Gig (no power), and a forced 2-source payment with no choice;
- fewer than 2 €$ available: nothing offered;
- two max Gigs of different values: the chosen one's value is gained;
- a paused payment's labels and its validation (a selected source must stay ready and be distinct);
- union membership.

The reviewed union is now 141 cards, and coverage is 141/151.
