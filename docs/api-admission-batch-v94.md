# API admission batch V94 (2026-11-25)

Plan section 6, bundle 14. This batch admits Alt Cunningham: Soulkiller Architect, a Legend whose paid {Spend} ability plays a
Program from its controller's trash, paying its cost, and bottom-decks it afterwards. It is the engine's first ordinary card play from
a zone other than the hand. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Alt Cunningham: Soulkiller Architect (`alt-cunningham-soulkiller-architect`) | Legend, Blue, RAM 2, Merc/Netrunner, sellable | 1 €$, {Spend} Play a Program from your trash. Bottom-deck it after you play it. (You still pay its cost.) | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v94-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `PLAY_TRASH_PROGRAM_THEN_BOTTOM_DECK`, and the play continuation fields `trashProgramId` (the chosen Program,
  never present at a decision) and `fromTrash` (a Program played from the trash).
- The card is a row in the Legend pin table (`legend-spend-support.ts`).
- `packages/engine/src/trash-program-play.ts`: the ability offers the controller's face-up trash Programs the engine can play whose
  cost (as a hand play computes it) can be paid after the ability's own 1 €$. A lone Program is taken without a choice; with none
  nothing is played.
- Once the ability has resolved, the chosen Program is played exactly as from hand, except that it is already public (no reveal) and
  it pays from the trash: its payment, its effects and its play triggers are the ordinary ones, and it counts as a played Program.
- When it has resolved, it goes to the bottom of its owner's deck instead of the trash (`moveToBottom` in `bottom-deck.ts`, now also
  leaving the resolving-Program area).
- Engine identity `0.4.91-trash-gear-v93` -> `0.4.92-trash-program-play-v94`.

## Rules readings

- "Play a Program from your trash" plays one only if its cost can be paid ("You still pay its cost"); one that cannot be paid is not
  offered, so nothing is played when none can.
- The Program is the whole of the ability, so playing it as the ability finishes is the same as playing it inside the ability.
- "Bottom-deck it after you play it" applies once the Program has resolved.

## Tests

`tests/api-admission-batch-v94.test.ts` covers:

- source projection and candidate match;
- the exact pin through the Legend gate, with forgeries (cost, no payment, Quick, tags, colors) rejected;
- the Program choice (a Program that cannot be paid is not offered), its own payment, its resolution and its bottom-decking, with the
  activation and option labels;
- a lone payable Program played without a choice and paused for its own payment; forged pauses (no `fromTrash`, a held
  `trashProgramId`) rejected; no payable Program plays nothing;
- a Program played from the trash counts as played and keeps its own pausing effect (the Rival's choice), then is bottom-decked.

The reviewed union is now 144 cards, and coverage is 144/151.
