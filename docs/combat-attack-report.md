# Reviewed attack initiation

Implemented the first offensive combat slice: eligible Unit selection, attack target selection, spending/declaration, one reviewed ATTACK trigger, and a valid unresolved **RIVAL_REACT** boundary. The engine stops there. It does not pass for the defender, compare power, fight, defeat cards, steal Gigs or complete combat.

The real-card replay plays Kerry and Swordwise Huscle through ordinary payment/Lag, equips Mantis Blades to Swordwise, and attacks a spent rival Kerry. Swordwise's current power is **3 + 2 = 5**, so its real ATTACK condition draws one card. The rival Gig area is a genuine alternative target. All earlier replays remain regression-tested.

## Runtime and artifact

Supported runtime: **Node v22.13.0**, **npm 10.9.2**, explicitly selected through the installed nvm path. Root project version remains 0.3.0; the behavior artifact is **0.4.0-combat-attack-1** with hash `17fd47fd121abbc386a5839eea42cd4208e74f87f30fa5a6cc83cce57397a907`. Wire goldens, all six replay fixtures and affected schemas were regenerated under this pin. Prior report hashes describe historical artifacts.

## Combat rules reviewed

[combat-rules.v1.json](../tests/fixtures/combat-rules.v1.json) preserves **179 exact selected records**, rule IDs and implementation decisions from the local capture. No publisher refresh or network source retrieval occurred.

| Source | SHA-256 |
|---|---|
| Raw comprehensive rules capture | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Processed rules snapshot | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |

| Rules | Reviewed semantics |
|---|---|
| 8.15, 9.1–9.3.1.1 | MAIN attack with a friendly ready field Unit; Lag prevents attacking. |
| 9.3.2–9.3.2.4 | Choose a valid target **before** spending: a spent rival Unit or a rival Gig area containing Gigs. No target means no attack. Effects can alter target permissions, but unsupported effects are not admitted. |
| 9.3.3–9.4.5 | Spend the selected Unit, communicate the attack/target, and establish attacking/defending roles. |
| 9.5, 11.21.1–11.21.2.2 | ATTACK means when this Unit attacks. Spending to declare causes ATTACK effects and any spending triggers to become pending; resolve them before React. |
| 10.3.3, 10.15.1, 10.16–10.17, 11.17 | Distinguish the attack trigger from its embedded resolution condition. Swordwise's power check uses current power when resolving the effect. |
| 9.6, 9.26–9.29 | After pending work, an invalid attack ends without replacement targeting, fight or steal; return to MAIN once the relevant pending work finishes. |
| 9.7–9.14 | Defender acts in React. Ending React is an explicit choice; the engine must not skip it. These reaction actions are deferred. |
| 4.2.1, 4.5, 11.25 | Legends on the field are also Units. Ordinary field entry and Go Solo have distinct orientation/Lag semantics. Their execution is not added here. |
| 11.3.1–11.3.2 | Lag blocks attacks and Spend abilities; existing end-of-each-turn clearing is retained. |
| 3.17.2–3.17.3, 4.12, 11.6 | Gear power is inherited from actual attached instances. Attacking itself does not move or detach Gear. |

The full fight/steal sections were inspected to establish the stopping boundary. No power comparison, steal-count formula or result was implemented.

## Attack state machine

The captured order differs from the prompt's illustrative trigger-first sequence:

```text
MAIN
  → DECLARE_ATTACK(cardInstanceId): choose eligible Unit
  → ATTACK_TARGET_SELECTION: attacker still READY, no ATTACK effect yet
  → CHOOSE(actionId): lock current legal target
  → spend attacker and declare attack
  → ATTACK_EFFECTS: discover / resolve supported PendingEffect
  → state-based checks
  → RIVAL_REACT: defender acting, unsupported capability, STOP
```

The target-choice state represents an **incomplete declaration**, not an already attacking Unit. It is a real strategic PendingChoice when at least two targets exist. A sole legal target locks automatically, with no separate forced training choice. No valid target suppresses DECLARE_ATTACK entirely.

