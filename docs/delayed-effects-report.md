# Dying Night: ATTACK-created end-turn effects

Completed 2026-09-09. One complete real card is newly executable: **Dying Night — V's Pistol**, bounded by `GEAR_DELAYED_ATTACK_V1`. All application, persistence and Python gates pass. The prior Delamain implementation and other workspace changes were preserved. Nothing was committed or pushed.

## Runtime

Node **v22.13.0**, npm **10.9.2**, Next.js **16.3.4**. Application package version stays0.3.0. Engine behavior artifact is **0.4.0-delayed-effects-1**, SHA-256 `7acba7f1700e86e1049146c067062e1382f02f6fb453249861b18b0018a537a9`.

The four records printed by `validate:cards` are the original application catalog fixtures. Reviewed engine content lives in explicit immutable replay/test bundles; that command is not a count of all reviewed card revisions or the source corpus. No catalog import was performed.

## Dying Night exact captured shape

Stable CardId `dying-night-v-s-pistol`, application revision1. Gear / Merc / Weapon; Blue RAM2; cost2; printed power2; sellable; Rare; artist Ivan Shavrin. Merc Demo Deck013, retail128. Exact local text:

> (Equip to a friendly Unit or face-up Legend.)
> {Attack} Decrease a Gig by up to 2. At the end of your turn, if this Unit is named "V", ready 2 Eddies.

| Printing UUID | Set | Number |
|---|---|---|
| `2b1b6268-193f-4b9e-a63c-0cbc200d6db7` | welcometonightcityretail |128|
| `3ceebded-0941-477f-b486-f2cb22ca653d` | welcometonightcitybeta |β128|
| `4bb35017-9842-4178-99a6-34353a3de2d4` | theheistretailstarterdeck |017|
| `1dc3c618-a40a-4717-bf4d-a573915c8ac0` | theheistbetastarterdeck |β017|
| `dd423c67-68f4-4da8-884c-cbeb91554c0d` | mercdemodeck |013|

Raw bytes SHA-256 `ff35eafac6b1c3c89c3eef1d997dad09a03244fbdd00ff577cc25dfd8ba320b0`; canonical record hash `33229b2912f87aadec96b43ab24bc7b39d2a569ab4bed37676c2797d05011069`; normalized application revision hash `162169d6cb32d35f93bb6aeedaee44d08f5aece9bdee82ddc388647b5522cb4a`. Full raw record, five printings, all four captured errata and all five reviewed image hashes are in [the source fixture](../tests/fixtures/delayed-effects-card-source.v1.json). No Dying Night erratum joins this capture.

## Authoritative delayed-effect evidence

Reviewed all713 records of the pinned comprehensive capture, all section10 rules, relevant card representations and all four errata before implementing. The [204-rule focused fixture](../tests/fixtures/delayed-effects-rules.v1.json) retains exact local text and hashes:

| Local source | SHA-256 |
|---|---|
| Raw comprehensive rules |`054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`|
| Processed comprehensive rules |`1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19`|
| Raw errata |`1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75`|
| Processed errata |`16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340`|

A narrowly scoped official review filled the previous milestone's evidence gap. The public rules/FAQ page uses an API endpoint found in its linked application bundle. The [official Dying Night FAQ feed](https://api.netdeck.gg/api/faqs/cyberpunk?scope=card&card_slug=dying-night-v-s-pistol) supplies two rulings, published2026-09-04:

| FAQ record | Established behavior, paraphrased |
|---|---|
| `5f960b7a-2008-4b2c-bbfd-ec852848651f` | Choosing zero Gig decrease does not prevent the later readiness benefit. |
| `881c635b-268e-4855-8617-a84587951a8f` | The benefit survives defeat of the attacking V host before end turn. |

