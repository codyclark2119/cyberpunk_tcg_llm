# Documentation index

Most documents here are **dated milestone records**. Each describes the engine as it
was when written, including engine versions, artifact hashes, test counts, and
sometimes one machine's paths. They are not rewritten afterwards, and a "current"
banner inside one means current as of its own date. For present behavior, the code,
tests and committed fixtures are authoritative; for the newest capabilities, read the
latest admission batch.

The PostgreSQL layer (deck, match and command-ledger adapters, SQL migrations,
`db:migrate`) was retired on 2026-11-11; no runtime path used it. Reports dated before
then that mention PostgreSQL, its migrations or the command ledger describe it as it
was.

## Start here

| Document | Purpose |
| --- | --- |
| [../README.md](../README.md) | Setup, commands and architecture |
| [../CLAUDE.md](../CLAUDE.md) | Working rules for the engine and the AI harness |
| [ci-validation.md](ci-validation.md) | What local validation (`scripts/run_tests.sh`) runs and why it never skips |
| [comprehensive-rules-refresh-2026-11-13.md](comprehensive-rules-refresh-2026-11-13.md) | 2026-11-13: Comprehensive Rules snapshot refreshed to `updated_at` 2026-10-29 (713 -> 733 nodes; Fight, Steal and Defeat moved into section 11); `scripts/diff_rules_snapshot.py` change report (56 added, 36 removed, 144 renumbered, 44 text-changed), expected-rules id fixes, quiz questions for review, retrieval recall before and after |
| [tournament-rules-snapshot-2026-11-13.md](tournament-rules-snapshot-2026-11-13.md) | 2026-11-13: the official Tournament Rules (`updated_at` 2026-10-28, 87 nodes) added as a second, separately versioned rules document (`TR 3.4.2` ids) for the chat assistant; prompt `assistant-chat-v4`; retrieval recall before and after |
| [engine-oracle-eval-2026-11-15.md](engine-oracle-eval-2026-11-15.md) | 2026-11-15: `engine_check` held-out eval (`scripts/eval_engine_check.py`) on 309 positions from seed prefix `engine-oracle-eval-v1`: 5,743 questions, 0 settled verdicts wrong, 91.5% settled after adding the `affordable` and `sold_this_turn` filters; `eval_assistant.py --no-engine-check` for the quiz comparison; Mac quiz runs: the model never called the tool (27/30/31 with it, 28/31/31 without, v7 32/33/34), and a one-character prompt-stamp change alone moved scores by 2-4 |
| [local-match-audit.md](local-match-audit.md) | 2026-11-14: match record auditor (`scripts/audit_match_records.py`): replays each record on the running engine worker; stale engine identity, non-offered actionIds, state/final hash mismatches and fallbacks recorded as model choices are reported per record and in total, non-zero exit on any; the play UI's "Audit" tab |
| [local-strength-eval.md](local-strength-eval.md) | 2026-11-12: local strength eval (`scripts/eval_local_strength.py`): N matches per model configuration against the baseline on the same seeds, both seats; win rate with a 95% Wilson interval, agreement, fallbacks, latency, tokens; resumable; prompt v3/v4 selectable; the play UI's "Strength" tab |
| [local-match-records-v3.md](local-match-records-v3.md) | 2026-11-12: match records v3 (model path and revision per seat, chosen index, baseline pick and agreement, raw output and tokens) and optional TrainingPosition/TrainingAttempt logging from local matches (`--training-dir`) |
| [training-record-migration.md](training-record-migration.md) | 2026-11-12: Python reader/writer and match-logging hook for the TS training records (`harness/core/training_records.py`); plan for moving the gold store onto TrainingPosition |
| [local-prompt-v4.md](local-prompt-v4.md) | 2026-11-12: gameplay prompt `local-choice-v4` adds a card reference (type, cost, power, tags, keywords, trimmed rules text from the engine content bundle) for every card the acting seat can see; sizes before and after; the play UI's "Prompt size" tab |
| [local-prompt-v3.md](local-prompt-v3.md) | 2026-11-11: compact gameplay prompt (`local-choice-v3`), about a third of v2's size with every visible fact kept; `scripts/measure_prompt_size.py` |
| [local-time-budget.md](local-time-budget.md) | 2026-11-11: local decision budget (10 s default, `--budget-ms`), late model answers drained instead of cascading, failure codes in match records |
| [local-play-ui.md](local-play-ui.md) | 2026-11-11: local play UI: play a bot, launch bot-vs-bot jobs, browse match records |
| [local-match-runner.md](local-match-runner.md) | 2026-11-11: local bot-vs-bot match runner on the engine, its match record and CLI |
| [simulator-bot-retirement.md](simulator-bot-retirement.md) | 2026-11-11: external simulator HTTP bridge retired; what remains of the local policy layer |
| [simulator-bot.md](simulator-bot.md) | Retired record: external simulator v1alpha1 service, baseline policy and model integration boundary |
| [local-mlx-bot.md](local-mlx-bot.md) | Apple Silicon model download, local inference, latency benchmark and adapter loading (written for the retired bridge) |
| [migration/cyberpunk_tcg_ai-import.md](migration/cyberpunk_tcg_ai-import.md) | How the AI repository was merged in, and the authority boundary |

