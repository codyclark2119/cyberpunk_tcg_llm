# Reboot Optics multiplicity implementation and resumed matrix

**Model A implemented: every matching occurrence consumes on the same qualifying fight.** The second physical Reboot is legal even when redundant. This successor implements the user's supplied ruling; the earlier [source-blocked report](reboot-multiplicity-report.md) and its source evidence remain historical and unchanged.

## Runtime

Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine **0.4.0-reboot-multiplicity-1**, artifact `2e9f69a2ae2bd2aeecdf305c2e79e67ab3219fc1248098a94c396d4ab27915f8`. Ruleset stays `beta@demo-overtime-1`, hash `0cf3dcd40766cd4b699e16842a0b6a66d3b1ecdf9b678986bf7686139dc800ab`; there was no explicit maximum-one rule in the ruleset to change. Current exact content manifest is `aff7971042134c8de38a1c342ecf961cacbc1b8dd87b2262046fdf22c1319e56`, changed only by the engine pin. The application version, dependencies, lockfile and exact deck composition remain unchanged.

## Previous source blocker

The initial fixed matrix attempted nine games: six supported terminals and three reachable overlaps at 003/A turn 12, 003/B turn 5 and 004/A turn 9. The earlier fresh public-source review could not uniquely decide overlap consumption. That finding is not rewritten. Its 14-section report, focused source fixture, initial matrix hash `fa8b1bc2e2a624dac52d3e4af8f5587ca17f6acd8c06cf0931f069abed57fe1f`, compact original prefixes and descriptor review remain pinned.

## Ruling supplied

The [successor ruling fixture](../tests/fixtures/reboot-multiplicity-ruling.v1.json) records the exact supplied wording:

> If two Reboot Optics effects are outstanding, they are consumed by that same qualifying fight, making playing two before the fight redundant.

Authority for this implementation is the **user-supplied ruling in this milestone request**. Its attachment SHA-256 and receipt date are recorded. No publisher response, author, URL or publisher timestamp was supplied; none is invented or attributed as independently verified. This resolves Model A for the task. No new corpus retrieval, publisher message or clarification request was made.

## Reboot exact card shape

`reboot-optics@1` is unchanged: Blue Program / Quickhack, Quick, cost 2 Eddies, Blue RAM 2, sellable, no printed power. Its complete source text remains:

> {Quick} The next time a rival Unit fights this turn, it doesn't defeat the opposing friendly Unit.

All five reviewed printings, provenance, errata review, execution metadata and the generic `CREATE_NEXT_RIVAL_FIGHT_PREVENTION` ability remain intact. Revision hash is still `dbc84769ae27e11b67d34f83ed7d1be60b96d794289f65544b624265b86e1243`. All **53 prior immutable revisions** in the complete reference-support bundle compare identically; all 36 older replay content revision arrays also match their frozen originals, including older synthetic variants. The exact Demo bundle still contains 29 real revisions and 60 physical copies, exactly two Reboots in Merc.

## Single-copy behavior

The original single-copy create, consume, prevention, expiry and defeat-continuation payload shapes are preserved. Frozen compatibility covers every prior action, including the standalone prevention family and the exact completed 000/A single-Reboot game. Fight results remain truthful; a friendly win or reviewed 0–0 fight still consumes one occurrence. Source movement does not cancel the effect. No-fight attacks retain it; cleanup expires it. No legacy card or rules pin was revised to disguise a semantic change.

## Multiplicity architecture

`packages/engine/src/fight-prevention.ts` now appends a complete occurrence and sorts by occurrence ID. Resolution snapshots all qualifying occurrences, filters each actual defeat once, emits consumption for each occurrence and keeps only nonmatching active records. There is no maximum of two, card-name branch, replacement DSL, generic stack or new choice. Dying Night remains separate scheduled end-turn work.

The domain's existing `fightPreventions[]` shape is reused. Zero is canonically represented by the absent optional property; empty arrays remain invalid, as before. The consumed proof is additive: the existing `appliedPrevention` field remains canonical for a single occurrence, while `appliedPreventions[]` retains the complete consumed set for two or more. Both fields together are invalid. This preserves old single-copy state/wire payloads without throwing away multi-source provenance.

## Second-copy legality

The singleton exclusions were removed from `canPlay`, direct `PLAY_CARD` admission and effect creation. Normal timing, Quick, source-in-hand/controller, supported full card shape, printed payment and deck/RAM constraints remain intact. The redundant play is an ordinary legal strategic action. Direct submission succeeds and completes the normal Program-to-Trash lifecycle.

