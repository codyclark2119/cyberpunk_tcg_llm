# Combat triggers milestone

Satori, Dexter DeShawn and Jackie Welles now have complete implementation-reviewed executable revisions. Satori includes **both** its printed Gear power inheritance and inherited fight-win draw. The bounded engine resolves fight-result effects before defeat, DEFEATED effects after movement, and genuine controller choices through the existing actionId boundary. All 15 replay families, 230 application tests, live Mongo/Postgres integration and the Python adapter/game/core suites pass.

## Runtime

Validated on Node **v22.13.0**, npm **10.9.2**. Application package remains **0.3.0**, Next.js **16.3.4**. Behavior artifact is **`0.4.0-combat-triggers-1`**, artifact hash `a8cb48ea57581621297c87dac5433d6d6cba3385d6b566b566665aa42b2ec8fb`. Runtime/domain changes remain independent of Next.js, Apollo and database adapters. No dependency, package-lock, environment or database migration change was required.

## Trigger rules reviewed

The complete local raw/processed comprehensive rules, all four errata records, all three card records and all fourteen printings were inspected before normalization. [combat-triggers-rules.v1.json](../tests/fixtures/combat-triggers-rules.v1.json) preserves 327 relevant exact records and interpretation decisions. [combat-triggers-card-sources.v1.json](../tests/fixtures/combat-triggers-card-sources.v1.json) preserves the complete raw cards, original byte hashes and errata pins. No matching errata was found for the three admissions.

| Local capture | SHA-256 |
|---|---|
| Raw comprehensive rules | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Processed comprehensive rules | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |
| Raw errata | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Processed errata | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

| Rule | Exact local excerpt | Implementation decision |
|---|---|---|
| 2.10.2 | “2.10.2. A value of null ( - ) is not treated as a number. It does not count as 0, and it is not even or odd.” | Numeric difference cannot use Null. |
| 3.17.2 | “3.17.2. A Unit or Legend’s power is equal to the power printed on the card plus the power of its equipped Gear and any current effect modifiers.” | Shared base + Gear + current modifier query. |
| 3.17.3 | “3.17.3. A Gear’s power modifies the Unit or Legend it is equipped to.” | Satori printed 2 grants exactly +2. |
| 4.10.3 | “4.10.3. There’s no upper limit on the number of Gears equipped to a single Unit.” | Independent multiple equipped copies are permitted. |
| 4.11.3 | “4.11.3. The bottom textbox contains effects inherited by the Unit or Legend the Gear is equipped to. Read the bottom textbox as if it's printed on that Unit or Legend.” | Inherited ability subject is the host; physical source stays Gear. |
| 6.4.5 | “6.4.5. A Gig’s value cannot be adjusted to the value it already has. If an effect tells you to do so, the effect fails.” | Zero/already-minimum does not earn Jackie draw. |
| 9.18 | “9.18. When you determine the loser(s), any effects triggered by the fight (i.e. “when this Unit fights,” “when this Unit loses a fight,” etc.) become pending. Both players must resolve all pending effects before they may defeat the loser(s).” | Discover fight effects before defeating losers. |
| 9.19 | “9.19. After resolving all effects triggered by the fight, resolve the fight’s result.” | Resume defeat only after the batch resolves. |
| 9.19.2 | “9.19.2. A Unit with 0 power cannot defeat a Unit as the result of a fight.” | Check current zero-power permission after triggers. |
| 9.19.3 | “9.19.3. If an effect prevents a Unit from being defeated in a fight, it is still a loser that has lost the fight, it only ignores the resulting defeat.” | Prevention changes defeat, not winner/loser. |
| 10.10.1 | “10.10.1. If resolving a pending effect requires information about a game piece that is no longer valid, use the information from when the piece was last valid.” | Retain immutable source/subject/controller identity. |
| 10.12 | “10.12. If you have multiple pending effects, you may resolve them in any order.” | Controller selects next pending effect. |
| 10.13 | “10.13. If both players control pending effects at the same time, the turn player resolves all their pending effects before their Rival resolves all of theirs.” | Turn-player group completes first. |
| 10.14.1 | “10.14.1. If both players have a new effect enter pending while resolving an effect, the player currently resolving pending effects finishes resolving all of their pending effects (including the new ones) before their Rival resolves their new ones.” | Recursive scheduling remains unadmitted. |
| 10.15 | “10.15. Once an effect is pending, later changes to the game state do not stop that effect from resolving (unless the effect includes a condition that must be true during resolution).” | Pending Satori survives detachment; Dexter survives movement. |
| 11.19.2 | “11.19.2. The effect attached to the [DEFEATED] trigger enters pending when the Unit has been declared defeated and is moved to trash.” | Enqueue DEFEATED after declaration and movement. |
| 11.20.2 | “11.20.2. The effect attached to the [PLAY] trigger enters pending when you meet all the requirements when playing that card type. See CARD TYPES.” | Record play only after all requirements, including equip. |

