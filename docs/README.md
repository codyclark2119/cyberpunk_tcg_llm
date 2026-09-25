# Documentation index

Most documents here are **dated milestone records**. Each describes the engine as it
was when written, including engine versions, artifact hashes, test counts, and
sometimes one machine's paths. They are not rewritten afterwards, and a "current"
banner inside one means current as of its own date. For present behavior, the code,
tests and committed fixtures are authoritative; for the newest capabilities, read the
latest admission batch.

## Start here

| Document | Purpose |
| --- | --- |
| [../README.md](../README.md) | Setup, commands and architecture |
| [../CLAUDE.md](../CLAUDE.md) | Working rules for the engine and the AI harness |
| [ci-validation.md](ci-validation.md) | What PR Validation runs and why it never skips |
| [simulator-bot.md](simulator-bot.md) | External simulator v1alpha1 service, baseline policy and model integration boundary |
| [migration/cyberpunk_tcg_ai-import.md](migration/cyberpunk_tcg_ai-import.md) | How the AI repository was merged in, and the authority boundary |

## Card admission

Cards reach the engine only through an explicit, reviewed admission. Batches V1–V3
were recorded in their pull requests (#4, #7, #8); later batches have documents here.

| Batch | Card | Documents |
| --- | --- | --- |
| Candidate review tooling | — | [engine-candidate-admission.md](engine-candidate-admission.md) |
| V4 (2026-09-17) | Japantown Jonin | [contract](api-admission-batch-v4.md), [implementation status](api-admission-batch-v4-implementation-status.md), [validation](api-admission-batch-v4-validation.md) |
| V5 (2026-09-18) | Detonate | [contract](api-admission-batch-v5.md), [implementation status](api-admission-batch-v5-implementation-status.md), [baseline completion runbook](api-admission-batch-v5-baseline-completion.md) |
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
