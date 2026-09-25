# External simulator bot

The service implements the [v1alpha1 External Bot Developer Guide](ai-source/simulator-bot-v1alpha1.txt)
supplied as `Bot-api-docs(1).txt` on 2026-09-25. It exposes `POST /ready` and `POST /sync` for
Cyberpunk TCG Sim. The simulator owns the match, hidden information, legal actions
and all transitions; the response contains only a current `actionId` plus request
correlation. No simulator payload is submitted to this repository's local engine.

## Run and register

From the repository root, in a Python 3.12+ virtual environment:

```bash
python -m pip install -r requirements-bot.txt
python scripts/serve_sim_bot.py --port 3100 --base-path /cyberpunk
```

This starts a loopback HTTP service. Its only runtime dependencies are FastAPI and
Uvicorn; Node, databases, MLX, model weights and corpus ingestion are unnecessary.
Use `--host 0.0.0.0` when an appropriate reverse proxy/container must reach it.
Expose a reachable HTTPS URL to the simulator operator, with the same base path.
The supplied contract defines no authentication header; restrict ingress at the
hosting layer if the service is private. This CLI does not deploy or register it.

Generate the profile to give the operator (replace the example URL):

```bash
python scripts/serve_sim_bot.py --profile-url https://bot.example/cyberpunk
```

The profile uses `community.cyberpunk-tcg-llm`, a 3000 ms timeout and `v1alpha1`.
Set `--bot-id`, `--name` and `--version` identically for the running service and
profile command when customizing them. Add your author/license information to
the profile if required by the operator; the CLI does not invent those fields.

Check compatibility locally:

```bash
curl -sS http://127.0.0.1:3100/cyberpunk/ready \
  -H 'Content-Type: application/json' \
  -d '{"apiVersion":"v1alpha1","game":"cyberpunk-tcg-sim","check":"ready"}'
```

## Selection and failures

- The baseline resolves setup/pending choices first; otherwise it prioritizes
  `roll_die`, then `play_card`, then unknown action categories, then `end_turn`;
  explicit `concede`/`surrender` categories rank last.
  Equal ranks use the offered ID. This is a transport/smoke-play policy with no
  measured playing strength, tactical simulation or claim to optimal decisions.
- `legalActions` is authoritative whenever present. `possibleActions` is accepted
  only when `legalActions` is absent. An empty or invalid authoritative list is an
  error, even if the alias contains actions. Duplicate/blank IDs are rejected.
- Acting requests with no selectable action return HTTP 400 and `ok: false`,
  allowing the simulator to handle its documented fallback. Waiting and finished
  requests return `ok: true, actionId: null` and never invoke a policy.
- Unknown fields and action types are tolerated. Snapshot fields remain opaque;
  opponent hidden information, raw GameState and corpus data are never required.
- Invalid JSON, unsupported versions/events, mismatched bot IDs and malformed
  required fields return a contract error. Bodies are limited to 2 MiB, with a
  five-second read limit. The service does not echo input or exception details.
- Requests are stateless. Baseline retries with the same offered actions produce
  the same result. No IDs, snapshots or responses are cached across requests, and
  sequence numbers are not treated as proof that an action is still legal.

## Adding a model policy

`BotService(policy=...)` accepts an asynchronous callable taking a `Decision`
and returning one offered string ID. `Decision` includes the bot-visible snapshot,
legal descriptors, prompt, turn, pending summary, metadata and request identity.
The policy receives a separate deep copy, so modifying descriptors cannot change
the service's authoritative offered-ID set. No rule/card-name dispatch is added.

```python
from games.cyberpunk.sim_bot import BotService, build_app

async def choose(decision):
    # Replace this with asynchronous inference against your model worker.
    # Send only the visible input; constrain and parse the output as one ID.
    return decision.legal_actions[0]["actionId"]

app = build_app(BotService(policy=choose), base_path="/cyberpunk")
```

Use a separate process or service for synchronous CPU/GPU inference. Policies must
use nonblocking I/O and honor cancellation; Python cannot enforce a timeout on code
that blocks its event loop. No model provider, API key, trained gameplay weights or
external inference calls are configured by this implementation.

The policy budget is the smaller of `deadlineMs` and the service's 2500 ms cap,
minus elapsed request processing and a response reserve (up to 50 ms). Exceptions,
cancellation, timeouts, invalid outputs and capacity exhaustion return the baseline
ID from that same request. At most eight policy calls may remain outstanding; a
timed-out call retains its slot until it actually exits. Caller cancellation is
propagated. These bounds do not guarantee internet transit time to the simulator.

Models may make different decisions on repeated requests; model-backed idempotency
and long-term strategy memory are not implemented. If introduced, memory must be
scoped by match and player, and IDs must still be revalidated against every request.

## Evidence and next milestone

```bash
python -m pip install httpx
python scripts/test_sim_bot.py
```

The 29 contract tests use HTTP through the ASGI app and injected policies. They cover
the guide example, prefixed routes, profile compatibility, malformed and empty
requests, aliases, unknown fields, setup/pending actions, waiting/finished states,
timeouts, failures, capacity, concurrent matches and stale/forged IDs. Logs contain
request/match/player/sequence IDs, the chosen ID, selection source and elapsed time;
they omit snapshots, private known cards, prompts and payloads. CI runs this suite
alongside all existing gates and retains its log.

These synthetic requests are not gameplay gold data. Acceptance against a live
simulator and measurement of strategy remain outstanding. The next AI milestone is
to connect an inference worker, collect reviewed simulator positions, and compare
its decisions and match results with this deterministic baseline before claiming
improved playing strength. Engine content/admission, generated baselines and dated
corpus snapshots are unchanged by this service.

Implementation checks on 2026-09-25 (Python 3.12, Node 22.23.2):

- 29/29 simulator contract tests; local Uvicorn HTTP smoke test for both prefixed
  endpoints and graceful shutdown.
- 1364/1364 engine/unit tests, zero skipped; 38/38 CI guard tests.
- Existing Python corpus 89/89, harness 48/48, candidate bridge 3/3, engine adapter
  PASS, and deck agreement 272/272 with every intended negative control firing.
- Typecheck, lint, card validation, production build and diff whitespace checks pass.
- Database integration was not run locally: no PostgreSQL/MongoDB services were
  available. The full existing CI integration job remains required before merge.
