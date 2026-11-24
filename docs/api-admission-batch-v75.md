# API admission batch V75 (2026-11-21)

Plan section 6, scope 3c. This batch admits Dum Dum: Maelstrom Triggerman, a Legend with a plain {Call} that may defeat a friendly
Gear, and a paid {Quick} {Spend} ability that powers up a friendly Unit for its Gear. The card is pinned literally in its engine gate
(Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Dum Dum: Maelstrom Triggerman (`dum-dum-maelstrom-triggerman`) | Legend, Yellow, RAM 2, Ganger/Maelstrom, sellable | {Call} You may defeat a friendly Gear. If you do, draw 2. Otherwise, draw 1. {Quick} 1 €$, {Spend} Give a friendly Unit +1 power this turn for each of its equipped Gear. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v75-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effects `MAY_DEFEAT_FRIENDLY_GEAR_THEN_DRAW {ifDefeated: 2, otherwise: 1}` and
  `POWER_PER_EQUIPPED_GEAR_THIS_TURN {target: FRIENDLY_UNIT, amount: 1}`.
- State: a `PER_EQUIPPED_GEAR` variant of the temporary power modifier, with the activation's effect id and sequence.
- The pin joins the Legend {Spend} table. Either new effect routes there first.
- A pinned Legend's single non-modal {Call} now resolves through the activation continuation (`beginLegendCallEffects`), as V73's
  Called Legend does, so it can pause for a choice. No earlier pinned Legend has a non-modal {Call}.
- The Call: with a friendly Gear, the controller chooses "Defeat no Gear and draw 1" or one Gear ("Defeat X and draw 2"). With
  none, it draws 1 without a choice. The Gear is defeated through `defeatCards` (attached face-up Gear in an active area, as
  V55's Gear defeat); its host stays. A Gear defeat discovers no reviewed trigger, so any binding fails closed.
- The Quick ability reuses V74's Legend Quick window (Main Phase, or its controller's React Step). With one friendly Unit it is
  chosen without a choice; with 2 or more the controller chooses. The Gear count is read once, as the effect resolves.
- Labels for the activation, the Gear choice and the decline, and the Unit choice.
- Engine identity `0.4.71-quick-blocker-grant-v74` -> `0.4.72-gear-legend-v75`.

## Rules readings

- "You may defeat a friendly Gear" only offers a decline when there is a Gear to defeat. With none, "Otherwise, draw 1" applies.
- "For each of its equipped Gear" is counted as the effect resolves and then fixed for the turn: a Gear that later leaves does not
  lower it. Any friendly Unit may be chosen, and an unequipped one gets +0.
- "A friendly Gear" is any attached Gear the controller controls, on a Unit or on a face-up Legend.

## Tests

`tests/api-admission-batch-v75.test.ts` covers:

- source projection and candidate match;
- the exact pin, with forgeries rejected by the Legend and Call gates;
- the Call's choice among the decline and each friendly Gear, and a defeat drawing 2;
- a decline drawing 1, and no Gear drawing 1 without a choice;
- the Quick choice, +1 per Gear, the count fixed after a Gear leaves, and expiry at turn end;
- a lone unequipped Unit forced with no modifier;
- the Quick ability in its controller's React Step;
- union membership.

The reviewed union is now 125 cards, and coverage is 125/151.
