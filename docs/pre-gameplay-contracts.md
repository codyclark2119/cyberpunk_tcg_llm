# Pre-gameplay contracts

This document records the preceding contract milestone. The subsequent
[first turn slice](turn-slice-report.md) now implements validated shuffled setup,
ready/draw/Gig decisions, CALL/payment and a multi-turn loop under TURN_SLICE_V1.
Its report supersedes the fixture-only execution limitations below for that policy;
legacy ORDERED_FIXTURE behavior remains for compatibility tests.

This pass preserves the Phase 1 web, GraphQL, immutable content repositories and
PostgreSQL command ledger. It replaces the placeholder state/action/training
interfaces. It does **not** implement playable Cyberpunk. Synthetic fixtures
exercise contracts; they are not official card mechanics or reviewed gold data.

## Ownership and dependency direction

```text
apps/web -> graphql + persistence -> domain
training-harness -> engine -> domain
wire -> engine + domain
scripts/engine-worker.ts -> wire + Node stdio + local artifact identity
Python games/cyberpunk/engine_adapter.py -> JSONL subprocess
```

`domain` owns identities, revision snapshots, ruleset/deck policies, mechanics
vocabulary, normalized state/action/event schemas and content manifests. `engine`
owns validation, initialization, selectors, observations, action IDs and
transitions. `training-harness` owns reusable positions and individual attempts.
`wire` owns versioned transport schemas. Python does not own game legality or
canonical hashing. Dependency tests cover package manifests/source imports and
the offline worker bootstrap. Generic Python `harness/core` remains unchanged.

## Content and deck contracts

`CardId` is a stable gameplay identity, `CardRevision` is an immutable snapshot,
`CardPrintingId` is a product identity, and `CardInstanceId` identifies a copy in
a match. Collector numbers are searchable metadata and may repeat. Alternate
prints must share their gameplay CardId; same-name characters need not.

Schema 2 `CardRevisionSnapshot` adds deckbuilding identity, subtitle/display name,
`printedCost` (`EDDIES`, `DASH`, `NONE`), explicit `SellProfile`, raw source markup,
typed keywords/abilities/modifiers, printing records and reviewed provenance
including source hash and errata references. The numeric legacy `cost` is only a
compatibility display projection, validated against `printedCost` when present.
Runtime code never reads that legacy cost or parses English/icons. Printed type
and executable Go Solo keyword remain immutable even when a runtime Legend
functions as a Unit. Keyword vocabulary is deliberately a small supported set;
new mechanics need typed additions and human review.

Schema 1 cards/rulesets remain byte-preserving for immutable history and the
existing four-card UI/seed. They are not executable ContentBundle cards. New
mechanics require new revisions; old snapshots must not be overwritten.

Schema 2 rulesets require explicit `CONSTRUCTED` and `SEALED_LIMITED` format
policies and gameplay policies. The legacy `deckbuilding` field remains solely
for stored-shape compatibility and is ignored for schema 2 legality; formats are
authoritative. Default beta@0.3.0 remains schema 1, preserving existing seed replay
and the current UI validator. No new official ruleset is claimed by this pass.

`validateDeck(deck, catalog, ruleset, {format, availability})` shares one validator.
Availability is `CATALOG`, or quantity-constrained `OWNED`/`SEALED`. Sealed requires
a sealed pool. Copies aggregate across repeated entries; availability aggregates
across both zones. Legend uniqueness selects CardId or reviewed
`deckbuildingIdentity`. RAM remains summed Legend supply versus maximum per-card
requirement, never a spendable runtime resource.

## State and operations

GameState schema 2 has `match`, `timing`, `players`, `objects`, `resolution`, `rng`.
Players hold ordered zone/Gig references; cards and Gigs live once in registries.
Validation enforces matching IDs, exactly one location, player/content pins,
attachment integrity/cycles, timing references, effect/choice references, and
stable decision states without unresolved work. Every public transition validates
input and output. Returned states are recursively frozen with deep readonly
TypeScript types. `GameStateSchema.parse` alone is only structural validation;
external imports must cross engine `validateState` before use.

Cards preserve owner/controller, face/readiness, revision, damage, counters,
statuses and attachments. Eddies are face-down sold card instances. Selling moves
HAND to EDDIES, preserves identity, readies the card, records turn usage and emits
CARD_MOVED/CARD_SOLD. Typed payment sources retain Eddie/Legend instance IDs.
Payment queries reject duplicate sources and dash-as-zero; overpayment/refunds
remain unsupported. Legend payment value requires an explicit ruleset policy.

