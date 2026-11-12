# Cyberpunk TCG Online

A monorepo for a Cyberpunk TCG platform and its AI harness:

- **Deterministic TypeScript engine** (`packages/engine`): the sole authority for rules, legality, hidden state, RNG and legal-action enumeration. It plays the fixed Arasaka-vs-Merc Demo format end to end, and all 192 games of its deterministic match matrix reach supported terminals. Further cards enter only through reviewed, immutable revisions (API admission batches V1–V6).
- **Web platform** (`apps/web`, `packages/graphql`, `packages/persistence`): Next.js and Apollo over versioned Mongo content (or the fixture repositories). The web catalog still serves the four development fixture cards; engine-admitted revisions are exercised by tests and replays, not yet published to it.
- **Python AI harness** (`games/`, `harness/`, `data/`): rules Q&A over the official rules and card corpus, with retrieval, a rubric-based judge and LoRA fine-tuning on Apple Silicon via MLX. For gameplay it receives public observations and engine-enumerated legal actions, and returns only an `actionId`. A local policy layer (`games/cyberpunk/policy_bot.py`) validates each decision and picks an offered action with a deterministic baseline or optional [local MLX inference](docs/local-mlx-bot.md). Everything runs locally; the external simulator bridge was [retired](docs/simulator-bot-retirement.md).

Browser gameplay, authentication, matchmaking and WebSockets are not implemented. Working rules for both halves are in [CLAUDE.md](CLAUDE.md); the documentation index is [docs/README.md](docs/README.md).

## Workspace and dependencies

```text
apps/web/                      Next.js App Router, React, Apollo Client, composition root
packages/domain/src/           canonical schemas/types, IDs, deck validator, repository contracts, hashing
packages/engine/src/           deterministic headless engine API
packages/graphql/src/          SDL, operations, generated types, thin Apollo resolvers, pagination
packages/persistence/src/      fixture and Mongo adapters and environment validation
packages/training-harness/src/  training position schemas, candidate evaluation, JSONL import/export
scripts/                       Node tools (setup, validation, replay writers, reviews) and Python CLIs
tests/                         pure tests, dependency checks and committed replay fixtures
tests/integration/             isolated Mongo integration tests
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
- The policy layer (`games/cyberpunk/policy_bot.py`, `policy_prompt.py`, `policy_mlx.py`) only chooses among offered action IDs; it implements no rules and invents no actions.

`npm test` checks package manifests and source imports to enforce these boundaries. Shared packages export TypeScript source and are transpiled by Next/tsx. They are private workspaces, not published libraries. The current headless runtime is Node.js; browser-only/WASM packaging would need a hashing adapter.

## Local development

Run all commands from the repository root. Existing root `.env`, `.env.local`, and environment precedence are preserved by `scripts/web.mjs`; do not move secrets into `apps/web`.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Use the Node version pinned in `.nvmrc` (`nvm use`); the manual validation workflow runs the same version. The lockfile pins resolved dependencies.

### Fixture-only mode

Set `MONGODB_URI=` in root `.env.local`. The empty value overrides a URI in `.env`; exported shell variables take precedence. Restart Next after changing modes. Card search and deck validation use the four fixture cards and default ruleset without either database.

### Mongo mode

Set the following in root `.env.local` (development credentials only):

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=cyberpunk_tcg_content
GRAPHQL_INTERNAL_URL=http://localhost:3000/api/graphql
```

```bash
npm run infra:up
npm run mongo:indexes
npm run mongo:seed
npm run dev
```

`mongo:seed` explicitly publishes the four fixtures and default ruleset. Repeating it reports `REPLAY`; conflicting content under an existing revision/version fails. No seed runs implicitly at startup. Index creation alone does not populate cards.

Configured but unavailable Mongo produces an actionable error, never a silent fixture fallback. Missing ruleset content and missing text indexes also produce visible setup errors. Mongo search uses its text index; fixture search uses case-insensitive substring matching, preserving starter behavior.

Compose remains infrastructure-only: MongoDB 7, a loopback port, a named volume and a healthcheck. `npm run infra:down` preserves volumes. If ports are occupied, use `MONGO_PORT=27018 npm run infra:up` and change the connection URL accordingly. Compose reads `.env`, not `.env.local`; shell overrides work for both.

