# API admission batch V83 (2026-11-25)

Plan section 6, scope 3c. This batch admits Nocturne Op55 N1, a modal Program that costs 1 €$ with an empty fixer area and whose three
modes draw 2, stop a Unit from attacking until its controller's next turn, or discount a friendly {Go Solo} this turn. The card is
pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Nocturne Op55 N1 (`nocturne-op55-n1`) | Program, Blue, RAM 2, cost 3, Arasaka/Plan, sellable | If your fixer area is empty, play this Program for 1 €$. Choose one effect. Draw 2. // A Unit can't attack until your next turn. // A friendly Legend may use {Go Solo} for -2 €$ this turn, to a minimum of 1 €$. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v83-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the modifier `ALTERNATIVE_PLAY_COST_IF_FIXER_EMPTY {amount: 1}`; the effects `UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN` and
  `FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN {amount: 2, minimum: 1}`; the state `attackLocks` (an `AttackLock` per resolved lock); the turn
  history `goSoloDiscounts` (unused grants, by effect id); and the events `ATTACK_LOCKED`, `ATTACK_LOCK_EXPIRED`,
  `GO_SOLO_DISCOUNT_GRANTED` and `GO_SOLO_DISCOUNT_USED`.
- The pin joins the modal Program table (`packages/engine/src/modal-program-support.ts`). A modal ability without a "choose both
  instead" condition now always pauses for its mode; before this batch every modal Program had one, so nothing else changes.
- New modules `packages/engine/src/attack-lock.ts` and `packages/engine/src/go-solo-discount.ts`.
- Play cost: with the controller's fixer area empty, the amount paid is 1 (the cost value stays 3), read wherever the play amount is
  computed (offer, payment and validation).
- Attack lock: any face-up field Unit, either player's, is offered (a lone one is locked without a choice; none does nothing). A
  locked Unit is not attack-eligible. The lock ends at the start of the locking player's next turn (8.6.2.1, beside Batch V22's ready
  lock) or when the Unit leaves the field.
- Go Solo discount: the grant waits in this turn's history. The active player's next {Go Solo} this turn costs 2 less, after any
  Rival increase (Batch V56), to a minimum of 1, and uses the earliest grant when it completes.
- Mode labels for this Program: "Draw 2", "A Unit can't attack until your next turn" and "A friendly Legend may use Go Solo for -2
  this turn, to a minimum of 1". Earlier modal Programs keep their labels.
- Engine identity `0.4.80-gear-move-v82` -> `0.4.81-attack-lock-v83`.

## Rules readings

- "If your fixer area is empty, play this Program for 1 €$" replaces the amount paid whenever it is lower; it is never forced higher.
- "A Unit" has no friendly or rival restriction, so either player's face-up field Unit may be locked. "Until your next turn" ends as
  the ready lock does.
- "A friendly Legend may use {Go Solo} for -2 €$ this turn" names no Legend when it resolves, so the grant applies to whichever
  friendly Legend next uses {Go Solo} this turn, once. Two grants discount two uses. The minimum of 1 bounds only this reduction.

## Tests

`tests/api-admission-batch-v83.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries (no alternative cost, a both-instead condition, two modes, reordered modes, cost, tags) rejected;
- the cost of 3, or 1 with an empty fixer area, and the always-offered mode choice with its labels;
- Draw 2;
- a rival Unit locked from either player's Units: unable to attack in the Rival's turn while another Unit can, and the lock expiring
  at the controller's next turn;
- a lone friendly Unit locked without a choice and unable to attack this turn, and no Unit to lock;
- the Go Solo discount on V: Corporate Exile (5 to 3), paid and used;
- tampered locks and a duplicate grant rejected;
- union membership.

The reviewed union is now 133 cards, and coverage is 133/151.
