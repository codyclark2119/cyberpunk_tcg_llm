# Reviewed noncombat card play and Spend activation

This is the historical noncombat-play milestone report. The later [Gear/equip report](gear-equip-report.md) extends Gear coverage and records the current artifact pins and regenerated replay hashes; the results below describe the preceding artifact.

The bounded milestone is implemented: **Afterparty at Lizzie's** executes from hand through exact payment, a real Gig target/direction decision, current-value mutation, a resolution-time condition and conditional draw, then trash and stable MAIN. **Kerry Eurodyne: The Last Rockerboy** also plays from hand, enters with Lag, and later activates its reviewed Spend ability. All previous setup, Viktor search, Royce persistent-query and Rebecca negative-admission coverage remains. No combat was added.

## Runtime and artifact

Every application gate selected `/Users/codyclark/.nvm/versions/node/v22.13.0/bin` explicitly: **Node v22.13.0 / npm 10.9.2**. No runtime pin, package dependency, app environment or database migration changed.

- Engine version: `0.4.0-noncombat-play-1`.
- Engine artifact hash: `1fa0d6c0822534c6c4270aaceb54928d33675e4bd4ff9ba1a1d2505bccc310f9`.
- Pinned ruleset: `beta / noncombat-play-1`, hash `75a8d644451900255be3cbf8442e72f4f01203f2ab2b94edfb641502d352a982`.
- Processed rules snapshot hash: `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19`.
- Original raw rules capture hash: `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`.

## Real cards reviewed

[Executable coverage](executable-card-coverage.md) records exact text, all captured printings, normalized abilities, rules decisions, tests and limitations. Application revision 1 is our immutable snapshot revision, **not official publisher revision numbering**.

| CardId / revision | Exact raw mechanic | Primary captured printing | Execution scope |
|---|---|---|---|
| `afterparty-at-lizzie-s` / 1 | “Adjust a Gig by up to 1. If you control 2 or more Gigs with different values, draw 1.” | Retail 065, `d53925ee-df55-4b71-8ca0-13ec3ede2076` | NONCOMBAT_PLAY_V1: entire captured Program effect in open MAIN |
| `kerry-eurodyne-the-last-rockerboy` / 1 | “{Spend} If you control a Gig with 8+ value, draw 2.” | Retail 012, `c26c7db6-f540-4073-ab33-b09335631764` | NONCOMBAT_PLAY_V1: Unit entry/Lag plus full printed Spend ability; Unit combat unavailable |

Neither selected capture prints Quick or another omitted ability. Kerry costs 4, has Red RAM 1/power 5 and cannot be sold. Afterparty costs 1, has Yellow RAM 1 and can be sold. Both original raw source captures and all printing metadata are retained. No matching errata appears in the pinned local errata snapshot. The corpus was not refreshed. Implementation review does not promote these fixtures to human-certified gold.

| CardId / application revision | Raw capture SHA-256 | Canonical record sourceHash | Normalized revision content hash |
|---|---|---|---|
| `afterparty-at-lizzie-s` / 1 | `892b6eef568aa7cada92ba77f01307f4130bf8870653df97ef5e8b866e29f241` | `7557229547a745ed79dd6287604534e772ee57517165d0bd9ee4f18b8eac8b4e` | `3d4b39e64dabab7e84ea066976d6956668c8e7ca27c1721abb104af1cfea7587` |
| `kerry-eurodyne-the-last-rockerboy` / 1 | `7395900e0b45f85ff896afd6ee18eadbc99e5b76e9f02469f106b61d730a3c9c` | `5d5cdbddf7c8d43852e217edea75256aad902ccfcd7604d9f5bb8af8488f5070` | `db3e0da684b05d82077ebfe161cb6e0fafd1ce4940919f6393e0790ef9ce7197` |

## Program/card play

`listLegalActions` admits a single PLAY_CARD parent per eligible instance: active/acting player, open MAIN, hand location/controller, explicit execution scope, fully supported normalized card shape and a payable printed Eddie cost. Catalog legality or empty metadata is insufficient. Unsupported types, Dash payment, extra keywords/modifiers, arbitrary effects or activation costs fail admission or stay absent from legal actions.

