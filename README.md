# Cyberpunk TCG Online — Phase 1

A versioned content platform and headless engine foundation. The four bundled cards are development fixtures, not official card data. No Cyberpunk gameplay, authentication, matchmaking, WebSocket server, or LLM integration is implemented.

## Workspace and dependencies

```text
apps/web/                      Next.js App Router, React, Apollo Client, composition root
packages/domain/src/           canonical schemas/types, IDs, deck validator, repository contracts, hashing
packages/engine/src/           deterministic headless engine API
packages/graphql/src/          SDL, operations, generated types, thin Apollo resolvers, pagination
packages/persistence/src/      fixture, Mongo, PostgreSQL adapters and environment validation
packages/training-harness/src/  training position schemas, candidate evaluation, JSONL import/export
scripts/                       root environment launcher, codegen/setup/validation/demo tools
tests/                         pure tests and dependency checks
tests/integration/             isolated Mongo/PostgreSQL integration tests
db/postgres/migrations/         forward SQL migrations
```

Dependency direction:

- Web composes GraphQL with persistence adapters. UI imports only generated client documents, not server services.
- GraphQL depends on domain contracts. Adapters are injected through `GraphContext`; GraphQL does not import database drivers.
- Persistence implements domain repository contracts and maps database envelopes to canonical models.
- Engine depends only on domain and Zod. Domain depends only on Zod and Node's deterministic SHA-256 primitive. Neither imports React, Next, Apollo, GraphQL, database drivers, networking, or WebSockets.
- Training harness depends on domain and engine. It has no database or model-provider integration.

`npm test` checks package manifests and source imports to enforce these boundaries. Shared packages export TypeScript source and are transpiled by Next/tsx. They are private workspaces, not published libraries. The current headless runtime is Node.js; browser-only/WASM packaging would need a hashing adapter.

## Local development

Run all commands from the repository root. Existing root `.env`, `.env.local`, and environment precedence are preserved by `scripts/web.mjs`; do not move secrets into `apps/web`.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Use a supported modern Node runtime. This refactor was verified with Node 26.8.1 and npm 11.19.0; the lockfile pins resolved dependencies.

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

The preexisting containers on ports 5432/27017 were kept. The additional Compose services from stabilization use ports 5433/27018. Choose one pair consistently. Setup scripts use the app's root environment; integration tests use explicit `TEST_*` URLs instead.

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

`validateState`, `listLegalActions`, `validateAction`, and `applyAction` are pure, deterministic APIs accepting explicit state and ruleset context. They check pinned rules, actor and expected state version. No clock or randomness is read. Phase 1 has **no legal gameplay actions**; unsupported actions return a structured error without mutation or version increments. Future rules must implement transitions/events and inject deterministic RNG if needed.

Training positions contain canonical state hash/ID, pinned rules, actor, legal actions, optional chosen action/result hash, and metadata. JSONL import validates runtime shapes and state/hash identity; export deduplicates by state hash. Candidate evaluation delegates to the engine. Shape validation alone does not prove imported legal actions are actually legal; consumers must evaluate them using the pinned engine/ruleset.

```bash
npm run --silent training:demo
```

The demo emits a deterministic placeholder position with no legal moves, not invented Cyberpunk training data.

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
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
node scripts/smoke-web.mjs fixture
node scripts/smoke-web.mjs mongo
node scripts/smoke-web.mjs unavailable
```

Integration tests create and remove randomized test databases/schemas, never application tables. They skip if explicit test URLs are missing; supply both to verify both adapters. HTTP smoke tests start and stop a temporary production server on port 3011; Mongo mode expects the development fixtures to have been seeded. Stop an old pre-refactor dev process and restart with the root `npm run dev` command after this directory move.

See [the implementation report](docs/phase1-report.md) for changed files, verification results and remaining work.