The matrix detector was replaced by a positive assertion: an otherwise affordable additional prevention must appear in `listLegalActions`. It still aborts if that legality regresses, before the policy can bypass the problem. The chooser, rankings, seeds and deck lists are unchanged.

## Physical occurrence identity

Each record retains `id`, physical `sourceId`, `controllerId`, `createdTurn` and end-turn expiry. Identity remains the existing hash of effect protocol, physical source, controller seat and turn. Different physical copies therefore have distinct IDs.

The reviewed mechanics cannot return a resolved Reboot Program from Trash and legitimately play that same physical source again during the turn. No speculative ordinal was added. The creation handler rejects registering an already-outstanding physical source again, and validation rejects duplicate source/occurrence records. A future reviewed Program-return mechanic must reopen this identity audit before same-source replay is admitted.

## Two-outstanding state

Exact 003/A reaches two independent Merc records after action 207, from `p1-c28` and `p1-c29`, both Programs in Trash. Canonical order is by occurrence ID, not registration chronology. Both records retain their original controller and turn-12 expiry. The other two unchanged coordinates also resolve the second copy and reach a valid two-outstanding state.

## Qualification

Qualification is unchanged and controller-relative: actual opposing fight participants must include a Unit rival to the effect's stored controller and its opposing friendly Unit. A friendly attacker versus rival defender qualifies. An attack declaration, React opening, Blocker declaration or Gig steal without a fight does not.

The snapshot is taken when the existing fight-prevention subsystem applies the fight result, after the already-reviewed fight-trigger continuation. Current reviewed triggers cannot play/register a new Reboot during that resolution. The snapshot is a separate array, and only its IDs are removed; later or nonmatching work is not implicitly erased. Invalid fights do not receive invented semantics.

## Same-fight consumption

For a qualifying fight with matching A and B, both consumption facts are emitted in canonical ID order, and zero matching occurrences remain. The semantic defeat filter uses whether **any** matching occurrence protects the relevant friendly Unit; it does not process a duplicate defeat for every source. Model B sequential protection is not implemented.

## Redundant protection consumption

Focused regressions cover a friendly win with no defeat to prevent, and a reviewed 0–0 fight. Both occurrences still consume. The trigger is occurrence of the qualifying fight, never an attempted or actual defeat. A deliberately redundant second play is permitted.

## Fight-result behavior

Effective powers, comparison powers, winner and losers remain untouched. A focused Satori/Dexter regression directly compares the single- and two-Reboot `FIGHT_RESULT` payloads. The exact 003/A fight at action 211 remains a **6–6 positive tie** between Merc Psycho Squad (`p1-c24`) and the rival participant (`p0-c19`); both are truthful losers.

## Prevented defeat

In that exact tie, the friendly Psycho Squad's defeat is filtered, while the rival defeat proceeds through normal owner ordering. There is one `FIGHT_DEFEAT_PREVENTED` fact for the actual filtered defeat. Two consumed sources do not imply two prevented defeat attempts.

## DEFEATED trigger behavior

A protected friendly Unit emits no `CARD_DEFEATED`, no defeat movement and no `WHEN_DEFEATED` binding. The focused real Dexter regression verifies that suppression while a truthful opposing Satori fight-win draw still occurs. Its unprotected control verifies actual Dexter defeat. The effect does not rewrite loss into victory.

## Gig-area no-fight behavior

With both occurrences active, a Gig-area attack without a Blocker proceeds to Steal and leaves both records intact. Neither is consumed at attack/React/Steal timing. The same focused legal resolution then reaches end-turn expiry of both records.

## Blocker fight

A real reviewed Blocker redirects the attack into a Unit fight, and both occurrences consume against those actual participants. The originally declared Gig area does not consume anything on its own.

## Later same-turn fight

A focused second fight after both occurrences consume defeats the formerly protected friendly Unit normally. The second attacker is a distinct existing physical Unit placed through a clearly labeled trusted arrangement; no fictional ready action or new content is introduced. The exact promoted path independently confirms zero active remainder after the first fight.

## End-turn expiry

Every unused occurrence expires at the same existing cleanup boundary, with a separate `FIGHT_PREVENTION_EXPIRED` fact. In exact 003/B, both expire at action 66; in 004/A, both expire at action 172. Those coordinates do not encounter a qualifying fight before expiry, so they are evidence for unused multiplicity, not double-fight consumption. No occurrence carries into the next turn.

## Events

The vocabulary is unchanged. Creation emits one `FIGHT_PREVENTION_CREATED` per physical play. A qualifying overlap fight emits **two `FIGHT_PREVENTION_CONSUMED` facts**, each containing effect/source/controller and fight participant identities. Expiry likewise emits one fact per unused occurrence.