Gigs have stable identity, die type, owner/controller, FIXER/GIGS location, and
UNROLLED or ROLLED state with separate original/current values. Street Cred sums
current values of controlled Gigs. Conditions separately query count, die types,
distinct current values, a particular value and Street Cred. Engine effect
primitives roll a selected eligible die, modify current value and transfer a
selected rolled Gig. D20 waits for other Fixer dice to be rolled. Transfers retain
owner, original roll and die type. Explicit bounds reject out-of-range values;
there is no guessed clamping. These primitives are for trusted future effect
handlers, **not** additional player actions exposed by the worker.

`createGame` establishes deterministic seat-local object IDs, zones, Legends,
Fixer dice, turn state and seeded RNG. Only `ORDERED_FIXTURE` initialization is
implemented: supplied deck order, explicit opening hand size, first-seat spent
Legend count. It intentionally permits synthetic small decks. Official
initialization is `UNSUPPORTED` until deck validation, shuffle, first-player and
setup policies are reviewed and implemented together. It must not be used as an
official match constructor yet.

## Actions, timing and resolution

`ActionPayload` is semantic intent. `GameAction` pairs actor with intent.
`GameCommand` adds command ID, idempotency key and expected version;
`applyCommand` checks the version then delegates without using transport metadata
in rule logic. Persistence still owns idempotency, not the pure engine.

`LegalAction` adds a deterministic actionId and typed descriptor. Models produce
only `{"actionId":"..."}`. The worker resolves it against freshly enumerated
current legal actions, then validates/applies the resulting action. Initial
intent does not enumerate Cartesian products of payment combinations.

Timing distinguishes main, rival reaction, resolving, setup and finished windows.
Combat contracts name attack declaration, attack effects, target lock, rival
reaction, combat resolution and Gig steal. PASS_REACT means declining a reaction,
not generic Magic priority. Combat/CALL/QUICK/BLOCKER/play/Go Solo execution is
not yet supported.

Effects are typed pending work; events are historical facts with sequence IDs.
Conditions, costs, selectors, abilities, modifiers, effects, actions and events
are separate schemas. The handwritten handler registry permits explicit
versioned custom handler IDs, not arbitrary JSON mutations. Registry execution
is not yet wired into a general resolver. An unimplemented ability/modifier makes
legal action enumeration fail explicitly instead of ignoring its effects.

PendingChoice represents card/target/mode/amount/order/Gig/payment/optional
selection with bounded options and a continuation. The resolution contract
separates current, pending and newly discovered effects and stages for effect
resolution, state-based checks, trigger discovery/ordering, choices and stable
decisions. No implicit LIFO semantics or map-order strategic selection exists.
`advanceResolution` stops with an unsupported-policy error for unfinished work.
Choice selection/continuations, automatic defeat rules and trigger scheduling
are intentionally not implemented. A configured Street Cred threshold can be
queried at a stable decision; simultaneous wins and alternate win conditions
still require reviewed handlers/policies.

## Observation and hashing

`observe` is engine-owned. It omits all deck order/content, opponent hand contents,
face-down Legend identities and future RNG. Hidden public objects receive zone
slot identities. Own hand and face-up public cards have pinned content references.
Public counts, readiness, damage/counters, Gigs/current values, Street Cred and
timing remain available. Choice details are withheld until a reviewed handler can
safely enumerate them. Hidden-zone tracking, revealed-card memory and effect-
specific visibility changes remain future policies.

`hashReplayState` hashes exact authoritative state; `hashObservation` hashes the
player-visible projection. `hashPosition` uses `POSITION_V1`: excludes match UUID,
state/event counters and replaces player UUIDs with seats. It retains meaningful
zone order, object identities, rules/content/artifact pins and private RNG state.
This is conservative equivalence, not complete graph-isomorphism deduplication;
positions with different private RNG remain different. New equivalence rules
require a new projection version. The former ambiguous `hashGameState` alias was
removed. Hash types are separately branded.

RNG is explicit `SHA256_COUNTER_V1` seed/counter state. Die sampling uses rejection
sampling of SHA-256-derived uint32 values; it never calls Math.random or a clock.
Roll events retain raw outcomes/counter, and later modifications preserve initial
rolls. Node is the canonical JSON/SHA-256 authority; Python uses returned hashes.

## Training and offline interop

