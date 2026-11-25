# API admission batch V80 (2026-11-25)

Plan section 6, scope 3c. This batch admits Johnny Silverhand: Rocking Renegade, a Legend whose paid {Spend} ability lets a friendly
Unit attack spent rival Units the turn it's played, with a cost that falls with high Gigs. The card is pinned literally in its engine gate
(Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Johnny Silverhand: Rocking Renegade (`johnny-silverhand-rocking-renegade`) | Legend, Red, RAM 2, Merc/Rocker/Samurai, sellable | 2 €$, {Spend} A friendly Unit can attack spent rival Units the turn it's played. If it's a ROCKER Unit, also give it +2 power this turn. This effect costs -1 €$ for each friendly Gig with 8+ value. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v80-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `costReduction {per: "FRIENDLY_GIG_VALUE_AT_LEAST_8", amount: 1}` on an activation; the effect
  `FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED {alsoPowerIfTag: "Rocker", amount: 2}`; and a `ROCKER_ATTACK_GRANT_BONUS` variant
  of the temporary power modifier (+2, keyed by effect id and activation sequence).
- The pin joins the Legend {Spend} table (`packages/engine/src/legend-spend-support.ts`), with the new module
  `packages/engine/src/rocker-grant.ts`.
- `activationPaymentAmount` takes the state and actor: a printed reduction lowers the amount everywhere it is offered, paid and
  validated (activation offer, payment, pause validation and label). Abilities without a reduction are unchanged.
- The effect chooses a friendly field Unit (none: nothing; one: chosen without a choice; more: the controller chooses, "Let X attack
  spent rival Units the turn it's played"). The Unit joins the turn's rival-Unit attack grants, the same record Batch V50's free plays
  use, so a Unit with Lag may attack rival Units (only spent ones are attackable) but not the Gig area. A ROCKER Unit also gets +2
  power this turn (`CONDITION_EVALUATED` records the check).
- The turn history's rival-Unit attack grants are now enabled for content holding this Legend too.
- Fix: a Legend's paid {Spend} that pauses with a payment source already chosen (any cost of 2 or more) was rejected by its state
  check, which required chosen sources to be spent. While payment is still being chosen they are ready; after it they are spent.
  This was unreachable before, since every earlier paid {Spend} cost 1.
- Engine identity `0.4.77-ready-attack-grant-v79` -> `0.4.78-rocker-grant-v80`.

## Rules readings

- "A friendly Unit can attack spent rival Units the turn it's played" is read like Batch V50's grant: it matters only for a Unit with
  Lag (played this turn), lets it attack rival Units, and keeps the Gig area closed. Any friendly field Unit may be chosen; for one
  without Lag the grant changes nothing, while a ROCKER still gets the +2.
- "If it's a ROCKER Unit" reads the chosen Unit's classifications as the effect resolves.
- "This effect costs -1 €$ for each friendly Gig with 8+ value" counts the controller's rolled Gigs with current value 8 or more when
  the cost is computed. No minimum is printed, so two such Gigs make it free (0); the {Spend} part is unchanged.

## Tests

`tests/api-admission-batch-v80.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries (no reduction, another cost, Quick, a condition, tags, colors) rejected;
- the cost at 2, 1 and 0 with 0, 1 and 2 friendly 8+ Gigs, including the two-step payment;
- a just-played Unit chosen without a choice: it may attack spent rival Units only, with no power for a non-ROCKER;
- the controller's choice between two Units, the ROCKER's +2, and only the chosen Unit able to attack;
- no friendly Unit;
- union membership.

The reviewed union is now 130 cards, and coverage is 130/151.