Declaration/spending/discovery/resolution/checks run internally in one transition. No automatic stage is returned as a detached continuation or turned into a TrainingPosition. A terminal empty draw retains the previous immediate match-loss behavior and clears combat instead of opening React.

## Eligibility, effective Unit types and Lag

Read-only queries are `RulesView.isUnitForGameplay`, `isAttackEligible`, `listAttackers`, `listAttackTargets`, `getCombatAttacker`, `getCombatTarget` and the existing `getEffectivePower`. Common pure helpers allow trusted effect resolution and RulesView to use the same derived rules without constructing a RulesView around an internal mutable stage.

Attack eligibility requires the reviewed combat policy, stable open MAIN, active/acting controller, face-up friendly BATTLEFIELD location, effective Unit type, READY, no Lag, supported full executable shape and at least one target. Pending combat suppresses a second attack and all unrelated MAIN commands. No arbitrary per-turn attack counter was introduced; readiness and actual reviewed restrictions govern eligibility.

Printed Unit identity remains Unit. Captured 4.2.1 gives a Legend in BATTLEFIELD both LEGEND and UNIT characteristics, independently of the future means of field entry. A focused architectural test covers that query without executing Go Solo. Field-Legend attack execution is still unadmitted by the supported card-shape check. Royce in LEGENDS is not an attacker even with numeric effective power and Gear.

Kerry's real play applies Lag. The existing end-turn removal clears Lag on the same instance, and a later own MAIN lists it as an attacker. Attacking spends Kerry for declaration; it does not activate its Spend ability or treat payment as activation. A Lagging rival Unit can still be attacked if spent: Lag restricts attacking, not being a target.

## Real attackers and execution coverage

### Swordwise Huscle

| Property | Reviewed value |
|---|---|
| CardId / application revision | `swordwise-huscle` / **1** |
| Raw record UUID | `3c4e7fcb-933d-4712-9ce7-6052a14f8e94` |
| Type / classification | Unit / Merc |
| Cost / power / RAM | 3 Eddies / 3 / Red 2 |
| Sellable | No |
| Exact source text | `{Attack} If this Unit has power 5+, draw 1.` |
| Primary printing | `1c053198-187e-49ab-a9e0-0661b4c3b337`, Welcome to Night City — Retail **019** |
| Other retained printings | Beta β019, Embracing Power Retail 005 and Beta β005, Arasaka Demo 003 |
| Execution | `COMBAT_ATTACK_V1`, `SUPPORTED`; not FULL_GAME |
| Unsupported printed abilities | None omitted from this captured card; universal combat resolution remains unsupported |

[combat-card-source.v1.json](../tests/fixtures/combat-card-source.v1.json) preserves the exact raw card, all five printing UUIDs, byte hash and errata provenance. No captured erratum matches Swordwise. [combat-fixture.ts](../tests/combat-fixture.ts) normalizes it by hand. No locally available card image was found or fetched; review used captured text/metadata, not independent image-layout verification. This is implementation-reviewed fixture content, not human-certified gold training data.

| Provenance | Hash |
|---|---|
| Raw card bytes | `f71f7b0ad57d370d2fb602d29f4bba1aa8e2aa0f2ff21e5837891e1aa4b07f7a` |
| Canonical raw sourceHash | `6303e45dd851708391d23625ca5b2c0059bfd7f1675d8bfcdeeaf496df91de8b` |
| Immutable normalized revision hash | `91e8146afcf3b57b8adac59c9ab2be82a4f6ac0e0f6c405a98656f79f0ed4bda` |
| Raw errata snapshot | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Processed errata snapshot | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