Each filtered defeat emits one existing `FIGHT_DEFEAT_PREVENTED`, attributed to the first protecting occurrence in canonical ID order. This is only representative event attribution; all contributing occurrences are recorded separately in consumption facts and retained in the plural continuation proof when owner ordering needs it. There is no duplicate `FIGHT_RESULT`, Program resolution or `CARD_DEFEATED` event, and no card-specific double-Reboot event.

## Observation

The existing public occurrence-array projection already supports zero, one and two records for both viewers. No new hidden information is exposed. Exact matrix and PostgreSQL traversal audit both observers before every action, including hidden hand/deck, Eddie and face-down Legend boundaries. Publicly played Reboot provenance remains visible independently of its current source zone.

Fight-time multiplicity creates no strategic choice or new TrainingPosition. The second ordinary PLAY can be a strategic action; automatic consumption remains engine-owned. A trusted focused regression also makes a protected friendly field V attack and lose to real Minotaur: both consume, V remains in the field, and its ordinary unprotected removal rules are unchanged.

## Hash behavior

No hash protocol was broadly changed. Generation sorts active occurrences and plural proof by ID; validation rejects unsorted or duplicate arrays. This supplies one canonical valid representation for an unordered matching set, without a strategic ordering choice or irrelevant creation ordinal.

Focused tests hold every other field—including payment and zones—identical while varying only zero/one/two occurrences. PositionHash and both public observation hashes differ. After qualifying consumption the active collection is absent. Engine and content-manifest pins change ReplayStateHash/current artifact identities as expected; original semantic compatibility was tested under repinned contexts before any regeneration.

## State validation

Validation checks supported physical revision/primitive, valid stored controller, deterministic occurrence identity, current creation/expiry turn, distinct physical plays, nonempty canonical ordering and appropriate continuation stage. Legacy single and plural consumed proof are mutually exclusive. Active records cannot duplicate consumed sources/IDs or remain applicable to the already-resolved fight whose proof is retained. Targeted non-fight defeat continuations reject either prevention-proof form.

Focused negative cases cover duplicate IDs/sources, stale or forged identity, invalid source, expiry, empty/unsorted arrays, duplicate proof, mixed single/plural proof and consumed records left active alongside the defeat continuation. Failed validation/submission leaves the input state unchanged. Existing rules/continuation validation is not weakened. Full replay/event-history and stored-state comparisons provide chronological provenance checks beyond isolated snapshot coherence.

## Exact 003/A reproducer

The original **206 actions** replay unchanged. The unchanged observation-only policy selects the now-legal second Reboot at action **207**, immediately reaching two occurrences. Fight action **211** consumes both and preserves their complete plural proof while the rival's owner orders defeat/Trash movement. The promoted [positive exact replay](../tests/fixtures/reboot-multiplicity-replay.v1.json) reaches Arasaka's normal turn-start win at turn **13**, with **218 actions, 180 positions and 864 events**. Current final ReplayStateHash: `bc40b89b6815539884e10d3762dfb085a50e7303fcb29e843c9021c5f6ef16e5`.

The old 206-action family is retained as a current-engine traversal of the historical stopping prefix; it is labeled `HISTORICAL_PREFIX`, not a current engine failure. Original action/hash evidence remains unchanged in `reboot-multiplicity-reproducers.v1.json` and in the pre-edit frozen payload copy.

## Exact 003/B reproducer

The original **51 actions** replay unchanged; second PLAY is action **52**, payment finishes with two occurrences after **54**, and both expire at **66**. The game completes with **224 actions** and an Arasaka normal turn-start win. Full acceptance metadata, counts and final hashes are in [reboot-multiplicity-acceptance.v1.json](../tests/fixtures/reboot-multiplicity-acceptance.v1.json). No state or policy alteration was needed.

## Exact 004/A reproducer

The original **144 actions** replay unchanged; second PLAY is action **145**, two occurrences are active after **147**, and both expire at **172**. The game completes with **293 actions** and an Arasaka normal turn-start win. This coordinate, 003/B and 003/A no longer classify as `OVERLAPPING_REBOOT`.

## Original payload compatibility

All **36 families / 2,182 actions** were frozen before runtime edits under `/tmp/tcg-reboot-model-a-before/replays`. The original compatibility command passed before any generator ran: semantic legal actions/descriptors, actor observations, events and final states were preserved under new engine pins. The three exact-prefix successor regressions additionally compare both observations and every original action/event and normalize only historical engine pins for frozen state/position-hash comparisons.