The existing payment subsystem supplies actual ready Eddie/eligible Legend objects and exact subsets; its validation is shared by CALL and card play. No second numeric cost routine was introduced. A unique exact set is paid automatically—even when it contains several sources. Multiple exact sets expose a PendingChoice with only candidates that can still complete exact payment. Partial selections reserve identities without spending them until the whole exact set is chosen. Duplicate/stale sources and forged remaining cost fail validation. Parent actions never contain Cartesian payment combinations.

Program lifecycle follows 4.14–4.14.2 exactly:

```text
HAND, reveal → payment choice if strategic → pay
→ HAND → RESOLVING_PROGRAM (public, technical location outside every game area)
→ ordered PendingEffects and decisions
→ RESOLVING_PROGRAM → TRASH, face-up
→ state-based stage → MAIN
```

RESOLVING_PROGRAM is not BATTLEFIELD and not Removed from Play. It is an optional additive location in the existing typed instance/zone representation, so old states need no new empty field. The instance is retained throughout. A Unit instead enters BATTLEFIELD ready with LAG under 4.6–4.7; Kerry's activated ability is not run on play.

## Activated abilities and Spend

ACTIVATE_ABILITY carries `sourceInstanceId` and `abilityId`. Kerry's action appears only for its controller while ready, face-up in the field, not lagging, in open MAIN, with a controlled rolled Gig at current value 8+. `SPEND_SOURCE` is a typed activation cost distinct from `PAYMENT_COST`; paying an Eddie/Legend never invokes a Spend ability. Only Kerry's reviewed Spend-only activation shape is admitted here. General activated Eddie payment is still unsupported.

Activation changes READY → SPENT, emits CARD_SPENT/ABILITY_ACTIVATED, rechecks the condition at resolution (11.15.3.1), and invokes the existing DRAW primitive for two actual top cards. There are no target/payment choices for this particular activated effect. Lag clears for all Units at the end of each turn under 11.3.2; the replay waits through the normal rival turn before activating Kerry.

## Gig modification and conditions

The previous boundary blocker is resolved by the local capture, not a new guess: 6.3.3 defines minimum 1 and maximum equal to die sides; 6.4.4 forbids non-face values. New policy DIE_FACES_V1 enforces this at state admission and in the shared trusted Gig primitive. Old explicit fixture policies remain separate regression policies. Impossible boundary directions are absent from legal choices; attempted primitive overflow returns GIG_VALUE_OUT_OF_BOUNDS without mutation or clamping.

Afterparty's unrestricted “a Gig” permits either player's rolled Gig in a Gig area. Fixer dice are uncontrolled and cannot be targeted (6.1.2–6.1.4). Therefore the requested controller-negative matrix cannot correctly reject every rival target: rival targets are expressly tested as legal; nonexistent controllers and invalid locations fail state validation.

“Up to” includes zero under 2.8. AMOUNT_SELECTION uses direction modes DECREASE_1 / KEEP / INCREASE_1, preserving nonnegative chosen magnitudes under 10.31.3. KEEP is an explicit decline, not an adjustment to the same face, which 6.4.5 forbids. If no Gig exists, 10.7/10.31.1 skip the impossible target part automatically and the second part is still evaluated.

The shared primitive preserves GigInstanceId, dieType, initialValue, owner and controller, changes only currentValue, and emits GIG_VALUE_CHANGED. Street Cred always derives from current controlled values; no total is stored or mutated.

The ordered Afterparty ability contains ADJUST_GIG_UP_TO then CONDITIONAL_DRAW with explicit `timing: RESOLUTION` and the existing DISTINCT_GIG_VALUES condition, minimum 2. Conditions query the state **after** adjustment. Kerry adds GIG_VALUE_AT_LEAST, minimum 8, with explicit ACTIVATION_AND_RESOLUTION timing. No generic scripting language, intervening-trigger-condition system or continuous-condition wrapper was introduced.

Tests prove false→true, true→false, unchanged-false, and a D4/D8/D12 position with current values 3/3/7: three die types, two distinct current values, Street Cred 13, despite identical initial rolls. Original ownership does not replace current control. Both follow-up draws use TurnMutation.draw, including hidden hand semantics and the existing empty-draw loss policy.

## PendingChoice, event order and state validation

