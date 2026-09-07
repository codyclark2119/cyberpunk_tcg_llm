# Phase 1 implementation report

## Outcome

The starter is now an npm workspace with six application/package boundaries. Web routes and the four-card development workflow are preserved; card listing intentionally changes to a paginated GraphQL connection. No full gameplay, authentication, WebSockets, LLM integration, deployment, commits or pushes were implemented.

Root `.env` was not modified. Existing Docker services and volumes were retained. The configured local Mongo instance now has the four development cards, immutable revisions and the default ruleset. The configured PostgreSQL database was verified against its manually applied 0001 schema, baselined, and upgraded with 0002. Repeating both migration and seed commands succeeded without duplicate application.

## Directory tree and significant files

```text
apps/web/
  package.json
  tsconfig.json
  next.config.ts
  next-env.d.ts
  public/
  src/
    app/{layout.tsx,page.tsx,globals.css,cards/page.tsx,decks/new/page.tsx}
    app/api/graphql/route.ts
    components/{nav.tsx,cards/card-browser.tsx,decks/deck-validation-demo.tsx}
    lib/{services.ts,apollo/provider.tsx}
packages/
  domain/
    package.json
    src/{index.ts,identity.ts,result.ts,card.ts,ruleset.ts,deck.ts,game.ts}
    src/{canonical.ts,repositories.ts,fixtures.ts}
  engine/
    package.json
    src/index.ts
  graphql/
    package.json
    src/{index.ts,context.ts,type-defs.ts,operations.ts,resolvers.ts,pagination.ts}
    src/generated/{client.ts,server.ts}
  persistence/
    package.json
    src/{index.ts,environment.ts,fixtures.ts,mongo.ts,postgres.ts,commands.ts}
  training-harness/
    package.json
    src/index.ts
scripts/
  web.mjs
  create-mongo-indexes.ts
  seed-mongo.ts
  migrate-postgres.ts
  validate-card-data.ts
  training-demo.ts
  smoke-web.mjs
tests/
  boundaries.test.ts
  foundations.test.ts
  integration/persistence.test.ts
db/postgres/migrations/
  0001_platform.sql                 unchanged
  0002_phase1_foundations.sql       new forward migration
codegen.ts
package.json
package-lock.json
tsconfig.base.json
tsconfig.json
eslint.config.mjs
.env.example
.gitignore
README.md
docs/phase1-report.md
docker-compose.yml                 unchanged
```

