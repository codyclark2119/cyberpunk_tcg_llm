# Card demos on the quiz (2026-11-25)

This measures [preload-card-demos-2026-11-25.md](preload-card-demos-2026-11-25.md) (prompt `assistant-chat-v10`,
PR #103) on the Mac. Card demos make the preload play each linked card once on a fixed engine board and send the
result to the model, so card questions get engine evidence without a tool call.

## What was run

Qwen3-8B 4-bit, master `6982bbc` (merge of #103), engine 0.4.77, in the separate quiz worktree. Same flags as the
v9 runs: `--max-tokens 4096`, quiz set `data/gold/quiz_mc_2026-11-13.jsonl` with `--sample 40 --seed 1..3
--pass-mark 35`, and the official set with `--pass-mark 34`. Both arms use the same prompt and the same version
stamp. The only difference is `--no-preload-demos`. Run files are in
`/mnt/project-files/assistant/v10-runs-2026-11-25/`.

## Result

| Run | v10 with demos | v10 `--no-preload-demos` | v9 with tool | v9b (stamp only) |
| --- | --- | --- | --- | --- |
| Quiz seed 1 | 28/40 | 32/40 | 35/40 | 32/40 |
| Quiz seed 2 | 32/40 | 34/40 | 35/40 | 32/40 |
| Quiz seed 3 | 30/40 | 33/40 | 36/40 | 35/40 |
| Official | 28/37 | 29/37 | 31/37 | 32/37 |

Demos cost 3 points per quiz seed on average (30.0 against 33.0) and 1 on the official set. Every run fails the
pass mark. The model made 0 tool calls in every run, as before; no run hit the length cap.

Items that changed between the arms (with demos, against without):

- Seed 1: 4 lost (cody-quiz-05, 09, 12, 34), none gained.
- Seed 2: 2 lost (cody-quiz-12, 34), none gained.
- Seed 3: 3 lost (cody-quiz-05, 09, 34), none gained.
- Official: 2 lost, 1 gained.

Every lost item had a demo in its context. The no-demo arm (33.0 mean) sits inside the stamp-noise range already
seen for v9 and v9b (33.0 to 35.3), so the loss is the demos, not the stamp.

## Why demos hurt

The traces show the model reading a demo as evidence about the question's situation, even though each demo
carries a note saying it is not:

- **cody-quiz-34** (Wild in the Streets with no spent Units; key Yes). The demo board has a spent rival Unit, so
  the play defeats it. The model reasoned that without a target "the effect cannot be fulfilled, the play is
  invalid", and cited the demo as not addressing that case.
- **cody-quiz-09** (Jacked-in Voodoo Boy played this turn, then Pyramid Song; key No, because of Lag). The model
  wrote that "engine_scenario confirms it's placed ready" and answered Yes.
- **cody-quiz-05** and **cody-quiz-12** (optional steps of Afterparty at Lizzie's and Sketchy Ripper; key Yes).
  The demo auto-picks the first option at each choice, and the model read the forced choices as mandatory steps.

A demo answers "what happens when this card is played on some board". The quiz asks about a specific situation,
often an edge case (no target, optional step, a turn-timing rule). An unrelated board's result anchors the
model on the wrong case.

## Takeaway

Generic per-card demos are a net loss for the 8B. Engine evidence would need to come from the question's own
situation (what `engine_scenario` builds when called), and the model still never calls it on its own.

`data/gold/` and `eval/runs/` are unchanged.
