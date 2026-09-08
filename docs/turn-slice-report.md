# First deterministic turn slice

Implemented a headless, two-player turn loop using the existing normalized state,
content bundles, legal action IDs, observations, training contracts and JSONL
worker. No full-game engine, browser gameplay UI, new database migration, corpus
import, model download, commit or push was added.

## Gameplay and policy scope

`createGame` returns a validated frozen state. `createGameWithEvents` additionally
returns setup/start-turn events. Both support the new `TURN_SLICE_V1` policy;
`ORDERED_FIXTURE` remains available for the previous contract regression tests.

The slice validates constructed decks against the pinned catalog and format,
creates each physical card once, shuffles main decks and Legends with seeded
Fisher–Yates using the existing deterministic counter RNG, deals six cards and
starts the first turn. The fixture decks each have three Legends and 42 main
deck cards, with copy/RAM limits enforced. The synthetic catalog has three simple
CALL/DRAW Legends and fourteen main-deck identities, including a non-sellable
card. The original four-card application seed remains unchanged.

Setup input explicitly supplies the agreed first-player seat and states that
both mulligans and cuts were declined. The random chooser/first-or-second
negotiation and optional mulligan/cut interactions are outside this milestone;
they are not silently chosen by the engine. Legends are randomized before the
first player's two leftmost objects are spent. Their identities remain private.
Those two do not ready on the first turn. CALL preserves orientation after any
payment spending; it never automatically readies a Legend.

Policies are tied to the already captured September 1 rules snapshot. Source
hash, rule IDs and slice-specific decisions are recorded in
`tests/fixtures/turn-rules.v1.json`. No rules were fetched or refreshed. Principal
references: 7.6–7.9 setup; 7.7.4 first-turn exception; 8.6 start steps; 8.11/8.12
SELL/CALL; 5.7.2/5.7.2.2 Legend payment; 11.11.1.3 CALL orientation; 1.10.1 victory
before ready; 1.14 empty draw; 1.11.1 overtime; 5.7.4.1/5.8.3.1 hidden objects.
These fixtures are implementation tests, not official card coverage or human
reviewed gold training data.

## Actual state machine

```mermaid
flowchart TD
    Init[Validate decks / shuffle / deal] --> Start[TURN_START: check Gig victory]
    Start --> Ready[READY]
    Ready --> Draw[DRAW]
    Draw --> Gig[CHOOSE_GIG: stable decision]
    Gig --> Roll[ROLL_GIG: automatic after selection]
    Roll --> Main[MAIN: stable decision]
    Draw -->|empty Fixer, explicit skip policy| Main
    Main -->|SELL_CARD| Main
    Main -->|CALL_LEGEND: multiple payment sources| Pay[PAYMENT_SELECTION: stable decision]
    Pay -->|CHOOSE one eligible source| Pay
    Pay -->|exact payment complete| Call[CALL_EFFECT: flip / pending DRAW / resolve]
    Main -->|CALL_LEGEND: zero or one complete payment| Call
    Call --> Main
    Main -->|END_TURN| End[TURN_END]
    End -->|next player| Start
    Start -->|7 controlled Gigs| Done[FINISHED]
    Draw -->|empty deck, LOSE policy| Done
    Call -->|empty deck while drawing| Done
```

Automatic steps are internal to initialization or an action transaction. Public
results reach a decision boundary or terminal outcome. Timing stores the active
step; resolution separately tracks pending/current work. Normal cards ready in
ruleset-listed zones; draw moves the actual top instance DECK → HAND. Turn-scoped
SELL/CALL counters reset with an explicit global `usageTurn`.

A selected eligible die leaves FIXER, rolls once, enters GIGS and preserves owner,
controller and die identity. Initial/current values begin equal. D20 eligibility
uses the original owner's entire die registry, so moving another die cannot
bypass its roll prerequisite. Street Cred sums current values of controlled
rolled Gigs; no mutable Street Cred field exists.

At each turn start the generic win evaluator checks the active player's Gig
count before READY or DRAW. Empty-draw loss records an outcome; an UNSUPPORTED
empty-draw policy instead rejects atomically. Empty Fixers skip the Gig choice
under an explicit slice policy. Two consecutive turn starts with both Fixers
empty reach the known overtime boundary; END_TURN returns UNSUPPORTED_OVERTIME
there. No overtime winner/transition is fabricated.

## Exact legal actions

