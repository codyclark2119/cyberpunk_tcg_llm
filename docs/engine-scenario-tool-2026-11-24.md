# engine_scenario as an assistant tool (2026-11-24)

This is PR 4 of plan section 7 (`/mnt/project-files/plan/sections/7-engine-scenario.md`). Stage 1
([engine-scenario-checks-2026-11-24.md](engine-scenario-checks-2026-11-24.md)) showed the engine can settle 21 of
the 24 keyed card questions when the situation is set up exactly. This change gives the chat assistant the same
tool, so stage 2 (PR 5, Mac runs) can measure whether the 8B model writes such setups and reads the report.
No model has run with it yet.

## What changed

- **Prompt `assistant-chat-v9`.** One line is added after v8's engine_check line (238 characters, budget 280):
  for what a card's effect does in a specific situation, build it with `engine_scenario`, play the steps, answer
  from the changes and offers and say the engine showed it; if it stops, fix the setup or steps from its message.
  It names no card. Nothing else in the prompt moved.
- **The tool** (`tools.py`, spec 978 characters, budget 1,100). It takes `setup` (object) and `steps` (array).
  Python checks only the step list's shape; the engine builds the board and judges every step.
- **Short setups** (`engine_scenario.complete_setup`). Missing zones default to empty and `activeSeat` to 0. A
  seat with no Legends gets three face-down filler Legends: the tool orders candidate triples by the colours of
  that seat's cards and keeps the first one `composeScenario` accepts, so the engine alone decides what a legal
  deck is. It gives up after 60 tries with the RAM rule in the message (each Legend gives 2 RAM of its colour).
  The report lists the filler and says it does nothing unless Called.
- **The model's view** (`for_model`). Step labels instead of descriptor objects, offers as short strings (at most
  25 per step, with the full count), the open choice, the next seat, and where a run stopped. Raw engine errors
  stay out of the report; a refused setup returns them in the tool error, with their paths.
- **Chat page.** An answer whose trace has a played `engine_scenario` carries an "engine scenario" badge with
  the outcome ("1 step played", "stopped at step 2"), and a `scenario` button opens the start board, every step's
  action, changes and offers, any stop, and the final board in the side panel. A refused call gets no badge. The
  Tools tab takes the setup and the steps as JSON (array fields now get a JSON box) with placeholder examples and
  shows the same view above the raw JSON.
- **Eval.** `scripts/eval_assistant.py --no-engine-scenario` drops the tool and its prompt line; the header records
  `engine_scenario: false` and the prompt's sha256. It combines with `--no-engine-check`.

## Caveats

- The filler Legends make a short setup legal, but they are real cards: a seat can Call one. The report's offers
  show those Calls, and the note says they do nothing unless Called.
- `test_assistant_loop`'s refusal test had a 72-character margin against the prompt and specs; the new tool's
  spec pushed it over. The test now plays one more search, so the results it can drop outweigh the estimator's
  pessimism with room to spare. The loop itself did not change.
- The quiz numbers for v9 do not exist yet. PR 5 runs v9 with and without the tool (seeds 1-3 and the official
  set) on the Mac, with Cody's go given on 2026-11-24.

```bash
python scripts/test_engine_scenario.py   # adds complete_setup, for_model and the tool
python scripts/test_assistant_prompt.py  # v9 line and spec budgets, the schema snapshot
python scripts/test_assistant_ui.py      # badge, side panel, Tools-tab form
python scripts/test_assistant_eval.py    # --no-engine-scenario header and tool set
```