The selected cards require WHEN_FIGHT_WON and WHEN_DEFEATED as distinct executable kinds. Rule 9.18 also explicitly describes fight-lost triggers, which are distinct from defeat; no selected full card requires a WHEN_FIGHT_LOST handler, so that additional executable shape remains unadmitted. No generic AFTER_COMBAT conflation was introduced. Rule 10.14.1 was reviewed, but recursive trigger scheduling is explicitly unsupported because none of the admitted primitives produces another supported trigger.

## Satori complete card semantics

Satori — Sword of Saburo is Red RAM 1, cost 2, printed power **2**, sellable Gear with Arasaka/Weapon classifications. Its equip reminder permits a friendly Unit or face-up Legend. Its remaining captured text is: “When this Unit wins a fight against a rival Unit, draw 1.”

The power adjustment is `GRANT_PRINTED_POWER_TO_HOST` and uses the printed Gear power under 3.17.2–3.17.3. There is **no separate additional +2 text**. Adding printed power 2 and another +2 would be incorrect. The ordinary Gear play/payment/equip lifecycle is retained; the inherited ability is not treated as a PLAY ability during Gear equip.

The second mechanic is `WHEN_FIGHT_WON`, `inherited: EQUIPPED_HOST`, `DRAW 1`. Rule 4.11.3 supplies the inherited-text reading. The physical Gear is the ability/modifier source; the equipped character is its subject. The host controller is captured at trigger time; supported equip states keep Gear and host controllers coherent. No host revision is rewritten. Both mechanics, and the absence of unsupported extra keywords/effects/restrictions, are checked by full-shape admission.

Satori must be attached when the fight result is determined to contribute that inherited ability. Once its effect is pending, later detachment does not cancel the draw under 10.15. The pending record retains the Gear instance and immutable revision reference, even if that Gear is now in Trash. General control-changing and combat-participant-moving trigger effects remain outside this admitted cluster.