| Stable state | Supported actions |
| --- | --- |
| CHOOSE_GIG | ROLL_GIG for each eligible unrolled original die; initially D4/D6/D8/D10/D12 |
| MAIN | Eligible SELL_CARD, eligible face-down CALL_LEGEND, END_TURN |
| PAYMENT_SELECTION | CHOOSE one engine-enumerated eligible payment source |
| FINISHED | No legal actions |
| Another player's decision | Empty action list for the nonacting player |

ROLL_GIG is the existing payload spelling for the player's die selection plus
its automatic roll. CALL first selects a physical face-down Legend; descriptors
use its hidden slot, never its card name. Payment choices select individual
ready Eddie/Legend instances. Already selected sources are excluded and only
choices admitting exact completion remain eligible. Sources are spent together
when payment completes; IDs/zones survive. No Cartesian product of parent CALL
actions is generated. A sole complete payment may resolve directly.

Face-down Legends may pay; face-up Legends require their SellProfile tag. Legends
cannot become Eddies. SELL requires a sellable non-Legend in the acting player's
hand and remaining per-turn usage. Unsupported effects are rejected at playable
deck admission and by the CALL handler with UNSUPPORTED_CALL_EFFECT. Admission is
deck-wide, not a hidden-Legend-specific action filter that leaks identity.

Only a single unconditional WHEN_CALLED ability containing one DRAW effect (or a
Legend without an ability) is supported. CALL flips the same Legend, emits its
fact, creates a PendingEffect, resolves it, passes the state-based stage and
returns to MAIN. It does not build a LIFO scheduler. Payment continuation IDs and
legal action IDs are independent of transport version counters. Command/idempotency
metadata still has no role in gameplay semantics.

## Events, observations and training

New events: TURN_STARTED, TURN_ENDED, PHASE_CHANGED, CARD_READIED, LEGEND_CALLED,
EFFECT_PENDING, EFFECT_RESOLVED and GAME_ENDED. Existing CARD_MOVED represents
draw and selling movement; CARD_SOLD, PAYMENT_MADE and GIG_DIE_ROLLED remain the
corresponding facts. Events retain monotonically increasing sequence numbers and
explain intermediate automatic work without exposing those states as decisions.
Full event streams are private replay data, not model prompts.

Observations expose own hand identities, opponent hand counts, face-up called
Legends, public Gig/current values, Street Cred, readiness, turn step and payment
choice summary. They omit deck order, opponent hands, all face-down Legend and
Eddie identities, and future RNG state. Model input exposes only observations and
legal action IDs/descriptors; payment labels identify public source slots.

Three validated TrainingPositions are generated: Gig choice, MAIN, and payment
selection. Automatic/terminal states cannot generate decision positions.
Position/observation/replay hashes, acting seat, manifest/rules and engine artifact
pins are checked. TrainingAttempt remains separate and repeatable.

## Replay evidence and interop

`tests/fixtures/turn-replay.v1.json` records initialization, seven semantic actions,
every legal list/observation/event sequence/intermediate hash, three positions and
full final state. The sequence is P1 D8 → SELL → CALL → pay with the Eddie → end;
P2 chooses a Gig → end; P1 begins turn three. This artifact currently rolls P1 D8
as 8 and P2 D10 as 10, with RNG counters 86 and 87 after setup shuffles.

Engine version: `0.4.0-turn-slice-1`.
Final ReplayStateHash:
`3f758765c1e27073e79c9d922e8897283f01668a770404e35213be2daf16a222`.

The headline test recreates the game from identical inputs, replays semantic
payloads, and compares full states/events plus every intermediate hash/action
list. A separate test checks the generated artifact against current code.

Wire v1 adds a discriminated `createGame` request with content and initialization
inputs, returning the existing transition response. The Python adapter adds only
`create_game`; it still supplies no gameplay rules. Its test starts one Node
worker, initializes, obtains observations/actions, submits each actionId, and
compares events, returned hashes and final state with the same replay artifact.
The earlier seven wire golden cases and seven Python/TypeScript differential deck
fixtures remain covered. Generic Python core is unchanged.

## Commands and results

Application Node commands used this prefix because only Node 22.5.1 is installed:
`PATH=/Users/codyclark/.nvm/versions/node/v22.5.1/bin:$PATH`.