Other locally reviewed ATTACK candidates were deliberately not reduced to simpler text: Panam requires discard plus a persistent free CALL; Pepe readies selected Legends; Sketchy Ripper needs a different search; Dexter includes Play and Defeated effects; Goro/El Sombrerón require temporary power; Evelyn requires conditional discard; Placide requires discard and rival bottom-decking; Jackie includes temporary power and Defeated draw. Sasha also needs Legend/Go Solo behavior. Swordwise avoids these additional systems.

The new normalized ability is `WHEN_ATTACKING`, with no extra cost/activation/trigger guard, and one `CONDITIONAL_DRAW` at RESOLUTION using `SOURCE_POWER_AT_LEAST(5)` and count 1. Complete shape admission rejects extra abilities/keywords/modifiers, wrong triggers/scopes, dash cost, missing numeric power and unsupported effect shapes. Catalog/source legality does not grant executable support.

### Kerry and retained cards

Kerry keeps its existing immutable revision and NONCOMBAT_PLAY_V1 shape. The opt-in combat policy now permits its ordinary Unit attack without inventing an ATTACK ability. Afterparty, Viktor, Royce, Mantis and synthetic support cards retain their earlier scopes/behaviors. Rebecca remains excluded. `turnSlice.combat: COMBAT_ATTACK_V1` requires the reviewed CALL, play/Gig bounds and Gear policies; it cannot silently activate combat over an incompatible fixture policy.

## ATTACK effects and Gear interaction

Swordwise's declaration creates one typed PendingEffect with its source instance and the spending event's provenance. The existing HandlerRegistry resolves CONDITIONAL_DRAW, evaluates current source power and calls the existing DRAW primitive. There is no attack-specific draw implementation or runtime English parser. The condition is part of resolution: an unmodified Swordwise still produces one pending/resolved effect, but draws nothing at power 3. With Mantis, power 5 makes it draw one.

The shared characteristics query was extracted from RulesView while retaining prior additive behavior. Mantis is still a separate CardInstance in the same area under canonical `host.attachments[]`. Attacker and Gear retain CardId, revision, ownership, control and location. Attacking changes only the attacker's readiness, not Gear readiness or the attachment relation. Focused Kerry + Mantis attack coverage reports **7** power without activating Kerry's Spend ability. No power is copied into GameState or CombatState, and no combat result is computed from it.

Only one independent ATTACK effect is admitted here. No new spend-trigger/simultaneous scheduler, inherited Gear trigger or continuous-effect layer system was implemented.

## Targets, CombatState and validation

The typed target union is:

```ts
type AttackTarget =
  | { kind: "CARD"; cardInstanceId: CardInstanceId }
  | { kind: "GIG_AREA"; playerId: PlayerId };
```

Targets are deterministically enumerated from actual control, area, effective Unit type, public face and SPENT status, or the presence of rolled Gigs in the rival area. A ready rival Unit, friendly object, Gear, Program, Legends-area Legend, empty area and individual Gig die are excluded. No player-life target or early steal selection exists.

Current combat states carry `attackerId`, `attackingPlayerId`, a typed stage and the locked target. ATTACK_TARGET_SELECTION requires target null; ATTACK_EFFECTS and RIVAL_REACT require the typed target. The defending player is derived from the two-player match. No duplicate targetId/blockerId or derived-power cache exists in these executable states. The old never-executable attack/effect/React placeholder shapes were refined; later historical vocabulary stages remain unimplemented. Existing playable NONE states and all earlier replays remain compatible under the new artifact.

Stable validation requires:

- A real supported attacker with matching controller/location/type, valid role and coherent readiness.
- READY plus the exact current multi-option PendingChoice during target selection; SPENT plus a valid locked target and defending actor at React.
- Matching combat stage, timing step/window, exclusive resolution state and no competing CALL/play/search/Program continuation.
- No disconnected internal stage, unrelated pending/discovered effect, malformed target, missing object, active setup/outcome or unresolved combat in MAIN.

Choice submission re-enumerates/revalidates the attacker and target before committing. Forged/stale choice IDs, source/controller/readiness, target/options, wrong actors and stale actionIds fail atomically. No external state is repaired.