Setup scripts use the app's root environment; integration tests use explicit `TEST_*` URLs instead.

## Canonical domain and runtime boundaries

Schemas are the source of canonical domain types. Card IDs, revisions, ruleset IDs/versions, player/match/deck/command IDs and version/sequence counters have distinct Zod brands. Entity IDs are UUIDs; content IDs are bounded ASCII identifiers. Counters keep the integer ranges of the retired PostgreSQL schema.

Environment configuration, imported fixture content, Mongo envelopes, GraphQL inputs, and external JSONL positions are parsed at their boundaries. Trusted domain functions do not repeatedly parse data. Expected legality/stale-state failures use discriminated `Result` values; corrupt storage and infrastructure faults throw.

Deck legality takes an explicit ruleset. The default `beta@0.3.0` keeps the starter's 3 unique Legends, 40–50 main cards, 3-copy limit, and existing RAM validation. Repeated entries are aggregated before checking copy limits.

`canonicalSerialize` sorts object keys recursively, preserves array order, and rejects lossy/non-JSON values, cycles, accessors and nonfinite numbers. SHA-256 helpers cover card snapshots, rulesets, states and command requests. Content identity excludes storage timestamps. This is a documented project JSON canonicalization contract, not a claim of complete RFC 8785 conformance.

## Mongo ownership and immutable history

- `cards`: one current/searchable projection per stable `_id`; contains indexed search fields, current revision, content hash, and mapped snapshot.
- `card_revisions`: immutable snapshots, unique `(cardId, revision)`, schema version and SHA-256 content hash.
- `ruleset_revisions`: immutable snapshots, unique `(rulesetId, version)`, schema version and content hash. Rulesets are selected by exact version; no implicit “latest” pointer is needed yet.

Publishing uses insert-only history. A duplicate identity with identical content returns `REPLAY`; different content returns `CONFLICT`. The atomic current-projection update cannot replace a newer revision with an older one. Replaying publication repairs missing/outdated projections from the newest stored revision. Readers validate envelope identity and content hash.

Standalone Mongo works: no replica set or multi-document transaction is required. History and projection are intentionally eventually consistent during an interrupted publish. Repair is explicit through replay, not a background worker. Database credentials must eventually restrict direct mutation of revision collections; application immutability is enforced by adapter contracts, not a Mongo administrator-proof policy.

Legacy card envelopes are not silently converted into invented historical snapshots. This local database was empty before explicitly seeding fixtures. Other installations with legacy card documents need a deliberate importer/migration before using these adapters.

## Retired PostgreSQL layer

The PostgreSQL adapters (owned decks, matches and the command ledger), their SQL migrations, `npm run db:migrate` and the Compose service were removed on 2026-11-11. No runtime path used them: the web app and GraphQL read only Mongo or fixture content, and engine state lives in replays and match records. The domain repository contracts (`DeckRepository`, `MatchRepository`, `CommandRepository`) remain in `packages/domain` without an adapter. The `pg` dependency is still declared in `packages/persistence` and will be removed separately, since the lockfile is part of the engine identity. Milestone reports dated before then describe the layer as it was.

## Engine and training contracts

The normalized schema-2 engine consumes a pinned `ContentBundle`, validates object/zone references, and returns frozen states. Semantic actions are separate from command metadata; models select engine-generated action IDs. Training positions and individual attempts are separate records. The offline JSONL worker and small Python adapter share this same engine.

The [documentation index](docs/README.md) lists the milestone reports behind each engine capability, the Demo format and match matrix, and every card admission batch.

```bash
npm run --silent training:demo
npm run contracts:export
npm run --silent engine:worker < requests.jsonl
```

The demo emits three synthetic gameplay decision positions (Gig choice, main, payment), not full official gameplay or gold training data.

