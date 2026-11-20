# API admission batch V40 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Go Solo Legend. When a friendly Legend steals a Gig, it draws 1 if that
Gig's value is even and makes a Rival discard 1 if it is odd. It is the first card named in Cody's quiz set that the
assistant thread asked for first (2026-11-20). The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Rogue Amendiares: Preem Solo (`rogue-amendiares-preem-solo`) | Legend, Yellow, 7, power 7 | [Go Solo] When a friendly Legend steals a Gig, if its value is even, draw 1. If its value is odd, a Rival discards 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v40-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - A new ability guard, `STEALER_IS_LEGEND`, on the existing friendly-steal trigger.
  - A new effect, `STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD` with `count` 1. It is one effect, so the value is read
    once and exactly one branch applies.
- `legend-steal-support.ts` adds a new pin table, `LEGEND_STEAL_SHAPES`. It pins the whole Legend, its Go Solo keyword
  and its single guarded ability, and it requires the trigger, field-Legend, combat, Gear and React policies. The
  trigger, field-Legend and play gates all route this metadata to that pin. Calling the Legend goes through the trigger
  gate, as for other `COMBAT_TRIGGERS_V1` Legends.
- `trigger-queries.ts`:
  - Friendly-steal observers now include face-up Legends-area cards as well as the field.
  - The new guard holds only when the stealing card is a printed Legend on the field (`stealerIsLegend`). The V26 d6
    guard is unchanged.
  - `stolenGigParity` reads the named Gig's current value.
  - `discardingPlayer` treats the new effect as a Rival discard.
- `trigger-resolution.ts`:
  - On resolution the effect emits `CONDITION_EVALUATED`, which is met for an even Gig. An even Gig draws 1.
  - An odd Gig pauses for the Rival's own discard choice. A single card is forced, and an empty hand does nothing.
- `trigger-state.ts`:
  - It validates the new observer binding.
  - It allows the effect to pause only in its STEAL batch, in the discard phase, while the Gig is odd and the source
    passes its pin.
- Engine identity `0.4.35-conditional-adrenaline-v39` -> `0.4.36-legend-steal-v40`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "A friendly Legend steals a Gig": only Units steal (10.16.3), so the stealer is a printed Legend that is on the field
  as a Unit, which here means through Go Solo. Rogue counts itself.
- The ability is active while Rogue is face-up in the Legends area or on the field. A face-down Legend has no abilities.
- One trigger is pending for each stolen Gig, after the Gigs move, as for the V24 and V26 steal triggers (11.5.1.7).
- "Its value" is the stolen Gig's value when the effect resolves.
- "A Rival discards 1": the Rival chooses from their own hand, as in V17 and V24.

## Tests

`tests/api-admission-batch-v40.test.ts` covers:

- Source projection and candidate match.
- The exact pin through the trigger, field-Legend, Call and play gates. Forgeries are rejected:
  - an unguarded or d6-guarded trigger, an own-steal trigger, a plain draw, or an added condition;
  - no Go Solo or an extra Blocker;
  - cost, power, tags, sellability or the plain field-Legend scope.
- A face-up Rogue in the Legends area draws 1 when another friendly Legend, gone solo, steals a 4.
- Rogue goes solo and steals a 5. The Rival chooses which card to discard and the controller draws nothing. A state that
  holds the discard for an even Gig is rejected.
- A face-down Rogue, and a friendly non-Legend Unit's steal, trigger nothing.
- Union membership.

The reviewed union is now 89 cards, and coverage is 89/151.