## Card admission

Cards reach the engine only through an explicit, reviewed admission. Batches V1–V3
were recorded in their pull requests (#4, #7, #8); later batches have documents here.

| Batch | Card | Documents |
| --- | --- | --- |
| Candidate review tooling | — | [engine-candidate-admission.md](engine-candidate-admission.md) |
| Coverage inventory (2026-11-14) | all 151 | [card-coverage-inventory.md](card-coverage-inventory.md): which cards are executable, the mechanic families the rest need, recommended order, open rules questions (`npm run coverage:cards`, play UI "Coverage" tab) |
| Constructed games (2026-11-14) | reviewed pool | [constructed-format.md](constructed-format.md): the engine already plays CONSTRUCTED; two reference 40-card decks, deck files as setups in the runner, auditor and play UI |
| Reviewed union (2026-11-15) | 39 | [reviewed-union-2026-11-15.md](reviewed-union-2026-11-15.md): every reviewed card in one content bundle; coverage now 39/151; constructed games can use all 39 |
| V4 (2026-09-17) | Japantown Jonin | [contract](api-admission-batch-v4.md), [implementation status](api-admission-batch-v4-implementation-status.md), [validation](api-admission-batch-v4-validation.md) |
| V5 (2026-09-18) | Detonate | [contract](api-admission-batch-v5.md), [implementation status](api-admission-batch-v5-implementation-status.md), [baseline completion runbook](api-admission-batch-v5-baseline-completion.md) |
| V8 (2026-11-17) | Offduty Malfini, Modded Muramasa, MaxTac Squadron | [shared spend and ready effects](api-admission-batch-v8.md); coverage 45/151 |
| V9 (2026-11-17) | Sandevistan, Modded Kusanagi, Don't Fear the Reaper | [end-turn Gear ready, return to hand, mass spend](api-admission-batch-v9.md); coverage 48/151 |
| V10 (2026-11-17) | Adam Smasher: Metal Over Meat, Jacked-in Voodoo Boy | [defeat all other Units, Program-play attack ban](api-admission-batch-v10.md); coverage 50/151 |
| V11 (2026-11-18) | Octant, Trauma Team Operatives, MaxTac Heavy | [self play-cost reductions](api-admission-batch-v11.md); coverage 53/151 |
| V12 (2026-11-18) | Bonnie and Clyde, Live with the Aftermath | [optional second defeat, each-player defeat](api-admission-batch-v12.md); coverage 55/151 |
| V13 (2026-11-18) | Screw: Lovelorn Fool | [Defeated trash-to-hand return](api-admission-batch-v13.md); coverage 56/151 |
| V14 (2026-11-18) | All Is Lost | [trash 3, return a Unit among them](api-admission-batch-v14.md); coverage 57/151 |
| V15 (2026-11-18) | Les Élémens, Unlikely Bond | [bottom-deck Units](api-admission-batch-v15.md); coverage 59/151 |
| V16 (2026-11-18) | Carnage at the Colosseum, Zetatech Berserk | [play-cost reduction on a Program and a Gear](api-admission-batch-v16.md); coverage 61/151 |
| V17 (2026-11-18) | La Llorona: Ghost of the Past, Augmented Negotiators | ["When this Unit uses Blocker" triggers](api-admission-batch-v17.md); coverage 63/151 |
| V18 (2026-11-19) | Adam Smasher: Ender of Legends | [Go Solo Legend with a Play defeat](api-admission-batch-v18.md); coverage 64/151 |
| V19 (2026-11-19) | Sketchy Ripper | [Attack-trigger Gear search](api-admission-batch-v19.md); coverage 65/151 |
| V20 (2026-11-19) | Hacked Corpo, Valentino Street Racer | [Play trash-3 Program pick and Adrenaline grant](api-admission-batch-v20.md); coverage 67/151 |
| V21 (2026-11-19) | Chrome Fang, Westbrook Netrunner | [Play steal restrictions until your next turn](api-admission-batch-v21.md); coverage 69/151 |
| V22 (2026-11-19) | Pacifica Netrunner, Memory Relapse | [Ready locks until your next turn](api-admission-batch-v22.md); coverage 71/151 |
| V23 (2026-11-19) | MaxTac AV | [Optional Gig swap](api-admission-batch-v23.md); coverage 72/151 |
| V24 (2026-11-19) | Maelstrom Goons | [Steal triggers: equipped rival discard](api-admission-batch-v24.md); coverage 73/151 |
| V25 (2026-11-19) | Wraith Marauders | [Steal trigger: ready a Unit matching the stolen Gig](api-admission-batch-v25.md); coverage 74/151 |
| V26 (2026-11-19) | 6th Street Recruits | [Friendly d6 steal: increase a Gig by up to 6](api-admission-batch-v26.md); coverage 75/151 |
| V27 (2026-11-19) | V: Roamer of the Badlands | [Steal trigger: increase the stolen Gig; end-of-turn draw](api-admission-batch-v27.md); coverage 76/151 |
| V28 (2026-11-19) | Jackie Welles: Ride or Die Choom | [Power and draw counted from friendly Gig parity](api-admission-batch-v28.md); coverage 77/151 |
| V7 (2026-11-15) | Royce: Don't Call Me Simon, Wild in the Streets, Delamain: Rideshare AI | [shared defeat filter and exact pin table](api-admission-batch-v7.md); coverage 42/151 |
| V6 (2026-09-22) | Trust No One | [contract and executable slice](api-admission-batch-v6.md), [baseline verification](api-admission-batch-v6-verification.md) |

## Demo format and self-play

| Date | Document |
| --- | --- |
| 2026-09-08 | [First demo match: execution coverage roadmap](demo-deck-coverage-roadmap.md) |
| 2026-09-10 | [DEMO_STARTER_V1: fixed-pair format and deterministic setup](demo-starter-report.md) |
| 2026-09-10 | [Demo product format review](demo-format-report.md) |
| 2026-09-10 | [Demo setup clarification follow-up](demo-setup-review-report.md) |
| 2026-09-12 | [First exact Arasaka vs Merc Demo match](exact-demo-match-report.md) |
| 2026-09-12 | [Demo match matrix and self-play readiness](demo-match-matrix-report.md) |
| 2026-09-12 | [Reboot Optics multiplicity source review](reboot-multiplicity-report.md) |
| 2026-09-12 | [Reboot Optics multiplicity implementation and resumed matrix](reboot-multiplicity-implementation-report.md) |
| 2026-09-12 | [Standard overtime execution](overtime-report.md) |

## Engine milestone reports

In the order they were written.

| Date | Document |
| --- | --- |
| 2026-09-07 | [Phase 1 implementation report](phase1-report.md) |
| 2026-09-08 | [Pre-gameplay implementation report](pre-gameplay-report.md) |
| 2026-09-08 | [Pre-gameplay contracts](pre-gameplay-contracts.md) |
| 2026-09-08 | [First deterministic turn slice](turn-slice-report.md) |
| 2026-09-08 | [Engine-owned setup and reviewed noncombat mechanics](setup-mechanics-report.md) |
| 2026-09-08 | [Reviewed noncombat card play and Spend activation](noncombat-play-report.md) |
| 2026-09-08 | [Reviewed Gear play, equip and attachment lifecycle](gear-equip-report.md) |
| 2026-09-08 | [Inherited Gear capabilities](gear-capabilities-report.md) |
| 2026-09-08 | [Reviewed attack initiation](combat-attack-report.md) |
| 2026-09-08 | [Defender React](combat-react-report.md) |
| 2026-09-08 | [Combat resolution](combat-resolution-report.md) |
| 2026-09-08 | [Combat triggers](combat-triggers-report.md) |
| 2026-09-08 | [Combat restrictions and prevention](combat-restrictions-report.md) |
| 2026-09-08 | [Kiroshi Optics: private information](private-information-report.md) |
| 2026-09-08 | [Executable card coverage](executable-card-coverage.md) (last updated 2026-09-12; excludes the V4–V6 admissions) |
| 2026-09-09 | [Field Legends / Go Solo](field-legends-report.md) |
| 2026-09-09 | [Goro Takemura, Hands Unclean: field-Legend admission](goro-field-legends-report.md) |
| 2026-09-09 | [Losing His Way attack-condition power](attack-condition-power-report.md) |
| 2026-09-09 | [Evelyn Parker, Scheming Siren: ordered ATTACK review](attack-ordered-effects-report.md) |
| 2026-09-09 | [Dying Night: ATTACK-created end-turn effects](delayed-effects-report.md) |
| 2026-09-09 | [Delamain Cab and Dying Night: end-turn history](end-turn-history-report.md) |
| 2026-09-09 | [Saburo Arasaka, Stubborn Patriarch: continuous attacking aura](saburo-attacking-aura-report.md) |
| 2026-09-09 | [Minotaur + Over the Edge: targeted defeat](targeted-defeat-report.md) |
| 2026-09-09 | [Corporate Surveillance targeted spend](targeted-spend-report.md) |
| 2026-09-09 | [Industrial Assembly + Field Operator: current value conditions](value-conditions-report.md) |
| 2026-09-09 | [Yorinobu: first qualifying attack history](yorinobu-first-attack-report.md) |

## AI harness (imported)

Documents carried over from the former `cyberpunk_tcg_ai` repository. Their paths and
setup refer to that repository; the working rules they contain are summarized in
[../CLAUDE.md](../CLAUDE.md).

| Document | Purpose |
| --- | --- |
| [ai-source/README.legacy.md](ai-source/README.legacy.md) | Original harness README: setup, data pipeline, deckbuilding, archetypes and conventions |
| [ai-source/CLAUDE.legacy.md](ai-source/CLAUDE.legacy.md) | Original working guidance, including the full list of traps already found |
| [ai-source/engine-interop.md](ai-source/engine-interop.md) | Python-to-engine JSONL boundary |
| [ai-source/api-content-bridge.md](ai-source/api-content-bridge.md) | API Content Bridge V1, the source of engine candidates |

## Historical evidence verifiers

Each admission pinned its source evidence. The verifiers are read-only and still run:

```bash
node --import tsx scripts/verify-api-admission-batch-v4-source.ts --ai-root .
node --import tsx scripts/verify-api-admission-batch-v6-source.ts --repo-root .
```

The V5 verifier additionally requires the AI checkout's HEAD to be the imported
source commit, which is an ancestor of this repository:

```bash
git worktree add /tmp/ai-source af9e0e1dd93b7eb77db5883bdd18809c8446d856
node --import tsx scripts/verify-api-admission-batch-v5-source.ts --ai-root /tmp/ai-source
git worktree remove /tmp/ai-source
```