`exact-demo-match-0` remains the same no-Reboot game: Arasaka normal win, turn 14, 244 actions, 195 positions and 975 events. Completed 000/A still preserves its single-Reboot game semantics. The complete 53-revision support bundle and every older replay's card revision array remain identical. After regeneration, the promoted positive family brings Python traversal to **37 families / 2,400 actions**.

Regeneration is distinguished from replaying a frozen payload. Thirteen older fixture generators use first-match selection from legal actions sorted by opaque action ID. Those IDs bind the full position for older bundle protocols, including engine pins; after repinning, these generators choose some different but equally legal physical cards, despite unchanged observations at the first divergent decision. This is existing generator selection sensitivity, not a failure to replay the original actions. All 36 regenerated families retain their initialization, action counts and immutable card arrays. The protected standalone single-Reboot, exact 000/A, original headline and 003/A historical-prefix sequences retain their exact action/event/actor-observation payloads.

Affected generator families: combat-attack, defeated, fight, first-blue, gear, gig-steal, mandibular, noncombat, permissions, react, satori, setup and turn. Future generator maintenance should select explicitly by stable semantic criteria where cross-engine selection stability is intended. The observation-only Demo policy already selects deterministically without this incidental opaque-ID ordering and was not changed.

## Base matrix resumed

Only after focused tests and all three unchanged exact prefixes crossed did generation restart at `demo-matrix-000`, using the original FIRST/keep-keep 32 seeds × A/B schedule, unchanged chooser and original caps/stop policy. Canonical successor results are written to `demo-match-matrix-reboot.v1.json`, coverage to `demo-match-coverage-reboot.v1.json`; the initial matrix/coverage stay untouched. Trusted traces use `/tmp/tcg-reboot-model-a-traces`.

**64/64 supported terminals**, 0 failures and 0 unattempted. Base totals: 15,991 actions, 12,871 strategic positions and 64,403 events. Both seat mappings complete 32 games. The completed successor matrix hash is `507af4bcca05d2d53428649f7547e643a6ce24f02a0bcd840ab3dad07be4cc48`; unchanged policy source hash `4c253121db4d40c253d570b1f2d361c8e8b924b9a3782ab99462fca9626f2ee6`.

## Base matrix completion/failures

| Measure | Base result |
| --- | --- |
| Terminal reasons | EMPTY_DRAW: 1, OVERTIME_GIGS: 25, START_TURN_GIGS: 38 |
| Winning decks | ARASAKA_DEMO_V1: 55, MERC_DEMO_V1: 9 |
| Turns: minimum / median / maximum | 9 / 13.5 / 15 |
| Actions: minimum / median / maximum | 103 / 258 / 377 |
| Positions: minimum / median / maximum | 86 / 205.5 / 299 |
| Unexpected errors / policy cycles / caps | 0 / 0 / 0 |

## Variant matrix

Started only after all 64 base games completed. **128/128 supported terminals**, 0 failures, 0 unattempted. Variant totals: 32,170 actions, 25,929 strategic positions and 131,262 events. Terminal reasons: EMPTY_DRAW: 4, OVERTIME_GIGS: 44, START_TURN_GIGS: 80. Winners: ARASAKA_DEMO_V1: 113, MERC_DEMO_V1: 15.

| First-player preference | Mulligans by seat | Completed / planned | Normal / empty draw / overtime |
| --- | --- | --- | --- |
| FIRST | KK | 16/16 | 12 / 1 / 3 |
| FIRST | MK | 16/16 | 13 / 0 / 3 |
| FIRST | KM | 16/16 | 8 / 2 / 6 |
| FIRST | MM | 16/16 | 8 / 0 / 8 |
| SECOND | KK | 16/16 | 11 / 0 / 5 |
| SECOND | MK | 16/16 | 10 / 0 / 6 |
| SECOND | KM | 16/16 | 9 / 1 / 6 |
| SECOND | MM | 16/16 | 9 / 0 / 7 |

K means keep, M means mulligan; settings are by physical seat. Together the fixed base and variants exercise **192 games / 48,161 actions / 38,800 positions**. Sixteen variant FIRST/KK coordinates deliberately duplicate the corresponding base coordinates; this is the predeclared schedule, not 192 distinct configurations. The full `--check` rerun reproduced the canonical matrix, coverage and promoted artifacts exactly.

The existing 16 setup-only preference checks remain separately labeled; they are never counted as full completed games.

## Mechanic coverage changes

| Multiplicity evidence | Base 64 | Variants 128 |
| --- | --- | --- |
| Games with two outstanding | 5 | 8 |
| Additional registrations while one active | 5 | 8 |
| Fights consuming both | 1 | 4 |
| Both consumed without a prevented defeat | 0 | 2 |
| Cleanup boundaries expiring both | 4 | 4 |
| Post-action states retaining plural owner-order proof | 2 | 2 |
| Maximum simultaneously outstanding | 2 | 2 |

