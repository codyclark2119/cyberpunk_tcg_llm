# Preload card demos (2026-11-25)

## Why

In the v8 and v9 quiz runs ([engine-scenario-quiz-2026-11-25.md](engine-scenario-quiz-2026-11-25.md),
[engine-scenario-quiz-noise-2026-11-25.md](engine-scenario-quiz-noise-2026-11-25.md)), the 8B made no engine tool
calls of its own in 477 items. Offering `engine_check` or `engine_scenario` therefore never put an engine answer
in front of it. Cody asked for the next step on 2026-11-25: make the automatic lookup (the preload) use the
engine itself.

## What it does

Prompt `assistant-chat-v10` has no new prompt text; only the stamp moves. The change is in the preload
(`preload.card_demos`).

- **Which cards.** For each card the preload sent with `get_card`, in order, up to 2. This covers the linked
  names in chat, or an item's given cards in the eval.
- **The board.** The engine plays the card once on a small fixed board (`engine_scenario.demo_setup`), built
  from the card's type and first colour only:
  - Seat 0 holds the card and 10 Eddies. It has a ready vanilla Unit of that colour, that Unit on top of its deck
    and in its trash, and a D4 Gig at 2.
  - Seat 1 has a spent vanilla Unit, the same deck and trash, and a D6 Gig at 3.
  - Filler Legends are face down.
- **Choices.** Any choice the card opens is resolved by its first listed option, up to 3 choices.
- **The result.** An `engine_scenario` result (`demo_brief`) carries:
  - the board in one line;
  - each step's action and changes, with payments collapsed to "paid N Eddie(s)";
  - any open choice and its options;
  - the next seat to act;
  - up to 6 offers;
  - a note saying it is a fixed board, not the question's situation.
- **Budget.** Demos have their own budget of 3,500 characters (`DEFAULT_DEMO_CHARS`). Rules, cards and implied
  rules use the same budget as before and are unchanged with demos on or off (a test pins this).
- **Determinism.** A demo depends on the card and the engine, never on the question, and is cached per engine
  identity.
- **Legends have no demo.** A Legend is Called rather than played, so it needs a different board.

One more change in `engine_scenario.for_model`: a choice step is now named by its option (`chose
BOTTOM_DECK_UNIT`), not the engine's label. Every mode of a modal Program carries the same generic label
("Decrease by 1"), which would have told the model the wrong effect.

`eval_assistant.py --no-preload-demos` turns demos off, for the comparison. The header then records
`preload_demos: false`.

## Coverage

Engine 0.4.77, 129 admitted cards:

- 109 Units, Programs and Gear: every one gives a demo that plays to the end with no stop and no engine fault.
  The four vanilla fillers needed a fix: each one demos against another colour's filler, so it doesn't break the
  three-copy limit.
- 20 Legends: no demo.
- Size: a demo result is 1,246 characters at the median and 2,702 at most, so two usually fit the budget.
- Time: about 3 s per card, uncached, on the cloud container.

## Not measured yet

Whether demos change quiz scores needs Mac runs: v10 against `--no-preload-demos` on seeds 1-3 and the official
set. Both arms carry the same stamp, so the comparison is not confounded by stamp noise. These runs wait for
Cody's go.

`data/gold/` and `eval/runs/` are unchanged.