Python reads and writes both record types through `harness/core/training_records.py`, which validates every record against the exported `packages/wire/schemas/trainingPosition.v1.json` and `trainingAttempt.v1.json` and fails closed on unknown fields or versions. It also holds the hook a local match runner uses to log one attempt per decision (`build_position`, `TrainingLog.log_attempt`). Hashes stay engine-checked: `scripts/check-training-records.ts` runs Python-written files through `importPositions` and `validateTrainingPosition`, and `scripts/test_training_records.py` round-trips records between the two languages. See [docs/training-record-migration.md](docs/training-record-migration.md) for the gold-store plan.

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

Validation is local-first; GitHub runs nothing automatically. One script runs every gate below and checks each suite's exact pass line or TAP summary:

```bash
scripts/run_tests.sh --quick   # static checks, unit suite and Python suites; no Docker
scripts/run_tests.sh           # full tier: adds build, diff check, deck rules and integration (starts Docker unless --no-infra)
npm run hooks:install          # opt-in pre-push hook running --quick (SKIP_LOCAL_VALIDATION=1 bypasses)
npm run validate:ui            # loopback console with Quick, Full, Full-no-Docker and Single-step runs
```

The individual commands:

```bash
npm run typecheck
npm run lint
npm run validate:cards
npm test
npm run build
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:integration
node scripts/smoke-web.mjs fixture
node scripts/smoke-web.mjs mongo
node scripts/smoke-web.mjs unavailable
```

Integration tests create and remove randomized test databases, never application collections. They skip if `TEST_MONGODB_URI` is missing. Use the port Compose was started with. HTTP smoke tests start and stop a temporary production server on port 3011; Mongo mode expects the development fixtures to have been seeded.

`run_tests.sh` rejects skipped tests, and its pin table is the one place that holds every expected pass line. A manual-only GitHub workflow (`manual-validation.yml`) runs the same script on demand. See [Validation](docs/ci-validation.md).

## Regenerating the engine baseline

Replays, wire schemas and matrix reviews pin the engine identity from `scripts/engine-identity.ts`: a version string plus a hash of the domain, engine and wire sources, the engine worker, the identity script itself and `package-lock.json`. Changing any of those makes the committed baseline stale, and validation fails until it is regenerated:

```bash
npm run baseline:regenerate -- --preserved <last commit before the runtime change>
```

This runs every replay writer, the 192-game Demo matrix and its reviews, then confirms the tree is byte-stable. It never commits. Review the diff (version/hash pins and legal-action order are expected to change; chosen actions, events and final states should not, unless the engine change intends it), run the gates, and commit the regeneration separately.

The independent replay fixtures are listed in `scripts/lib/replay-registry.ts` and written by one CLI; `--check` regenerates them in memory and names any file whose committed bytes differ:

```bash
npm run replays:generate                          # write every registered fixture
npm run replays:generate -- turn-replay gear-replay
npm run replays:generate -- --check               # no writes; exit 1 on any byte difference
npm run replays:generate -- --list
DEMO_MATRIX_CONCURRENCY=4 npm run test:matrix -- --check   # matrix; serial and parallel output are identical
```

Matrix traces, which the matrix reviews read back, go to `DEMO_MATRIX_TRACE_DIR` (default `/tmp/tcg-reboot-model-a-traces`).

## AI harness

Model work needs Apple Silicon and MLX:

```bash
python3 -m venv mlx_env && source mlx_env/bin/activate
pip install -r requirements.txt
```

The offline checks need `fastapi` (for the harness monitor tests), no GPU and no network after dependency installation. `scripts/run_tests.sh` runs all of them:

```bash
python -m pip install fastapi httpx
python scripts/test_cyberpunk.py                       # corpus and ingestion
python scripts/test_harness_core.py                    # harness/core
python scripts/test_engine_candidates.py               # engine candidate bridge
python scripts/check_deck_rules.py --negative-control  # deck rules against 272 public decks
python scripts/test_engine_adapter.py                  # Python-to-engine boundary
python scripts/test_policy_bot.py                      # local policy layer: validation, baseline, fallbacks
python scripts/test_policy_mlx.py                      # subprocess policy boundary; no MLX required
python scripts/test_local_match.py                     # bot-vs-bot games on the real engine worker
python scripts/test_local_prompt.py                    # compact gameplay prompt: facts kept, nothing hidden added
```