| Command | Result |
| --- | --- |
| `node --import tsx scripts/generate-wire-golden.ts` | Pass; prior wire vectors refreshed for new artifact |
| `node --import tsx scripts/generate-turn-replay.ts` | Pass; seven actions and three stable positions |
| `npm run contracts:export` | Pass; versioned schemas refreshed |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run validate:cards` | Pass; four original application fixtures |
| `npm test` | Pass; 36 tests, including 14 new turn-slice tests |
| `npm run build` | Pass; Next/GraphQL web build preserved |
| `git diff --check` | Pass in both repositories |

Integration command (local-service permission granted):

```bash
PATH=/Users/codyclark/.nvm/versions/node/v22.5.1/bin:$PATH \
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg \
npm run test:integration
```

Both suites pass, including a new initialized-game persistence check. No new
migration is required: JSON state accommodates the policy-gated fields. The match
repository now accepts initial version zero with nonzero setup event sequence;
setup events are returned for callers to retain, not implicitly written to an
event table. Existing schema-1/2 compatibility and ledger tests remain intact.
Tests use randomized isolated databases/schemas, not application tables.

Python commands, from `cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.5.1/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
```

All pass: initialization plus seven gameplay actions; seven previous golden cases;
seven differential cases; 87 Cyberpunk tests; 48 core tests. No model downloads.

The user's `.nvmrc` specifies 22.13.0 and was preserved. That runtime is not
installed locally; tests ran on 22.5.1. The previously identified
eslint-visitor-keys requirement for Node 22.13+ still applies despite passing gates.

## Changed files in this pass

| Files | Purpose |
| --- | --- |
| `packages/domain/src/game.ts`, `ruleset.ts` | Policy-gated turn steps, usage, CALL continuation, outcome and event contracts |
| `packages/engine/src/initialization.ts` | Validated/shuffled/dealt game initialization |
| `packages/engine/src/turn.ts` | Automatic lifecycle, draw, CALL/DRAW resolution, payment continuation |
| `packages/engine/src/payment.ts`, `rng.ts`, `win.ts` | Shared exact payment, seeded RNG and checkpoint evaluator |
| `packages/engine/src/index.ts`, `state.ts`, `view.ts`, `observation.ts` | Dispatch/enumeration, invariant validation, rules queries and public projection |
| `packages/training-harness/src/index.ts` | Reject empty/terminal decision positions |
| `packages/wire/src/index.ts`, `packages/wire/schemas/*.v1.json` | Initialization transport and regenerated schemas |
| `packages/persistence/src/postgres.ts`, `tests/integration/persistence.test.ts` | Persist initialization with setup events without a schema change |
| `scripts/engine-identity.ts` | Explicit new engine behavior version |
| `scripts/generate-turn-replay.ts`, `scripts/training-demo.ts` | Deterministic replay artifact and three-position demo |
| `tests/turn-fixture.ts`, `turn-replay.ts`, `turn-slice.test.ts` | Legal synthetic decks, reusable trace and 14 substantive tests |
| `tests/fixtures/turn-rules.v1.json`, `turn-replay.v1.json`, `wire-golden.v1.json` | Local rule provenance, complete replay and refreshed legacy vectors |
| `README.md`, `docs/turn-slice-report.md`, `docs/pre-gameplay-contracts.md` | Current behavior and compatibility documentation |
| Python `games/cyberpunk/engine_adapter.py`, `scripts/test_engine_adapter.py`, `docs/engine-interop.md` | Initialize and verify this loop through Node |

The earlier pre-gameplay changes remain in the working trees. This inventory does
not claim those earlier files or the user's `.nvmrc` change as new work.

## Unsupported scope and next milestone

PLAY_CARD, attacks/combat, damage/defeat, QUICK, BLOCKER, Rival React, Go Solo,
Gig stealing, continuous modifiers, complex trigger ordering, general custom
handlers, all official card mechanics, overtime, matchmaking and multiplayer
remain unsupported. Earlier trusted Gig modification/control-transfer primitives
are used only to test derived semantics; no stealing action was added.

Mulligans, cuts and first-player negotiation are explicit setup preconditions.
The empty-Fixer SKIP policy is a deliberate slice boundary, not a claim to resolve
all future timing interactions. Multiple CALL triggers/conditional effects are
rejected rather than assigned guessed ordering. Sealed/owned pool validation
contracts remain intact, but this initializer currently admits constructed/catalog
inputs only. No full official card corpus has been normalized or certified.

Next milestone: review and implement the remaining pre-game choices, then one
small official CALL/card-effect set using this replay pipeline. Keep combat and
realtime integration separate until that state/visibility slice is trustworthy.
