# Local match records v3 and training logging

Date: 2026-11-12. Engine identity at writing: unchanged (no engine, wire or
worker file was touched). Follows the [local match runner](local-match-runner.md),
[local play UI](local-play-ui.md) and the [training record
module](training-record-migration.md).

## Why

On the first Mac runs a match record could not answer three basic questions
about play quality:

- **Which weights played?** The header named the policy (`mlx`) but not the model
  directory or the upstream revision it was downloaded at, so two runs with
  `models/qwen3-8b-4bit` and `models/qwen3-4b-4bit` were indistinguishable.
- **What did the model actually pick, against what?** Rows held the chosen
  `actionId` and its label but not its position in the offered list, nor what
  the deterministic baseline would have done on the same list. Agreement with the
  baseline is the cheapest first signal of whether a model plays differently from
  a fixed heuristic (it is not a strength measure).
- **What did the model say?** Fallback rows gave a failure code but not the raw
  text or token counts, so an `invalid_output` or a long prompt could not be
  inspected afterwards.

Separately, every model decision is a training example in the adopted TS contract
(TrainingPosition v2 plus TrainingAttempt v1), and nothing wrote them.

## Record schema version 3

`RECORD_SCHEMA_VERSION` in `games/cyberpunk/local_match.py` is 3. All changes are
additive; v2 fields keep their meaning.

**`match` header, each `seats` entry** adds:

| Field | Meaning |
| --- | --- |
| `modelPath` | Model directory, repo-relative when inside the repo (`models/qwen3-8b-4bit`), else absolute; null for baseline and human seats |
| `modelRevision` | Upstream commit of the local weights, or null when the local files do not say (see below) |
| `adapterPath`, `adapterRevision` | LoRA adapter directory and `sha256:` of its `adapters.safetensors`; null without an adapter |
| `promptVersion` | `PROMPT_VERSION` of `games/cyberpunk/policy_prompt.py` the seat prompted with |

`budgetMs` per seat and at the top level are unchanged from v2.

**`decision` rows** add:

| Field | Meaning |
| --- | --- |
| `chosenIndex` | Position of `actionId` in the offered list (the order the engine offered, which is the order the prompt numbers) |
| `baselineActionId`, `baselineIndex` | What `baseline_action_id` picks on the same offered list, and its position |
| `agreesWithBaseline` | `actionId == baselineActionId` |
| `rawOutput` | The model's raw text for this decision; null when it produced none (baseline, human, timeout, busy, prompt too large) |
| `inputTokens`, `outputTokens` | Prompt and generated token counts from the worker; null when unknown |

The baseline pick is computed in `decision_row` from the offered list after the
action is chosen. It never feeds back into play: `test_local_match.py` checks that
a game with training logging on replays the same actions and state hashes as the
same game with it off, and baseline-vs-baseline games still replay by seed.

Human rows in the play UI carry the same index and baseline fields (raw output and
tokens are null).

**`result` row** adds `baselineAgreement`: per seat (keyed by seat number as a
string) `policy`, `decisions`, `agree` and `rate`. The CLI summary adds the same
pooled per policy name. Both are null for a record without the v3 decision fields.

The record still holds no state, events or hidden cards. `rawOutput` is the
model's own answer (a choice index in JSON, or whatever it wrote instead).

## How the model revision is found

`policy_mlx.model_revision(path)` reads local files only and never fetches:

1. `hf download --local-dir` (the documented download in
   [local-mlx-bot.md](local-mlx-bot.md)) leaves
   `<dir>/.cache/huggingface/download/<file>.metadata`; the first line is the
   commit. `config.json.metadata` is read first, then any other `.metadata` file.
2. A Hugging Face cache snapshot directory (`.../snapshots/<commit>/`) is named
   after its commit.
3. Otherwise null.

Only a 40-character lowercase hex value is accepted. With the documented downloads
this yields `545dc4251c05440727734bcd94334791f6ab0192` for `models/qwen3-8b-4bit`
and `4dcb3d101c2a062e5c1d4bb173588c54ea6c4d25` for `models/qwen3-4b-4bit`. Weights
copied without that cache folder record null.

## Where the details come from

`MLXPolicy` takes `info=model_info(model, adapter=...)` and reports it through
`describe()`; `local_match.seat_models` reads that for the header. After each
answered request it keeps the raw text, token counts, inference time and parsed
index for that request id; `PolicyRunner.choose` collects them once with
`take_details(request_id)` into the new `Selection.details`. A request cancelled
by the decision timeout leaves nothing, so a late answer is never attributed to
the next decision. Policies without these hooks (the baseline, test fakes) record
nulls. Nothing here is logged; it only reaches the record.

