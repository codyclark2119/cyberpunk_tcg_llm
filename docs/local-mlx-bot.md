# Local MLX simulator bot

Implemented 2026-09-25 for development on Apple Silicon, initially an M3 with
64 GB unified memory. This milestone connects downloaded model weights to the
[external simulator bridge](simulator-bot.md). It includes no trained gameplay
adapter and makes no claim about playing strength or M3 latency.

The starting candidate is `mlx-community/Qwen3-8B-4bit`, an MLX conversion of
Qwen3-8B. Model inference runs in a separate, persistent process on the Mac.
The simulator supplies the bot-visible state and legal actions. The model returns
`{"choice":1}`, and the parent maps that zero-based choice to an action ID offered
in that request. The simulator remains the authority for all rules and transitions.

## Mac setup

Use a native arm64 terminal and Python 3.12, outside Docker. If Python 3.12 is
missing and Homebrew is installed, run `brew install python@3.12` first.
From your checkout's repository root:

```bash
python3.12 -c 'import platform; print(platform.system(), platform.machine())'
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-mlx-bot.txt
```

The architecture check should print `Darwin arm64`. If it prints `x86_64`, use
native Apple Silicon Python instead of a Rosetta installation. MLX/Metal also
requires a macOS version supported by the installed MLX release. Node, the web
application, databases and an external LLM account are unnecessary for this bot.

Download the weights once; allow several GB of disk space and network transfer:

```bash
hf download mlx-community/Qwen3-8B-4bit \
  --revision 545dc4251c05440727734bcd94334791f6ab0192 \
  --local-dir models/qwen3-8b-4bit
mkdir -p local
python -m pip freeze > local/mlx-environment.txt
```

The model revision is pinned to the upstream HEAD checked on 2026-09-25.
`mlx-lm[train]` is pinned to 0.31.3; transitive dependencies are resolved by pip,
so retain the environment capture with benchmark results. We inspected that
release's Python API; the complete installed stack must still be tested on Mac.
Model loading accepts a local directory only and forces Hugging Face/Transformers
offline mode. Startup and gameplay do not download models or call an LLM provider.
`models/` and `local/` are gitignored.

Optional direct installation diagnostic, before starting the bot:

```bash
python -c 'import mlx.core as mx; print("Metal available:", mx.metal.is_available())'
```

## Benchmark before connecting a match

```bash
python scripts/benchmark_sim_bot.py \
  --model models/qwen3-8b-4bit \
  --repeat 5 \
  --output local/benchmark-qwen3-8b-smoke.jsonl
```

This loads/warms the model once and runs five decisions through `BotService`, using
the same 2500 ms service cap and response reserve as HTTP play. The fixture is a
small synthetic roll/end protocol probe, with no preferred-action label. It is
neither a full match nor a strategy evaluation. Startup time is reported separately.

The summary reports model decisions, fallbacks, and p50/p95/max service time.
Per-decision records also include model inference time and token counts when
available. Fast fallback responses do **not** count as model success. Exit code 0
means every choice came from the model; 1 means at least one fallback; 2 means a
setup/input error. An existing output file is never overwritten: choose a new name
for the next experiment. Reports omit prompts, snapshots and model-generated text.

For realistic latency, place full **bot-visible acting `/sync` request bodies**
in `local/positions.jsonl`, one JSON object per line, and run:

```bash
python scripts/benchmark_sim_bot.py \
  --model models/qwen3-8b-4bit \
  --requests local/positions.jsonl \
  --repeat 3 \
  --output local/benchmark-qwen3-8b-positions.jsonl
```

Use `--bot-id` if those requests target a different bot identity. Input positions
may contain the bot seat's private known cards; keep the raw file local. The live
service intentionally does not log or record snapshots. Waiting/finished requests
are rejected as benchmark inputs because they would inflate apparent throughput.
The benchmark drains timed-out work between samples, so it measures serial
decisions; it does not simulate concurrent matches or internet latency.

If 8B misses the deadline, compare a smaller model using the same positions:

```bash
hf download mlx-community/Qwen3-4B-4bit \
  --revision 4dcb3d101c2a062e5c1d4bb173588c54ea6c4d25 \
  --local-dir models/qwen3-4b-4bit
python scripts/benchmark_sim_bot.py \
  --model models/qwen3-4b-4bit \
  --requests local/positions.jsonl \
  --output local/benchmark-qwen3-4b-positions.jsonl
```

The optional 4B comparison also pins the upstream revision checked on 2026-09-25. Increase
`--max-prompt-tokens` only after inspecting realistic token counts and memory use;
a larger limit can increase prefill latency. Increasing the service's response
budget alone cannot change the simulator's deadline.

## Run the bot

```bash
python scripts/serve_sim_bot.py \
  --policy mlx \
  --model models/qwen3-8b-4bit \
  --port 3100 \
  --base-path /cyberpunk
```

Wait for `Local MLX worker ready` and Uvicorn startup to complete. In another terminal:

```bash
curl -sS http://127.0.0.1:3100/cyberpunk/ready \
  -H 'Content-Type: application/json' \
  -d '{"apiVersion":"v1alpha1","game":"cyberpunk-tcg-sim","check":"ready"}'
```

Generate the matching registration profile without loading the model:

```bash
python scripts/serve_sim_bot.py --policy mlx \
  --profile-url http://127.0.0.1:3100/cyberpunk
```

That URL works when the simulator **server** runs on the same Mac. If the simulator
server is in Docker, it needs a host address it can reach. If using the hosted
simulator website, its backend cannot reach your Mac's `127.0.0.1`; a reachable
tunnel/URL and simulator-operator registration are still needed. Neither this CLI
nor this repository starts the external simulator or registers a bot automatically.
Starting this repository's Next.js catalog does not start the external simulator.

Keep one bot process running for initial measurements. Stop with Ctrl-C; its model
subprocess is also stopped. To return to the portable heuristic, omit `--policy mlx`.

## Inference and failure behavior

- The model loads and performs a short GPU warmup before the HTTP service starts.
  Failed startup stops the service; it does not announce a working MLX installation.
- One inference exchange may run at a time. Other requests use the baseline
  immediately. There is no unbounded GPU queue, cross-match prompt/KV cache, or
  saved action mapping. The model stays loaded between requests.
- Qwen's chat template uses `enable_thinking=False`. Greedy decoding and a default
  16-token output cap keep the output short; gameplay quality is unmeasured.
- The complete rendered prompt is counted before generation. Above 4096 tokens
  by default, it falls back without truncating state or dropping legal actions.
  All supplied snapshot fields remain opaque; the current prompt has no retrieval
  of the rules/card corpus. Legal choices alone do not establish strategic knowledge.
- Only a JSON object with exactly one in-range integer `choice` is accepted.
  Duplicate fields, booleans, prose, invented IDs and length-truncated generation
  fall back. The parent validates the mapped ID against the current offered set.
- When the HTTP deadline expires, the baseline returns while the worker finishes
  its bounded generation. That late response is drained and discarded; the next
  request can never receive it. During draining, new requests use the baseline.
- A 30-second worker watchdog kills a wedged process. EOF, malformed protocol or
  mismatched response IDs also stop the worker. The HTTP service keeps providing
  the baseline; **restart the bot process** to reload MLX after such a failure.
  `/ready` still reports service readiness because legal fallback remains available;
  it is not proof that a particular decision used the model.
- Logs record decision selection and safe failure codes such as `worker_busy`,
  `prompt_too_large` and `invalid_output`. They never include snapshots, prompts,
  generated text or library stderr. `selection: policy` indicates a model choice.

If startup fails, check the local model/adapter files and dependencies. A direct
MLX diagnostic on a non-private prompt can expose installation errors suppressed
by the worker's private protocol:

```bash
HF_HUB_OFFLINE=1 mlx_lm.generate \
  --model models/qwen3-8b-4bit --prompt 'Reply with OK.' --max-tokens 16
```

## Preparing for a trained adapter

Once a reviewed gameplay adapter exists, both commands accept it:

```bash
python scripts/benchmark_sim_bot.py \
  --model models/qwen3-8b-4bit --adapter models/cyberpunk-policy-v1 \
  --requests local/positions.jsonl --output local/benchmark-policy-v1.jsonl

python scripts/serve_sim_bot.py \
  --policy mlx --model models/qwen3-8b-4bit \
  --adapter models/cyberpunk-policy-v1 --base-path /cyberpunk
```

The directory must contain MLX-LM's `adapter_config.json` and
`adapters.safetensors`, trained against the same starting model. These commands
are for a future artifact; this change does not create that directory or a dataset.

Next: collect reviewed visible positions and chosen actions, split by match into
training/validation/held-out sets, and export examples using the same
`build_choice_messages` prompt. Vary action ordering and remap the target choice.
The training renderer must preserve the same non-thinking chat template prefix;
MLX-LM 0.31.3's generic chat-dataset loader does not pass `enable_thinking=False`
automatically. The training exporter/entrypoint must handle this before training.
No heuristic decisions or synthetic smoke fixtures become gold labels by default.

## Validation boundary

```bash
python -m pip install httpx
python scripts/test_sim_bot.py
python scripts/test_sim_mlx.py
```

The portable suites cover 29 simulator contract checks and 29 local-worker checks,
including actual subprocess lifecycle, deadline/cancellation draining, busy callers,
crashes, bad/oversized replies, stale IDs, offline environment, output parsing,
token limits, benchmark fallback accounting and HTTP lifecycle. CI runs both
unconditionally. It does not install MLX or download weights on Ubuntu.

Actual MLX/Metal inference, M3 latency, live simulator matches and playing strength
remain to be measured on the Mac. No engine identity input, generated baseline,
corpus snapshot, gold dataset or existing evaluation result changes in this milestone.

References: [MLX-LM 0.31.3](https://github.com/ml-explore/mlx-lm/tree/v0.31.3),
[Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B),
[MLX weights](https://huggingface.co/mlx-community/Qwen3-8B-4bit),
[Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/guides/cli).
