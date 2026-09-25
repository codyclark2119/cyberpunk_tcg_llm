# Cyberpunk TCG Online

A monorepo for a Cyberpunk TCG platform and its AI harness:

- **Deterministic TypeScript engine** (`packages/engine`): the sole authority for rules, legality, hidden state, RNG and legal-action enumeration. It plays the fixed Arasaka-vs-Merc Demo format end to end, and all 192 games of its deterministic match matrix reach supported terminals. Further cards enter only through reviewed, immutable revisions (API admission batches V1–V6).
- **Web platform** (`apps/web`, `packages/graphql`, `packages/persistence`): Next.js and Apollo over versioned Mongo content and a PostgreSQL command ledger. The web catalog still serves the four development fixture cards; engine-admitted revisions are exercised by tests and replays, not yet published to it.
- **Python AI harness** (`games/`, `harness/`, `data/`): rules Q&A over the official rules and card corpus, with retrieval, a rubric-based judge and LoRA fine-tuning on Apple Silicon via MLX. For gameplay it receives public observations and engine-enumerated legal actions, and returns only an `actionId`.

Browser gameplay, authentication, matchmaking and WebSockets are not implemented. Working rules for both halves are in [CLAUDE.md](CLAUDE.md); the documentation index is [docs/README.md](docs/README.md).

## Workspace and dependencies

```text
apps/web/                      Next.js App Router, React, Apollo Client, composition root
packages/domain/src/           canonical schemas/types, IDs, deck validator, repository contracts, hashing
packages/engine/src/           deterministic headless engine API
packages/graphql/src/          SDL, operations, generated types, thin Apollo resolvers, pagination
packages/persistence/src/      fixture, Mongo, PostgreSQL adapters and environment validation
packages/training-harness/src/  training position schemas, candidate evaluation, JSONL import/export
scripts/                       Node tools (setup, validation, replay writers, reviews) and Python CLIs
tests/                         pure tests, dependency checks and committed replay fixtures
tests/integration/             isolated Mongo/PostgreSQL integration tests
db/postgres/migrations/         forward SQL migrations
games/cyberpunk/               Python game layer: markup, cards, errata, chunking, prompts, engine adapter
harness/core/                  game-agnostic Python harness: JSONL I/O, retrieval, judge, SFT, calibration
data/                          dated source snapshot: raw API captures, processed corpus, engine candidates
eval/ configs/ models/         evaluation runs, configs and local model weights (weights are gitignored)
docs/                          milestone reports and admission records, indexed in docs/README.md
```

Dependency direction:

- Web composes GraphQL with persistence adapters. UI imports only generated client documents, not server services.
- GraphQL depends on domain contracts. Adapters are injected through `GraphContext`; GraphQL does not import database drivers.
- Persistence implements domain repository contracts and maps database envelopes to canonical models.
- Engine depends only on domain and Zod. Domain depends only on Zod and Node's deterministic SHA-256 primitive. Neither imports React, Next, Apollo, GraphQL, database drivers, networking, or WebSockets.
- Training harness depends on domain and engine. It has no database or model-provider integration.
- The Python harness reaches the engine only through the JSONL worker (`scripts/engine-worker.ts`, wrapped by `games/cyberpunk/engine_adapter.py`). Nothing under `harness/` imports from `games/`.

`npm test` checks package manifests and source imports to enforce these boundaries. Shared packages export TypeScript source and are transpiled by Next/tsx. They are private workspaces, not published libraries. The current headless runtime is Node.js; browser-only/WASM packaging would need a hashing adapter.

## Local development

Run all commands from the repository root. Existing root `.env`, `.env.local`, and environment precedence are preserved by `scripts/web.mjs`; do not move secrets into `apps/web`.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Use the Node version pinned in `.nvmrc` (`nvm use`); CI runs the same version. The lockfile pins resolved dependencies.

### Fixture-only mode

Set `MONGODB_URI=` in root `.env.local`. The empty value overrides a URI in `.env`; exported shell variables take precedence. Restart Next after changing modes. Card search and deck validation use the four fixture cards and default ruleset without either database.

### Mongo/PostgreSQL mode