Full printed metadata, text, raw/canonical/normalized hashes and every printing UUID appear in [executable-card-coverage.md](executable-card-coverage.md#combat_triggers_v1-complete-characteristic-and-trigger-composition).

## Derived power

One shared query produces source-aware applicable modifiers; `RulesView.getEffectivePower` adds them to the printed base. All prior consumers, including fight comparison and public observation, use it. `getApplicableCharacteristicModifiers`, the bounded `getEffectiveTriggeredAbilities` query and `getTurnEventSummary` expose reusable engine views. Older CALL/ATTACK handlers retain their existing policy boundaries; this is not a universal ability inheritance language.

| Configuration | Effective power |
|---|---:|
| Swordwise alone | 3 |
| Swordwise + one Satori | 3 + 2 = 5 |
| Swordwise + two Satori | 3 + 2 + 2 = 7 |
| After one of those Gear departs | 3 + 2 = 5 |
| Swordwise + Satori + Mantis + Floor It | 3 + 2 + 2 − 1 = 6 |
| Face-up Royce, own turn, Satori + Mantis | 6 + 2 + 2 + 2 × 2 = 14 |
| Null-power Jackie + Gear | Null |

No `currentPower`, Satori-specific state field, printed-base mutation or extra pending power effect is stored. Each Gear remains a distinct modifier source. Tests independently verify the power query before combat, departure, base immutability, and fights changed from loss to tie, tie to win and loss to win. Negative raw power is retained in the truthful fight fact while comparison uses the existing zero floor.

## Fight-result timing

The implemented sequence under the new opt-in policy is:

```text
PASS_REACT → FIGHT_STARTED → FIGHT_RESULT
→ discover/snapshot fight-result effects → EFFECT_PENDING
→ resolve all scheduled fight-result effects and choices
→ current defeat permission / Reboot prevention
→ defeat and movement → DEFEATED pending effects
→ cleanup → MAIN
```

The winner and loser IDs come from the authoritative FIGHT_RESULT, using current Gear and temporary power at comparison time. They are not recomputed after a pending trigger resolves. The continuation stores that historical fact only while needed. Post-trigger zero-power permission is derived from current power before defeat. Selected fight effects only draw; movement, power-changing or prevention-creating fight triggers have not been admitted.

## DEFEATED timing

The shared defeat operation captures immutable ability identity while the source is valid, declares CARD_DEFEATED and completes the existing owner-ordered movement/attachment processing. Only then are the captured WHEN_DEFEATED effects enqueued. Capturing source identity before departure does not mean the effect was pending before movement.

Dexter can therefore resolve its draw while in Trash. Its condition queries current Street Cred at resolution, rather than caching a total before departure. Positive ties can defeat both participants; a Reboot-protected loser has lost the fight but was not defeated, so it does not create Dexter's DEFEATED effect.

## Pending-effect scheduling

The bounded continuation records origin (PLAY, ATTACK, FIGHT or DEFEAT), semantic batch ordinal, immutable source bindings, resolved IDs for the current batch, phase and optional Gig target. PendingEffect retains source instance, CardId/revision, inherited subject, trigger kind, controller, turn/ordinal and event-sequence provenance. It does not copy a CardRevision into state.

The binding roster is a temporary validation record. Pending/current/resolved IDs must partition it exactly; it is removed on completion. State validation checks source revision/ability, controller/subject, origin, truthful historical result, movement, combat pause, phase, target, actor and exact legal choice options. Orphaned, duplicated, missing and forged pending work is rejected atomically. Unsupported nested batches and participant departures have explicit failures.

The semantic trigger ID uses turn, batch ordinal, physical source, subject, immutable source reference, ability, trigger kind and controller seat. It does not use match UUID, state version or event sequence. POSITION_V2 remains unchanged: semantic history affects its hash, transport identity/counters and effect event provenance do not.

## Same-controller simultaneous ordering

Rule 10.12 gives the controller a sequential choice of the next eligible effect. Two Satori create a genuine `TRIGGER_ORDER_SELECTION` PendingChoice with two independent sources. A sole remaining effect resolves automatically and records a forced selection. The engine never chooses an arbitrary array order on behalf of the player or generates factorial permutations as actions.

## Cross-player ordering

Rule 10.13 gives the turn player priority to finish their pending group before the rival. A positive-tie test with two real Dexters proves both move first, then the active player's DEFEATED effect resolves before the rival's. If a group had multiple effects, only that group's controller would choose its next effect. Recursive priorities under 10.14.1 remain outside this bounded scheduler.

## Satori multiple-copy behavior

Rule 4.10.3 has no upper Gear count per Unit. Each equipped Satori grants its own +2 and independently observes the host's fight win. The headline legally equips two physical copies, compares Swordwise at power 7 against Dexter at power 4, pauses for controller order, resolves two separate draws, then defeats/moves Dexter and returns to MAIN. The power bonuses are already active before any trigger is pending.

## Satori + Mantis interaction

Both Gear contribute their printed power exactly once. A focused composition test uses separate Satori, Mantis and Floor It source identities. A Royce test also adds the existing own-turn power-per-Gear modifier without a card-specific arithmetic branch. Attachment departure removes only the departing Gear's contribution.

## Satori + Floor It interaction

The shared temporary −1 modifier composes with Gear. A real Program play during Rival React takes Swordwise + Satori from 5 to 4 against Dexter's 4, creating a positive tie and no Satori fight-win trigger. Another focused comparison verifies Swordwise 5 versus Floor-It-adjusted Psycho 5. Current derived power, winner/losers and downstream defeat remain consistent.

## Satori + Reboot interaction

A real React Reboot play is followed by a Satori-equipped win. Satori draws before prevention filters defeat; FIGHT_RESULT still names the same winner and loser. The protected Dexter remains on the field and produces no DEFEATED trigger. Prior Reboot lifetime, single-outstanding-effect restriction, Blocker interaction, expiry and Gig-attack behavior remain covered by the existing suite and exact legacy-event audit.

## Jackie

Jackie — Pour One Out For Me is fully admitted in the Legends area: Blue RAM 2, sellable, dash field cost and Null power. Its full captured text has a first Blue Unit/Gear play trigger, optional friendly Gig decrease by up to 2, and draw 1 if the Gig becomes minimum. It has **no DEFEATED line and no static characteristic modifier**. Go Solo is neither necessary for this shape nor implemented.

The engine offers explicit acceptance or decline, then friendly rolled-Gig selection and a legal 0–2 amount. Only an actual decrease to 1 draws; choosing zero or an already-minimum Gig does not, under 6.4.5. A sole target/amount is automatic, and no valid target means the impossible operation completes without an invented choice. Tests cover acceptance, decline, actual minimum, zero, already minimum and pre-reveal history. The legal headline calls Jackie normally and demonstrates the full Blue Unit play/decrease/draw path.

## Dexter

Dexter DeShawn — One Last Chance is fully admitted: Yellow RAM 2, cost 3, power 4, not sellable Unit/Fixer. Separate typed WHEN_PLAYED and WHEN_ATTACKING abilities each adjust any rolled Gig by up to 1 using the existing adjustment primitive and a genuine target/magnitude choice. WHEN_DEFEATED evaluates an absolute numeric Street Cred difference of at least 10 from a rival and draws 2 if met.

It has no printed static modifier, keyword restriction or first-event guard. Every captured executable line is normalized. The separate DEFEATED headline proves actual draw-two resolution after Trash movement. Tests cover current/equal/large differences and Null on either/both sides. Null is not coerced to numeric zero for subtraction.

## First-event guards

Jackie's first event means the first completed Blue Unit or Blue Gear play by its controller during the global turn. The history is recorded even if Jackie is still face down. Declining its optional effect does not make the second qualifying play the first. Programs, CALL and SELL do not qualify; payment/declaration alone is not a completed play. The actual Gear path records the event only after equip completion.

A clearly labeled synthetic Blue Gear variant tests the generic completed-play guard hook; it is not an additional real-card admission or headline replay. No card color or source revision is silently reclassified. The headline uses a reviewed real Blue Unit.

## Turn-history model

`turnHistory` carries the current turn, a semantic trigger-batch ordinal and exact per-player Blue Unit/Gear play counts. `TurnMutation.startTurn` resets both players' summaries and separately resets existing CALL/SELL usage. Setup has no turn history. The new policy requires coherent current-turn counters and rejects extra/missing players or orphaned continuation data. Legality never scans the persisted event log.

Counters represent historical qualification, not a reusable ability allowance. The active binding roster and historical fight fact live only until their continuation completes. No steal history, generic ledger or persistent cache of base characteristics was added.

## Events

New typed facts are `QUALIFYING_PLAY_RECORDED`, `TRIGGER_ORDER_SELECTED` (including forced status), `OPTIONAL_TRIGGER_ACCEPTED` and `OPTIONAL_TRIGGER_DECLINED`. Existing EFFECT_PENDING/RESOLVED, CONDITION_EVALUATED, FIGHT_RESULT, CARD_DEFEATED, CARD_MOVED and Gig adjustment facts are reused.

Each new replay retains the complete initialization and transition batches with contiguous event sequences. `advanceResolutionWithEvents` performs automatic fight work, preserves those facts, and pauses at a real ordering choice; automatic arithmetic and forced resolutions are not model decisions. Source snapshots plus attachment events and effective power make Satori's modifier and trigger separately auditable.

## Observation

Both players see public current effective power, attachments, public pending source/subject/revision/controller facts, the historical fight result during its trigger window and public qualifying-play counts. The technical batch counter and modifier derivation internals are not added to model observations. Existing public temporary-effect facts remain intact.

Only the scheduled trigger controller receives legal ordering/optional action IDs. The opponent's hidden hand and future RNG are absent from modelInput. The exact private state is retained for engine storage/replay, never substituted for the observation in a model prompt.

## Training positions

The Satori replay supplies 42 strategic positions, DEFEATED 40 and first-Blue 24. These include actual setup/payment/target decisions as well as the new ordering and optional decisions. Each has more than one legal action. Forced effect selection, draws, power comparison and automatic defeat/cleanup generate no training position. Fixtures are implementation-reviewed regression data, not human-certified gold or complete games.

## Demo coverage

The original 29-row roadmap was checked before editing, then recalculated from its rows after exactly three full admissions.

| Metric | Before | After |
|---|---:|---:|
| Distinct executable cards / 29 | 11 | 14 |
| Without executable revisions | 18 | 15 |
| Arasaka distinct / 14 | 4 | 5 |
| Arasaka physical copies / 30 | 11 | 14 |
| Merc distinct / 15 | 7 | 9 |
| Merc physical copies / 30 | 14 | 16 |
| Combined physical copies / 60 | 25 | 30 |

[The roadmap](demo-deck-coverage-roadmap.md) preserves all quantities, including **three Psycho Squad** and **three Satori**. Copies and distinct identities are separate counts. Reboot remains individually supported subject to the existing one-outstanding-effect scope.

## Demo match readiness

Neither exact physical teaching deck can initialize as constructed or run a complete match. Both remain **27 main + 3 Legends = 30 total**. Arasaka still lacks nine distinct executable cards (16 copies); Merc lacks six (14 copies). A separate authoritative demo-format source review and the remaining full-card mechanics are required. No starter padding or `DEMO_STARTER` policy was introduced.

## Constructed validation

The ruleset still requires **40–50 main cards**, three Legends and at most three copies. The new replay support lists contain 42 main cards and three Legends with legal RAM profiles. They are explicitly synthetic constructed support decks. A 27-main input remains rejected. No format or deckbuilding validator was weakened.

## Replays

| New family | Seed | Actions | Strategic positions | Events including initialization | Final |
|---|---|---:|---:|---:|---|
| satori-replay | `triggers-60` | 46 | 42 | 195 | MAIN |
| defeated-replay | `triggers-31` | 40 | 40 | 167 | MAIN |
| first-blue-replay | `triggers-0` | 25 | 24 | 94 | MAIN |

The headline generators use legal setup, turns, rolls, SELL, CALL/payment, play/equip, attack, React/PASS and enumerated choices. No state/RNG patching occurs in their generation. Focused trusted preparations are explicitly labeled in the test file and cover isolated interactions, not headline legality claims.

All twelve previous families were regenerated with the new artifact. A separate audit read their original committed payloads with `git show HEAD:…`, rebuilt only the engine/content manifest pins and replayed those exact payloads. Every original initialization and transition event batch remained byte-structurally equal: turn 7 actions, setup 10, reviewed 11, noncombat 24, Gear 25, attack 41, React 53, fight 53, Gig steal 46, prevention 34, permissions 29, vanilla 35. All retain their previous stopping boundaries. Existing immutable card snapshots are unchanged.

Changing the artifact changes hashes/action IDs throughout the goldens. A pre-existing generator convention selects the first hash-sorted option in some older fixtures, so incidental freshly generated selections may change. The independent original-payload audit is the compatibility evidence; regenerated hashes alone would not establish that claim.

## Persistence

Live integration used Mongo at `127.0.0.1:27018` and PostgreSQL at `127.0.0.1:5433`. Both integration tests passed without skips. Mongo publishes/reads/replays all three new immutable revisions alongside the existing history/projection tests. PostgreSQL traverses all new traces with different transport UUIDs, saves and reloads each boundary, and compares legal action IDs, replay/position hashes and complete ordered event history. This persists the Satori ordering snapshot, Jackie optional/target/amount choices and history; Dexter's automatic post-movement draw is persisted in its complete event batch/final state.

Existing random isolated test databases/schemas are cleaned up in finally blocks. Transaction rollback, stale state, duplicate ledger requests, incomplete history and earlier combat traces remain covered. No migration or application infrastructure changes were necessary.

## Python/wire

Wire remains additive **v1**, POSITION_V2 unchanged. Request, response and TrainingPosition JSON Schemas and all wire/replay goldens were regenerated. TrainingAttempt's schema was exported and remained byte-identical. Python adds only three fixture names and updated interop documentation; no power, trigger, history or canonical hashing logic was ported.

The existing offline Node JSONL subprocess traverses all fifteen families by enumerated actionId and verifies observations, transitions, events and hashes. Seven wire round trips and seven differential cases pass. Python game tests: **87 passed**. Harness/core tests: **48 passed**. No model download/training, source refresh, measurements, human gold or evaluation dataset changes occurred.

## Tests

| Gate | Result |
|---|---|
| Node / npm | v22.13.0 / 10.9.2 |
| Typecheck with GraphQL generation | Pass |
| ESLint | Pass, no warnings |
| validate:cards | Pass: 4 original starter fixture records |
| Focused combat-trigger tests | 32 passed |
| Complete application suite | 230 passed, 0 skipped |
| Production Next build | Pass; `/api/graphql` retained |
| contracts:export | Pass |
| Original twelve payload/event audit | Pass |
| Mongo + PostgreSQL integration | 2 passed, 0 skipped |
| Python adapter | 15 replay families, 7 wire round trips, 7 differential cases passed |
| Python Cyberpunk / core | 87 / 48 passed |
| git diff --check, both repositories | Pass |

`validate:cards` still deliberately reads the original four starter fixtures. That output is not the captured corpus size or the number of reviewed gameplay revisions. New admissions are exercised by full-shape tests, manifest validation, legal replays and Mongo revision round trips.

During implementation, typechecking exposed a nullable pending-source type and test-only branded counter/ES target issues. Legal seed authoring exposed Satori's inherited ability being mistaken for its play/equip continuation ability; the explicit Gear adapter now preserves equip typing and timing. An initialization-history validation issue was fixed before setup generation. Test authoring also corrected a syntax typo, a Gear accidentally used as a Unit in a focused zero-power preparation, and a synthetic duplicate-printing UUID. Final focused/full gates pass; no checks were disabled to obtain that result.

## Commands

All application commands below were run in `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`, using the pinned runtime:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
npm run typecheck
npm run lint
npm run validate:cards
node --import tsx --test tests/combat-triggers.test.ts
npm test
npm run build
npm run contracts:export
git diff --check
```

The version probe was executed as `sh -c 'node -v && npm -v'` with that PATH. Commands' stdout/stderr were captured in `/tmp/tcg-triggers-{runtime,typecheck,lint,cards,focused,test,build,contracts}.log`. Authoring iterations reran the focused suite and typecheck after the fixes described above.

All generator commands ran sequentially under the same Node executable; results are in `/tmp/tcg-triggers-regenerate.log`:

```bash
node --import tsx scripts/generate-wire-golden.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
```

Live database command, with the requested local-network sandbox approval:

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg \
npm run test:integration
```

The original-payload audit ran this read-only script, logging to `/tmp/tcg-triggers-legacy-payloads.log`:

```bash
node --import tsx - <<'JS'
const {execFileSync}=require('node:child_process');const assert=require('node:assert/strict');
const {createContentBundle}=require('@tcg/domain');const {createGameWithEvents,applyAction}=require('@tcg/engine');const {engineIdentity}=require('./scripts/engine-identity.ts');
const unwrap=r=>{assert.ok(r.ok,JSON.stringify(r));return r.value};
for(const family of ['turn','setup','reviewed','noncombat','gear','combat-attack','react','fight','gig-steal','prevention','permissions','vanilla']) {
 const before=JSON.parse(execFileSync('git',['show',`HEAD:tests/fixtures/${family}-replay.v1.json`],{encoding:'utf8',maxBuffer:100*1024*1024}));
 const context={content:createContentBundle(before.content.ruleset,before.content.cards,engineIdentity())};
 const initial=unwrap(createGameWithEvents(before.initialization,context));assert.deepEqual(initial.events,before.initialized.events);let state=initial.state;
 for(const [i,step] of before.steps.entries()){const next=unwrap(applyAction(state,step.action,context));assert.deepEqual(next.events,step.events,`${family} original event batch ${i}`);state=next.state;}
 console.log(`${family}: original ${before.steps.length} payloads and all original event batches accepted; final ${state.timing.step}`);
}
JS
```

Harness commands ran from `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`, logging to `/tmp/tcg-triggers-python-{adapter,game,core}.log`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

Repository inspection used `git status --short`, `git diff`, `git show`, `rg`, `rg --files`, `cat` and bounded file reads. Temporary authoring probes used `node --import tsx -` for legal seed selection and metadata, and `python3` for byte-hash/coverage audits and report generation. They neither fetched data nor modified either git index.

## Files changed

Compared against the byte-hash baseline captured before this turn: **61 application files and 2 harness files** changed. All existing source-corpus, human/evaluation data and prior standalone revision fixtures are unchanged. Generated replay files account for most of the diff volume.

| Application file | Change |
|---|---|
| [docs/combat-triggers-report.md](../docs/combat-triggers-report.md) | New complete source review, implementation, gates, command receipts, file audit and remaining scope. |
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Admit exactly three full cards and recalculate all 29 rows, distinct/copy counts and readiness blockers. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Record complete characteristics/effects, hashes and all fourteen new printing references. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add explicit COMBAT_TRIGGERS_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Add typed source bindings, trigger origins/continuations, turn history, choices/events and shared historical fight-result schema. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add bounded fight/card-play triggers, inherited-host metadata, first-Blue guard and reviewed effects/condition. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add explicit opt-in combatTriggers policy pin. |
| [packages/engine/src/attachments.ts](../packages/engine/src/attachments.ts) | Admit the complete reviewed Satori Gear shape through existing equip/attachment rules. |
| [packages/engine/src/attack-support.ts](../packages/engine/src/attack-support.ts) | Reject unhandled inheritance/guard metadata in older attack shapes. |
| [packages/engine/src/characteristics.ts](../packages/engine/src/characteristics.ts) | Derive distinct Gear, host and temporary power contributions through one reusable modifier query. |
| [packages/engine/src/combat-outcome-queries.ts](../packages/engine/src/combat-outcome-queries.ts) | Derive post-trigger defeat permission from current power and historical losers. |
| [packages/engine/src/combat-outcome-state.ts](../packages/engine/src/combat-outcome-state.ts) | Validate resumed defeat orders against the retained fight fact and prevention. |
| [packages/engine/src/combat-resolution.ts](../packages/engine/src/combat-resolution.ts) | Insert fight-trigger window before defeat and DEFEATED window after movement; resume correct cleanup. |
| [packages/engine/src/combat-state.ts](../packages/engine/src/combat-state.ts) | Delegate paused trigger combat validation to the bounded continuation validator. |
| [packages/engine/src/combat.ts](../packages/engine/src/combat.ts) | Route the complete new Attack trigger through pending-effect resolution. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Evaluate current absolute Street Cred difference with explicit Null handling. |
| [packages/engine/src/defeat.ts](../packages/engine/src/defeat.ts) | Admit real DEFEATED source shapes, capture immutable bindings before shared movement and return them for post-movement enqueue. |
| [packages/engine/src/effect-support.ts](../packages/engine/src/effect-support.ts) | Admit Jackie for ordinary CALL/reveal and reject new metadata in older shapes. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Enumerate controller choices, label physical source/subject, dispatch continuations and pause automatic resolution. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Admit complete new card shapes and initialize history coherently around engine-owned setup. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Expose public pending source/subject facts, historical fight fact and qualifying-play counts with existing hidden-zone boundaries. |
| [packages/engine/src/play-state.ts](../packages/engine/src/play-state.ts) | Validate inherited Gear equip separately from PLAY abilities and accept exact trigger amount continuations. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Admit complete new Unit/Gear play shapes; fail closed on unhandled inherited/guard metadata. |
| [packages/engine/src/play.ts](../packages/engine/src/play.ts) | Record completed qualifying plays after payment/equip and dispatch Dexter PLAY effects without mistaking Satori inheritance for PLAY. |
| [packages/engine/src/react-support.ts](../packages/engine/src/react-support.ts) | Reject unhandled inheritance/guard metadata in older React shapes. |
| [packages/engine/src/restriction-support.ts](../packages/engine/src/restriction-support.ts) | Reject unhandled inheritance/guard metadata in older restriction shapes. |
| [packages/engine/src/search-state.ts](../packages/engine/src/search-state.ts) | Allow target selection only with its supported trigger continuation. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Integrate trigger/history validation and legal turn/actor boundaries; POSITION_V2 projection is unchanged. |
| [packages/engine/src/trigger-queries.ts](../packages/engine/src/trigger-queries.ts) | New typed effective bindings, discovery, semantic IDs, priority groups and deterministic options. |
| [packages/engine/src/trigger-resolution.ts](../packages/engine/src/trigger-resolution.ts) | New bounded ordering/optional/adjustment resolution, completed-play recording and origin-specific continuation. |
| [packages/engine/src/trigger-state.ts](../packages/engine/src/trigger-state.ts) | New invariant validation for historical origin, source identity, exact batch partition, priority, choices and turn history. |
| [packages/engine/src/trigger-support.ts](../packages/engine/src/trigger-support.ts) | New complete-shape admission for all three reviewed cards with explicit policy gating. |
| [packages/engine/src/turn.ts](../packages/engine/src/turn.ts) | Reset separate historical counters at global turn start. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose applicable modifiers, bounded effective triggers and turn event summary. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive wire v1 request contract for typed trigger/history/observation changes. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive wire v1 response contract for typed trigger/history/observation changes. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive wire v1 trainingPosition contract for typed trigger/history/observation changes. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Increment behavior artifact to 0.4.0-combat-triggers-1. |
| [scripts/generate-combat-triggers-replays.ts](../scripts/generate-combat-triggers-replays.ts) | Generate the three complete legal headline fixtures with event/position receipts. |
| [tests/combat-triggers-fixture.ts](../tests/combat-triggers-fixture.ts) | Handwritten complete three-card normalization and explicit constructed support bundle/decks. |
| [tests/combat-triggers-replay.ts](../tests/combat-triggers-replay.ts) | Pinned legal Satori, DEFEATED and first-Blue replay authoring without state/RNG patches. |
| [tests/combat-triggers.test.ts](../tests/combat-triggers.test.ts) | 32 focused provenance, full-shape, power, ordering, history, validation, visibility and wire tests. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate existing combat-attack replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/combat-triggers-card-sources.v1.json](../tests/fixtures/combat-triggers-card-sources.v1.json) | New full local three-card source snapshot, fourteen printing objects and byte/errata pins. |
| [tests/fixtures/combat-triggers-rules.v1.json](../tests/fixtures/combat-triggers-rules.v1.json) | New 327-rule exact local snapshot and bounded timing/admission decisions. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | New legal Dexter post-movement draw-two replay. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate existing fight replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | New legal Jackie first-play optional minimum-draw replay. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate existing gear replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate existing gig-steal replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate existing noncombat replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate existing permissions replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate existing prevention replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate existing react replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate existing reviewed replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | New legal two-Satori power and player-ordered draw replay. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate existing setup replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate existing turn replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate existing vanilla replay, actions, positions, events and hashes for the new artifact; original payload compatibility audited. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate existing wire v1 requests/responses/action IDs and hash receipts for the new artifact. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Round-trip new Mongo revisions and persist/reload every new PostgreSQL replay boundary and complete history. |