Payment, Gig target and amount choices use the existing CHOOSE/actionId protocol and PendingChoice vocabulary, just as Viktor's target choices do. Pure selectors regenerate each choice from the pinned source and current objects. The play continuation validates the source, controller, paid sources, current primitive, ordered remainder, target and option list. Viktor's search continuation and private inspection remain separate supported mechanics within the same decision protocol.

Continuation/effect identities derive from protocol, turn, actor seat, source, ability and primitive index; they exclude match ID, state version and event sequence. POSITION_V2 is unchanged. Tests vary transport counters and effect `causedBySequence` while preserving semantic hashes and action IDs; ReplayStateHash still records the complete differing state.

New events: CARD_PLAYED, ABILITY_ACTIVATED, CARD_SPENT, LAG_REMOVED, GIG_TARGET_SELECTED, GIG_ADJUSTMENT_DECLINED, CONDITION_EVALUATED. Reused events: CARD_REVEALED, PAYMENT_MADE, CARD_MOVED, EFFECT_PENDING, EFFECT_RESOLVED, GIG_VALUE_CHANGED and PHASE_CHANGED. Event order records reveal → payment → play/move → pending primitives → target → adjustment/decline → first primitive resolved → resulting-state condition → optional draw movement → second primitive resolved → Program trash → MAIN. Forced automatic operations produce no artificial training position.

## Observation and security

Only the particular declared card is revealed from an opponent hand during payment. Merely marking another hand card face-up does not expose it. The resolving Program and face-up trash/field cards are public. Labels expose public source slots, Gig die type/controller/current value, and direction; they do not reveal face-down Legend identities. Lag appears as an optional observation flag when applicable.

Other hand identities, deck order and future RNG stay out of model input. Viktor's inspected cards remain actor-only. Full states, content bundles, replay ledgers and TrainingPositions remain private authoritative artifacts; only the observation/legal-action model payload belongs in an LLM prompt.

## Deterministic replay and training positions

The new replay uses seed `noncombat-play-34`; the seed was selected locally to obtain both cards naturally in the opening draws. The replay itself never patches a deck, die or game state. Each constructed deck contains 42 cards with legal copy/RAM limits, three Afterparty, three Kerry, 36 synthetic support Gears, Viktor, Royce and one synthetic third Legend.

```text
7 engine setup decisions (first player, cuts, keep hands)
turn 1: roll D12, sell a support card, end
turn 2: rival rolls D4, ends
turn 3: roll D8, sell a support card
        PLAY Afterparty → choose Eddie payment → choose own D8 → increase 1
        D8 current 1 → 2, initial stays 1; Street Cred 13 → 14
        distinct-current-values condition true → draw 1 → Program to trash
        PLAY Kerry → forced exact four-source payment → ready Unit with Lag
        end turn clears Lag
turn 4: rival rolls D6, ends
turn 5: roll D4 → ACTIVATE Kerry → spend source → draw 2 → MAIN
```

24 semantic actions, 23 strategic TrainingPositions. MAIN positions include card play and activation; payment, Gig target and adjustment are separate strategic decisions. A forced single-option decision and automatic operations do not acquire synthetic training positions. Focused true/false and boundary fragments complement the headline true-condition replay.

| Replay | Actions | Positions | Final ReplayStateHash |
|---|---:|---:|---|
| turn | 7 | 3 | `25bad355d3796a936aed86abc92790ced26e83d5eb235a95a8b231a768985cb7` |
| setup | 10 | 7 | `3cdd05b932a1247c6da86ae4cab929b8993cc806cd25db0b3840d9607fdd54c6` |
| reviewed | 11 | 11 | `0a51e8646fe95ef21977833b996e92a2e1ee1203d25fc622d2c919c026fe22dc` |
| noncombat | 24 | 23 | `b70f716cb1b88de3525accae78064a506a0fed80fbb0b473f4dc6cf77bf2a4b9` |

## Python/wire interop

The unchanged generic Python adapter reproduces all four traces using create_game, legal_actions, observe, model_input and submit(actionId). Its test driver now includes the noncombat replay. Python contains no new Gig/card/payment/Lag logic. Model output remains `{ "actionId": "…" }`.

Wire v1 and schema-2 GameState/TrainingPosition remain additive: new action/event/effect/continuation variants, optional Program location and optional Lag observation. The request, response and TrainingPosition JSON Schemas and affected goldens were regenerated. TrainingAttempt output is unchanged. Existing wire vectors and the older replays still pass under the new pinned artifact; outputs from the former artifact are not treated as equivalent. Engine dependencies remain domain/Zod only; boundary tests pass.

