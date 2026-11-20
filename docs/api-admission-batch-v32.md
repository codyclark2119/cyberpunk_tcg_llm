# API admission batch V32 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Unit whose {Play} and {Attack} each let its controller discard a Program
from hand. If they do, they bottom-deck a rival Unit. The card is pinned literally in its engine gate (Cody's exact
per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Placide: Voodoo Sentinel (`placide-voodoo-sentinel`) | Unit, Blue, 8, power 10 | {Play} {Attack} You may discard 1 Program. If you do, bottom-deck a rival Unit. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v32-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`. The printed "{Play} {Attack}" is
authored as two abilities with the same effect, one per trigger.

## Engine change

- Grammar (`mechanics.ts`): a new effect, `DISCARD_PROGRAMS_THEN_BOTTOM_DECK`, with `count` 1 and a rival `then`
  clause.
- State (`game.ts`): the trigger continuation may hold `discardedPrograms`, the Programs the current effect has
  discarded. They stay held as proof while the bottom-deck target is chosen.
- `program-discard.ts`:
  - The selectors are the own-hand Programs and the rival Units for the bottom-deck. The rival Units use the V15
    bottom-deck selector.
  - The discard moves the chosen Program to the trash and emits `CARD_DISCARDED`.
  - The validator is described under Validation.
- `bottom-deck.ts`: the existing V15 `bottomDeck` is exported unchanged. The owner places the Unit and its Gear on
  the bottom in a random order, and a Legend is removed.
- Resolution (`trigger-resolution.ts`):
  - With fewer Programs in hand than the count, nothing happens.
  - Otherwise the controller chooses a Program or declines (`MODE DONE`, recorded as `OPTIONAL_TRIGGER_DECLINED`).
  - After the discard, a single rival Unit is bottom-decked without a choice. With 2 or more the controller chooses,
    and with none nothing more happens.
- Choices (`trigger-queries.ts`): the discard choice offers only own-hand Programs, and the decline only before
  the first discard. The choice id hashes `discardedPrograms` when present.
- Validation (`trigger-state.ts`, `validateProgramDiscard`):
  - The effect pauses only for the pinned source's own PLAY or ATTACK occurrence.
  - It pauses in the discard phase while Programs are still to be discarded and enough remain in hand.
  - It pauses in the target phase only with every Program discarded and held in the controller's trash, and with
    2 or more rival Units.
  - `discardedPrograms` exists only for the current effect.
- Gate (`program-discard-support.ts`): the whole printed Unit and both abilities are pinned. `supportsTriggerCard`
  delegates to it.
- Engine identity `0.4.27-defeat-discard-v31` -> `0.4.28-program-discard-v32`. The baselines are regenerated once
  for the bundle this batch ships in, in a separate commit.

## Rules readings

- "You may discard 1 Program": optional. Only a Program in the controller's own hand can be discarded, and
  declining discards nothing.
- "If you do, bottom-deck a rival Unit": only after the discard, and it is mandatory then. Readiness does not
  matter. 11.15 applies: the owner bottom-decks the Unit with its equipped Gear.
- The discard may be made with no rival Unit on the field. It then has no further effect.
- On {Attack}, bottom-decking the attacked Unit ends the attack when the attack effects finish (target invalid).
  Bottom-decking another Unit lets the attack go on to the React window.

## Tests

`tests/api-admission-batch-v32.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - either ability missing, the abilities reordered, or a defeated trigger;
  - a condition;
  - cost, power, tags, a keyword or sellability.
- {Play}:
  - only own-hand Programs are offered, with a decline, and a forged Unit option is rejected;
  - after the discard, ready and spent rival Units are both offered;
  - a missing or still-in-hand held Program is rejected;
  - the chosen Unit goes face down to its owner's deck.
- Declining keeps the Program, a single rival Unit is forced, and with no Program in hand nothing is offered.
- With no rival Unit, the discard still happens.
- {Attack}: bottom-decking another Unit leads to the React window, and bottom-decking the attacked Unit ends the
  attack.
- Union membership.

The reviewed union is now 81 cards, and coverage is 81/151.