| Harness file, relative to `cyberpunk_llm` | Change |
|---|---|
| `docs/engine-interop.md` | Document artifact, fifteen-family traversal, public trigger/history contract and preserved Node authority. |
| `scripts/test_engine_adapter.py` | Add the three new fixtures to the existing generic actionId traversal loop. |

## Unsupported mechanics

Go Solo, field-Legend execution, general inherited Blocker Gear, general inherited effects/keywords, full demo-format rules, full starter matches, a general steal-history subsystem, all remaining real cards, overlapping Reboot effects and a universal replacement/recursive-trigger scheduler remain unsupported. None was silently admitted. The bounded inherited draw, current Gig adjustment and history guard are not declarations of FULL_GAME support.

The current pending primitives do not move combat participants or change controllers. Such future handlers require dedicated legality, source-lifetime and continuation review; current validation explicitly rejects those unsupported participant departures. The trusted Gear-detachment test proves already-pending effect lifetime without exposing a new player movement action.

## Ambiguities not guessed

No internet refresh or publisher-image adjudication was performed. These are implementation reviews of pinned local captures, not human certification. Captured Gear power and the inheritance rules settle Satori's +2 without inventing a second bonus. Jackie's capture contains no DEFEATED line. Rule 6.4.5 settles the unchanged-minimum case; 2.10.2 preserves Null for Dexter. Nested priorities were reviewed but not approximated by a stack.

The exact demos still lack an authoritative complete local format capture. Deck/printing metadata does not establish exceptions to size, RAM, copy, setup or win rules. No DEMO_STARTER was inferred from those lists.

Existing technical debt remains: older fixture authors sometimes choose first hash-sorted actions, so artifact changes can produce large golden diffs; the old public Street Cred observation represents an empty area as zero even though relevant rule conditions are Null-aware; Python's separate legacy deck validator has known repeated-entry-copy and Legend-in-main gaps. Node's authority and the existing differential tests remain intact. Build and lint emitted no remaining warnings.

## Recommended next milestone

Review the complete Mandibular Upgrade shape and implement its bounded inherited Blocker/equip semantics through the shared effective-capability queries. Keep private-look/named-host Gear effects, Go Solo/field Legends and Yorinobu's first-attack/trait/discard behavior as separate full-shape reviews. Continue recalculating the exact roadmap without changing constructed validation or claiming demo readiness.

No staging, commits or pushes were performed in this pass. The nested `cyberpunk_llm` repository already contains staged, unstaged and untracked work from before this turn; the byte-hash comparison confirms that this pass changed only its two listed files and preserved all pre-existing corpus/code changes.