## Persistence

No persistence implementation or migration changed. The existing PostgreSQL integration group now creates the complete initial history for the new replay and saves each of its 24 transitions, reading back every intermediate state and comparing the complete final contiguous event ledger. Program payment/target/amount boundaries and Kerry activation round-trip through PostgreSQL. Existing missing-batch, CAS race and injected event-insert rollback tests still pass. Mongo revision/search integration also passes against the existing local services.

This preserves atomic state + event batch behavior. It does not introduce a new command archive or combine the separately transactional command ledger and MatchRepository APIs. History validation still reads complete prior history on save, and old incomplete histories require explicit recovery.

## Tests and commands run

Final results: **78 TypeScript tests** (57 retained + 21 new), **2 real database integration groups**, **87 Python game tests**, **48 Python core tests**, four Python/Node replay loops and seven wire golden round trips. No test failures/skips remain. Typecheck, lint, card validation and production build pass. Next.js 16.3.4 builds six static pages and the dynamic GraphQL route without warnings.

All application commands ran in `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. The exact runtime prefix on each Node/npm command was `PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH`:

| Command following that prefix | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | Pass; GraphQL generation and both TS projects |
| `npm run lint` | Pass |
| `npm run validate:cards` | Pass; four original catalog records, separate from reviewed execution fixtures |
| `npm test > /tmp/tcg-play-all-tests.log 2>&1` | Pass; 78/78, zero skipped |
| `npm run build > /tmp/tcg-play-build.log 2>&1` | Pass |
| `npm run contracts:export` | Pass; request/response/TrainingPosition regenerated |
| `node --import tsx scripts/generate-wire-golden.ts` | Pass; seven vectors |
| `node --import tsx scripts/generate-turn-replay.ts` | Pass; seven actions |
| `node --import tsx scripts/generate-setup-replay.ts` | Pass; ten actions |
| `node --import tsx scripts/generate-reviewed-replay.ts` | Pass; eleven actions |
| `node --import tsx scripts/generate-noncombat-replay.ts` | Pass; 24 actions / 23 strategic positions |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` | Pass; both groups |

`docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Status}}'` confirmed existing healthy local Compose services on 27018/5433. Docker inspection required sandbox escalation; the subsequent approved local integration runs created and removed only randomized test databases/schemas. Existing infrastructure and other containers were left intact.

Python commands ran in `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py > /tmp/tcg-play-python-game.log 2>&1
mlx_env/bin/python -B scripts/test_harness_core.py > /tmp/tcg-play-python-core.log 2>&1
```

All passed. `git diff --check` passed in both repositories. Source inspection used local raw/processed captures, repository code and pinned rule excerpts; no publisher refresh occurred. Early implementation checks caught test typing issues and an explicit-undefined negative fixture rejected by canonical JSON; they were corrected without relaxing production validation. A later review removed non-strategic payment-source ordering when only one exact set exists; the final replay and tests incorporate that correction.

## Files changed

Paths below are relative to the application unless marked harness. Generated files include artifact-induced hash changes in retained replays.

