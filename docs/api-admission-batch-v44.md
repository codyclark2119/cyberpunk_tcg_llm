# API admission batch V44 (2026-11-20)

Plan section 6, scope 3c. This batch admits one modal Program: choose one of two effects, or both when a friendly d4 is a
min Gig. It is one of the cards named in Cody's quiz set that the assistant thread asked for first (2026-11-20). The card is
pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Pyramid Song (`pyramid-song`) | Program, Blue, 3, Braindance | Choose one effect. If a friendly d4 is a min Gig, choose both instead. Give a rival Unit -5 power this turn. // Bottom-deck a rival Unit with power 0. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v44-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` adds an optional ability field, `choose: { count: 1, allInstead }`, and a new condition,
    `FRIENDLY_GIG_IS_MIN` with `dieType: "D4"`. `BOTTOM_DECK_UNIT` targets gain an optional `power: 0` filter.
  - `game.ts` adds a `-5` temporary power modifier that records its effect id, a `MODE` phase and a `chosenEffect` index
    on the play continuation, and a new event, `EFFECT_MODE_CHOSEN`.
- `modal-program-support.ts` adds a new pin table, `MODAL_PROGRAM_SHAPES`, which pins the whole Program and both modes in
  printed order. The play gate routes any ability with `choose` to it first. The trigger, field Legend, effect and
  attack-condition-power gates refuse a modal ability, so `choose` is admitted only by this pin.
- `play.ts`:
  - When the Program resolves, the condition is evaluated (`CONDITION_EVALUATED`).
  - If it is met, both effects are pended in printed order.
  - Otherwise the controller picks a mode (`MODE` choice, `EFFECT_MODE_CHOSEN`), and only that effect is pended.
- `play-state.ts` validates the mode phase: `chosenEffect` is present exactly when the condition is unmet, and the pending
  effects must match the printed indexes it implies.
- `temporary-power.ts` applies and validates the `-5` modifier against the reviewed resolving Program.
- `bottom-deck.ts` applies the power filter with effective power, so negative power counts as 0.
- `conditions.ts` evaluates `FRIENDLY_GIG_IS_MIN`: a friendly rolled d4 showing 1.
- Engine identity `0.4.39-must-attack-v43` -> `0.4.40-modal-program-v44`. The baselines are regenerated once for the bundle
  this batch ships in, in a separate commit.

## Rules readings

- "Choose one effect": the controller may choose either mode even when it would do nothing, such as bottom-decking with no
  rival Unit at power 0 (10.6.1).
- "If a friendly d4 is a min Gig": checked when the Program resolves. Only the controller's own d4 counts; a rival's d4
  showing 1 does not.
- "Choose both instead": both modes resolve in printed order. So the -5 can bring a Unit to 0 or below, and the bottom-deck
  mode can then take it.
- "With power 0": a Unit whose power is below 0 counts as 0 (2.10.1), so it qualifies.

## Tests

`tests/api-admission-batch-v44.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - no `choose`, another condition, a -4 mode, an unfiltered bottom-deck, swapped modes or a third mode;
  - an added condition, Quick, cost, tags or sellability.
- Without a friendly min d4 (the rival's d4 at 1 does not count), the controller chooses one mode. The -5 mode weakens only
  the chosen Unit, and the other mode does not resolve. A forged friendly min d4 during the mode choice is invalid.
- The bottom-deck mode takes only a rival Unit with power 0, and with none it does nothing.
- With a friendly min d4 both modes resolve. A Unit at -1 is then bottom-decked. With two Units at power 0 the controller
  chooses, and a forged `chosenEffect` is invalid.
- Union membership.

The reviewed union is now 93 cards, and coverage is 93/151.