## Invalidation and the stopping boundary

The trusted post-effect boundary implements 9.6/9.26–9.29 for this bounded effect set: after the current/pending work completes, an invalid participant/target ends the attack without replacement selection, fighting or stealing and returns to MAIN. Tests exercise a departing attacker, departing defender and a defender no longer SPENT. There are no supported per-attack temporary modifiers to clean up. The selected DRAW effect cannot itself move or retype a participant, so these are direct trusted internal tests, not invented card effects or player commands. General control changes, retyping and reaction effects remain future reviewed work.

A valid attack reaches **RIVAL_REACT**, with the defender as acting player and the attacker still active turn player. Both players can observe it. `listLegalActions` returns an empty supported action set. Observation includes `unsupportedCapabilities: ["UNSUPPORTED_RIVAL_REACT"]`; `advanceResolution`, semantic command attempts and wire actionId submission return that explicit error. TrainingPosition generation returns NO_PLAYER_DECISION. This is a deliberate supported state with an unsupported next capability, not an accidental internal deadlock or fake empty MAIN.

## Events

The target-choice entry emits PHASE_CHANGED without spending or declaring yet. On selection the tested sequence is:

```text
ATTACK_TARGET_SELECTED
ATTACKER_SPENT
ATTACK_DECLARED
EFFECT_PENDING
CONDITION_EVALUATED
CARD_MOVED                 # existing DRAW, only when condition is true
EFFECT_RESOLVED
RIVAL_REACT_OPENED
```

Spending/declaration is atomic; the PendingEffect retains the ATTACKER_SPENT sequence as its trigger provenance (11.21.2). The declared event records communication of the same selected target before resolution. No reaction/model decision intervenes. ATTACKER_SPENT is distinct from activated-ability CARD_SPENT and PAYMENT_MADE. Kerry's basic attack omits the effect events. Narrow invalidation emits ATTACK_ENDED with ATTACKER_INVALID or TARGET_INVALID, then the MAIN phase boundary. No damage, defeat or Gig-transfer event is emitted by attack initiation.

## Observation and training

Both viewers see public combat stage, attacker identity, attacking/defending seats, selected target, attacker readiness, effective power and Gear. Area targets project their player to a seat in observation. Target descriptors distinguish the actual public Unit or rival Gig area. Opponent hands, deck order, hidden Eddie content, face-down Legends and future RNG remain private. Models still receive only PlayerObservation plus legal actionIds/descriptors and respond with `{"actionId":"…"}`.

MAIN offers an action per legal attacker alongside independently legal prior actions. Multi-target selection produces a strategic position. Automatic trigger resolution and the unsupported React boundary produce none. A unique attack target locks automatically. One earlier forced END_TURN in the headline trace also stays out of training, leaving **40 strategic positions across 41 actions**. POSITION_V2 is unchanged; tests vary transport UUID/version/event counters and preserve target actionIds, resulting semantic hashes and event payloads while retaining distinct replay hashes.

## Deterministic replay

[combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) uses seed **combat-attack-46**, normal engine-owned setup and two constructed 42-card decks. Three Swordwise cards replace three synthetic support entries; all RAM/copy constraints are validated. A local seed search selected a reproducible fixture; no initialized state, deck order, RNG, card identity or action result is patched.

```text
setup: choose first player, cuts, declined mulligans, engine shuffle/deal
turn 1: own D4, SELL, end
turn 2: rival D12, SELL, PLAY Kerry (forced exact payment), end clears Lag
turn 3: own D6, SELL, PLAY Kerry with payment choices, end clears Lag
turn 4: rival D8, ACTIVATE Kerry's real Spend draw, end
turn 5: own D8, SELL, PLAY Swordwise, PLAY Mantis, choose Swordwise, end
turn 6: rival D6, ACTIVATE Kerry's real Spend draw, end
turn 7: own D10, DECLARE_ATTACK Swordwise, choose spent rival Kerry
        Swordwise draws at derived power 5; enter RIVAL_REACT; STOP
```