| Files | Change |
|---|---|
| Root `package.json`, lockfile; all six workspace manifests | Workspaces, declared package dependencies, Zod, GraphQL Codegen and root-compatible scripts. Version remains 0.3.0. |
| `tsconfig.base.json`, root/web tsconfigs | Shared strict settings, separate package and Next type checks. |
| `eslint.config.mjs`, `tests/boundaries.test.ts` | Flat Next/TypeScript lint plus checked import/dependency boundaries. Generated artifacts excluded from lint. |
| `.gitignore`, `.env.example` | Nested build output ignores; root environment, seed/migration and isolated test configuration. |
| `apps/web/src/app/*`, layout, styles, navigation, Apollo provider | Moved from root `src`; existing pages and visual behavior retained. |
| `apps/web/src/app/api/graphql/route.ts`, `lib/services.ts` | Typed Apollo App Router wrappers and dependency composition with explicit fixture/Mongo selection. |
| `apps/web/src/components/cards/card-browser.tsx` | Generated typed document, connection nodes and load-more pagination. |
| `apps/web/src/components/decks/deck-validation-demo.tsx` | Generated mutation/result types replace handwritten shapes. |
| Domain `identity.ts`, `result.ts` | Branded IDs/counters and explicit structured domain results. |
| Domain `card.ts`, `ruleset.ts`, `deck.ts`, `game.ts` | Canonical runtime schemas/types, pinned content/state contracts, ruleset-driven deck validation. |
| Domain `canonical.ts` | Stable JSON serialization and SHA-256 helpers with explicit rejection of lossy data. |
| Domain `repositories.ts` | Framework-independent card/ruleset/deck/match/command contracts and stored-deck/command boundary schemas. |
| Domain `fixtures.ts` | Original four fixtures, parsed once into canonical versioned cards. |
| Engine `src/index.ts` | Real deterministic validation/action API, with unsupported gameplay explicitly rejected. |
| GraphQL `type-defs.ts`, `operations.ts`, `codegen.ts`, generated files | Connection SDL, operation documents, generated client and server types with domain Card mapping. |
| GraphQL `context.ts`, `index.ts`, `resolvers.ts` | Injected repository context and thin typed resolvers. |
| GraphQL `pagination.ts` | Validated page bounds and opaque stable-ID cursors bound to filters. |
| Persistence `environment.ts` | Runtime environment validation without dumping secret values. |
| Persistence `fixtures.ts` | Defensive snapshot copies, historical revisions, idempotent fixture publishing and pagination. |
| Persistence `mongo.ts` | Validated envelopes/mappers, immutable publish/replay/conflict, monotonic current projection, indexes and explicit infrastructure errors. |
| Persistence `postgres.ts` | Owned deck storage, repeatable-read deck reads, pinned match creation and optimistic updates. |
| Persistence `commands.ts` | PostgreSQL reservation/transaction/completion ledger, validated replay and rollback/retry behavior. |
| Training harness `src/index.ts` | Position schemas, deterministic generation, candidate evaluation and JSONL import/export/deduplication. |
| `0002_phase1_foundations.sql` | Forward-only removal of beta slot cap; positive revisions/sequences, state versions, participants, command uniqueness/status invariants and state identity checks. |
| `scripts/web.mjs` | Root environment loading and Next command forwarding to `apps/web`. |
| `scripts/create-mongo-indexes.ts`, `seed-mongo.ts` | Shared index setup and explicit idempotent development content publishing with cleanup. |
| `scripts/migrate-postgres.ts` | Advisory-lock migration runner, checksum tracking, verified baseline support, transactional forward application. |
| `scripts/validate-card-data.ts` | Validates the canonical fixture import while retaining duplicate-ID/number checks. |
| `scripts/training-demo.ts`, `smoke-web.mjs` | Deterministic position proof of concept and real production HTTP verification in fixture/Mongo/unavailable modes. |
| `tests/foundations.test.ts`, `tests/integration/persistence.test.ts` | Foundational domain/engine/hash/cursor/runtime guarantees and isolated database concurrency tests. |
| `README.md`, this report | Setup, architecture, ownership, guarantees, commands and limits. |

The old root `src` tree, root Next config and root Next declaration file were moved/replaced by the workspace equivalents above; they are not parallel implementations.

## Architecture and contracts

Web composes GraphQL and persistence. GraphQL depends on domain interfaces and receives adapters through context. Persistence implements those interfaces. Engine depends on domain only; training depends on domain and engine. Domain has Zod plus the Node SHA-256 primitive, with no framework/database/network dependency. Tests inspect both manifests and import syntax for violations.

Mongo `cards` is the mutable searchable projection. `card_revisions` and `ruleset_revisions` are immutable identity/content snapshots with schema versions and hashes. Duplicate publication replays identical content and rejects conflicts. Revision insertion precedes the monotonic projection update; retry repairs an interrupted projection from the newest stored revision.

PostgreSQL keeps ownership and hard state, positive quantities/revisions, version counters, ordered unique event sequences, participants and textual content revision/version pins. SQL does not encode beta deck size, exact Legend count or copy limits. Deck and match repositories return explicit stale/missing/conflict results.

Command insertion returns STARTED, IN_PROGRESS, REPLAY or CONFLICT. Successful `execute` returns COMPLETED. Effects performed through the supplied transaction client commit with the response. A thrown callback rolls back and permits one same-request retry. The ledger is reusable infrastructure, not yet exposed as a new gameplay mutation or WebSocket command.

Engine functions are `validateState`, `listLegalActions`, `validateAction`, `applyAction`. They check ruleset pins, actor and expected version deterministically; no gameplay transitions are invented. Training generation hashes states, emits legal-action placeholders, evaluates candidates through the engine and imports/exports deduplicated JSONL.

GraphQL Codegen derives resolver signatures and typed client operation documents from SDL. The Card domain mapper avoids handwritten server duplication. Card connections use stable-ID keysets, bounded page sizes and filter-bound opaque cursors. The UI consumes generated operation types and supports subsequent pages.

## Commands and verification

All commands were run from `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online` with Node 26.8.1/npm 11.19.0.

