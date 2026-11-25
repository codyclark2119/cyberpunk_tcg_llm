# API admission batch V76 (2026-11-25)

Plan section 6, scope 3c. This batch admits Judy Álvarez: Braindance Maestro, a Legend with a trigger on playing a BRAINDANCE
Program and a {Spend} ability that trashes the top card of the deck. The card is pinned literally in its engine gate (Cody's exact
per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Judy Álvarez: Braindance Maestro (`judy-a-lvarez-braindance-maestro`) | Legend, Blue, RAM 2, Ganger/Mox/Techie, sellable | When you play a BRAINDANCE Program, give a friendly Unit +1 power this turn. {Spend} Trash the top card of your deck. If it's a Program, you may add it to your hand. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v76-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the trigger guard `FRIENDLY_BRAINDANCE_PROGRAM_PLAYED` on `WHEN_CARD_PLAYED`, and the effects
  `PROGRAM_PLAY_FRIENDLY_POWER_THIS_TURN {amount: 1}` and `TRASH_TOP_MAY_ADD_PROGRAM`.
- State: a `PROGRAM_PLAY_TRIGGER` variant of the temporary power modifier, with the trigger occurrence's effect id, ability id and
  batch ordinal; and `programPlay` on the trigger continuation (below).
- The pin joins the Legend {Spend} table. The guard and either new effect route there first.
- Program plays now discover triggers: after a BRAINDANCE Program resolves and goes to the trash, each face-up Legend of its
  controller with the new guard is pending in a PLAY batch. A Program that is not BRAINDANCE, or a play with no such Legend, keeps
  the old path exactly (no batch, no events), so no earlier replay changes.
- When the Program's own effect already prepared a DEFEAT batch (a defeated Unit's {Defeated} triggers), Judy's binding joins that
  batch, marked by `programPlay`, so all of them wait together and resolve in one ordered batch.
- The first-blue-play Legend observer now filters on its own guard, so a blue Unit or Gear play never brings Judy's binding.
- The power: with one friendly field Unit it is chosen without a choice; with 2 or more the controller chooses; with none nothing
  happens.
- The {Spend} ability moves the deck's top card to the trash. If it is a Program, the controller chooses "Leave it in your trash" or
  "Add X from your trash to your hand"; otherwise nothing more happens. An empty deck trashes nothing.
- Labels for the activation, the take-or-leave choice and the Unit choice.
- Engine identity `0.4.73-maxtac-observe` -> `0.4.74-braindance-legend-v76`.

## Rules readings

- "When you play a BRAINDANCE Program" triggers on the play and resolves after the Program has resolved and is in the trash, like
  other triggers from playing a card. Only Programs played from hand exist for it today; none of the BRAINDANCE Programs has {Quick}.
- The trigger needs Judy face up in the Legends area when the Program is played (a face-down Legend has no abilities).
- "If it's a Program" is read from the trashed card's printed type. A non-Program stays in the trash with no choice.

## Tests

`tests/api-admission-batch-v76.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries rejected by the Legend and trigger gates;
- the {Spend} label, a trashed Program's take-or-leave choice, both outcomes;
- a non-Program top card and an empty deck, with no pause;
- a BRAINDANCE Program play: the trigger after the Program resolves, the Unit choice, +1 power and expiry at turn end;
- a lone Unit forced, no Unit, a face-down Judy and a non-BRAINDANCE Program;
- a BRAINDANCE defeat Program whose defeat batch also holds Judy's trigger, with both resolving;
- union membership.

The reviewed union is now 126 cards, and coverage is 126/151.
