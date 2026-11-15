# engine_check held-out eval (2026-11-15)

This is PR 4 of the engine oracle plan. It checks how often the assistant's `engine_check` tool agrees with the engine on positions that are not in its catalog. It also adds a with/without switch to the quiz scorer. This report records the tool side. The quiz runs under prompt `assistant-chat-v8` are a later step on the Mac, and their results get their own dated section here.

## Held-out positions

`build_oracle_positions.py --eval --seeds 6` plays the fixed Demo decks on seed prefix `engine-oracle-eval-v1`. It records the positions exactly as the catalog builder does, but writes them to `data/oracle/eval-positions-v1.jsonl` and never caches them. The prefix was reserved in PR 1, and it shares no seed with the catalog (`engine-oracle-v1`) or with the LoRA items (`engine-tf-v1`).

| | Catalog | Held-out |
| --- | --- | --- |
| Positions | 677 (12 seeds) | 309 (6 seeds) |
| Main / React | 565 / 112 | 260 / 49 |
| Engine | `0.4.2-lag-order`, `ec4954…` | same |

## Method

`scripts/eval_engine_check.py` builds the questions. For each friendly card copy in each held-out position, it asks every play the tool knows:

- **attack** and **block**: each copy on the battlefield;
- **attack_target**: each battlefield copy against each rival Unit;
- **play_from_hand** and **sell**: each copy in hand.

Each question fills every filter the tool accepts from that position:

- the step;
- the card's ready or spent state, lagging, and played this turn;
- for `attack_target`, the target's state;
- for a card in hand, whether its cost can be paid now and whether a card was already sold this turn.

The answer is what the engine offered for that exact copy. Python judges no legality.

| Outcome | Meaning |
| --- | --- |
| correct | the verdict was `offered` and the engine offered it, or `not_offered` and it did not |
| wrong | a settled verdict, and the engine did the opposite |
| depends | the catalog has both answers for these facts |
| no_position | the catalog has no match for these facts |

## Results

There were 5,743 questions over the 309 held-out positions. No settled verdict was wrong, and 91.5% of questions got a settled verdict.

| Play | Questions | Correct | Wrong | Depends | No position | Answered |
| --- | --- | --- | --- | --- | --- | --- |
| attack | 616 | 600 | 0 | 0 | 16 | 97.4% |
| attack_target | 1,657 | 1,346 | 0 | 0 | 311 | 81.2% |
| play_from_hand | 1,427 | 1,282 | 0 | 143 | 2 | 89.8% |
| sell | 1,427 | 1,425 | 0 | 0 | 2 | 99.9% |
| block | 616 | 600 | 0 | 0 | 16 | 97.4% |
| **all** | **5,743** | **5,253** | **0** | **143** | **347** | **91.5%** |

The report is `data/oracle/eval-fidelity-v1.json`. `python scripts/eval_engine_check.py --check` recomputes it, and `scripts/test_engine_check.py` does the same as part of the quick tier.

### Two filters added before any v8 quiz run

The first pass used the PR 2 filters. Settled answers were still never wrong, but only 65% of questions got one. Most hand plays came back `depends`: `play_from_hand` was answered 13% of the time and `sell` 71%. The tool's own `facts_that_split` named the missing facts:

- for `play_from_hand`: "card affordable now: False" (22 cases);
- for `sell`: "a card was sold this turn: True" (12 cases).

So `engine_check` gained two optional yes/no filters, still under v8:

- `affordable`: can the card's cost be paid now (the catalog's recorded `affordable` fact);
- `sold_this_turn`: was a card already sold this turn.

The tool spec went from 1,025 to 1,240 characters, and its budget in `test_assistant_prompt.py` went from 1,100 to 1,300. Both filters only narrow which recorded positions match; neither one is a rule.

### What is left

- **attack_target, no position (311).** These are attacker and target pairs whose exact facts the catalog never saw together.
- **play_from_hand, depends (143).** These are hand plays where the stated facts still do not decide the answer.

In both cases the tool says so rather than guessing. A larger catalog, or the constructed positions planned with the engine-expansion thread, would shrink both.

## The quiz switch

`eval_assistant.py --no-engine-check` runs the same prompt version without the tool:

- the tool's spec is not offered;
- `ENGINE_GUIDANCE` is left out of the system prompt;
- a call to the tool is refused as `unknown_tool`.

The header then records `engine_check: false`, the reduced `tool_specs_sha256` and `system_prompt_sha256`. A default run, with the tool on, records nothing new, so its header is unchanged.

The planned comparison runs mixed seeds 1-3 and the official set with and without the tool, with per-item diffs. It is not run yet, because it needs the Mac. Expected lift, from the plan: 0-2 questions, since only the 29 Demo cards can appear in positions.

`data/gold/` and `eval/runs/` are unchanged by this work.