| Exact command | Result |
|---|---|
| `npm install --ignore-scripts` | Initial restricted-network attempt stalled and was stopped; elevated rerun passed. 0 reported vulnerabilities; transitive `node-domexception` deprecation warning. |
| `npm run typecheck` | Passed; regenerates client/server types and checks strict package and Next trees. |
| `npm run lint` | Passed with no authored-source warnings. |
| `npm run validate:cards` | Passed: 4 records. |
| `npm test` | Passed: 9 unit/boundary tests. |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` | Passed: 2 database integration tests, none skipped. |
| `npm run build` | Passed: all existing pages plus `/api/graphql`. |
| `npm run db:migrate -- --baseline-0001` | Verified original live schema, recorded 0001 and applied 0002. |
| `npm run db:migrate` | Passed again; no migrations reapplied. |
| `npm run mongo:indexes` | Passed against configured local database. |
| `npm run mongo:seed` | First run published 4 cards and one ruleset; subsequent run reported REPLAY for all 5. |
| `npm run training:demo` | Emitted one deterministic placeholder position, with no legal actions. |
| `node scripts/smoke-web.mjs fixture` | GET/POST, pages, filtering, two-page traversal, malformed cursor and sample deck validation passed. |
| `node scripts/smoke-web.mjs mongo` | Same checks passed against seeded Mongo. |
| `node scripts/smoke-web.mjs unavailable` | Visible infrastructure error; no fixture fallback. |
| `git diff --check` | Passed. |

During implementation, Codegen initially generated a Card import/name collision; aliasing its mapper to DomainCard fixed it. The first workspace build exposed Node ESM/CommonJS interoperability in the environment launcher; using the package's default export fixed it. These failures were not suppressed.

Database tests create/drop only randomized test schemas/databases. Tests cover concurrent immutable publishing, conflict and replay, historical reads, projection repair, command running/replay/conflict, transactional rollback and retry, owned deck read/write, stale state writes, and pinned content. Pure tests cover canonical hashes, runtime malformed-data rejection, ruleset legality, deterministic engine behavior, cursor correctness, training round-trips and dependency direction.

## Remaining warnings and technical debt

- Node 26 emits DEP0169 from the community Apollo integration's `url.parse()` usage. The package is retained; no warning suppression was added.
- Runtime verification was on Node 26.8.1/npm 11.19.0, not the originally reported Node 22.5.1/npm 10.8.2.
- Engine gameplay is intentionally unimplemented. No action succeeds or increments versions yet.
- STARTED commands left by process death need explicit reconciliation/fencing; there is no unsafe automatic lease expiry. All transactional effects must use the supplied client. External effects need a future outbox.
- Mongo history/current projection is eventually consistent across a crash. Replaying publication repairs it; there is no background repair worker or database-level revision-write role policy yet.
- Legacy nonempty Mongo catalogs need an explicit importer, and legacy null-state matches need migration. No historical snapshots were invented.
- Generated code includes generator-owned helper types and is lint-ignored. Authored code remains strict; no broad `any` was introduced.
- Shared package source currently targets Node/Next/tsx, not standalone published artifacts. Browser/WASM headless support needs a hashing adapter/build pipeline.
- There is no authenticated public write API, event outbox, command retention policy, ruleset activation workflow, or content administration UI.
- Cursor pagination is over the current catalog, not a transactionally frozen catalog snapshot. Mongo text search and fixture substring search retain their existing semantic difference.
- Unit and HTTP tests do not replace an interactive browser/UI end-to-end suite.
- Existing Apollo client dependency ranges still say `latest`; the lockfile pins the verified resolutions.

## Recommended next five steps

1. Define reviewed, versioned gameplay semantics and state/action schemas for the first small legal transition; add deterministic replay tests before implementing more rules.
2. Add an authenticated application command service using the ledger, transaction-scoped repositories and expected state versions; define crash reconciliation/fencing.
3. Build a validated content import/publish workflow with historical migration, provenance and explicit ruleset activation; restrict production revision writes.
4. Add atomic event persistence/outbox delivery and replay verification against pinned cards/rulesets before introducing WebSockets.
5. Extend the training CLI to real legal positions and candidate evaluation after engine semantics exist; add dataset provenance and browser end-to-end regression tests.