The [official FAQ feed](https://api.netdeck.gg/api/faqs/cyberpunk) was inspected in temporary storage to find narrowly relevant general and Delamain rulings; five relevant record hashes and summaries were retained in the fixture. No FAQ corpus was imported. Official comprehensive rules and errata responses still equal the pinned local records. Current card metadata differs only in image URLs/signatures. Current public signed image URLs allowed inspection of all five printings; the old unsigned URLs return403. The [Merc013 image](../tests/fixtures/dying-night-demo013.webp) is retained with hash `416a9c9c49bec4e666f4bd6e93c9f6f749d8ce8aa8809dc044fdf5abb1ea0e86`. Ephemeral signatures are not stored in the repository.

| Rules | Application of the evidence |
|---|---|
|10.1.1–10.1.2|One paragraph is one effect.|
|10.2,10.2.1,10.2.3,10.6.2|Written instruction order, partial resolution and no interleaving.|
|10.3.3|Evaluate an internal condition when that clause is reached.|
|10.11|Unresolved current effects block play, so waiting future work needs separate state.|
|4.10.3,4.11.3,11.6.4,10.16.2–10.16.3|Independent inherited physical paragraphs; repeated triggers remain distinct occurrences.|
|4.12,10.10.1,10.15 and card-specific defeat FAQ|Gear follows/detaches on defeat; retain immutable source and original subject information.|
|8.16.1–8.16.2,8.18,10.12–10.13|End-turn pending work and controller ordering precede expiration and next turn.|
|3.9.2,3.10.2|Printed Name excludes subtitle; V variants share exact Name V.|
|3.8,5.8,5.8.3.1,10.31.2,10.32|Physical readiness, hidden Eddie contents and selecting the required number if possible.|
|6.1.2–6.1.4,6.3–6.4,10.31.3|Rolled GIGS eligibility, bounds and nonnegative up-to amounts.|

The rules do not introduce a general delayed-effect programming language. The implementation combines the printed future instruction, independent-trigger rules and specific card FAQ into one narrow end-of-current-turn instruction. Hidden-zone and controller-changing lifetimes remain unresolved/unadmitted; the implementation rejects those transitions instead of inventing behavior.

## Paragraph interpretation

The previous interpretation remains correct. All five printing images show the decrease and future sentence in the same ATTACK paragraph. Normalization is one inherited `WHEN_ATTACKING` ability, with ordered decrease and registration instructions. No `WHEN_OWN_TURN_ENDS` ability is added to Dying Night.

## DelayedEffect architecture

`DelayedEffect` is a strict typed `END_TURN_READY_EDDIES` record containing `id`, `controllerId`, `sourceId`, immutable `source` CardRef, `subjectId`, immutable `subject` CardRef, `abilityId`, `createdTurn`, `originOrdinal` and `originEffectId`. It copies no CardRevision. The fixed effect is recovered from the fully admitted source ability; no callbacks, arbitrary timing expressions or scripts are stored.

Canonical nonempty optional `GameState.delayedEffects` represents future work. End turn transfers these records into the existing typed trigger origin and binding set, where they validate pending reloads. Future and captured copies cannot coexist. Unique IDs, canonical ordering, immutable references, active turn/controller, original ATTACK identity, supported source ability and public source/subject lifetime are checked. `RulesView.getDelayedEffectsForTurn()` is read-only.

## Registration timing

The original pending ATTACK executes its Gig clause first, including target and magnitude choices. On reaching the second instruction it registers future work and emits its fact, then resolves the whole ATTACK effect. Zero adjustment and impossible target selection still reach the second instruction. Neither registration nor an early V check occurs before that point. React/combat and normal MAIN actions continue with no future instruction left in `resolution.pending`.

## Multiplicity

Each physical Gear paragraph registers once per actual ATTACK occurrence. Two copies on one host create two records with distinct sources. Repeated attacks create separate records with distinct semantic trigger ordinals. Tests cover both, including independent end-turn ordering and four Eddies readied through two separate count2 effects. No merge into ready4 and no new ready-Unit card are introduced; the repeated-attack setup is explicitly trusted.

## Source lifetime

The immutable Gear source and CardRef remain available after public Trash departure. Its current attachment is not rechecked to rediscover future work. Gear detachment, host defeat with Gear follow/detach, and trusted reattachment elsewhere do not cancel or rebind the original instruction. Gear absent before ATTACK registers nothing.

## Subject lifetime

The original physical Unit and immutable CardRef remain the subject in battlefield or Trash. The explicit host-defeat FAQ supports the positive defeated-host result. Evaluation reads the unchanged revision rather than a cached boolean. A hidden-zone departure or mutation of the pinned type/CardRef is rejected. There is no newly admitted Name-changing or hidden-zone return mechanic.

## Controller lifetime

The creation controller is retained, and must remain the active player and the source/subject's retained controller in the admitted lifecycle. No controller transfer is implemented. Cross-controller delayed states fail validation; generic control-change semantics still need a separate review.

## End-turn timing

An attack during the host controller's turn registers for that global turn's end. END_TURN removes the future array and captures every record in the shared pending origin. A later false condition or zero eligible Eddies resolves once and disappears. No record survives into the next turn; game termination also clears waiting work.

## Named-"V" condition

`SUBJECT_IS_UNIT_NAMED` admits only identity literal `V`. When the internal end-turn clause resolves, it requires revision type `UNIT` and exact immutable `deckbuildingIdentity === "V"`. Subtitle and display text are irrelevant. Tests use distinct subtitles, a misleading non-V identity and a Legend negative. No actual V revision or Go Solo is admitted. A clearly synthetic trusted vanilla Unit tests the positive branch.

## Gig decrease behavior

Shared target and mutation infrastructure selects any rolled Gig in either player's GIGS area, excluding Fixer. Target precedes amount. Legal amounts are0..min(2,currentValue−1), with no clamping. Zero produces no `GIG_VALUE_CHANGED`. The no-target focused case uses a spent rival Unit as the legal attack target and resolves the remaining instruction. The headline exercises an actual decrease of2.

## Ready2 semantics

This is one count2 instruction. With0/1/2 spent Eddies it automatically readies as many as possible. With3+ it gathers two distinct public slots before changing either readiness. The intermediate continuation stores one selected slot; the second decision commits the unordered set in canonical slot order, producing two `CARD_READIED` facts within the same atomic action/effect. Equivalent selection orders yield identical final states and ready facts. This implements the required count and no-interleaving rules without a combinatorial action list or two count1 effects.

Duplicate, ready, stale, out-of-range and malformed selections reject atomically. The test matrix covers0,1,2,3,4,5 spent Eddies.

## Eddie privacy

Choices/descriptors use `EDDIE_SLOT`, never sold-card identifiers. Both players see only public slot/readiness information under5.8.3.1. Swapping hidden Eddie contents changes the trusted replay hash but preserves both observations and action IDs, including the partially selected state. Model input contains only entitled observation/descriptors. No underlying Eddie CardId, physical sold-card ID or RNG seed is exposed.

## Delayed + Delamain ordering

Stored Dying instructions and qualifying board-discovered Delamain abilities join one pending batch. Same-controller ordering uses `TRIGGER_ORDER_SELECTION`. Both ready2→ready1 and ready1→ready2 are tested with current-state eligibility recomputation. Dying support also works in a bundle with Delamain removed; no Gig-steal history is required for registration.

## Temporary-effect cleanup ordering

END_TURN → shared pending work → Lag removal → temporary power/Reboot expiration → TURN_ENDED → next turn. Floor It, unused Reboot, Lag, history and private knowledge survive both ready2 selection stages. Kiroshi memory remains intact. Existing Delamain cleanup behavior is preserved.

## Events

One new generic public fact, `DELAYED_EFFECT_CREATED`, records the full authoritative registration. Existing `EFFECT_PENDING`, `TRIGGER_ORDER_SELECTED`, `CONDITION_EVALUATED`, `CARD_READIED` and `EFFECT_RESOLVED` express later resolution. No Dying-specific events or redundant expiration event exist. Authoritative state/event transport remains private; the model boundary is the entitled observation.

## Observation

Before end turn the public future projection contains Gear source/ref, original subject, controller seat, creation turn, timing, named-Unit predicate and count2. It omits occurrence internals. At resolution, existing pending-effect IDs support ordering as before. A selected Eddie slot is public, while its hidden content stays absent. The public future array preserves multiplicity and disappears when transferred to current pending work.

## Training positions

Meaningful ATTACK order, Gig target/amount, end-turn order and ready2 choices can produce positions. Automatic registration and false conditions produce no standalone sample. The legal headline has35 strategic positions across36 actions. Positive ready2 positions pass `validateTrainingPosition` and wire actionId-only submission in focused tests.

## Hash behavior

ReplayStateHash and POSITION_V2 include exact delayed state; same board with/without future work hashes differently. ObservationHash includes only its entitled public projection. Occurrence identity derives from turn, source/subject refs, originating ATTACK effect and semantic ordinal/controller seat. Match UUID, version and event counters are excluded. Pre-registration counter changes preserve action IDs and registration IDs. Hidden Eddie substitutions preserve public decision IDs.

## Demo coverage

Recalculated from the unchanged29 roadmap rows, rather than inferred from the prompt:

| Metric | Before | After |
|---|---:|---:|
| Executable distinct /29 |18|19|
| Without executable revisions |11|10|
| Arasaka distinct /14 |5|5|
| Arasaka physical copies /30 |14|14|
| Merc distinct /15 |13|14|
| Merc physical copies /30 |27|29|
| Combined physical copies /60 |41|43|

## Remaining Merc blocker(s)

**V — Corporate Exile, one copy.** The two Dying Night copies now have a full reviewed executable revision. The positive V condition is implemented but currently has no real executable V Unit host; its positive tests are synthetic and explicitly labeled.

## Demo match readiness

Neither exact physical teaching list can initialize or play a complete match. Each remains27 main +3 Legends. Arasaka still lacks9 executable distinct cards; Merc lacksV. DEMO_STARTER was not introduced.

## Constructed validation

Official constructed stays40–50 main, exactly3 Legends and existing copy/RAM rules. Replays use42-card constructed main decks. Tests reject27 main, two Legends and a fourth Dying copy. No padding or format exception is applied to the teaching lists.

## Replays

New `dying-night-replay.v1.json`: seed`delayed-2`, **36 actions /35 strategic positions /154 events**, ending turn6/CHOOSE_GIG. It legally sets up, plays Delamain, waits out Lag, pays/equips Dying, attacks, decreases2, registers future work, passes React, steals, performs a normal MAIN sale, orders Dying with Delamain, resolves the false V condition plus independent Delamain ready1, and starts the next turn. No state/RNG patches. Positive V and repeated-attack arrangements remain focused trusted tests.

All20 replay families and wire goldens were regenerated through all16 existing/new generator scripts. The real Dying revision is the sole new official card admission.

## Original payload compatibility

Before editing, all19 original replay files were copied into `/tmp/tcg-delayed-before`. An independent audit ran their original actions/content through the new engine, changing only engine version/artifact and resulting manifest pins. It compared original initialization events/states, every semantic legal action/descriptor, every observation and event batch, and the final state. **19 families /591 original decisions passed exactly.** Regenerated defaults were not used as the proof. Original audit output: `/tmp/tcg-delayed-original-audit.log`.

| Original family | Decisions | Result |
|---|---:|---|
|combat-attack-replay.v1.json|41|Exact original payloads preserved|
|defeated-replay.v1.json|40|Exact original payloads preserved|
|delamain-replay.v1.json|33|Exact original payloads preserved|
|evelyn-replay.v1.json|17|Exact original payloads preserved|
|fight-replay.v1.json|53|Exact original payloads preserved|
|first-blue-replay.v1.json|25|Exact original payloads preserved|
|gear-replay.v1.json|25|Exact original payloads preserved|
|gig-steal-replay.v1.json|46|Exact original payloads preserved|
|kiroshi-replay.v1.json|31|Exact original payloads preserved|
|mandibular-replay.v1.json|31|Exact original payloads preserved|
|noncombat-replay.v1.json|24|Exact original payloads preserved|
|permissions-replay.v1.json|29|Exact original payloads preserved|
|prevention-replay.v1.json|34|Exact original payloads preserved|
|react-replay.v1.json|53|Exact original payloads preserved|
|reviewed-replay.v1.json|11|Exact original payloads preserved|
|satori-replay.v1.json|46|Exact original payloads preserved|
|setup-replay.v1.json|10|Exact original payloads preserved|
|turn-replay.v1.json|7|Exact original payloads preserved|
|vanilla-replay.v1.json|35|Exact original payloads preserved|

## Persistence

Live MongoDB/PostgreSQL integration passed, **2 tests, no skips**, using existing local test infrastructure. Mongo publishes/reloads the exact Dying revision and confirms repeat publication semantics. PostgreSQL replays every legal Dying action from reloaded state, comparing state, both observations, replay/position/observation hashes, legal actions and complete event history through registered combat/MAIN, shared pending work, removal and next turn.

A separate clearly trusted V-positive bootstrap persists every subsequent action through ATTACK registration and end turn. Both ready2 stages reload with all four Eddies still spent and the correct4→3 remaining options; only the completed set becomes ready. State/action/event comparisons and history continuity pass. Tests use isolated random databases/schemas and clean up their own data. No migration was needed.

## Python/wire

Wire protocol remainsv1 with additive request/response/TrainingPosition schemas. `trainingAttempt.v1.json` is byte-identical to the pre-task baseline. The only harness file changed is `scripts/test_engine_adapter.py`: Dying's replay name was appended to the generic actionId traversal list. Python contains no delayed logic.

Adapter results: **20 replay families /627 actions**,7 golden wire round trips, model input, stale rejection and invalid envelopes pass. Differential validation still reports two pre-existing Python gaps: `repeated-entry-copy-bypass` and `legend-in-main`. Node remains authoritative; these gaps were not widened into this milestone. Python game tests:87 pass. Harness core tests:48 pass. No model download, training, corpus refresh or raw/processed source mutation occurred.

## Tests

**406 application tests pass**, including55 focused Dying tests and all351 previous tests. Added tests cover source/paragraph admission, legal replay/payment/power, both-player Gig bounds, zero/no-target continuation, forced and strategic ready2 sets, identity/subtitle/type, source/host Trash lifetime, attachment changes, repeat/copy multiplicity, Delamain order/recomputation, Kiroshi/Evelyn/Dexter ATTACK order, Satori later fight timing, temporary cleanup, malformed/stale state, privacy/action hashes and wire resume. Hidden/control changes reject; termination clears future work. The delayed capability also runs without Delamain or Kiroshi/Evelyn admission.

## Commands

Application cwd: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. Runtime PATH for npm and Node commands:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

| Exact command | Result |
|---|---|
|`node -v`|v22.13.0, exit0|
|`npm -v`|10.9.2, exit0|
|`npm run typecheck`|GraphQL generation + application/web TypeScript pass|
|`npm run lint`|Pass, no warnings|
|`npm run validate:cards`|Validated4 original catalog fixture records|
|`npm test`|406 pass,0 fail,0 skip|
|`npm run build`|Next16.3.4 compile/typecheck/static generation pass; `/api/graphql` retained|
|`npm run contracts:export`|Pass; request/response/TrainingPosition refreshed, TrainingAttempt unchanged|
|`git diff --check`|Pass in both repositories|
|`node --import tsx --test tests/delayed-effects.test.ts`|55 focused tests pass|
|`node node_modules/typescript/bin/tsc --noEmit`|Pass during implementation verification|
|`node --import tsx /tmp/tcg-delayed-audit.cjs`|19 original families /591 original decisions preserved|
|`TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration`|Mongo/Postgres2 pass,0 skip|

The local infrastructure check was authorized through sandbox escalation. It ran against existing services; no Compose change or restart was required.

Every generator below was run as shown, each exiting0:

```bash
node --import tsx scripts/generate-attack-ordered-effects-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
node --import tsx scripts/generate-delayed-effects-replay.ts
node --import tsx scripts/generate-end-turn-history-replay.ts
node --import tsx scripts/generate-gear-capabilities-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-private-information-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-wire-golden.ts
```

Harness cwd: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`. All three commands exited0:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node

mlx_env/bin/python -B scripts/test_cyberpunk.py

mlx_env/bin/python -B scripts/test_harness_core.py
```

Final command outputs and result manifests remain in `/tmp/tcg-delayed-*.log`, `/tmp/tcg-delayed-gates.json`, `/tmp/tcg-delayed-generation-results.json` and `/tmp/tcg-delayed-python-results.json`. During development, focused checks caught test-fixture/expectation and TypeScript narrowing issues; these were corrected before the passing full gates. The first headline seed search also exposed the missing new-scope play admission branch; it was added to the shared play validator before final replay generation.

## Files changed

This inventory is relative to the pre-task file-hash snapshot, including pre-existing uncommitted files; it does not mistake prior milestone work for new changes. Existing source revisions, catalog, package/lock/runtime setup, migrations and harness corpus remain untouched. Paths below are relative to the application unless labeled harness.

| File | Change |
|---|---|
|`docs/delayed-effects-report.md`|Added: Full milestone evidence, contracts, tests, compatibility audit and handoff.|
|`docs/demo-deck-coverage-roadmap.md`|Modified: Admit only Dying; recalculate19/29 and43/60; retain constructed/demo separation.|
|`docs/executable-card-coverage.md`|Modified: Complete text/printing/source review, new scope, lifecycle, ready2 semantics and evidence.|
|`packages/domain/src/card.ts`|Modified: Add the bounded GEAR_DELAYED_ATTACK_V1 execution scope.|
|`packages/domain/src/game.ts`|Modified: Strict future records, captured end-turn origins/bindings, partial Eddie selection and generic event.|
|`packages/domain/src/mechanics.ts`|Modified: Typed decrease/register primitives, exact V Unit condition and bounded ready2.|
|`packages/engine/src/attachments.ts`|Modified: Dispatch complete delayed Gear admission through normal Gear support.|
|`packages/engine/src/conditions.ts`|Modified: Exact immutable Unit/Name predicate, evaluated when requested.|
|`packages/engine/src/delayed-effect-support.ts`|Added: Central strict full-card capability and metadata validation.|
|`packages/engine/src/delayed-effects.ts`|Added: Semantic identity, registration, timing query, transfer and lifetime validation.|
|`packages/engine/src/end-turn.ts`|Modified: Transfer stored instructions into the existing end-turn scheduler.|
|`packages/engine/src/index.ts`|Modified: Enable observation-derived action IDs for delayed bundles.|
|`packages/engine/src/initialization.ts`|Modified: Reject partial/unsupported delayed metadata at initialization.|
|`packages/engine/src/observation.ts`|Modified: Public future-work projection and partial Eddie-slot selection.|
|`packages/engine/src/play-support.ts`|Modified: Admit the full new Gear shape through shared play validation.|
|`packages/engine/src/state.ts`|Modified: Validate future/captured delayed records and strict metadata on reload.|
|`packages/engine/src/trigger-queries.ts`|Modified: Discover stored work beside recurring triggers; derive delayed primitives/choices.|
|`packages/engine/src/trigger-resolution.ts`|Modified: Ordered ATTACK registration, later condition and atomic count2 set completion.|
|`packages/engine/src/trigger-state.ts`|Modified: Validate captured delayed bindings and strategic partial count2 choices.|
|`packages/engine/src/trigger-support.ts`|Modified: Expose new fully admitted inherited ATTACK sources.|
|`packages/engine/src/turn.ts`|Modified: Clear waiting future instructions when a game ends.|
|`packages/engine/src/view.ts`|Modified: Expose the read-only current-turn delayed query.|
|`packages/wire/schemas/request.v1.json`|Modified: Regenerate additive v1 schema for new typed mechanics/state/observations.|
|`packages/wire/schemas/response.v1.json`|Modified: Regenerate additive v1 schema for new typed mechanics/state/observations.|
|`packages/wire/schemas/trainingPosition.v1.json`|Modified: Regenerate additive v1 schema for new typed mechanics/state/observations.|
|`scripts/engine-identity.ts`|Modified: Pin behavior version0.4.0-delayed-effects-1.|
|`scripts/generate-delayed-effects-replay.ts`|Added: Generate the legal non-V Dying headline and positions.|
|`tests/delayed-effects-fixture.ts`|Added: Complete real Dying revision and42-main constructed content/decks.|
|`tests/delayed-effects-focused.ts`|Added: Clearly synthetic V Unit plus reusable trusted arrangements and action helpers.|
|`tests/delayed-effects-replay.ts`|Added: Legal setup/payment/attack/registration/MAIN/end-turn false-branch replay.|
|`tests/delayed-effects.test.ts`|Added: 55 focused source, behavior, lifecycle, choice, interaction and privacy tests.|
|`tests/fixtures/combat-attack-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/defeated-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/delamain-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/delayed-effects-card-source.v1.json`|Added: Exact raw record, four errata, five printing image hashes and paragraph evidence.|
|`tests/fixtures/delayed-effects-rules.v1.json`|Added: 204 pinned rules plus five official FAQ hashes/summaries and bounded decisions.|
|`tests/fixtures/dying-night-demo013.webp`|Added: Reviewed official Merc printing image preserving paragraph structure.|
|`tests/fixtures/dying-night-replay.v1.json`|Added: New36-action legal replay with35 strategic positions and154 events.|
|`tests/fixtures/evelyn-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/fight-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/first-blue-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/gear-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/gig-steal-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/kiroshi-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/mandibular-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/noncombat-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/permissions-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/prevention-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/react-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/reviewed-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/satori-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/setup-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/turn-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/vanilla-replay.v1.json`|Modified: Regenerate existing replay pins/hashes/action IDs; original semantic payload independently audited.|
|`tests/fixtures/wire-golden.v1.json`|Modified: Refresh wire golden artifact/manifest pins.|
|`tests/integration/persistence.test.ts`|Modified: Mongo revision and PostgreSQL legal/positive delayed reload tests.|

Harness: **`scripts/test_engine_adapter.py`** appends only `dying-night-replay` to the existing generic replay traversal list.

## Unsupported mechanics

No V — Corporate Exile, Go Solo, field Legend execution, general delayed-effect language, general Name DSL, DEMO_STARTER, complete starter match or Arasaka expansion. Reboot's pre-existing overlapping-copy limitation remains. The application still uses its four original catalog fixtures; the new reviewed revision is explicitly pinned in engine bundles.

## Ambiguities not guessed

The new official FAQ resolves the crucial defeated-V-host lifetime and zero-decrease questions. It does not establish generic hidden-zone returns, control changes, identity changes or type changes. Such source/subject transitions reject while delayed work exists. They are unreachable through the newly admitted card's player actions and need separate source review before expansion.

The collect-then-commit Eddie set is the implementation of one mandatory count2 instruction under required-count/no-interleaving rules. Sequential UI picks do not imply sequential readiness effects. No current admitted effect can intervene after the first pick. This is not a claim that all future card effects have identical batching semantics.

Official API/image availability can change; reviewed source hashes and the paragraph image are retained. This remains an implementation review, not human-certified gold training data. No production model was run. Build/lint emit no remaining warnings; the two known Python differential gaps remain explicitly reported.

## Recommended next milestone

Review **Go Solo + field Legend execution**, starting with **V — Corporate Exile**, then separately review Arasaka Legends with that structural mechanic. Keep exact teaching-deck legality separate even after all individual cards have executable revisions. Nothing in that next milestone was implemented here.

### Gear on Legends-area hosts

Steering audit completed 2026-09-09 without restarting the milestone. **No current Gear-host bug was found.** The existing attachment/inheritance model supports face-up Legends in `LEGENDS`; individual effect eligibility is a separate layer. Engine behavior, content revisions, artifact hash, replays and coverage remain unchanged.

The read-only local [Zetatech Faceplate capture](../../tcg_ai_training/cyberpunk_llm/data/raw/cards/zetatech-faceplate.json) matches the supplied official wording: default Unit/face-up Legend equip; when that Unit **or Legend** is spent, adjust a Gig by up to1; then check three distinct controlled Gig values and draw1 if satisfied. It is Yellow RAM2, cost2, power2, sellable Gear / Cyberware / Zetatech, with four printings, including requested retail064 printing `79cdc9a5-d94d-4df4-9f88-aa02fb0357b3`. Raw SHA-256: `567ff02372745bce320f6bc2aec570ffd25a60876f6a833ff9deee1542baa1cf`. No captured erratum joins it. The [official card page](https://cyberpunktcg.com/cards/zetatech-faceplate) and [publisher's design discussion](https://cyberpunktcg.com/blog/color-tree-blue-yellow) corroborate its Unit-or-Legend spend trigger. **Zetatech Faceplate remains unadmitted.**

1. **Legal hosts:** `attachments.ts` accepts a friendly face-up field Unit **or** a friendly face-up Legend in `LEGENDS`. The reviewed state validator requires Gear to share that host's area/controller. Its older battlefield-attachment branch is guarded by `!gearEnabled(context)` and is not used by reviewed Gear policies. Rules4.10.1,4.11.3 and11.6.4 establish the host/inheritance distinction.
2. **Power, text and capabilities:** `characteristics.ts`, `trigger-queries.ts`, `capabilities.ts`, RulesView and observation all include `LEGENDS`. Printed Gear power and Royce's own-turn continuous modifier apply there; Satori fight-win text and Mandibular Blocker remain inherited there. A Legend with no printed base power remains Null under the existing reviewed rule. The battlefield-only recurring end-turn discovery is the bounded Delamain mechanic, not a global Gear filter. Future Legends-area end-turn cards would require expanding that individual discovery branch.
3. **Dying and action eligibility:** Dying contributes its printed+2 and exactly one inherited ATTACK paragraph to a Legends-area host. Inheritance neither grants attack legality nor turns Legend payment into ATTACK. Attack/Blocker actions separately require an eligible field Unit. A Legends-area V remains a Legend, so its Name alone cannot satisfy Dying's Unit-and-V predicate. The new regression also verifies public power/attachments and unchanged inheritance after paying with the host.
4. **Movement:** `host.attachments` can retain the same physical Gear IDs, and low-level `moveCardLocation` does not detach them. However, there is currently no admitted atomic Legends-to-field transfer. `processDeparture`/`moveCardForEffect` support only HAND/TRASH/REMOVED departures, detach Gear, and remove departed Legends; they must **not** be reused unchanged for Go Solo. Rules4.12–4.12.2 distinguish moving together from detaching outside the field/Legends areas. The future transition must move host and attached Gear together and preserve their relationship, then extend field-Legend host/capability admission. No Go Solo rule or action was implemented here.
5. **Actual Legend payment:** `paymentSources` recognizes ready Legends in `LEGENDS`; face-up ones require a sell tag under3.12.2/5.7.2.2. The [gameplay guide](https://cyberpunktcg.com/gameplay-guide) establishes that Legends can pay while staying in their area, while these comprehensive rules supply the qualification. `TurnMutation.call` and `play.ts::payValidated` change each same source instance READY→SPENT and emit `PAYMENT_MADE` with physical source references. No currency counter replaces the card transition; Gear and area remain unchanged.
6. **Spend hook and Faceplate gap:** There is no shared semantic spend operation or `WHEN_SPENT` type/origin yet. CALL/play payments directly mutate readiness; attack emits `ATTACKER_SPENT`; Blocker emits `BLOCKER_SPENT`; Spend-icon activation emits `CARD_SPENT`; setup also assigns spent readiness. A future central transition/capture operation should retain the reason and pre-spend source/subject bindings, then dispatch supported spend triggers at the reviewed boundary. It must preserve distinctions such as11.21.2's spending **to declare an attack**, multi-source payment timing, and setup initialization. This is a clear integration point, not an existing dispatch hook. Stable paths were not rewritten during this audit.
7. **Structural debt:** Faceplate needs bounded trigger/schema admission, discovery, immutable pending validation and return-to-payment/CALL/play/attack/Blocker continuations. Current scheduling rejects nested trigger batches and cannot yet suspend these paths for a spend trigger. Existing `ADJUST_GIG_UP_TO`, `DISTINCT_GIG_VALUES` and resolution-time `CONDITIONAL_DRAW` can express its effect instructions, but the exact ordered adjustment→conditional-draw chain also needs admission/resume tests. Merely adding a trigger enum would be insufficient. Separately, future Go Solo must reconcile effective Unit types with Dying's currently printed-UNIT-only subject validation/condition, including reviewed last-valid type handling after departure. These limits concern future execution, not a need to redesign Gear attachment.

Existing regressions were reused rather than duplicating generic host/power tests:

| Regression | Evidence |
|---|---|
|[gear.test.ts](../tests/gear.test.ts), “Royce composes printed Gear power…”|Actual attachment changes Royce power6→10→14; printed Gear power remains during the rival turn.|
|[combat-triggers.test.ts](../tests/combat-triggers.test.ts), “Royce own-turn modifier stacks…”|Satori power and inherited fight-win text exist on a Legends-area host; Null power stays Null.|
|[gear-capabilities.test.ts](../tests/gear-capabilities.test.ts), “face-up Legends-area host inherits text…”|Mandibular grants Blocker in `LEGENDS`; `DECLARE_BLOCKER` remains illegal there.|
|[turn-slice.test.ts](../tests/turn-slice.test.ts), “single-source CALL spends the same Legend…”|Payment preserves physical identity/area and rejects face-up unsellable payment sources.|
|[delayed-effects.test.ts](../tests/delayed-effects.test.ts), “Dying on a Legends-area host…” (new)|Dying on face-up Royce provides+2 and ATTACK text; real CALL payment spends the same host while retaining Gear and creates no delayed ATTACK instruction.|

Future Faceplate acceptance target, **not current executable behavior**:

```text
face-up, sell-tagged Legend in LEGENDS
→ legally equip Zetatech Faceplate; apply printed Gear power
→ pay with that Legend; same instance READY → SPENT
→ inherited WHEN_SPENT becomes pending at its reviewed timing
→ choose a legal Gig and adjust by up to1
→ evaluate distinct current Gig values after adjustment
→ draw1 if the condition is satisfied
→ resume the original action with Legend and Gear still in LEGENDS
```

Follow-up files changed: this report and `docs/executable-card-coverage.md` (test counts/audit reference), plus the one focused regression in `tests/delayed-effects.test.ts`. No engine, harness or corpus files changed during this steering audit. Verification: `npm run typecheck`, `npm run lint`, `npm test` and `git diff --check`; the final application count is **406 passing tests**, including **55 Dying tests**. Logs: `/tmp/tcg-legend-host-{typecheck,lint,test}.log`. Earlier build, persistence, Python and original replay compatibility results remain applicable because their implementation/content inputs are unchanged.
