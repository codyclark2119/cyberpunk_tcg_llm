# API admission batch V63 (2026-11-21)

Plan section 6, scope 3c. This batch admits Evelyn Parker: Beautiful Enigma, a Legend with "When a friendly CORPO or GANGER
Unit steals 1 or more Gigs, ready 1 Eddie." and "1 €$, {Spend} A rival Unit must attack next turn if it can." It is the first
Legend {Spend} with an Eddie cost. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Evelyn Parker: Beautiful Enigma (`evelyn-parker-beautiful-enigma`) | Legend, Blue, RAM 2, Doll, sellable | When a friendly CORPO or GANGER Unit steals 1 or more Gigs, ready 1 Eddie. 1 €$, {Spend} A rival Unit must attack next turn if it can. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v63-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the trigger guard `FRIENDLY_CORPO_OR_GANGER_UNIT_STEALS`. The must-attack obligation's origin may now be a
  resolved activation (`{effectId, abilityId, activated: true}`) as well as a {Play} trigger.
- Evelyn joins the Legend pin table. The trigger gate routes a Legend-pinned card with a scheduled trigger to that pin, and
  the quick-activation and end-turn detectors leave it there.
- Steal observers bind Evelyn once per steal, on its first stolen Gig, when the stealer is a friendly field Unit tagged Corpo
  or Ganger and Evelyn is face up in the Legends area. The ready uses the existing friendly-steal Eddie ready.
- A paid Legend {Spend}: activation is offered only if another source can pay, judged with the Legend already spent, and
  `validateLegendActivationState` gains a `PAYMENT` phase bounding the strategic payment.
- `FORCE_RIVAL_UNIT_ATTACK` resolves on the Legend path with the existing must-attack targets: two or more open a choice, a
  lone rival Unit is forced (a forced target-selected event), and none does nothing. The obligation is validated against
  the activation's effect id.
- Engine identity `0.4.58-cross-gig-set-v62` -> `0.4.59-legend-must-attack-v63`.

## Rules readings

- "Steals 1 or more Gigs" is one trigger per steal, however many Gigs that steal takes.
- Evelyn spends herself as the {Spend} cost, so she cannot also pay the 1 €$. Another ready Legend can still pay it, as for
  any cost.
- "Must attack next turn if it can" reuses the reviewed must-attack obligation and its expiry.

## Tests

`tests/api-admission-batch-v63.test.ts` covers source projection and candidate match; the exact pin with forgeries across the
Call, trigger and Legend gates and the refusing play gate; a Ganger Unit's steal readying 1 Eddie while an NCPD Unit's does
not; a face-down Evelyn not observing; the paid {Spend} with a choice of rival Unit, the obligation carrying into the rival's
turn; a lone rival Unit forced and no rival Unit doing nothing; the payment requirement (no self-payment); forged obligations;
and union membership.

The reviewed union is now 113 cards, and coverage is 113/151.
