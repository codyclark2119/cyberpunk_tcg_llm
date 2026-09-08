# Pre-gameplay implementation report

Completed the contracts/domain/engine/interop pass while retaining Phase 1 web,
GraphQL, immutable content, persistence and command-ledger boundaries. No commits,
pushes, application database migration, corpus refresh or model training occurred.
The AI repository's pre-existing staged work and unrelated unstaged tests remain
intact. `.env`, `.nvmrc`, `harness/core`, gold data and evaluation runs were not edited.

See [the contract reference](pre-gameplay-contracts.md) for type ownership, exact
runtime semantics, wire usage, compatibility and the future gameplay pipeline.

## Result

- Hierarchical schema-2 state with normalized card/Gig registries, ordered zones,
  explicit owner/controller and face/readiness, validated references and frozen
  engine outputs.
- Rich reviewed content revisions and distinct printing identity; deck format
  and available quantities remain independent. Legacy seed snapshots stay intact.
- Engine-owned selectors/observations, semantic action IDs, isolated command
  metadata, typed effects/events/choices, explicit resolution policies and
  deterministic RNG. Selling works; Gig operations are trusted effect primitives.
- Separate replay/observation/position hashes, artifact/content pins, reusable
  TrainingPosition and repeatable TrainingAttempt records. Imported training
  labels/observations can be authoritatively rederived with validateTrainingPosition.
- Infrastructure-free wire package, generated schemas, offline JSONL worker and
  a small Python game adapter. Node remains validation/hashing authority.

## Validation commands and results

Application commands ran from `cyberpunk-tcg-online`. Each Node/npm command used:

```bash
PATH=/Users/codyclark/.nvm/versions/node/v22.5.1/bin:$PATH
```

| Command | Final result |
| --- | --- |
| `npm install --offline --ignore-scripts` | Pass; linked wire workspace; zero reported vulnerabilities; Node engine warning below |
| `node --import tsx scripts/generate-wire-golden.ts` | Pass; seven representative vectors regenerated |
| `npm run contracts:export` | Pass; four JSON Schemas generated |
| `npm run typecheck` | Pass, including GraphQL Codegen and web TypeScript |
| `npm run lint` | Pass |
| `npm run validate:cards` | Pass; four original fixture cards |
| `npm test` | Pass; 22 tests, no skips |
| `npm run build` | Pass; Next compilation, TypeScript and static generation; `/api/graphql` retained |
| `git diff --check` | Pass in both repositories |

Database tests ran with this exact command:

```bash
PATH=/Users/codyclark/.nvm/versions/node/v22.5.1/bin:$PATH \
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg \
npm run test:integration
```

Result: both tests passed with no skips. Tests create/remove randomized Mongo
Databases and PostgreSQL schemas. They verify ledger concurrency/rollback/replay,
deck ownership/versioning, normalized match writes, schema-1 history preservation,
rich card revisions, repeated index migration and duplicate collector numbers.
The first sandboxed attempt failed on local network permissions; the rerun with
local-service access passed. A cleanup error that hid Mongo connection failures
was also corrected. `docker ps --format '{{.Names}} {{.Ports}} {{.Status}}'`
confirmed the Compose services on ports 27018/5433 were already healthy.

From `tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.5.1/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
```

Results: adapter passed seven golden round trips, model-input filtering, action
submission, stale rejection, malformed envelopes and the generic-core import
boundary; seven differential deck cases reproduced the two known Python gaps.
Existing suites passed 87 and 48 tests. No ML model downloads or training were
required. Python jsonschema is not installed; the adapter intentionally has no new
dependency and delegates full schema checks to Node while checking the transport
shape in Python. TypeScript tests check generated schemas against runtime schemas.

Early implementation checks caught and resolved a branded-primitive readonly
type error and Zod's prohibition on omitting fields from a refined object schema.
Final gates above ran after the corrections.

## File inventory

Paths below are relative to their repository. This inventory excludes all
pre-existing user work in the Python repository.

