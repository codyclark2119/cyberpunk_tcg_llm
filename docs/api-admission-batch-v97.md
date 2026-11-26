# API admission batch V97 (2026-11-26)

Plan section 6, bundle 15. This batch admits Lizzy Wizzy: Delicate Weapon, a Blocker Unit whose {Play} trigger may play a cheap
Program from hand or trash for free and bottom-deck it afterwards. The card is pinned literally in its engine gate (Cody's exact
per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Lizzy Wizzy: Delicate Weapon (`lizzy-wizzy-delicate-weapon`) | Unit, Blue, cost 5, power 2, RAM 2, Rocker, not sellable | {Play} You may play a Program with cost 3 or less from your hand or trash for free. Bottom-deck it after you play it. {Blocker} | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v97-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `MAY_PLAY_PROGRAM_FREE_FROM_HAND_OR_TRASH_THEN_BOTTOM_DECK`, the turn-history field `queuedProgramPlay`, and the
  play continuation field `freeBottomDeck`.
- The card is a row in the free-play pin table (`free-play-support.ts`), with `BLOCKER` in its pinned mechanics.
- `packages/engine/src/queued-program-play.ts`: the trigger offers "Play no Program" and each of the controller's Programs in hand or
  face up in the trash with printed cost 3 or less that the engine can play. The chosen Program is queued.
- The queued Program is played once the action's trigger batches are done (or the attack has ended), as a free Call's {Call} ability
  waits in batch V84. It is played from where it is now, through the ordinary play with a cost of 0. A hand card is revealed, and a
  trash card is already public. It counts as a played Program, and it goes to the bottom of its owner's deck after it resolves. A
  Program that has left hand and trash by then is not played.
- `startPlay` takes a `freeBottomDeck` flag.
- Engine identity `0.4.94-trash-units-play-v96` -> `0.4.95-queued-program-play-v97`.

## Rules readings (to review)

- A Program cannot resolve inside a trigger batch in this engine (no stack), so the chosen Program is played after the batch. When
  Lizzy's trigger is the batch's only or last pending effect, which is the usual case, this is the same as playing it inside the
  trigger. Otherwise, other pending effects of that batch resolve before the Program instead of after it. This is the same reading the
  engine already uses for a free Call's {Call} ability.
- Only one queued Program play exists at a time, and only for the turn player; a second such trigger in the same action, or Lizzy
  entering the field for the non-active player (only possible through another card's free play during an attack), offers nothing
  (fail-closed).

## Tests

`tests/api-admission-batch-v97.test.ts` covers:

- source projection and candidate match;
- the exact pin through the free-play gate and `supportsPlay`, with forgeries (no Blocker, power, tags, sellable, trigger) rejected;
- a hand Program chosen (a cost-4 Program is not offered), with option labels; played for free after the batch, keeping its own pause
  (the Rival's choice), counted as played, then bottom-decked; forged pauses (no `freeBottomDeck`, no queue) rejected;
- a trash Program played the same way, without a second reveal;
- the decline; no eligible Program offers nothing;
- Lizzy keeps Blocker and enters the field with no Program to play.

The reviewed union is now 147 cards, and coverage is 147/151.