Attacker **p0-c12** retains Mantis **p0-c11**; selected defender is **p1-c8**. The rival Gig area is the alternative. The final trace contains **185 contiguous events including initialization**. Repeating it reproduces states, legal targets/actions/IDs, events, observations and all hashes.

| Replay | Actions | Strategic positions | Current final ReplayStateHash |
|---|---:|---:|---|
| turn | 7 | 3 | `7d9940ad284d350975a9dbbd9c9edbf07aa4bc45ff458b5d244292e485f120ec` |
| setup | 10 | 7 | `791b59beff323df5329076cf70645e557980065e9570cf2f530a48ce143235e4` |
| reviewed CALL | 11 | 11 | `65496d9ae8c871276261582df119f302f35856c5f24f40fce6ff294e7d9818de` |
| noncombat | 24 | 23 | `3f31ee538174bc0576a64a8b14b13692bcd8bc4530c62bdc2ad0f31779db512f` |
| Gear | 25 | 25 | `12a2d55a829907c61edfa81ff755b883f4b7a1a9611b34f64c121a96ee9de398` |
| combat attack | 41 | 40 | `c041d3b99f2bf8a420cbbe56e07f4cae7e0e8b27cdc186e5fc3b2839d0506f15` |

## Persistence and Python/wire

The PostgreSQL integration group persists initialization and all 41 transitions, reads back every intermediate GameState, compares ReplayStateHash against the saved state, and compares POSITION_V2 against the replay despite randomized match/player UUIDs. Final attacker/target identity, Gear relation, power query, empty React action set and all 185 contiguous events round-trip exactly. Existing transaction rollback, CAS, incomplete-history detection and all previous replay persistence checks remain. Mongo revision/publication/search integration passes. No migration or persistence implementation was changed.

The generic Python driver adds the sixth fixture and traverses DECLARE_ATTACK → target CHOOSE → RIVAL_REACT by actionId. It reproduces initialization, action lists, observations, events, hashes and final state through the unchanged Node JSONL adapter. There are no Python combat rules, copied schemas, new services/endpoints or runtime adapter changes. Wire tests additionally verify the React observation marker and structured rejection of attempted advancement.

The existing v1 envelope carries the typed state, choice, condition/event and observation additions. Request, response and TrainingPosition schemas were regenerated. TrainingAttempt and POSITION_V2 semantics remain unchanged. Executable state uses exact engine/content/ruleset pins; old placeholder combat vocabulary is not a claim of historical executable combat support.

## Tests and commands run

Final results: **120 TypeScript tests** (**98 retained + 22 new combat tests**), **2 database integration groups**, **87 Python game tests**, **48 Python core tests**, six Python/Node replay loops and seven wire golden round trips. Zero failures/skips. Typecheck, lint, four-card catalog validation, build and contract export pass. Next.js 16.3.4 builds six static pages and the dynamic GraphQL route without warnings.

The first focused combat run passed 21 tests; a wire-boundary test raised the new count to 22. An early typecheck caught optional RAM access in a test and it was corrected. A later artifact regeneration exposed four fragile prior tests: choosing the first SELL action by hash sometimes sold the Afterparty card required next. Their setup now explicitly sells a synthetic support card. No production action ordering was changed, and all previous assertions remain. The full suite then passed 120/120.

Application working directory: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. Each Node/npm command below used the exact prefix **`PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH `**:

| Command after prefix | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck > /tmp/tcg-combat-typecheck.log 2>&1` | Pass, including code generation and both TypeScript projects |
| `npm run lint > /tmp/tcg-combat-lint.log 2>&1` | Pass, zero warnings |
| `npm run validate:cards` | Pass, four original catalog records |
| `node --import tsx --test tests/combat.test.ts > /tmp/tcg-combat-focused.log 2>&1` | Initial focused pass, 21 tests |
| `npm test > /tmp/tcg-combat-all-tests.log 2>&1` | Final 120/120 pass, zero skipped |
| `npm run build > /tmp/tcg-combat-build.log 2>&1` | Pass |
| `npm run contracts:export` | Pass |
| `node --import tsx scripts/generate-wire-golden.ts` | Pass, seven vectors |
| `node --import tsx scripts/generate-turn-replay.ts` | Pass, seven actions |
| `node --import tsx scripts/generate-setup-replay.ts` | Pass, ten actions |
| `node --import tsx scripts/generate-reviewed-replay.ts` | Pass, eleven actions |
| `node --import tsx scripts/generate-noncombat-replay.ts` | Pass, 24 actions / 23 positions |
| `node --import tsx scripts/generate-gear-replay.ts` | Pass, 25 actions / 25 positions |
| `node --import tsx scripts/generate-combat-attack-replay.ts` | Pass, 41 actions / 40 positions |
| `node --import tsx /tmp/tcg-combat-seed.ts > /tmp/tcg-combat-seed.log 2>&1` | Local deterministic seed selection found seed 46; no RNG mutation |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration > /tmp/tcg-combat-integration.log 2>&1` | 2/2 real groups pass |

Local database access required approved sandbox escalation. The tests created and removed only randomized test databases/schemas against the existing services. No new infrastructure/container configuration was needed.

