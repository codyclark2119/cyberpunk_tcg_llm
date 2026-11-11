# Local play UI

Date: 2026-11-11. Engine identity at writing: `0.4.0-api-admission-6`. Scope 3 of
the move to a local-only project, after the [local match runner](local-match-runner.md).

## What it is

Project rule: every tool gets a UI. `scripts/play_local.py` serves one page from
`games/cyberpunk/play_app.py` with three tabs:

- **Play a bot**: choose your seat, the bot's policy (`baseline`, or `mlx` on
  Apple Silicon), a seed and a setup file (blank means the fixed Demo decks; any
  JSON with `content` and `initialization` that the runner accepts works). The
  page shows your public view and the engine's offered actions as buttons.
- **Bot vs bot**: runs `scripts/run_local_matches.py` with N matches, a seed
  prefix, a policy per seat, a setup file and limits, with its log streamed live.
- **Match records**: lists `local/matches/*.jsonl` and steps through a record's
  decisions (label, reason, offered count, elapsed ms, state hash) and its result.

The page is self-contained: inline CSS and JS, no CDN, works offline.

```bash
python scripts/play_local.py                        # http://127.0.0.1:8766/
python scripts/play_local.py --lan                  # all interfaces; prints a token URL
python scripts/play_local.py --model PATH --adapter PATH   # mlx bot settings
```

It binds `127.0.0.1` by default with no token. Any non-loopback bind (`--host`
or `--lan`) requires the random token printed with the URL, the harness monitor's
rule; `--no-auth` drops it for a trusted network. Ctrl-C stops the server, which
abandons live matches (writing their records) and closes every engine worker.

## Authority and hidden information

The engine is the only rules authority, as in the runner. For each decision the
server reads the acting player from the authoritative state and asks the worker
for that player's `ModelInputV2`. When the human seat acts, the browser receives
only that `observation` and the offered actions (`actionId` and public descriptor).
The engine's own projection already omits the opponent's hand and deck and the
content of face-down cards. The authoritative state, events, RNG and state hashes
stay on the server. A submitted `actionId` that the engine did not offer is
refused with 400 and the state does not change; an offered one is applied by the
worker.

During a live match the human's move log shows only that the bot acted, not its
action labels, timings or offered counts, because a label can describe a hidden
choice. The full record, labels included, is readable in the viewer after the
match ends.

The bot seat moves through `PolicyRunner`, with the usual fallbacks. An `mlx`
bot shares one local MLX worker per server, started on first use.

Update 2026-11-11 ([local-time-budget.md](local-time-budget.md)): both the play
form and the bot-vs-bot form have a "Bot budget ms" field (default 10,000 ms),
recorded in the match header, and the record viewer shows each decision's failure
code (`error`) and any worker restart next to its reason.

## Records

Human matches write the same JSONL as the runner (`local/matches/<seed>.jsonl`).
The human seat's policy is `human`, and each human decision has reason `human`
with `elapsedMs` measured from when the server offered the decision. A match that
is abandoned, or still live at shutdown, ends with result status `abandoned`, a
status only human matches produce. A seed whose record already exists is refused.

To keep one format, `local_match.py` gained small additive hooks: `match_header`,
`decision_row`, `result_row` and the public `build_decision`. `play_match` now
builds its rows with them; its output is unchanged (`test_local_match.py` 12/12).

## Server shape

The app is the harness monitor's `build_app`, used as-is: its token middleware
and job routes (`/api/actions`, `/api/run/{id}`, `/api/job/{id}`,
`/api/cancel/{id}`, `/api/history`) with one allowlisted action,
`local-matches`. The client fills that action's declared arguments and the
`Runner` builds the argv server-side, one job at a time; the output directory
and node binary are fixed server-side. The monitor's generic page at `/` is
replaced by the play page, and these routes are added:

| Route | Purpose |
| --- | --- |
| `GET /` | The play page |
| `GET /api/play/config` | Available bot policies, default limits, records dir, live match ids |
| `POST /api/play` | Start a match: `seat`, `policy`, `seed`, `setup`, `maxDecisions`, `maxTurns` |
| `GET /api/play/{id}` | The human view of a match |
| `POST /api/play/{id}/action` | Submit an offered `actionId`; the bot then moves until you decide |
| `POST /api/play/{id}/abandon` | End the match, write its record, close its worker |
| `GET /api/records` | Record list with seed, policies, status, winner, turns, decisions |
| `GET /api/records/{name}` | One record's rows |

Sessions are in memory, keyed by a random id. Each live match has its own engine
worker, closed on finish, abandon or shutdown. At most four matches are live at
once, and record names are restricted to `[A-Za-z0-9._-]` ending in `.jsonl`.

## Tests

`scripts/test_play_app.py` uses FastAPI's `TestClient` (needs `fastapi` and
`httpx`) against the real engine worker with a baseline bot. It checks the page is
self-contained and its script parses under `node`; refuses bad requests and
non-offered action ids without changing state; plays human moves, one full game
to an engine outcome and one abandoned game; checks that no opponent hand or deck
instance id, state, RNG or hash reaches the human view; checks both records; lists
and serves records, including path-like names; runs a real 12-decision
bot-vs-bot job through the runner; and requires the token when one is set. It
prints `PASS local play UI: 12/12` in about 20 s. It is not yet wired into PR
Validation; that is a separate change.

## Left for later

- Wiring `test_play_app.py` into CI with its pass line and `httpx`.
- Real MLX play on the Mac, including a human match against an `mlx` bot.
- A board view in the record viewer would need replaying action ids through the
  engine; the viewer shows the record's labels and hashes only.
- Per-step undo, saved human matches across restarts, and richer card rendering.