`data/` is a dated snapshot of the official card API. The fetch/ingest pipeline, errata handling, deckbuilding and archetype tooling, and the rules for refreshing the snapshot are in [CLAUDE.md](CLAUDE.md), with full detail in [the original harness README](docs/ai-source/README.legacy.md).

The harness was imported from `codyclark2119/cyberpunk_tcg_ai`, now archived, at its last source commit; see [the import record](docs/migration/cyberpunk_tcg_ai-import.md).

### Local gameplay policy

`games/cyberpunk/policy_bot.py` validates a `Decision` (visible context plus the
offered legal actions) and `PolicyRunner` returns one offered `actionId`. The
default chooser is a deterministic smoke-play baseline, not a trained gameplay
model. On Apple Silicon, `MLXPolicy` (`games/cyberpunk/policy_mlx.py`) runs a
persistent local MLX model in its own process; slow, busy or invalid model
decisions fall back to the baseline, and each fallback's failure code is recorded.
The per-decision budget is a setting (`--budget-ms`, default 10,000 ms; local play
has no external deadline), and a late model answer is discarded without blocking
the next decision; see [docs/local-time-budget.md](docs/local-time-budget.md). Follow the
[Mac setup and benchmark guide](docs/local-mlx-bot.md) to install
`requirements-mlx-bot.txt`, download Qwen3-8B's 4-bit weights and measure decision
time with `scripts/benchmark_policy_bot.py`, which now measures positions from real
local engine games. The model reads the position as compact text
(`local-choice-v3`, about a third of the earlier JSON prompt);
`scripts/measure_prompt_size.py` reports prompt sizes over real games without a
model; see [docs/local-prompt-v3.md](docs/local-prompt-v3.md). The external simulator HTTP bridge was
[retired on 2026-11-11](docs/simulator-bot-retirement.md). No external LLM API is
used. A trained gameplay adapter and measured playing strength are still future
milestones.

### Local bot-vs-bot matches

`scripts/run_local_matches.py` plays full games on the local engine. For each
decision the engine names the acting player and offers its legal actions; that
seat's policy (`baseline` or `mlx`) picks one offered `actionId`, and the engine
applies it. Each match is written as JSONL under `local/matches/` (gitignored).
The fixed Demo decks are the default; `--setup` takes any `content` plus
`initialization` the engine's `createGame` accepts. Records (schemaVersion 3) name
each seat's model path and revision and give every decision's chosen index, the
baseline's pick and whether they agree; `--training-dir` also logs model decisions
as TrainingPosition/TrainingAttempt records. See
[docs/local-match-runner.md](docs/local-match-runner.md) and
[docs/local-match-records-v3.md](docs/local-match-records-v3.md).

```bash
python scripts/run_local_matches.py --matches 10 --seed demo            # baseline vs baseline
python scripts/run_local_matches.py --policy baseline mlx --matches 3   # Apple Silicon only
python scripts/run_local_matches.py --policy baseline mlx --budget-ms 20000  # longer thinking time
python scripts/run_local_matches.py --policy baseline mlx --training-dir local/training  # also log training records
```

### Local play UI

`scripts/play_local.py` serves one offline page on `127.0.0.1` where you can play
a match against a local bot, launch bot-vs-bot matches and step through recorded
matches. You see only your seat's public engine view and press the actions the
engine offers; the server accepts only an offered `actionId`. Human matches write
the same records to `local/matches/`. It needs `fastapi` and `uvicorn`; any bind
off loopback requires the printed token. See [docs/local-play-ui.md](docs/local-play-ui.md).

```bash
python scripts/play_local.py              # then open http://127.0.0.1:8766/
python scripts/test_play_app.py           # needs fastapi and httpx; real engine, baseline bot
```

### Local assistant tools