Harness working directory: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node > /tmp/tcg-combat-python-adapter.log 2>&1
mlx_env/bin/python -B scripts/test_cyberpunk.py > /tmp/tcg-combat-python-game.log 2>&1
mlx_env/bin/python -B scripts/test_harness_core.py > /tmp/tcg-combat-python-core.log 2>&1
```

All passed. `git diff --check` passed in the application and actual `cyberpunk_llm` repository. Inspection used local file reads, `rg`, Git status and JSON/hash checks. No model download/training or corpus refresh occurred.

## Files changed in this milestone

Paths are relative to the application unless marked harness. This inventory uses file hashes captured at the start of this pass; it does not attribute earlier uncommitted work to the combat milestone.

| File | Change |
|---|---|
| `packages/domain/src/card.ts` | Add explicit COMBAT_ATTACK_V1 execution scope |
| `packages/domain/src/game.ts` | Typed target-selection/attack/React states, timing steps and attack events |
| `packages/domain/src/mechanics.ts` | Typed card/area AttackTarget, PendingChoice option and source-power condition |
| `packages/domain/src/ruleset.ts` | Opt-in combat policy |
| `packages/engine/src/attack-support.ts` | Strict whole Swordwise shape admission |
| `packages/engine/src/characteristics.ts` | Shared pure effective type/power queries retaining existing Gear/Royce composition |
| `packages/engine/src/combat-queries.ts` | Effective Unit, source eligibility and deterministic target queries |
| `packages/engine/src/combat-state.ts` | Exact strategic choices, policy/stage/role/target/resolution invariants |
| `packages/engine/src/combat.ts` | Target-before-spend declaration, PendingEffect resolution, invalidation and React stop |
| `packages/engine/src/conditions.ts` | Current source-power predicate with explicit source/context |
| `packages/engine/src/effects.ts` | Pass source/context through existing CONDITIONAL_DRAW handler |
| `packages/engine/src/index.ts` | Enumerate/dispatch attack and target choices; explicit unsupported React advancement |
| `packages/engine/src/initialization.ts` | Deck-wide combat scope admission through existing play checks |
| `packages/engine/src/observation.ts` | Public combat/target roles and unsupported React capability marker |
| `packages/engine/src/play-support.ts` | Ordinary play admission for the reviewed attack Unit |
| `packages/engine/src/state.ts` | Integrate combat invariants and defender acting-role timing |
| `packages/engine/src/turn.ts` | Clear pending combat when existing immediate match-ending rules fire |
| `packages/engine/src/view.ts` | Read-only combat queries and shared effective characteristic/condition access |
| `packages/wire/schemas/request.v1.json` | Regenerated affected schema |
| `packages/wire/schemas/response.v1.json` | Regenerated affected schema |
| `packages/wire/schemas/trainingPosition.v1.json` | Regenerated state/content/action/observation contracts |
| `scripts/engine-identity.ts` | Increment behavior artifact version |
| `scripts/generate-combat-attack-replay.ts` | New deterministic replay generator |
| `tests/combat-fixture.ts` | Handwritten immutable Swordwise review and constructed pinned bundle |
| `tests/combat-replay.ts` | Legal setup/turn/Unit/Gear/attack trace ending at React |
| `tests/combat.test.ts` | 22 focused scope, legality, target, trigger, type/power, invariant, visibility, replay and wire tests |
| `tests/noncombat.test.ts` | Four old fixture setup selections explicitly sell support cards, independent of action hash order |
| `tests/fixtures/combat-card-source.v1.json` | Exact captured record, printings and errata/hash provenance |
| `tests/fixtures/combat-rules.v1.json` | Exact reviewed rules, hashes and decisions |
| `tests/fixtures/combat-attack-replay.v1.json` | New 41-action, 40-position private replay |
| `tests/fixtures/turn-replay.v1.json` | Regenerate preserved regression under new artifact |
| `tests/fixtures/setup-replay.v1.json` | Regenerate preserved regression under new artifact |
| `tests/fixtures/reviewed-replay.v1.json` | Regenerate preserved CALL regression |
| `tests/fixtures/noncombat-replay.v1.json` | Regenerate preserved Program/Unit/Spend regression |
| `tests/fixtures/gear-replay.v1.json` | Regenerate preserved search/equip regression |
| `tests/fixtures/wire-golden.v1.json` | Regenerate seven wire vectors |
| `tests/integration/persistence.test.ts` | Persist/read back entire combat trace, hashes, identities and event history |
| `docs/executable-card-coverage.md` | Swordwise provenance, attack order, supported scopes and limits |
| `docs/gear-equip-report.md` | Mark preceding report historical and link current extension |
| `docs/combat-attack-report.md` | This report |
| Harness `scripts/test_engine_adapter.py` | Sixth fixture in generic actionId replay traversal |
| Harness `docs/engine-interop.md` | Current offensive combat contract, visibility and nontrainable React boundary |

## Unsupported semantics, ambiguities and next milestone

Still unsupported: Rival React CALL/Quick/Blocker/PASS, Go Solo/ordinary Legend field entry, fight/power comparison, damage, defeat, Gig stealing, successful direct-area attack resolution, normal completed-combat cleanup, inherited combat Gear triggers, arbitrary attack restrictions, retyping/control-change effects, simultaneous ordering, replacements/prevention and the full card pool. No selected printed Swordwise functionality was removed to claim support.

The captured order, target categories, Lag/spend rules and React stop are explicit. No contrary TCG conventions were inferred. The new code does not guess reactions, permission overrides, effect-driven retyping or when unsupported multi-trigger chains should resolve. Architectural field-Legend type tests do not certify Go Solo. Trusted invalidation tests cover only the bounded post-effect rule; they do not add a player movement/defeat command.

Known debt remains: no-Gig Street Cred is observed as numeric 0 despite the captured Null distinction; Python's legacy deck validator still has repeated-entry copy-limit and Legend-in-main gaps; MatchRepository still reads complete prior history on save and incomplete historical histories require explicit recovery. The separate command ledger/match APIs remain unchanged. The four production catalog fixtures and web UI are not expanded by these headless execution fixtures. No new lint/build warnings remain.

The recommended next milestone is the separately reviewed **Rival React window**: reaction CALL, Quick, Blocker redirection and explicit PASS, with authoritative defender decisions and trigger timing. Continue deferring fight/defeat/Gig-steal resolution until that timing layer is proven.

No commit, push or staging was performed. Existing unrelated application/harness changes, corpora, measurements and training pipelines were preserved.
