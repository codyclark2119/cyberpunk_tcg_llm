# Engine scenario checks, stage 1 (2026-11-24)

This is stage 1 of plan section 7 (`/mnt/project-files/plan/sections/7-engine-scenario.md`, PR 3). It asks one question: can the engine answer the card questions in Cody's quizzes and the official test, if the situation is set up exactly? No model is involved.

Cody approved hand-writing these scenarios from the quiz questions on 2026-11-21, on two conditions: they measure the engine only, and they are never used in prompts or training.

## What was run

`data/scenario/quiz-checks-v1.json` holds one scenario for each keyed card question, 24 in all. Many are repeated between the two quiz files and the official test, so the 24 cover 39 question ids.

Each scenario has four parts:

- **A setup.** It is built by the engine's `composeScenario` op ([engine-scenario-2026-11-21.md](engine-scenario-2026-11-21.md)) and is always a legal Constructed deck.
- **Up to 8 steps.** Each one is matched to an action the engine offered, through `games/cyberpunk/assistant/engine_scenario.py` (#97).
- **A reading.** This names the offer, diff line or open choice in the tool's report that answers the question. `preconditions` check that the setup did what it was written for.
- **A letter map.** It turns the reading into an answer letter.

`scripts/eval_engine_scenarios.py` runs every scenario on the real engine and compares the engine's letter with the key in `data/gold`. It writes the result to `data/scenario/quiz-checks-v1.report.json`. The checks file holds no question text and no keys. A test pins that only that script and its test read `data/scenario`.

## Result

Engine 0.4.72-gear-legend-v75 (125/151 cards):

| Outcome | Questions |
| --- | --- |
| Agrees with the key | 21 |
| Disagrees | 0 |
| Out of reach | 2 |
| Engine error | 1 |

The engine settles 21 of the 24 card questions, and every answer it gives matches the key. A control check for q36 (`cody-quiz-36-control`, see below) also behaves as expected.

**Out of reach.** cody-quiz-06 (Carnage at the Colosseum) and cody-quiz2-16 (Zetatech Berserk) both ask whether the card's effect changes its cost when played; the key is No. The engine shows only what was paid: 6 printed, 4 paid, in both cases. No admitted effect reads a Program's or Gear's cost while it is being played, so no scenario can tell "cost changed" apart from "pays less". Both are recorded with the payment as evidence.

**Engine error.** cody-quiz2-29 asks whether Adam Smasher can attack after defeating MaxTac Suppression Team. `observe` throws `UNSUPPORTED_CONTINUOUS_MODIFIERS` on any state with MaxTac on the field. This is an engine bug, not a scenario problem; the engine thread has a fix for bundle 10. The check reruns unchanged once that merges.

## Caveats

- **Written with the keys in view.** These scenarios are not blind. I wrote each one knowing the key, so a scenario could in principle be built to agree. Two were changed after a first run:
  - **cody-quiz-36 (Satori).** The first attacker, Swordwise Huscle, reached power 5 with Satori's +2 and drew a card from its own Attack ability. That looked like Yorinobu's ARASAKA draw. I replaced it with La Llorona, which has no attack ability. I also added a control check: an actual ARASAKA Unit attacking under the same Legend must draw, and it does.
  - **cody-quiz2-12 (Safety Override).** The question is ambiguous. The first reading asked "does playing it open a target choice?"; the engine says no, which disagrees with the key (Yes). The recorded reading is "does it apply to a Unit already on the field?": a friendly Unit loses a fight and the rival Unit is defeated, which agrees with the key. Both facts are stated in the check's `what`.
- **cody-quiz-26 (Animals Wrecker with Adrenaline Converter).** The quiz's pair is not a legal deck: Wrecker needs RED 3 and the Converter YELLOW 4, more RAM than 3 Legends give. The scenario uses Rockn' Rockerboy, another vanilla Unit, instead. The precondition checks that it had Adrenaline before the steal.
- **cody-quiz-11 (Rogue Amendiares with The Relic).** This reading is weak. Rogue arrives after the React step has closed, and the engine never offers its Quick ability to that seat. That agrees with the key (No). The sealed-event part of the question is not modelled.
- **Hidden-information questions work.** cody-quiz2-35 (does Bootleg reveal the card it sells?) is read from a new diff line, "seat N now sees its rival's ...". The tool emits it when one seat's own view starts showing a card the other seat holds in a private zone. It did not fire here, which matches the key.

## Tool fixes the scenarios exposed

These are in `engine_scenario.py`:

- **Legend slots close up.** When a Legend leaves the Legends area (Go Solo), the slots move down. Face-down Legends are now named by their order among the Legends not yet seen face up, instead of by their setup index.
- **Calls read as one line.** A Call is now a single "face-down Legend -> face up" line, not a vanish plus an appear.
- **Combat shows in the report.** The diff and the board show the open combat: its stage, the attacker and the target. A step's `target` is applied only to the attack's own target choice. If the engine locked the target in, the step says so.
- **Trigger order choices are readable.** They are named by their label, and a step can pick one by the card its label names.
- **Engine faults stop the run.** A worker failure stops the run as `engine_error`, with a message that carries no request id. The report keeps the last position the engine could observe.

## What it means for stage 2

The engine work can answer the card questions. That covers 21 of 24 now, 22 once the MaxTac fix lands, and the other 2 cannot be decided by any engine. What remains is whether the 8B model can write such scenarios and read the report (plan section 7, stage 2). That needs prompt v9, the tool registration and the UI (PR 4), and then Mac runs with Cody's go (PR 5).

```bash
python scripts/eval_engine_scenarios.py           # rerun and rewrite the report
python scripts/eval_engine_scenarios.py --check   # compare with the committed report (engine identity aside)
python scripts/test_engine_scenario.py            # includes the same comparison
```
