# engine_scenario quiz runs, stage 2 (2026-11-25)

This is PR 5 of plan section 7 (`/mnt/project-files/plan/sections/7-engine-scenario.md`): the Mac runs with
prompt `assistant-chat-v9` and the `engine_scenario` tool (#99), against the same prompt without the tool.
Cody gave his go on 2026-11-24.

## Setup

- **Model:** Qwen3-8B 4-bit, thinking on, preload on, max tokens 4096.
- **Code:** a separate checkout of master `dc68631` (the #99 merge) on the Mac, with engine 0.4.72.
- **Weights:** the 8B weights had gone missing from the Mac since the v8 runs. With Cody's OK they were
  downloaded again at the revision pinned in `docs/local-mlx-bot.md` (545dc42).
- **Arms:** the quiz seeds draw 40 of the 64 keyed items, with a pass mark of 35; the official set has 37 keyed
  items. `--no-engine-scenario` drops the tool and its prompt line. engine_check stays on in both arms.
- **Run files:** these are not committed (like earlier runs). They are kept at
  `/mnt/project-files/assistant/v9-runs-2026-11-25/`.

## Result

| Run | v7 (no tools) | v8 with engine_check | v9 with engine_scenario | v9 `--no-engine-scenario` |
| --- | --- | --- | --- | --- |
| Quiz seed 1 | 32/40 | 27/40 | **35/40** | 29/40 |
| Quiz seed 2 | 33/40 | 30/40 | **35/40** | 32/40 |
| Quiz seed 3 | 34/40 | 31/40 | **36/40** | 31/40 |
| Official set | 30/37 | 29/37 | **31/37** | 29/37 |

With the tool offered, the 8B reaches Cody's pass bar (35 of 40) on all three seeds for the first time. The
official set is still below its pass mark of 34.

**The model never called `engine_scenario`.** It made no tool calls of its own in any of the 320 items, in
either arm; only the automatic preload lookups ran. So no answer came from a scenario the engine played. The
two arms differ only in what the model reads:

- the tool's spec (978 characters);
- the v9 guidance line (238 characters).

**The flips all go one way.** On the quiz seeds, 14 items differ between the arms, and all 14 are wrong
without the tool and right with it. They are 6 distinct questions:

- cody-quiz-01, -06, -12, -22 and -34;
- cody-quiz2-12.

On the official set, 3 items flip to right and 1 flips to wrong. This differs from the v8 noise
([engine-oracle-eval-2026-11-15.md](engine-oracle-eval-2026-11-15.md)): there, changing only the version stamp
flipped 4 to 10 items per seed in both directions. Here the no-tool arm differs from the v8 runs only by its
stamp, and it moved 2, 2 and 0 points against v8 with engine_check, which is the same kind of noise.

## What it means

- **The gain is real on this data, but it is not the tool working.** The text describing the tool and when to
  use it seems to change how the model reasons about effects, even though it never makes the call. Four of the
  6 questions are card questions with a stage-1 check (06, 12, 34 and 2-12). The other two (01 and 22)
  have none.
- **One prompt is one fixed draw.** Decoding is deterministic, so this is still a single prompt measured on
  overlapping items: the seeds share questions, and 01 and 34 flip on every seed. Before treating v9 as a real
  improvement, a cheap check is worth running: v9 with a harmless change, such as the version stamp. That would
  show whether the gain survives a different draw.
- **The tool is still unused.** As with engine_check in v8, the 8B does not reach for a tool it was not made to
  use. Getting real calls would need something more direct, for example a preload step that builds a scenario
  for card-effect questions. That is a separate change.

`data/gold/` and `eval/runs/` are unchanged by this work.