The local chat assistant gets every card and rule fact from code, never from the
model's memory: `games/cyberpunk/assistant/tools.py` holds `find_card` (name to
slugs, every same-named card listed with an `ambiguous` flag), `get_card` (full facts
by slug, errata attached and marked as overriding the printed text), `search_cards`
(structured filters only), `get_rule` (by rule number, with its section and
sub-rules), `search_rules` (one passage per rule with its heading path, ranked by
deterministic rule-level BM25 in `assistant/retrieval.py`, fused with an embedding
ranking once a matching rules index exists; the result says which ran and why) and
`card_interactions` (the rules two cards' keywords, triggers and symbols point to).
Each validates its arguments against its JSON schema, fails closed with an error dict,
and returns the slugs, rule ids and errata it used with `rules_version`. The `TOOLS`
registry renders to OpenAI-style function specs (`tool_specs()`) for Qwen3's tool
template. No model runs yet.

The deck tools in `games/cyberpunk/assistant/decks.py` join the same registry and
supply deck facts, never judgment: `parse_deck` (a pasted list, a deck dict or a
public deck id to a normalised deck of slugs; Legends go under a `Legends` line; a
shared, partial or unknown name is reported with its candidates and never guessed),
`check_deck` (`deckbuilding.validate`/`describe`, violations by rule slug, the
format reported as the deck gives it), `deck_profile` (cost curve, colour and type
split, RAM budget against usage, keyword and trigger counts, cards with errata),
`similar_decks` and `archetype_of` (`archetypes` similarity and clustering over the
272 public decks, computed once and cached) and `played_with` (co-occurrence across
the public decks). Every deck tool takes `deck`, `deck_id` or `text`, so they chain.

`scripts/assistant_local.py` serves the Tools page on `127.0.0.1:8767`: pick a tool,
fill the form generated from its schema (a textarea for pasted lists and deck JSON, a
picker over the public decks), see the JSON result. On loopback it answers
only to a loopback `Host` and `Origin` (against DNS rebinding); any other bind needs
the printed token unless `--no-auth`.

```bash
python scripts/assistant_local.py         # then open http://127.0.0.1:8767/
python scripts/test_assistant_tools.py    # needs fastapi and httpx; snapshot data, no model
python scripts/test_assistant_deck_tools.py  # deck tools, same requirements
```

### Local assistant chat

The same page has a chat box. `games/cyberpunk/assistant/loop.py` runs one turn: a
system prompt (`ASSISTANT_PROMPT_VERSION`, with the snapshot's `RULES_VERSION`) tells
the model it does not know this game, that every card and rule fact must come from a
tool, to cite card slugs and rule numbers, and to label strategy as judgment. The
model answers with Qwen3's native `<tool_call>` blocks (the tool specs go through the
tokenizer's chat template); the loop parses them strictly, returns an unknown tool,
bad arguments or malformed JSON to the model as a tool error without running
anything, stops after 6 tool calls, and strips `<think>` from the answer. Each answer
carries a trace: every tool, its arguments, ok or error, a summary, its sources and
timings, and any thinking. `POST /api/chat` (`session`, `message`) keeps a short
history per session in memory. The model runs in `scripts/mlx_chat_worker.py`
(protocol `local-chat-v1`, greedy, offline, Apple Silicon only), separate from the
gameplay worker; it starts on the first question. Without `--model` the chat box
answers "no model configured".

On the Mac (not yet run against a real model; the Linux tests use a scripted fake):

```bash
python scripts/assistant_local.py --model models/qwen3-8b-4bit   # then open http://127.0.0.1:8767/
# optional: --adapter <dir>, --thinking, --max-tokens 1024
python scripts/test_assistant_loop.py    # loop, worker parts, chat route; fake model, no mlx
```

The page opens on a Chat tab (the Tools tab is the form above). The header shows the
data snapshot (`RULES_VERSION`, card count) and the model's state (none, idle,
loading, ready, error; `GET /api/status`). Answers render through a tiny escaping
markdown subset (paragraphs, lists, bold, inline code); every other model or tool
string is set as text. Under each answer a collapsed trace has one row per model step
and tool call (ok or error, summary, elapsed ms; expand for arguments and result
JSON), flags for the tool-call cap and the token limit, and the card slugs and rule
ids the tools returned; clicking one shows its `get_card` or `get_rule` result in a
side panel without asking the model. The deck panel (`POST /api/deck`, paste or pick a
public deck) runs `parse_deck`, lists unresolved or ambiguous lines with candidates,
and for a resolved deck shows `check_deck` and a compact `deck_profile`; that deck is
held for the session and `loop.deck_context` adds it to the system message as a
labelled `<loaded_deck>` JSON block whose `deck` value the model passes unchanged to
the deck tools, until it is cleared (`/api/deck/clear`). "New chat"
(`/api/chat/reset`) clears the history and keeps the deck. A per-question "think
first" toggle defaults to `--thinking`. The four example chips only fill the input.

```bash
python scripts/test_assistant_ui.py      # escaping, deck panel, sessions, status, trace; fake model, needs node
```

### Local assistant eval

`data/gold/quiz_mc_2026-11-12.jsonl` is Cody's 40-question multiple-choice quiz (38
keyed; fields in `data/gold/SCHEMA.md`). It is eval-only, never training data.
`scripts/eval_assistant.py` puts each question and its lettered choices to the same
`run_turn` the chat uses, wrapped in a versioned prompt (`EVAL_PROMPT_VERSION`) that
asks for reasoning and a final `Answer: <letter>` line, parses the last such line
strictly (none means unanswered), and writes `eval/runs/<name>.jsonl`: a header
(model, adapter, thinking, prompt versions, `RULES_VERSION`, the set's sha256), one
row per question (chosen, key, outcome, known-incorrect pick, tools called, rule ids
and card slugs returned, cap and length flags, answer, full trace) and a summary. The
file is deterministic and timestamp-free and is never replaced without `--force`;
items with `correct: null` are recorded as unscored. The page's Eval tab shows each
set with its key and a review note per question (saved to `eval/notes/`, never to
`data/gold/`), a Run button that starts the scorer with the page's model settings
(one job at a time; chat pauses while it runs) and the runs with per-question
outcomes and traces.

The baseline on the Mac (not yet run):

```bash
python scripts/eval_assistant.py --set data/gold/quiz_mc_2026-11-12.jsonl --model models/qwen3-8b-4bit --name baseline-qwen3-8b
python scripts/test_assistant_eval.py    # gold set, letter parser, scorer (--fake), Eval tab; needs node
```

### Rules retrieval

`search_rules` ranks the 713 rules one rule at a time (each prefixed by its heading
path, heading-only rows down-weighted, stopwords and light stemming, a named keyword
or trigger boosting its glossary rules; errata included), all in
`games/cyberpunk/assistant/retrieval.py`. When `data/processed/corpus_index.npz`
exists and its fingerprint matches that rule-level corpus, it fuses the lexical and
embedding rankings by reciprocal rank fusion (`method: "hybrid"`); a missing, stale
or foreign index, or no embedding model on the machine, falls back to lexical with a
`fallback_reason`. The index is a git-ignored build artifact.

`scripts/eval_retrieval.py` measures recall@1/5/10 of every method on the quiz
against `eval/sets/quiz_mc_expected_rules_draft.jsonl`, an unreviewed Claude draft of
the rules each question needs (a measurement aid, not gold, never training data; 30
rule-answerable questions, the policy and card-only ones skipped with a reason). The
hit rule and query form are in its docstring. Reports go to `eval/reports/`; the Eval
tab's Retrieval panel shows them, the index status, and the "Build rules index" and
"Measure retrieval" actions. Measured on Linux, 2026-11-12 (no index):

| method | recall@1 | recall@5 | recall@10 | chars in top 10 |
| --- | --- | --- | --- | --- |
| old chunk BM25 (`lexical-bm25-chunks`) | 0.533 | 0.733 | 0.867 | 10,710 |
| rule-level lexical (`lexical-bm25-rules`) | 0.533 | 0.767 | 0.767 | 1,475 |

A chunk passage holds about fifteen rules and is credited for all of them, so the old
method's recall is bought with seven times the text. Build the index and measure the
hybrid on the Mac (not yet run):

```bash
python scripts/build_rules_index.py                  # Apple Silicon, mlx-embeddings; --check reports status anywhere
python scripts/eval_retrieval.py --name retrieval-quiz-hybrid --quiet
python scripts/test_assistant_retrieval.py           # rule-level index, fusion on a fake embedder, Eval panel; needs node
```
