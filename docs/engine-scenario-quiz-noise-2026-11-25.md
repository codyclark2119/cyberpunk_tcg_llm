# v9 quiz noise check (2026-11-25)

This follows up [engine-scenario-quiz-2026-11-25.md](engine-scenario-quiz-2026-11-25.md). With the
`engine_scenario` tool offered, prompt v9 scored 35, 35 and 36 on quiz seeds 1-3, even though the model never
called the tool. Cody asked for a check of whether that survives a harmless change.

## What was run

The setup was the same as the v9 runs: the same checkout (`dc68631`), model, flags and items, with engine_scenario
on. The only change was `ASSISTANT_PROMPT_VERSION`, set to `assistant-chat-v9b` in a local uncommitted edit that
was restored after the runs. That changes only the version stamp at the end of the system prompt. The run files
are with the others in `/mnt/project-files/assistant/v9-runs-2026-11-25/` (`*-v9b-*`).

## Result

| Run | v9 with tool | v9b with tool (stamp only) | v9 `--no-engine-scenario` |
| --- | --- | --- | --- |
| Quiz seed 1 | 35/40 | 32/40 | 29/40 |
| Quiz seed 2 | 35/40 | 32/40 | 32/40 |
| Quiz seed 3 | 36/40 | 35/40 | 31/40 |
| Mean | 35.3 | 33.0 | 30.7 |
| Official set | 31/37 | 32/37 | 29/37 |

The model again made no tool calls of its own.

- **The pass does not hold.** With only the stamp changed, the tool arm reaches 35 on one seed of three. The v9
  result (35/35/36) was partly a lucky draw: changing the stamp alone moved 3, 3 and 1 points.
- **Some gain does hold.** Both draws with the tool text beat the no-tool arm on average (35.3 and 33.0 against
  30.7). The official set is 31 and 32 against 29, and 32/37 is the best official score so far, though still under
  its pass mark of 34.
- **The steady items are card questions.** cody-quiz-06, cody-quiz-34 and cody-quiz2-12 are right in both draws
  with the tool text and wrong without it, on every seed where they appear. All three have stage-1 scenario checks.
  cody-quiz-01, -12 and -22, which flipped to right in v9, went back to wrong in v9b, so those flips were noise.

## What it means

The tool's description and guidance line seem to help the 8B on a few card-effect questions, worth about 2 to 3
points on average, but this is within reach of the stamp noise, and it does not reliably clear the 35/40 bar. The
model still never calls the tool, so the engine itself has not yet answered a quiz question for it.

`data/gold/` and `eval/runs/` are unchanged by this work.
