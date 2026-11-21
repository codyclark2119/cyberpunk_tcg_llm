# API admission batch V73 (2026-11-21)

Plan section 6, scope 3c. This batch admits V: Streetkid, a Go Solo Legend with "{Call} Trash 3. Then, add 1 BRAINDANCE Program
from your trash to your hand." The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| V: Streetkid (`v-streetkid`) | Legend, Red, RAM 2, cost 5, power 6, Merc, sellable | {Call} Trash 3. Then, add 1 BRAINDANCE Program from your trash to your hand. {Go Solo} | `FIELD_LEGENDS_V1` |

The revision is authored in `tests/api-admission-batch-v73-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `TRASH_THEN_ADD_TRASH_PROGRAM {count: 3, tag: "Braindance"}`.
- A new pin table, `call-trash-program-support.ts`, holds V's whole shape. Both the Call gate (`supportsCall`) and the field-Legend
  gate (`supportsFieldLegend`) route the card there first, so its {Call} and its {Go Solo} are admitted by the same pin.
- Calling it resolves its one printed effect through the activation continuation (`beginLegendCallEffects`). This is the same path
  the V60 Called Legends use for their mode, so the effect can pause for a choice.
- Resolution: trash the top card 3 times, one at a time. An empty deck stops the trashing. Then the tagged Programs in the trash are
  counted: with none, nothing happens; a lone one goes to hand without a choice; with 2 or more, the controller chooses one.
- The Legend activation validator accepts the Called pin without a mode, and its pause only for a choice among 2 or more Programs.
- Engine identity `0.4.69-compose-scenario` -> `0.4.70-call-trash-program-v73`.

## Rules readings

- "From your trash" means the whole trash, not only the 3 cards just trashed, so a Program that was already there counts, and so
  does one just trashed.
- "Add 1" is mandatory whenever a tagged Program is in the trash.
- Trashing from an empty deck loses nothing (11.10.2.1.1; only drawing loses, 1.14).
- A BRAINDANCE Program is one whose printed classifications include Braindance.

## Tests

`tests/api-admission-batch-v73.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries rejected by all three gates;
- a Call with three tagged Programs to choose from, including one just trashed, but never a Quickhack Program or a Unit;
- a lone Program added without a choice, and no Program adding nothing;
- an empty deck stopping the trashing without a loss;
- {Go Solo} from face up;
- union membership.

The reviewed union is now 123 cards, and coverage is 123/151.