| Application files | Change |
| --- | --- |
| `README.md` | Current architecture summary and contract documentation link |
| `docs/pre-gameplay-contracts.md`, `docs/pre-gameplay-report.md` | Contract decisions, supported/unsupported semantics, migration instructions, verification and inventory |
| `package.json`, `package-lock.json` | Wire workspace registration and worker/schema npm scripts |
| `packages/domain/src/identity.ts` | Printing, card-instance and Gig-instance IDs |
| `packages/domain/src/card.ts` | Legacy-compatible rich immutable revision and SellProfile schemas |
| `packages/domain/src/ruleset.ts` | Format and explicit gameplay policy schemas |
| `packages/domain/src/deck.ts` | Shared format/pool-aware legality, quantity constraints and Legend identity |
| `packages/domain/src/game.ts` | Normalized state, timing/combat/resolution, RNG, action/command/event and hash types |
| `packages/domain/src/mechanics.ts` | Typed keyword/trigger/condition/cost/target/ability/modifier/effect/choice vocabulary |
| `packages/domain/src/content.ts` | Reviewed bundles, manifests and integrity checks |
| `packages/domain/src/canonical.ts` | Removed ambiguous hashGameState alias; canonical algorithm unchanged |
| `packages/domain/src/index.ts` | New contract exports |
| `packages/engine/src/state.ts` | Initialization, invariant validation, freezing and replay/position hashing |
| `packages/engine/src/view.ts` | Read-only rules, Gig, economy, target and characteristic selectors |
| `packages/engine/src/observation.ts` | Hidden-information filtering and observation hash |
| `packages/engine/src/index.ts` | Legal action IDs, selling, command wrapper, Gig/RNG primitives and explicit unsupported resolution/handler boundaries |
| `packages/training-harness/src/index.ts` | Position/attempt split, generation, revalidation, model projection and JSONL export |
| `packages/wire/package.json`, `packages/wire/src/index.ts` | Headless transport package, strict request/response variants and dispatcher |
| `packages/wire/schemas/request.v1.json`, `response.v1.json`, `trainingPosition.v1.json`, `trainingAttempt.v1.json` | Generated wire-v1 schema set (nested position/state use schema v2) |
| `packages/persistence/src/mongo.ts` | Repeatable nonunique collector-number index migration |
| `packages/persistence/src/postgres.ts` | Nested state pins and explicit legacy-placeholder read error |
| `db/postgres/migrations/0003_normalized_state.sql` | Forward-only nested identity check preserving existing state JSON |
| `scripts/engine-worker.ts`, `scripts/engine-identity.ts` | Offline JSONL loop and deterministic source/lockfile artifact identity |
| `scripts/export-wire-schemas.ts`, `scripts/generate-wire-golden.ts` | Reproducible contract artifacts |
| `scripts/training-demo.ts` | Synthetic schema-2 decision position demo |
| `tests/contract-fixture.ts` | Explicit ordered synthetic content/state fixture |
| `tests/contracts.test.ts` | Meaningful invariants, transitions, observation/hash/training/pool/wire/differential tests |
| `tests/boundaries.test.ts` | Wire and worker dependency-direction guards |
| `tests/foundations.test.ts` | Migrated callers while preserving baseline guarantees |
| `tests/integration/persistence.test.ts` | Rich/legacy compatibility, index migration and normalized-state persistence coverage |
| `tests/fixtures/deck-differential.v1.json`, `tests/fixtures/wire-golden.v1.json` | Positive/negative and cross-language synthetic regression vectors |

| Python files | Change |
| --- | --- |
| `games/cyberpunk/engine_adapter.py` | Small synchronous offline worker adapter |
| `scripts/test_engine_adapter.py` | Golden/protocol/core-boundary and differential checks |
| `docs/engine-interop.md` | Usage, ownership, data migration and unsupported rules |
| `README.md` | Added interop documentation link; existing staged content preserved |

## Remaining boundaries and technical debt

Official setup/shuffle/first-player semantics, combat, CALL/Go Solo execution,
trigger scheduling, choice continuations, state-based defeat rules, custom-card
execution, continuous modifier application, payment edge cases and alternate/
simultaneous win policies remain unsupported. Contracts exist; no strategic
ordering, die choice or uncertain clamp behavior was fabricated. Initialization
is explicitly fixture-only. Full engine gameplay must not be inferred from the
passing contract tests.

Legacy card/ruleset display fields remain for immutable-data compatibility;
reviewed executable metadata controls schema-2 behavior. Application databases
still need `npm run db:migrate` and `npm run mongo:indexes` before new state writes
and duplicate-number publications. Old placeholder match JSON is retained but
cannot resume as a game without explicit reinitialization.

Position equivalence is conservative: it removes transport match/player identity
and counters but retains RNG and logical object IDs. Exact graph-isomorphism
normalization and hidden-zone/reveal-memory policies are future work. Worker
artifact identity hashes source/lockfile, not a distributed compiled binary or
Node runtime; packaged deployment should add those pins. The worker is a trusted
offline interface, not an authenticated public service.

Node 22.5.1 passes the current gates, but eslint-visitor-keys@5.0.1 declares
`^20.19.0 || ^22.13.0 || >=24`. Update the local Node 22 installation to a supported
minor before treating that dependency's runtime support as guaranteed. This pass
did not change the user's Node pin or install a new runtime.

Recommended next milestone: review/version official setup plus a small
turn/sell/CALL slice, implement its initialization and resolution/visibility
policies, and prove deterministic replay before expanding to combat or self-play.