TrainingPosition schema 2 contains independent positionId, engine version/artifact,
content manifest/hash (including ruleset hash), full private replay state and hash,
observation/hash, acting seat, legal actions, semantic positionHash and generator
revision/seed provenance. Position export deduplicates identical position IDs and
rejects conflicting reuse. Imported schemas/hashes are checked, but authoritative
`validateTrainingPosition` also rederives observations/actions with the pinned bundle before labels/prompts can be trusted.

TrainingAttempt schema 1 references positionId and separately records raw output,
parsed choice, validation, resulting state hash, model/tokenizer/adapter revisions,
prompt fingerprint, decoding parameters, elapsed time and token counts. Repeated
attempts use different attempt IDs and are never deduplicated by position/state.
`modelInput(position)` exposes only observation and action IDs/descriptors. Never
pass a full TrainingPosition, bundle, worker request or transition to a model.

ContentBundle is serialized data with reviewed schema-2 cards, pinned ruleset,
manifest hashes and engine identity. The worker reads the bundle in each request;
no DB, environment loader, GraphQL or app bootstrap is involved. It is long-running
JSONL over stdin/stdout, with logs on stderr. Supported operations: validateState,
listLegalActions, validateAction, applyAction, observe, hash. It is stateless between
requests; the caller retains the authoritative latest state. The command ledger
is intentionally not part of offline simulation.

The worker verifies its source artifact hash against the bundle. Artifact identity
covers domain/engine/wire sources, worker/bootstrap identity source and the lockfile;
it is deterministic beyond semver. Future packaged workers should also pin their
built artifact/runtime environment. Direct engine callers are responsible for
supplying the real artifact identity, as they supply content/ruleset context.

```bash
npm run contracts:export
node --import tsx scripts/generate-wire-golden.ts
npm run --silent engine:worker < requests.jsonl
npm run --silent training:demo
```

Generated JSON Schemas under `packages/wire/schemas` describe wire contract v1,
including nested state/position schema v2. They enforce structure; runtime Zod and
engine checks additionally enforce hashes and cross references. Golden vectors
are synthetic protocol regressions, not training gold. Regenerate when hashed
engine source/lockfile changes, and review changed vectors alongside the code.

Python's game-specific adapter starts one offline Node process, correlates JSONL
responses, checks envelopes/result kinds/hash shapes, rejects stale choices, and
has a timeout with subprocess cleanup. Full schema/rule validation stays in Node.
No Python engine, canonical serializer, new dependency or model download is added.
The synchronous adapter is for one caller; concurrent simulations need one worker
per caller or a later multiplexing design.

## Migration, checks and next milestone

Migration 0003 preserves schema-1 placeholder JSON and adds strict nested identity
checks for schema 2. Reading a schema-1 match through the current match repository
raises LEGACY_STATE_UNSUPPORTED: its missing objects/RNG cannot be honestly
invented. Existing migrations 0001/0002, seed IDs/revisions and ledger behavior are
unchanged. Apply `npm run db:migrate` to each application database before storing
new states. This pass runs migration tests in isolated schemas; it does not migrate
application databases automatically.

Mongo index setup repeatably replaces the old globally unique collector-number
index with a nonunique search index; stable IDs/revision constraints stay unique.
Run `npm run mongo:indexes` on each application database to apply that index change.
No corpus is fetched/imported, so `validate:cards` still reports four fixtures.

Tests cover references/ownership, sold identity, original/current Gig values,
distinct conditions, Legends, hidden information, deterministic IDs and hashes,
training attempts, wire vectors, quantity pools and positive/negative differential
decks. The existing Python validator deliberately remains a historical comparison:
repeated-entry copy limits and Legend-in-main failures are captured as expected
disagreements. Candidate generation/optimization/RAG/SFT/judging stay in Python.

Next milestone: review and version one official setup/turn/sell/CALL rules slice,
then implement its initialization, pending-effect continuation, state-based checks
and visibility policies with deterministic replay tests. Only then add combat and
real card handlers. Do not label these synthetic contract fixtures playable games.


Combat-resolution extension: `advanceResolutionWithEvents(state, context)` returns a normal `{ state, events }` transition for an opted-in `COMBAT_RESOLUTION_PENDING` boundary, automatically stopping at MAIN or a genuine combat choice. PASS_REACT normally executes this same reducer within its own event batch. The original state-only `advanceResolution` helper refuses event-producing progression instead of discarding events. No wire operation or player RESOLVE_COMBAT action was introduced. Earlier ruleset policies retain their unsupported boundaries.