The independent multiplicity audit checks every recorded consumption against its qualifying before-state snapshot, canonical event order, zero retained consumed IDs and unique prevented-defeat targets. Review hash: `bdb6e2f79bf0510a31f584216cb947a6ad513cea7e2731acd96d998dd011897f`. Plural-proof counts are paused states, not distinct fights. Redundant consumption means no defeat was filtered at that fight.

The existing coverage counters below compare the historical **nine attempted coordinates, including three prefixes**, with the complete successor matrix. Population sizes differ; these are coverage counts, not rates or a controlled strength comparison.

| Mechanic | Historical games / occurrences | Successor games / occurrences |
| --- | --- | --- |
| gearOnLegend | 1 / 1 | 21 / 25 |
| preEquippedGoSolo | 0 / 0 | 5 / 5 |
| dyingNightPlayed | 4 / 4 | 41 / 41 |
| dyingAttack | 4 / 6 | 38 / 105 |
| dyingDelayedCreated | 4 / 6 | 38 / 105 |
| dyingEndReady | 0 / 0 | 0 / 0 |
| dyingVEndReady | 0 / 0 | 0 / 0 |
| delamainSteal | 5 / 11 | 127 / 478 |
| delamainEndPending | 5 / 10 | 127 / 468 |
| delamainEddieChoice | 5 / 10 | 127 / 444 |
| delamainEndResolved | 5 / 10 | 127 / 468 |
| quickFloorIt | 1 / 1 | 8 / 8 |
| quickReboot | 1 / 1 | 11 / 11 |
| floorItPower | 6 / 8 | 102 / 134 |
| losingPlus5 | 1 / 1 | 48 / 82 |
| saburoAura | 7 / 34 | 185 / 1204 |
| saburoAndLosing | 1 / 1 | 48 / 82 |
| yorinobuTrigger | 6 / 16 | 183 / 530 |
| minotaurDefeat | 1 / 1 | 16 / 16 |
| overTheEdgeDefeat | 1 / 1 | 14 / 14 |
| corporateSpend | 0 / 0 | 24 / 24 |
| dexterDefeatedTrigger | 2 / 2 | 25 / 25 |
| fieldLegendDefeated | 1 / 1 | 17 / 21 |
| fieldLegendRemoved | 1 / 1 | 17 / 21 |
| legendGearTrashOrder | 0 / 0 | 1 / 1 |
| multiGigSteal | 1 / 1 | 58 / 101 |
| overtimeProgress1 | 3 / 3 | 137 / 137 |
| overtimeProgress2 | 3 / 3 | 95 / 95 |
| overtimeEntered | 2 / 2 | 69 / 69 |
| overtimeWin | 2 / 2 | 69 / 69 |
| emptyDraw | 1 / 1 | 5 / 5 |
| multipleBlockers | 6 / 11 | 85 / 153 |
| inheritedBlocker | 0 / 0 | 21 / 25 |
| kiroshiLook | 4 / 7 | 130 / 307 |
| kiroshiMemoryRetained | 4 / 205 | 130 / 7098 |
| kiroshiMemoryRevealed | 4 / 4 | 128 / 214 |
| kiroshiMemoryCleaned | 4 / 4 | 128 / 214 |

## Remaining rule gaps

**No repeatable engine/source gap, unexpected error, policy cycle or cap was reached in the fixed 64+128 schedule or its exact rerun.** This establishes the tested Demo rules environment, not exhaustive rules coverage or support for all future cards. Coverage still depends on this deterministic policy. Counters not reached in this schedule: `dyingEndReady`, `dyingVEndReady`. Existing focused regressions remain the evidence for behaviors not naturally reached by this chooser.

No Faceplate, general WHEN_SPENT, new cards, generic replacement system, new format, ruleset overhaul or training pipeline was added. Same-source Program replay remains outside currently reviewed mechanics; future support requires an explicit occurrence-identity review.

## Descriptor-contract blocker

The historical descriptor artifact remains byte-identical and continues to document **285 positions with duplicate public `(kind,label)` descriptors**, including different visible attackers with different power/Gear. It is not hidden by the Reboot fix.

The successor review finds **5,956 positions** with duplicate descriptors, across **7,463 duplicate groups**; it also inspects **35 overtime positions**. Review hash: `87ade709dcc96a3f5c0b34dce2bde3c95ce7e572a18369ee2e7a2f1da2ad4e27`. The successor artifact is [demo-matrix-position-review-reboot.v1.json](../tests/fixtures/demo-matrix-position-review-reboot.v1.json); both generation and `--check` pass. Its concrete visible-attacker examples still include identical labels on options with different power or attachments. Opaque action IDs distinguish submissions but do not explain those strategic differences to a model.