| File | Change |
|---|---|
| `packages/domain/src/card.ts` | Add explicit NONCOMBAT_PLAY_V1 execution scope |
| `packages/domain/src/game.ts` | Optional Program location, LAG, play continuation, amount step, activation action and typed events |
| `packages/domain/src/mechanics.ts` | Technical resolving location, Gig condition, bounded adjustment/conditional draw and explicit activation metadata/cost vocabulary |
| `packages/domain/src/ruleset.ts` | Opt-in noncombat play policy and reviewed DIE_FACES_V1 bounds |
| `packages/engine/src/conditions.ts` | Pure shared current-state condition evaluation |
| `packages/engine/src/gig-value.ts` | Shared trusted Gig modification with explicit bounds and unchanged-value rejection |
| `packages/engine/src/play-support.ts` | Strict reviewed shape admission and play/activation legality |
| `packages/engine/src/play-state.ts` | Canonical payment/target/amount choices and continuation validation |
| `packages/engine/src/play.ts` | Program/Unit lifecycle, payment continuation, ordered resolution and Spend activation |
| `packages/engine/src/effect-support.ts` | Prevent activated metadata from slipping into CALL support |
| `packages/engine/src/effects.ts` | Typed adjustment and resolution-time conditional draw handlers |
| `packages/engine/src/index.ts` | Enumerate/dispatch play, activation and choices; clear Lag; reuse Gig primitive |
| `packages/engine/src/initialization.ts` | Deck-wide admission for the new explicit execution scope |
| `packages/engine/src/observation.ts` | Declared-card reveal, resolving Program, amount step and public Lag flag |
| `packages/engine/src/payment.ts` | Shared exact-payment validation and detection of forced exact sets |
| `packages/engine/src/search-state.ts` | Distinguish Program target continuation while retaining Viktor validation |
| `packages/engine/src/setup-state.ts` | Reject gameplay continuations/Program objects during setup |
| `packages/engine/src/state.ts` | Validate new continuation, physical-face bounds and Lag location |
| `packages/engine/src/view.ts` | Reuse shared condition/payment queries; optional location access |
| `packages/wire/schemas/request.v1.json` | Regenerated additive request schema |
| `packages/wire/schemas/response.v1.json` | Regenerated additive response schema |
| `packages/wire/schemas/trainingPosition.v1.json` | Regenerated affected TrainingPosition schema |
| `scripts/engine-identity.ts` | Increment explicit artifact version |
| `scripts/generate-noncombat-replay.ts` | Reproducible new private replay generator |
| `tests/noncombat-fixture.ts` | Handwritten raw-card normalization and pinned constructed bundle |
| `tests/noncombat-replay.ts` | Fully legal 24-action setup/Program/Unit/activation trace |
| `tests/noncombat.test.ts` | 21 focused legality, continuation, information, bounds, replay and condition tests |
| `tests/fixtures/noncombat-card-sources.v1.json` | Exact local card captures, printings and errata provenance |
| `tests/fixtures/noncombat-rules.v1.json` | Exact selected rules plus raw/processed snapshot hashes |
| `tests/fixtures/noncombat-replay.v1.json` | New replay and 23 strategic positions |
| `tests/fixtures/turn-replay.v1.json` | Refresh retained turn regression for the new artifact |
| `tests/fixtures/setup-replay.v1.json` | Refresh retained setup regression |
| `tests/fixtures/reviewed-replay.v1.json` | Refresh retained Viktor regression |
| `tests/fixtures/wire-golden.v1.json` | Refresh wire vectors |
| `tests/integration/persistence.test.ts` | Persist/read back all new replay states/events |
| `docs/executable-card-coverage.md` | Current real-card registry, exact sources, hashes and semantic decisions |
| `docs/setup-mechanics-report.md` | Link historical blockers to this completed extension |
| `docs/noncombat-play-report.md` | This report |
| Harness `scripts/test_engine_adapter.py` | Add generic traversal of the fourth replay |
| Harness `docs/engine-interop.md` | Document current play/activation protocol and scope |

## Unsupported scope, ambiguities and next milestone

No unresolved rule ambiguity was guessed for the selected cards. Gig bounds, zero choice, destination, Spend/Lag and condition order are all grounded in the captured rules. The digital direction modes and temporary location are explicit representations of those reviewed semantics.

Combat, attacks/blockers, Quick/Rival React, damage, defeat, stealing, Go Solo, equipping, arbitrary Program/Unit effects, activated Eddie costs, generic simultaneous trigger scheduling, replacements and overtime remain unsupported. Royce retains its prior Legend-area modifier scope; Rebecca stays excluded. FULL_GAME admission is not claimed.

These are reviewed headless fixture bundles, not an expansion of the four production catalog fixtures or a web match UI. The existing model observation represents no-Gig Street Cred as numeric 0 although captured rules distinguish Null; neither new condition relies on that approximation. The Python legacy deck validator still has the explicitly reported repeated-entry copy-limit and Legend-in-main gaps; authoritative gameplay/deck admission remains in TypeScript. No new build warnings were observed.

A suitable next milestone is a separately reviewed Gear/equip lifecycle with one real noncombat Gear and strict attachment validation, making Viktor search and Royce's existing derived modifier useful in the same fully legal replay. Keep combat as its own reviewed milestone.

No commit, push, staging, corpus refresh, model download or training run occurred. Pre-existing harness changes were preserved.
