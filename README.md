# Cyberpunk TCG Online

A learning-oriented foundation for a browser-based Cyberpunk TCG platform. Milestone 03 adopts **hybrid persistence**: MongoDB for evolving game content and PostgreSQL for hard-shaped platform/game state.

> Bundled card records are development fixtures only. No official artwork or official card text is included.

## Why two databases

The game is still in beta, so card definitions and rules can change shape as well as value. That makes them a poor fit for relational tables that would require repeated migrations. MongoDB owns content whose schema is expected to evolve:

- cards and card revisions
- rulesets and ruleset versions
- keywords/effect metadata
- future mechanic-specific fields

PostgreSQL owns data where constraints, relationships, ordering, and transactional integrity matter:

- users
- decks and ownership
- deck membership
- matches
- immutable match event sequence
- exact card/rules revisions used by a match

The application never creates a fake cross-database foreign key. PostgreSQL stores stable Mongo content IDs as `text` plus the relevant revision/version when historical reproducibility matters.

## Stack

- Next.js App Router + React + TypeScript
- Apollo Client + Apollo Server 5
- GraphQL SDL schema
- MongoDB Node.js driver for content
- node-postgres (`pg`) for platform/state data
- Pure TypeScript domain logic for deck validation and future game rules

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

The example defaults to fixture-only development: `MONGODB_URI=` selects the four bundled cards without infrastructure. An empty value in `.env.local` overrides an existing `.env` value; an exported shell variable takes precedence over both. Restart Next.js after changing modes.

### Mongo-backed development

Set `MONGODB_URI=mongodb://localhost:27017` in `.env.local`, then run:

```bash
npm run infra:up
npm run mongo:indexes
npm run dev
```

Compose starts PostgreSQL 16 and MongoDB 7 on loopback ports 5432 and 27017 with named volumes and healthchecks. PostgreSQL uses database `cyberpunk_tcg` and username/password `postgres`/`postgres`; local Mongo has no authentication. `npm run infra:down` stops services while preserving data.

If default ports are occupied, run `POSTGRES_PORT=5433 MONGO_PORT=27018 npm run infra:up` and update your connection URLs to those ports. Compose reads `.env`, while Next.js also reads `.env.local`; pass port overrides in the shell when using `.env.local`.

The index script loads Next.js development environment files, closes its client on success or failure, and exits non-zero on failure. Configured but unavailable Mongo is an infrastructure error: it never falls back to fixtures. Both card search and deck validation use the selected card repository.

A fresh Mongo database contains no cards. Index creation does not seed content; use fixture mode for the bundled card browser and sample deck until a content import is available. The sample deck intentionally contains only three main-deck cards, so a successful validation returns legality issues.

`DATABASE_URL` in `.env.example` matches Compose. Apply `db/postgres/migrations/0001_platform.sql` separately with your migration tool or `psql`; starting infrastructure does not apply the schema. `GRAPHQL_INTERNAL_URL` remains the Apollo server-side endpoint and must match the app port.

### Baseline checks

```bash
npm run typecheck
npm run lint
npm run validate:cards
npm run build
```

## Storage architecture

```text
React / Apollo Client
        |
        v
Apollo GraphQL API
        |
        v
Resolvers
        |
        +--------------------+--------------------+
        |                    |                    |
        v                    v                    v
 CardRepository        Domain services      Platform repositories
        |                    |                    |
        v                    |                    v
     MongoDB                 |               PostgreSQL
 evolving content            |              hard-shaped state
 cards / rulesets             |
        ^                    |
        +---- stable IDs ----+
```

GraphQL does not know whether a `Card` came from MongoDB or the fixture fallback. It asks the `CardRepository`. This is deliberate: transport, persistence, and rules stay independent.

## Mongo card shape

The Mongo document has a small stable indexed envelope and a flexible `data` payload:

```ts
{
  _id: "card_stable_id",
  schemaVersion: 1,
  revision: 4,
  status: "ACTIVE",
  index: {
    cardNumber: "BT01-001",
    name: "...",
    type: "UNIT",
    colors: ["RED"],
    setCode: "BT01",
    setName: "..."
  },
  data: {
    cost: 3,
    power: 4,
    ram: { RED: 2 },
    rulesText: "...",
    // New beta mechanic fields can appear here without a SQL migration.
    futureMechanic: { ... }
  }
}
```

`index` contains fields we need to search/filter consistently. `data` is intentionally open-ended. The repository mapper projects the current document into the stable GraphQL `Card` contract.

## Ruleset versioning

Rulesets also live in MongoDB and are versioned documents. A rules update can add a new timing window, keyword definition, or deckbuilding property without modifying PostgreSQL.

A live match, however, stores its pinned `ruleset_id` and `ruleset_version` in PostgreSQL. `match_content_revisions` additionally records every card revision used by that match. Old replays therefore do not silently adopt new beta errata.

```text
MongoDB
Card A revision 4 ------+
Card B revision 2 ------+----> Match 91 revision manifest (Postgres)
Rules beta 0.9.3 -------+
```

## Current GraphQL flow

`Query.cards` and `Query.card` now go through `CardRepository`. `Mutation.validateDeck` requests only the referenced card IDs from that repository, then passes plain domain cards into `validateDeck()`.

```text
Mutation.validateDeck
        |
        v
CardRepository.findByIds()
        |
        v
MongoDB / fixture adapter
        |
        v
validateDeck()       <- no database code here
        |
        v
GraphQL response
```

This same boundary will be useful for gameplay:

```text
Mutation.submitGameAction
        |
        v
MatchService.applyAction()
        |
        +--> PostgreSQL transaction/event append
        |
        +--> content lookup by pinned Mongo revision
        |
        +--> publish GameEvent
                    |
                    v
Subscription.gameUpdated
                    |
                    v
WebSocket / Apollo Client
```

## Files worth reading first

```text
src/data-access/cards/types.ts                   repository contract + Mongo document
src/data-access/cards/mongo-card-repository.ts   Mongo implementation
src/data-access/cards/mapper.ts                  Mongo -> domain projection
src/data-access/rules/types.ts                   flexible versioned rules documents
src/lib/db/mongo.ts                              Mongo connection singleton
src/lib/db/postgres.ts                           Postgres pool singleton
db/postgres/migrations/0001_platform.sql         relational platform schema
src/graphql/resolvers.ts                         Apollo -> repository/domain adapter
```

## Next milestones

1. Add GraphQL Code Generator and remove handwritten operation result types.
2. Build a seed/import pipeline that writes normalized source cards into versioned Mongo documents.
3. Add `RulesetRepository` to deck validation so legality is driven by a pinned rules version instead of constants.
4. Add Postgres deck repositories and GraphQL CRUD mutations.
5. Persist deck card IDs + revisions when a deck is saved/locked for play.
6. Build the authoritative `MatchService` and event append transaction.
7. Add `graphql-ws` subscriptions after the mutation/event boundary is stable.

## Design rule

**MongoDB owns mutable game content. PostgreSQL owns durable relationships and authoritative state. GraphQL owns the API contract. Domain services own rules. WebSockets only deliver authoritative events.**