No descriptor contract V2 change is included. The public policy signature, privacy boundary and rankings remain unchanged.

## Persistence

Live development services were already healthy: PostgreSQL 16 at `127.0.0.1:5433`, MongoDB 7 at `127.0.0.1:27018`. The complete integration suite passes **12 tests with zero skips**, using isolated test schemas/databases and cleanup.

The new positive exact replay is traversed through PostgreSQL before every action. Checks compare authoritative state, ReplayStateHash, PositionHash, both observations and their hashes, legal actions/descriptors, and complete event history. It covers first/second registration, two active records, the qualifying tie, two consumed facts, plural proof during owner ordering, zero active remainder and terminal state. Persistence storage already round-trips the additive resolution JSON; no migration or repository change was needed.

The unchanged Mongo integration suite exercises existing fixture publication/read/idempotency paths only in disposable test databases, which it drops afterward. Its separate overtime-ruleset test verifies that publishing the ruleset creates zero card revisions. No seed or catalog-publication command was run against the existing development catalog, and no production database was written. The milestone adds no revised card content; all revision identities remain unchanged.

## Wire

Wire schemaVersion remains **1**. Request, response and TrainingPosition contracts were regenerated for the optional plural consumed-proof array. Existing single-copy payloads and TrainingAttempt remain unchanged. The exact replay exercises both active multiplicity and plural proof through Node-authoritative transport; focused tests also send the two-source owner-order state through wire validation.

## Python

Only the new promoted replay family name was added to `scripts/test_engine_adapter.py`. No Reboot semantics, schema duplication or model policy was added to Python. **37 families / 2,400 actions** pass generic Node traversal; seven goldens, seven differentials and multi-game worker reset/isolation checks pass. The existing 89 Cyberpunk and 48 harness-core tests pass. The seven-case differential still reports its two pre-existing legacy Python deck-validator gaps, `repeated-entry-copy-bypass` and `legend-in-main`; neither was changed, and Node remains authoritative for engine play. No training, model download, data refresh or human-gold promotion occurred.

## Tests

All final required gates pass. The Node suite has **1,180 passing tests, zero failures/skips** after adding the two successor-matrix integrity tests; live integration has **12 passing tests, zero skips**. Focused cases cover the second legal play, same-fight double consumption on loss/win/tie/0–0, opponent defeat/owner ordering, no duplicate prevented defeat, truthful fight triggers, no-fight retention, Blocker redirection, friendly field-Legend attack, later unprotected fight, independent expiry, canonical hashes and invalid-state rejection. All three exact acceptance continuations reproduce byte-identical artifacts in their own `--check` run.

Bring-up failures were corrected before the final gates: a TypeScript tuple-spread type mismatch in a test helper, and two old matrix-test expectations that still treated the historical prefix as a current unsupported boundary. A post-generation audit initially over-constrained alternative generator choices; it was corrected to distinguish frozen-payload compatibility from pin-sensitive fixture selection, as documented above. There were no build/lint warnings or remaining test failures.

## Commands

Commands ran with the requested Node path. Logs are retained locally as `/tmp/tcg-reboot-model-a-*.log`. Routine output is summarized here; all listed final runs exited 0.

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-reboot-model-a-before/replays
node --import tsx scripts/generate-reboot-multiplicity-replays.ts
node --import tsx scripts/generate-reboot-multiplicity-replays.ts --check
for script in scripts/generate-*.ts; do
  case "$script" in
    scripts/generate-demo-match-matrix.ts|scripts/generate-reboot-multiplicity-replays.ts) continue ;;
  esac
  echo "$script"
  node --import tsx "$script" || exit $?