## Training records

Off by default. `scripts/run_local_matches.py --training-dir DIR` (the usual
place is `local/training/`, gitignored) and the play UI's bot-vs-bot option "Log
training records" (fixed to `<records dir>/../training`, so `local/training/`;
the client cannot choose another path) turn it on.

For each decision of a seat whose policy describes a model, and that produced raw
output, `TrainingRecorder` (in `local_match.py`) logs through
`harness.core.training_records.TrainingLog`:

- **One TrainingPosition** from `build_position`, using the engine worker's own
  `observe`, `listLegalActions` and `hash` answers for the state the model saw
  (new `EngineWorker.observe`, `list_legal_actions`, `hashes` wrappers; the worker
  already served these ops). Provenance is `{generator: "local_match", revision:
  <git HEAD, or "unknown">, seed: <state rng seed>}`. `positionId` is
  `local_match/<revision[:12]>/<seed>/<index>/<positionHash[:16]>`, so rerunning a
  seed at the same commit dedupes identical positions.
- **One TrainingAttempt**: `rawModelOutput`, the parsed choice, validation (`ok`
  with the engine's resulting `stateHash` when the parsed choice was played; else
  `INVALID_MODEL_OUTPUT` with no parsed choice), `modelRevision` and
  `tokenizerRevision` (both the weights' revision; the tokenizer ships with them),
  `adapterRevision` (`none` or the adapter's sha256), `promptFingerprint`
  (`policy_prompt.prompt_fingerprint([])`, a hash of `PROMPT_VERSION` and
  `SYSTEM_PROMPT`), decoding `{temperature 0, topP 1, maxTokens 16, seed null}`
  (the worker samples greedily), the worker's inference ms and token counts.
  `attemptId` is `<matchId>-<index>/<run id>`, unique per run.

`TrainingLog` is created with `expect_engine=setup.engine` and scoped to one
match: it flushes when the match returns and writes nothing for a match that
raises. An existing match record without `--force` is refused before the match is
played, so no training records are logged for it either. Baseline and human seats
log nothing; a decision with no raw output (timeout, busy, prompt too large)
logs nothing.

A model seat whose revision is unknown is refused when training is on, before the
weights load: `ModelMetadata` asks for a stable revision, never a path alone.

Measured in the Linux container with the fake worker (one Demo game, 119
decisions, 75 on the model seat): 65 attempts were logged, positions average about
44 KB per line (each holds the full engine state), attempts under 1 KB. The game
took about 18 s with logging versus 12 s without, from the three extra worker
requests per logged decision.

## Viewer

The record viewer reads v2 and v3 records. It adds per-decision "Pick" (chosen
index), "Baseline pick", "Agrees", raw output and token counts; per match the
schema version, each seat's model path, revision (first 12 characters) and prompt
version, and the baseline agreement per seat; and a schema and agreement column in
the record list. `GET /api/records/{name}` returns `summary` (`schemaVersion`,
`agreement`), computed server-side; for a v2 record agreement is null and the
page shows "n/a".

## Tests

- `scripts/test_local_match.py`, `PASS local match runner: 19/19` (was 14/14): every
  row's `chosenIndex`, baseline fields and agreement against `baseline_action_id`,
  and the result row's per-seat counts; revision lookup from download metadata and
  snapshot paths; an `mlx` seat driven by a real `MLXPolicy` over a fake worker
  subprocess (valid, invalid and prompt-too-large answers) for header and row
  fields; training records read back by `training_records.read_positions`
  (with `expect_engine`) and `read_attempts`, accepted by
  `scripts/check-training-records.ts` with every position re-derived by the
  engine; nothing written when off, for baseline-only seats, when a match raises,
  or for a model without a revision.
- `scripts/test_play_app.py`, still 12/12: v3 header and human rows, per-seat
  agreement in the listing and summary, a v2 record that lists and opens, the
  training option fixed to one directory and writing nothing for baseline seats.
- `scripts/test_policy_bot.py` 28/28 (was 27/27) and `scripts/test_policy_mlx.py`
  33/33 (was 32/32): `Selection.details` comes only from the policy's own request.

No real model ran for this change.

Update 2026-11-14: [local-match-audit.md](local-match-audit.md) replays v3 records
on the running engine and checks these fields against what the runner would write.