Set the following in root `.env.local` (development credentials only):

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=cyberpunk_tcg_content
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cyberpunk_tcg
GRAPHQL_INTERNAL_URL=http://localhost:3000/api/graphql
```

```bash
npm run infra:up
npm run mongo:indexes
npm run mongo:seed
npm run db:migrate
npm run dev
```

`mongo:seed` explicitly publishes the four fixtures and default ruleset. Repeating it reports `REPLAY`; conflicting content under an existing revision/version fails. No seed runs implicitly at startup. Index creation alone does not populate cards.

Configured but unavailable Mongo produces an actionable error, never a silent fixture fallback. Missing ruleset content and missing text indexes also produce visible setup errors. Mongo search uses its text index; fixture search uses case-insensitive substring matching, preserving starter behavior.

Compose remains infrastructure-only: PostgreSQL 16 and MongoDB 7, loopback ports, named volumes, healthchecks. `npm run infra:down` preserves volumes. If ports are occupied, use `POSTGRES_PORT=5433 MONGO_PORT=27018 npm run infra:up` and change the connection URLs accordingly. Compose reads `.env`, not `.env.local`; shell overrides work for both.

Setup scripts use the app's root environment; integration tests use explicit `TEST_*` URLs instead.

### Previously applied SQL

`0001_platform.sql` is unchanged. `0002_phase1_foundations.sql` adds versioned state, command records, participant ownership, and technical constraints; it removes the old three-slot Legend constraint.

The runner serializes migrations with a PostgreSQL advisory lock and records checksums. Each migration is transactional. Modified applied migrations are rejected. If you previously applied 0001 manually, use:

```bash
npm run db:migrate -- --baseline-0001
```

This creates an empty temporary comparison schema, checks live columns/defaults/constraints/indexes against the original migration, removes only that comparison schema, and records 0001 before applying new migrations. It fails if schemas differ. It does not recreate or delete live application tables. This baseline helper targets the default `public` schema.

## Canonical domain and runtime boundaries

Schemas are the source of canonical domain types. Card IDs, revisions, ruleset IDs/versions, player/match/deck/command IDs and version/sequence counters have distinct Zod brands. Entity IDs owned by PostgreSQL are UUIDs; content IDs are bounded ASCII identifiers. Counters match PostgreSQL integer ranges.

Environment configuration, imported fixture content, Mongo envelopes, PostgreSQL read results, GraphQL inputs, and external JSONL positions are parsed at their boundaries. Trusted domain functions do not repeatedly parse data. Expected legality/stale-state failures use discriminated `Result` values; corrupt storage and infrastructure faults throw.

Deck legality takes an explicit ruleset. The default `beta@0.3.0` keeps the starter's 3 unique Legends, 40–50 main cards, 3-copy limit, and existing RAM validation. Repeated entries are aggregated before checking copy limits. SQL contains no corresponding beta deck-size/copy-limit constraints.

`canonicalSerialize` sorts object keys recursively, preserves array order, and rejects lossy/non-JSON values, cycles, accessors and nonfinite numbers. SHA-256 helpers cover card snapshots, rulesets, states and command requests. Content identity excludes storage timestamps. This is a documented project JSON canonicalization contract, not a claim of complete RFC 8785 conformance.

## Mongo ownership and immutable history

- `cards`: one current/searchable projection per stable `_id`; contains indexed search fields, current revision, content hash, and mapped snapshot.
- `card_revisions`: immutable snapshots, unique `(cardId, revision)`, schema version and SHA-256 content hash.
- `ruleset_revisions`: immutable snapshots, unique `(rulesetId, version)`, schema version and content hash. Rulesets are selected by exact version; no implicit “latest” pointer is needed yet.

Publishing uses insert-only history. A duplicate identity with identical content returns `REPLAY`; different content returns `CONFLICT`. The atomic current-projection update cannot replace a newer revision with an older one. Replaying publication repairs missing/outdated projections from the newest stored revision. Readers validate envelope identity and content hash.

Standalone Mongo works: no replica set or multi-document transaction is required. History and projection are intentionally eventually consistent during an interrupted publish. Repair is explicit through replay, not a background worker. Database credentials must eventually restrict direct mutation of revision collections; application immutability is enforced by adapter contracts, not a Mongo administrator-proof policy.

Legacy card envelopes are not silently converted into invented historical snapshots. This local database was empty before explicitly seeding fixtures. Other installations with legacy card documents need a deliberate importer/migration before using these adapters.

## PostgreSQL ownership and commands

PostgreSQL owns users, owned decks/entries, matches/participants, pinned content references, event metadata, state versions and the command ledger. Content references are text IDs plus revisions/versions, never cross-database foreign keys.

Deck adapters enforce ownership and optimistic versions. Deck reads use one repeatable-read snapshot. Match creation pins rules and card revisions; saving requires the expected version and preserves pinned content and participants. Existing legacy matches with null serialized state require explicit migration before engine use.

The reusable command ledger scopes idempotency keys by actor:

1. Unique insertion reserves a command and returns `STARTED`.
2. Same key/hash while reserved returns `IN_PROGRESS`; it does not replay an unfinished response.
3. Same key with different hash returns `CONFLICT`.
4. Same key/hash after completion returns `REPLAY` with the stored validated response.
5. `execute` runs the callback and stores completion in one database transaction, returning `COMPLETED`.

**All database effects in the callback must use its supplied `PoolClient`.** External network effects cannot be made atomic by this ledger; a future outbox is needed. An exception rolls back effects and marks the reservation `FAILED`, allowing one same-request retry to reclaim it. A process crash can leave `STARTED`; automatic lease expiry is deliberately absent because blindly rerunning an uncertain command can double-apply effects. Reconciliation/fencing and retention policies remain future work. `begin` is a reservation primitive, not a promise that execution occurred.

## Engine and training contracts

The normalized schema-2 engine consumes a pinned `ContentBundle`, validates object/zone references, and returns frozen states. Semantic actions are separate from command metadata; models select engine-generated action IDs. Training positions and individual attempts are separate records. The offline JSONL worker and small Python adapter share this same engine.

The [documentation index](docs/README.md) lists the milestone reports behind each engine capability, the Demo format and match matrix, and every card admission batch.

```bash
npm run --silent training:demo
npm run contracts:export
npm run --silent engine:worker < requests.jsonl
```

The demo emits three synthetic gameplay decision positions (Gig choice, main, payment), not full official gameplay or gold training data.

## GraphQL and code generation

Apollo remains at `/api/graphql` with explicit App Router GET/POST wrappers. `codegen.ts` derives resolver signatures and typed client documents from SDL and operations; domain `Card` is mapped into generated resolver types. UI query/result interfaces are no longer handwritten duplicates. Generated files are checked in and regenerated by typecheck/build. Generated output is lint-ignored; authored source remains linted.

Card lists now use a connection:

```graphql
query Cards($after: String) {
  cards(first: 20, after: $after, filter: { search: "red" }) {
    edges { cursor node { id revision name } }
    pageInfo { endCursor hasNextPage }
  }
}
```

Cursors are opaque base64url envelopes containing format version, stable card ID and normalized filter hash. Pagination uses `_id` keysets, not array offsets, requests at most 100 cards, and rejects malformed or mismatched-filter cursors. The UI supports loading subsequent pages. Current-catalog changes between pages do not constitute a frozen historical snapshot. The connection shape intentionally changes the old list API; external callers must migrate.

Code generation uses the official [resolver mapper configuration](https://the-guild.dev/graphql/codegen/plugins/typescript/typescript-resolvers) and [typed document generation](https://github.com/dotansimha/graphql-typed-document-node).

## Quality gates

```bash
npm run typecheck
npm run lint
npm run validate:cards
npm test
npm run build
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cyberpunk_tcg npm run test:integration
node scripts/smoke-web.mjs fixture
node scripts/smoke-web.mjs mongo
node scripts/smoke-web.mjs unavailable
```

Integration tests create and remove randomized test databases/schemas, never application tables. They skip if explicit test URLs are missing; supply both to verify both adapters. Use the ports Compose was started with. HTTP smoke tests start and stop a temporary production server on port 3011; Mongo mode expects the development fixtures to have been seeded.

PR Validation runs the unit, integration and AI suites on every pull request and rejects skipped tests; `master` requires all three. See [CI validation](docs/ci-validation.md).

## Regenerating the engine baseline

Replays, wire schemas and matrix reviews pin the engine identity from `scripts/engine-identity.ts`: a version string plus a hash of the domain, engine and wire sources, the engine worker, the identity script itself and `package-lock.json`. Changing any of those makes the committed baseline stale, and CI fails until it is regenerated:

```bash
npm run baseline:regenerate -- --preserved <last commit before the runtime change>
```

This runs every replay writer, the 192-game Demo matrix and its reviews, then confirms the tree is byte-stable. It never commits. Review the diff (version/hash pins and legal-action order are expected to change; chosen actions, events and final states should not, unless the engine change intends it), run the gates, and commit the regeneration separately.

## AI harness

Model work needs Apple Silicon and MLX:

```bash
python3 -m venv mlx_env && source mlx_env/bin/activate
pip install -r requirements.txt
```

The offline checks need only `fastapi` from that list, no GPU and no network. CI runs all of them:

```bash
python scripts/test_cyberpunk.py                       # corpus and ingestion
python scripts/test_harness_core.py                    # harness/core
python scripts/test_engine_candidates.py               # engine candidate bridge
python scripts/check_deck_rules.py --negative-control  # deck rules against 272 public decks
python scripts/test_engine_adapter.py                  # Python-to-engine boundary
```

`data/` is a dated snapshot of the official card API. The fetch/ingest pipeline, errata handling, deckbuilding and archetype tooling, and the rules for refreshing the snapshot are in [CLAUDE.md](CLAUDE.md), with full detail in [the original harness README](docs/ai-source/README.legacy.md).

The harness was imported from `codyclark2119/cyberpunk_tcg_ai`, now archived, at its last source commit; see [the import record](docs/migration/cyberpunk_tcg_ai-import.md).