done
npm run contracts:export
npm run typecheck
npm run lint
npm run validate:cards
npm test
npm run build
npm run test:matrix
npm run test:matrix -- --check
node --import tsx scripts/review-demo-matrix-positions.ts
node --import tsx scripts/review-demo-matrix-positions.ts --check
node --import tsx scripts/review-reboot-multiplicity-matrix.ts
node --import tsx scripts/review-reboot-multiplicity-matrix.ts --check
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg TEST_MONGODB_URI=mongodb://127.0.0.1:27018 npm run test:integration
git diff --check
```

Focused named-test runs were also used during development; the final unfiltered `npm test` covers every case. Version output: `v22.13.0`, `10.9.2`. Compatibility: **36 / 2,182**; generators and contract export: pass; card validation: **four original catalog fixtures**; typecheck/lint/build: pass; tests: **1,180**; live Mongo/Postgres: **12**. Matrix: **64 base + 128 variants**, generation and exact regeneration pass; both post-run coverage reviews and checks pass.

From the AI harness directory:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

Python results: **37 / 2,400** Node-authoritative replay traversal, **7** golden round trips, **7** differentials with the two documented pre-existing gaps, worker reset/isolation pass; **89** Cyberpunk and **48** harness-core tests pass. `python3 /tmp/tcg-reboot-model-a-audit.py` verifies before/after immutable data, historical evidence, protected traces, file inventory and both Git HEAD/index snapshots. No commit or push command was run.

## Files changed

This inventory compares the working tree to the snapshot at the start of this milestone, not to the older committed HEAD; prior user-staged work is excluded.

| Application file | Change | Purpose |
| --- | --- | --- |
| [docs/combat-restrictions-report.md](../docs/combat-restrictions-report.md) | Modified | Link current successor while labeling previous source-blocked review as historical. |
| [docs/demo-match-matrix-report.md](../docs/demo-match-matrix-report.md) | Modified | Link current successor while labeling previous source-blocked review as historical. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Modified | Link current successor while labeling previous source-blocked review as historical. |
| [docs/reboot-multiplicity-implementation-report.md](../docs/reboot-multiplicity-implementation-report.md) | Added | Record supplied ruling, implementation, all required results, risks and changed files. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Modified | Add optional plural consumed-prevention proof; retain legacy single proof. |
| [packages/engine/src/combat-outcome-state.ts](../packages/engine/src/combat-outcome-state.ts) | Modified | Validate defeat filtering against the complete consumed set. |
| [packages/engine/src/fight-prevention.ts](../packages/engine/src/fight-prevention.ts) | Modified | Create, canonicalize, validate, consume and expire all matching occurrences. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Modified | Remove obsolete direct second-copy rejection. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Modified | Enumerate otherwise legal redundant second-copy play. |
| [packages/engine/src/targeted-defeat-state.ts](../packages/engine/src/targeted-defeat-state.ts) | Modified | Reject fight-only plural proof in targeted non-fight defeat. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Modified | Regenerate additive plural-proof JSON Schema; envelope version unchanged. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Modified | Regenerate additive plural-proof JSON Schema; envelope version unchanged. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Modified | Regenerate additive plural-proof JSON Schema; envelope version unchanged. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Modified | Advance runtime identity to 0.4.0-reboot-multiplicity-1. |
| [scripts/generate-demo-match-matrix.ts](../scripts/generate-demo-match-matrix.ts) | Modified | Resume fixed schedule into successor artifacts; retain old evidence and stop rules. |
| [scripts/generate-reboot-multiplicity-replays.ts](../scripts/generate-reboot-multiplicity-replays.ts) | Added | Verify unchanged three exact prefixes; generate/check positive continuation evidence. |
| [scripts/review-demo-matrix-positions.ts](../scripts/review-demo-matrix-positions.ts) | Modified | Review successor traces without overwriting historical descriptor evidence. |
| [scripts/review-reboot-multiplicity-matrix.ts](../scripts/review-reboot-multiplicity-matrix.ts) | Added | Audit per-source consumption, expiry and proof throughout the successor matrix. |
| [tests/combat-restrictions.test.ts](../tests/combat-restrictions.test.ts) | Modified | Add positive/negative multiplicity, canonical hash, expiry, later-fight and wire regressions. |
| [tests/combat-triggers.test.ts](../tests/combat-triggers.test.ts) | Modified | Check truthful fight facts, no duplicate defeat/trigger, and double-play helper. |
| [tests/demo-match-replay.ts](../tests/demo-match-replay.ts) | Modified | Replace suppression detector with positive legal-play regression. |
| [tests/demo-match.test.ts](../tests/demo-match.test.ts) | Modified | Update detector expectation for newly legal multiplicity. |
| [tests/demo-matrix-metrics.ts](../tests/demo-matrix-metrics.ts) | Modified | Label nonterminal historical/setup traces correctly after blocker removal. |
| [tests/demo-matrix-replay.ts](../tests/demo-matrix-replay.ts) | Modified | Stop classifying the former overlap as known unsupported. |
| [tests/demo-matrix.test.ts](../tests/demo-matrix.test.ts) | Modified | Preserve historical matrix evidence while asserting current positive admission. |
| [tests/fixtures/attack-condition-power-replay.v1.json](../tests/fixtures/attack-condition-power-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/demo-match-coverage-reboot.v1.json](../tests/fixtures/demo-match-coverage-reboot.v1.json) | Added | Store successor mechanics, complexity, visibility and position coverage. |
| [tests/fixtures/demo-match-matrix-reboot.v1.json](../tests/fixtures/demo-match-matrix-reboot.v1.json) | Added | Store fixed 64+128 successor matrix records and integrity hash. |
| [tests/fixtures/demo-matrix-empty-draw-replay.v1.json](../tests/fixtures/demo-matrix-empty-draw-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/demo-matrix-overlap-replay.v1.json](../tests/fixtures/demo-matrix-overlap-replay.v1.json) | Modified | Retain exact 206-action prefix under current pins; classify historical prefix. |
| [tests/fixtures/demo-matrix-overtime-replay.v1.json](../tests/fixtures/demo-matrix-overtime-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/demo-matrix-position-review-reboot.v1.json](../tests/fixtures/demo-matrix-position-review-reboot.v1.json) | Added | Record successor duplicate-descriptor evidence. |
| [tests/fixtures/demo-matrix-second-setup-replay.v1.json](../tests/fixtures/demo-matrix-second-setup-replay.v1.json) | Modified | Regenerate current pins and correct bounded setup-only labeling. |
| [tests/fixtures/demo-setup-replay.v1.json](../tests/fixtures/demo-setup-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/exact-demo-match-replay.v1.json](../tests/fixtures/exact-demo-match-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/minotaur-replay.v1.json](../tests/fixtures/minotaur-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/over-the-edge-replay.v1.json](../tests/fixtures/over-the-edge-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/overtime-replay.v1.json](../tests/fixtures/overtime-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/reboot-multiplicity-acceptance.v1.json](../tests/fixtures/reboot-multiplicity-acceptance.v1.json) | Added | Record all three original-prefix acceptance and terminal summaries. |
| [tests/fixtures/reboot-multiplicity-matrix-review.v1.json](../tests/fixtures/reboot-multiplicity-matrix-review.v1.json) | Added | Store canonical all-game occurrence-consumption/expiry audit. |
| [tests/fixtures/reboot-multiplicity-replay.v1.json](../tests/fixtures/reboot-multiplicity-replay.v1.json) | Added | Promote exact 003/A full positive 218-action continuation. |
| [tests/fixtures/reboot-multiplicity-ruling.v1.json](../tests/fixtures/reboot-multiplicity-ruling.v1.json) | Added | Record exact supplied Model A wording and available provenance. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/targeted-spend-replay.v1.json](../tests/fixtures/targeted-spend-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Existing generator makes alternative legal selections after opaque-ID repinning. |
| [tests/fixtures/value-conditions-replay.v1.json](../tests/fixtures/value-conditions-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Modified | Regenerate wire golden pins; preserve existing semantics. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Modified | Regenerate current engine pins; immutable cards unchanged. Action/event/actor-observation sequence preserved. |
| [tests/integration/demo-matrix.test.ts](../tests/integration/demo-matrix.test.ts) | Modified | Traverse new exact positive overlap through every-action PostgreSQL reload. |
| [tests/reboot-matrix.test.ts](../tests/reboot-matrix.test.ts) | Added | Pin successor schedule/policy, exact continuations and multiplicity review integrity. |
| [tests/reboot-multiplicity-review.test.ts](../tests/reboot-multiplicity-review.test.ts) | Modified | Verify supplied ruling, all exact old prefixes, positive second copies and field-Legend fight. |

AI harness: [`scripts/test_engine_adapter.py`](../../tcg_ai_training/cyberpunk_llm/scripts/test_engine_adapter.py) — append the new positive replay family to generic Node-authoritative traversal. No other harness file changed.

The prior user-staged Git indexes are preserved. No staging, commit or push was performed by this milestone.

## Self-play rules readiness

**ENGINE RULE ENVIRONMENT: READY for the fixed tested Demo scope.** All three original blockers cross, all 64 base and 128 variant games complete, and exact matrix regeneration reproduces them. Single-Reboot/headline compatibility, live persistence, wire and Python traversal pass. This is a bounded readiness claim for the reviewed card pool, ruleset and policy schedule, not exhaustive proof across every legal strategy.

## Informed-agent readiness

**BLOCKED** pending public legal-action descriptor contract V2. Passing gameplay simulations does not make indistinguishable strategically different actions an informed model interface.

## Recommended next phase

**Public legal-action descriptor contract V2** is next. Give a model enough public structured identity and characteristics to distinguish legal options with identical labels, preserve action-ID binding and privacy, and validate that contract across the recorded positions. Training pipeline or informed unattended self-play should follow only after that interface gate also passes. No descriptor or training work has begun here.
