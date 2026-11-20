# API admission batch V29 (2026-11-19)

Plan section 6, scope 3c. This batch admits one Unit with an {Attack} that readies up to 2 MERC Legends when its
controller controls a value-pair of Gigs. The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Pepe Najarro: Working Doubles (`pepe-najarro-working-doubles`) | Unit, Green, 4, power 6 | {Attack} If you control a value-pair of Gigs, ready up to 2 MERC Legends in your Legends area. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v29-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - A new condition, `CONTROLS_VALUE_PAIR`, is true when two of the controller's own rolled Gigs share a value.
  - A new effect, `READY_LEGENDS_UP_TO` (tag `Merc`, maximum 2), carries that condition as a resolution-time
    `when`.
- State (`game.ts`): the trigger continuation may hold `readiedLegends`, the one Legend already chosen while the
  second pick is open.
- Resolution (`trigger-resolution.ts`):
  - The condition is evaluated when the effect resolves. If it is false, or no eligible Legend exists, the effect
    ends.
  - Otherwise the controller picks one eligible Legend at a time, and each pick readies it at once.
  - The choice always includes `DONE`. It ends after 2 picks, after `DONE`, or when no other eligible Legend is
    left.
- Queries (`ready-unit.ts`): an eligible Legend is a face-up Legend in the controller's Legends area with the MERC
  classification. Readiness is not a filter, as with the existing Legend ready. A chosen Legend is not offered
  again.
- Validation (`trigger-state.ts`): the pause is allowed only for the pinned source's own ATTACK occurrence, while
  the condition holds. It may hold at most one already-chosen eligible Legend, and another eligible Legend must
  remain. `readiedLegends` exists only for this effect.
- Gate: `value-pair-support.ts` pins the complete ability list, and `supportsTriggerCard` delegates to it.
- Engine identity `0.4.24-gig-parity-v28` -> `0.4.25-value-pair-v29`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- 6.6: a value-pair is 2 dice with the same value in the same Gig area. Only the controller's own Gig area counts
  (6.1.2), so a Rival's Gig with the same value does not make a pair.
- 10.16.1.1: "If you control a value-pair" is a condition beyond the trigger. The trigger is always pending, and
  the condition is checked when it resolves.
- "Up to 2": the controller may choose 0, 1 or 2 Legends. A face-down Legend has no public classification, so it
  is never a MERC Legend.

## Tests

`tests/api-admission-batch-v29.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - a Play trigger, or an unconditional ready of any Legend;
  - the condition moved to trigger time, or a second ability;
  - cost, power, tags, an added keyword, or sellability.
- With a value-pair and V, Ender and Goro face up and spent:
  - only the two MERC Legends are offered, with `DONE`;
  - a forged non-MERC option is rejected, and so is a forged held Legend;
  - after both are readied, Goro stays spent and the attack reaches the React window.
- Stopping after one Legend, and stopping before any.
- No friendly value-pair: a Rival's matching Gig does not count. The trigger is pending, evaluates false, and
  nothing is offered.
- A single MERC Legend completes the effect once it is chosen.
- Union membership.

The reviewed union is now 78 cards, and coverage is 78/151.
