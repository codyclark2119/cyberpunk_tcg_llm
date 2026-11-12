"""Read, write and log the engine's training records: TrainingPosition v2 and TrainingAttempt v1.

Why this exists: the TypeScript training contract in `packages/training-harness`
is the training record format. A TrainingPosition is one engine decision point
pinned to the engine version, engine artifact hash and content manifest; a
TrainingAttempt is one model try at that position (raw output, parsed choice,
the engine's verdict and the model/decoding metadata). Python writes attempts
during local matches and reads both for training, so it needs the same contract
without reimplementing the engine.

## What is checked here, and what only the engine can check

Every record is validated against the JSON Schemas that `npm run
contracts:export` writes to `packages/wire/schemas/` (`trainingPosition.v1.json`
and `trainingAttempt.v1.json`; the file suffix is the export version, the
record's own `schemaVersion` is 2 and 1). The validator below implements exactly
the JSON Schema keywords those files use and raises on any other keyword, so a
schema change that this module does not understand fails closed instead of
being skipped. `additionalProperties: false` is enforced everywhere, which is
the TS `strictObject` behaviour: an unknown field or an unknown `schemaVersion`
is an error, not a warning.

The TS `superRefine` also recomputes `stateHash`, `positionHash`,
`observationHash` and `contentManifestHash` from canonical engine
serialisation. Python does not reimplement those hashes (that would be engine
logic outside the engine); it checks only the field-equality half of that
refinement (engine version/artifact against the manifest, acting seat against
the observation, provenance seed against the RNG seed, state manifest hash
against the record). So: positions must come from the engine (`generatePosition`
in TS, or `build_position` below from the engine worker's own `hash`, `observe`
and `listLegalActions` answers), and the TS `importPositions` /
`validateTrainingPosition` remain the authority on hashes. The cross-language
round trip in `scripts/test_training_records.py` proves the two agree.

## Hook for local matches

    log = TrainingLog(positions_path, attempts_path)
    position = build_position(state=..., content=..., actor_id=..., observation=...,
                              legal_actions=..., hashes=..., position_id=...)
    log.log_attempt(position=position, attempt_id=..., raw_model_output=...,
                    parsed_action_id=..., validation_ok=..., validation_codes=[...],
                    resulting_state_hash=..., model=ModelMetadata(...), decoding=Decoding(...),
                    elapsed_ms=..., input_tokens=..., output_tokens=...)
    log.flush()   # or use TrainingLog as a context manager

See `TrainingLog.log_attempt` for each argument.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from harness.core.io import guard_shrink, iter_jsonl, write_jsonl_atomic

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "packages" / "wire" / "schemas"
POSITION_SCHEMA_PATH = SCHEMA_DIR / "trainingPosition.v1.json"
ATTEMPT_SCHEMA_PATH = SCHEMA_DIR / "trainingAttempt.v1.json"

POSITION_SCHEMA_VERSION = 2
ATTEMPT_SCHEMA_VERSION = 1
HASH_RE = re.compile(r"[a-f0-9]{64}")


class TrainingRecordError(ValueError):
    """A record that the TS training contract would reject (or Python cannot vouch for)."""


# ---------------------------------------------------------------------------
# Minimal JSON Schema (draft 2020-12) validator for the exported zod schemas
# ---------------------------------------------------------------------------

# Keywords that only annotate. Anything outside SUPPORTED raises SchemaError.
_ANNOTATIONS = {"$schema", "description", "title", "format"}
_SUPPORTED = _ANNOTATIONS | {
    "type", "properties", "required", "additionalProperties", "const", "enum",
    "minLength", "maxLength", "pattern", "items", "prefixItems", "minItems", "maxItems",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "oneOf", "anyOf", "allOf",
    "propertyNames",
}
# Formats the exports use; each is also enforced by a sibling `pattern`. An
# unknown format may carry a constraint zod enforces and this module would not.
_KNOWN_FORMATS = {"uuid"}


class SchemaError(RuntimeError):
    """The schema uses a construct this validator does not implement (fail closed)."""


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _json_equal(a: Any, b: Any) -> bool:
    """JSON equality: unlike Python ==, true is not 1 and 1 equals 1.0."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_number(a) and _is_number(b):
        return a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_json_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_json_equal(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def _utf16_len(s: str) -> int:
    # JS string length (zod min/max) counts UTF-16 code units, not code points.
    return len(s.encode("utf-16-le")) // 2


_TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "number": lambda v: _is_number(v) and math.isfinite(v),
    "integer": lambda v: _is_number(v) and math.isfinite(v) and float(v).is_integer(),
}


class SchemaValidator:
    """Validates JSON values against one exported schema. Reports the first few errors."""

    def __init__(self, schema: Mapping[str, Any]):
        self.schema = schema
        self._patterns: dict[str, re.Pattern] = {}
        self._check_supported(schema)

    @classmethod
    def from_file(cls, path: Path) -> "SchemaValidator":
        if not path.is_file():
            raise SchemaError(f"schema not found: {path} (run `npm run contracts:export`)")
        return cls(json.loads(path.read_text(encoding="utf-8")))

    def _check_supported(self, node: Any) -> None:
        if isinstance(node, bool):
            return
        if not isinstance(node, dict):
            raise SchemaError(f"schema node must be an object or boolean, got {type(node).__name__}")
        unknown = set(node) - _SUPPORTED
        if unknown:
            raise SchemaError(f"unsupported JSON Schema keyword(s): {sorted(unknown)}")
        if "format" in node and node["format"] not in _KNOWN_FORMATS:
            raise SchemaError(f"unsupported format: {node['format']!r}")
        if "pattern" in node:
            self._compile(node["pattern"])
        for key in ("properties",):
            for sub in node.get(key, {}).values():
                self._check_supported(sub)
        for key in ("items", "additionalProperties", "propertyNames"):
            if key in node:
                self._check_supported(node[key])
        for key in ("prefixItems", "oneOf", "anyOf", "allOf"):
            for sub in node.get(key, []):
                self._check_supported(sub)

    def _compile(self, pattern: str) -> re.Pattern:
        cached = self._patterns.get(pattern)
        if cached is not None:
            return cached
        # ECMAScript `$` (no m flag) matches only at the very end; Python `$`
        # also matches before a trailing newline. Only a final `$` is translated;
        # any other unescaped `$` is refused rather than guessed at.
        body = pattern
        if body.endswith("$") and not body.endswith("\\$"):
            body = body[:-1] + r"\Z"
        if re.search(r"(?<!\\)\$", body):
            raise SchemaError(f"unsupported '$' in pattern: {pattern!r}")
        compiled = re.compile(body, re.ASCII)
        self._patterns[pattern] = compiled
        return compiled

    def errors(self, value: Any, limit: int = 5) -> list[str]:
        out: list[str] = []
        self._validate(value, self.schema, "$", out, limit)
        return out

    def _validate(self, v: Any, s: Any, path: str, out: list[str], limit: int) -> None:
        if len(out) >= limit:
            return
        if s is True:
            return
        if s is False:
            out.append(f"{path}: not allowed")
            return
        t = s.get("type")
        if t is not None:
            types = t if isinstance(t, list) else [t]
            for name in types:
                if name not in _TYPE_CHECKS:
                    raise SchemaError(f"unsupported type: {name!r}")
            if not any(_TYPE_CHECKS[name](v) for name in types):
                out.append(f"{path}: expected {'/'.join(types)}, got {_describe(v)}")
                return
        if "const" in s and not _json_equal(v, s["const"]):
            out.append(f"{path}: expected {json.dumps(s['const'])}, got {_short(v)}")
            return
        if "enum" in s and not any(_json_equal(v, e) for e in s["enum"]):
            out.append(f"{path}: {_short(v)} is not one of {json.dumps(s['enum'])[:200]}")
            return
        if isinstance(v, str):
            n = _utf16_len(v)
            if "minLength" in s and n < s["minLength"]:
                out.append(f"{path}: shorter than {s['minLength']}")
            if "maxLength" in s and n > s["maxLength"]:
                out.append(f"{path}: longer than {s['maxLength']}")
            if "pattern" in s and not self._compile(s["pattern"]).search(v):
                out.append(f"{path}: {_short(v)} does not match {s['pattern']}")
        if _is_number(v):
            if "minimum" in s and v < s["minimum"]:
                out.append(f"{path}: {v} < minimum {s['minimum']}")
            if "maximum" in s and v > s["maximum"]:
                out.append(f"{path}: {v} > maximum {s['maximum']}")
            if "exclusiveMinimum" in s and v <= s["exclusiveMinimum"]:
                out.append(f"{path}: {v} <= exclusiveMinimum {s['exclusiveMinimum']}")
            if "exclusiveMaximum" in s and v >= s["exclusiveMaximum"]:
                out.append(f"{path}: {v} >= exclusiveMaximum {s['exclusiveMaximum']}")
        if isinstance(v, list):
            if "minItems" in s and len(v) < s["minItems"]:
                out.append(f"{path}: fewer than {s['minItems']} items")
            if "maxItems" in s and len(v) > s["maxItems"]:
                out.append(f"{path}: more than {s['maxItems']} items")
            prefix = s.get("prefixItems", [])
            for i, item in enumerate(v):
                sub = prefix[i] if i < len(prefix) else s.get("items", True)
                self._validate(item, sub, f"{path}[{i}]", out, limit)
        if isinstance(v, dict):
            props = s.get("properties", {})
            for key in s.get("required", []):
                if key not in v:
                    out.append(f"{path}: missing required field {key!r}")
            extra = s.get("additionalProperties", True)
            names = s.get("propertyNames")
            for key, item in v.items():
                if names is not None:
                    self._validate(key, names, f"{path}{{key {key!r}}}", out, limit)
                if key in props:
                    self._validate(item, props[key], f"{path}.{key}", out, limit)
                elif extra is False:
                    out.append(f"{path}: unknown field {key!r}")
                else:
                    self._validate(item, extra, f"{path}.{key}", out, limit)
        for sub in s.get("allOf", []):
            self._validate(v, sub, path, out, limit)
        if "anyOf" in s and not any(not self.errors_at(v, sub) for sub in s["anyOf"]):
            out.append(f"{path}: matches none of anyOf ({self._best_branch(v, s['anyOf'])})")
        if "oneOf" in s:
            matched = sum(1 for sub in s["oneOf"] if not self.errors_at(v, sub))
            if matched != 1:
                why = self._best_branch(v, s["oneOf"]) if matched == 0 else f"{matched} branches match"
                out.append(f"{path}: must match exactly one of oneOf ({why})")

    def errors_at(self, value: Any, schema: Any) -> list[str]:
        out: list[str] = []
        self._validate(value, schema, "", out, 1)
        return out

    def _best_branch(self, v: Any, branches: Sequence[Any]) -> str:
        # Prefer the branch whose discriminating const matched, for a readable error.
        first = ""
        for sub in branches:
            errs = self.errors_at(v, sub)
            first = first or (errs[0] if errs else "")
            if isinstance(v, dict) and isinstance(sub, dict):
                consts = {k: p["const"] for k, p in sub.get("properties", {}).items()
                          if isinstance(p, dict) and "const" in p}
                if consts and all(k in v and _json_equal(v[k], c) for k, c in consts.items()) and errs:
                    return errs[0]
        return first


def _describe(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if _is_number(v):
        return "number" if math.isfinite(v) else "non-finite number"
    return {dict: "object", list: "array", str: "string"}.get(type(v), type(v).__name__)


def _short(v: Any) -> str:
    text = json.dumps(v, ensure_ascii=False, default=str)
    return text if len(text) <= 80 else text[:77] + "..."


_VALIDATORS: dict[Path, SchemaValidator] = {}


def _validator(path: Path) -> SchemaValidator:
    if path not in _VALIDATORS:
        _VALIDATORS[path] = SchemaValidator.from_file(path)
    return _VALIDATORS[path]


# ---------------------------------------------------------------------------
# Record validation
# ---------------------------------------------------------------------------

def _require_version(record: Any, expected: int, kind: str) -> None:
    if not isinstance(record, dict):
        raise TrainingRecordError(f"{kind}: expected a JSON object, got {_describe(record)}")
    version = record.get("schemaVersion")
    if not (_is_number(version) and version == expected):
        raise TrainingRecordError(
            f"{kind}: unsupported schemaVersion {version!r} (this reader accepts only {expected})")


def validate_position(record: Any, *, expect_engine: Mapping[str, str] | None = None) -> dict:
    """Return `record` if it satisfies the exported TrainingPosition v2 schema, else raise.

    `expect_engine` ({"version", "artifactHash"}, e.g. a match header's engine
    identity) additionally rejects positions pinned to another engine build.
    Hash recomputation is the engine's job; see the module docstring.
    """
    _require_version(record, POSITION_SCHEMA_VERSION, "TrainingPosition")
    errs = _validator(POSITION_SCHEMA_PATH).errors(record)
    if errs:
        raise TrainingRecordError(f"TrainingPosition {record.get('positionId')!r}: " + "; ".join(errs))
    engine = record["manifest"]["engine"]
    state = record["state"]
    mismatches = [name for name, ok in (
        ("engineVersion != manifest.engine.version", record["engineVersion"] == engine["version"]),
        ("engineArtifactHash != manifest.engine.artifactHash", record["engineArtifactHash"] == engine["artifactHash"]),
        ("state.match.contentManifestHash != contentManifestHash",
         state["match"]["contentManifestHash"] == record["contentManifestHash"]),
        ("actingSeat != observation.viewerSeat", record["actingSeat"] == record["observation"]["viewerSeat"]),
        ("provenance.seed != state.rng.seed", record["provenance"]["seed"] == state["rng"]["seed"]),
    ) if not ok]
    if mismatches:
        raise TrainingRecordError(f"TrainingPosition {record['positionId']!r}: " + "; ".join(mismatches))
    if expect_engine is not None and (record["engineVersion"] != expect_engine.get("version")
                                      or record["engineArtifactHash"] != expect_engine.get("artifactHash")):
        raise TrainingRecordError(
            f"TrainingPosition {record['positionId']!r} is pinned to engine "
            f"{record['engineVersion']}/{record['engineArtifactHash'][:12]}, expected "
            f"{expect_engine.get('version')}/{str(expect_engine.get('artifactHash'))[:12]}")
    return record


def validate_attempt(record: Any) -> dict:
    """Return `record` if it satisfies the exported TrainingAttempt v1 schema, else raise."""
    _require_version(record, ATTEMPT_SCHEMA_VERSION, "TrainingAttempt")
    errs = _validator(ATTEMPT_SCHEMA_PATH).errors(record)
    if errs:
        raise TrainingRecordError(f"TrainingAttempt {record.get('attemptId')!r}: " + "; ".join(errs))
    return record


# ---------------------------------------------------------------------------
# JSONL reader / writer
# ---------------------------------------------------------------------------

def _reject_constant(name: str):
    raise TrainingRecordError(f"non-JSON number {name} (JSON.parse rejects it)")


def _iter_records(path: Path, missing_ok: bool):
    # iter_jsonl's json.loads accepts NaN/Infinity, which JSON.parse in TS does
    # not; re-parse strictly so Python never reads what TS would refuse.
    for line_no, record in enumerate(iter_jsonl(path, missing_ok=missing_ok), 1):
        json.loads(json.dumps(record), parse_constant=_reject_constant)
        yield line_no, record


def read_positions(path: Path, *, missing_ok: bool = True,
                   expect_engine: Mapping[str, str] | None = None) -> list[dict]:
    """Every TrainingPosition in a JSONL file, each validated; raises on the first bad line."""
    out, seen = [], {}
    for line_no, record in _iter_records(Path(path), missing_ok):
        try:
            validate_position(record, expect_engine=expect_engine)
        except TrainingRecordError as exc:
            raise TrainingRecordError(f"{path}:{line_no}: {exc}") from None
        pid = record["positionId"]
        if pid in seen:
            if not _json_equal(seen[pid], record):
                raise TrainingRecordError(f"{path}:{line_no}: conflicting position ID {pid!r}")
            continue
        seen[pid] = record
        out.append(record)
    return out


def read_attempts(path: Path, *, missing_ok: bool = True) -> list[dict]:
    """Every TrainingAttempt in a JSONL file, each validated; duplicate attempt IDs are errors."""
    out, seen = [], set()
    for line_no, record in _iter_records(Path(path), missing_ok):
        try:
            validate_attempt(record)
        except TrainingRecordError as exc:
            raise TrainingRecordError(f"{path}:{line_no}: {exc}") from None
        if record["attemptId"] in seen:
            raise TrainingRecordError(f"{path}:{line_no}: duplicate attempt ID {record['attemptId']!r}")
        seen.add(record["attemptId"])
        out.append(record)
    return out


def _check_json_safe(record: Mapping[str, Any]) -> None:
    try:
        json.dumps(record, allow_nan=False)
    except ValueError as exc:
        raise TrainingRecordError(f"record is not strict JSON: {exc}") from None


def _dedupe_positions(positions: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Same rule as TS exportPositions: identical repeats collapse, conflicts raise."""
    unique: dict[str, dict] = {}
    for p in positions:
        validate_position(p)
        _check_json_safe(p)
        existing = unique.get(p["positionId"])
        if existing is not None and not _json_equal(existing, p):
            raise TrainingRecordError(f"conflicting position ID {p['positionId']!r}")
        unique[p["positionId"]] = dict(p)
    return list(unique.values())


def _check_unique_attempts(attempts: Iterable[Mapping[str, Any]]) -> list[dict]:
    out, ids = [], set()
    for a in attempts:
        validate_attempt(a)
        _check_json_safe(a)
        if a["attemptId"] in ids:
            raise TrainingRecordError(f"duplicate attempt ID {a['attemptId']!r}")
        ids.add(a["attemptId"])
        out.append(dict(a))
    return out


def write_positions(path: Path, positions: Iterable[Mapping[str, Any]], *, force: bool = False) -> list[dict]:
    """Validate, dedupe and atomically write positions; refuses to shrink the file without force."""
    rows = _dedupe_positions(positions)
    guard_shrink(Path(path), len(rows), force=force, min_ratio=1.0, what="training positions")
    write_jsonl_atomic(Path(path), rows)
    return rows


def write_attempts(path: Path, attempts: Iterable[Mapping[str, Any]], *, force: bool = False) -> list[dict]:
    """Validate and atomically write attempts; refuses to shrink the file without force."""
    rows = _check_unique_attempts(attempts)
    guard_shrink(Path(path), len(rows), force=force, min_ratio=1.0, what="training attempts")
    write_jsonl_atomic(Path(path), rows)
    return rows


# ---------------------------------------------------------------------------
# Building records from engine output (the local-match hook)
# ---------------------------------------------------------------------------

def build_position(*, state: Mapping[str, Any], content: Mapping[str, Any], actor_id: str,
                   observation: Mapping[str, Any], legal_actions: Sequence[Mapping[str, Any]],
                   hashes: Mapping[str, str], position_id: str,
                   provenance: Mapping[str, str] | None = None) -> dict:
    """Assemble a TrainingPosition from engine-worker answers; no field is computed in Python.

    Every argument is engine output for the same `state` and `actor_id`:
      state          the trusted GameState the runner holds (from createGame/applyAction)
      content        the ContentBundle sent with every worker request (manifest + manifestHash)
      observation    value.observation of the worker's `observe` op
      legal_actions  value.actions of the worker's `listLegalActions` op (full LegalActions,
                     not the ModelInputV2 public projection)
      hashes         value of the worker's `hash` op: stateHash, positionHash, observationHash
      provenance     {"generator", "revision", "seed"}; seed defaults to state.rng.seed and
                     must equal it (the TS schema checks this)
    The result is what TS `generatePosition` returns for the same input; TS
    `importPositions` recomputes and checks the hashes.
    """
    if state["timing"]["actingPlayer"] != actor_id:
        raise TrainingRecordError("position actor must own the decision (state.timing.actingPlayer)")
    if not legal_actions:
        raise TrainingRecordError("training positions require a nonempty legal action set")
    prov = {"generator": "local-match", "revision": "1", "seed": state["rng"]["seed"], **(provenance or {})}
    record = {
        "schemaVersion": POSITION_SCHEMA_VERSION,
        "positionId": position_id,
        "engineVersion": state["match"]["engineVersion"],
        "engineArtifactHash": state["match"]["engineArtifactHash"],
        "manifest": content["manifest"],
        "contentManifestHash": content["manifestHash"],
        "state": state,
        "stateHash": hashes["stateHash"],
        "observation": observation,
        "observationHash": hashes["observationHash"],
        "actingSeat": state["players"][actor_id]["seat"],
        "legalActions": list(legal_actions),
        "positionHash": hashes["positionHash"],
        "provenance": prov,
    }
    return validate_position(record)


@dataclass(frozen=True)
class ModelMetadata:
    """Which model produced the output. Use a stable revision (commit/sha), never a path alone."""
    model_revision: str
    tokenizer_revision: str
    adapter_revision: str          # e.g. "none" when no LoRA adapter is loaded
    prompt_fingerprint: str        # 64 lowercase hex chars (sha256 of the prompt version/shape)


@dataclass(frozen=True)
class Decoding:
    temperature: float
    top_p: float
    max_tokens: int
    seed: int | None = None


def build_attempt(*, position: Mapping[str, Any], attempt_id: str, raw_model_output: str,
                  parsed_action_id: str | None, validation_ok: bool, validation_codes: Sequence[str],
                  resulting_state_hash: str | None, model: ModelMetadata, decoding: Decoding,
                  elapsed_ms: float, input_tokens: int, output_tokens: int) -> dict:
    """Assemble one TrainingAttempt for `position` and validate it.

    Beyond the schema, refuses records that contradict the engine: an accepted
    attempt needs a parsed choice that the position offered and the engine's
    resulting state hash; a rejected one has no resulting state.
    """
    offered = {a["actionId"] for a in position["legalActions"]}
    if validation_ok:
        if parsed_action_id is None or resulting_state_hash is None:
            raise TrainingRecordError("an accepted attempt needs parsed_action_id and resulting_state_hash")
        if parsed_action_id not in offered:
            raise TrainingRecordError("accepted attempt chose an actionId the position did not offer")
        if validation_codes:
            raise TrainingRecordError("an accepted attempt carries no validation codes")
    else:
        if resulting_state_hash is not None:
            raise TrainingRecordError("a rejected attempt has no resulting state hash")
        if not validation_codes:
            raise TrainingRecordError("a rejected attempt needs at least one validation code")
    record = {
        "schemaVersion": ATTEMPT_SCHEMA_VERSION,
        "attemptId": attempt_id,
        "positionId": position["positionId"],
        "rawModelOutput": raw_model_output,
        "parsedChoice": None if parsed_action_id is None else {"actionId": parsed_action_id},
        "validation": {"ok": bool(validation_ok), "codes": list(validation_codes)},
        "resultingStateHash": resulting_state_hash,
        "modelRevision": model.model_revision,
        "tokenizerRevision": model.tokenizer_revision,
        "adapterRevision": model.adapter_revision,
        "promptFingerprint": model.prompt_fingerprint,
        "decoding": {"temperature": decoding.temperature, "topP": decoding.top_p,
                     "maxTokens": decoding.max_tokens, "seed": decoding.seed},
        "elapsedMs": elapsed_ms,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
    }
    return validate_attempt(record)


class TrainingLog:
    """Collects positions and attempts from one run and writes them atomically.

    Buffers in memory and merges with what is already on disk at `flush()`, so
    a run never rewrites a large positions file once per decision. Existing
    records are kept (positions dedupe by ID, a conflicting ID or a repeated
    attempt ID raises), so the files only grow. Use as a context manager to
    flush on a clean exit; nothing is written if the block raises.
    """

    def __init__(self, positions_path: Path, attempts_path: Path, *,
                 expect_engine: Mapping[str, str] | None = None):
        self.positions_path = Path(positions_path)
        self.attempts_path = Path(attempts_path)
        self.expect_engine = expect_engine
        self._positions: dict[str, dict] = {}
        self._attempts: list[dict] = []

    def __enter__(self) -> "TrainingLog":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            self.flush()

    def log_attempt(self, *, position: Mapping[str, Any], **attempt_fields: Any) -> dict:
        """Record one decision: the position (once per positionId) and one attempt at it.

        `position` is a TrainingPosition from `build_position` (or TS
        `generatePosition`); `attempt_fields` are the keyword arguments of
        `build_attempt` other than `position`. Returns the attempt record.
        """
        validate_position(position, expect_engine=self.expect_engine)
        existing = self._positions.get(position["positionId"])
        if existing is not None and not _json_equal(existing, position):
            raise TrainingRecordError(f"conflicting position ID {position['positionId']!r}")
        attempt = build_attempt(position=position, **attempt_fields)
        if any(a["attemptId"] == attempt["attemptId"] for a in self._attempts):
            raise TrainingRecordError(f"duplicate attempt ID {attempt['attemptId']!r}")
        self._positions[position["positionId"]] = dict(position)
        self._attempts.append(attempt)
        return attempt

    def flush(self) -> None:
        """Merge buffered records into the files on disk (positions first), then clear the buffer."""
        if not self._positions and not self._attempts:
            return
        on_disk = read_positions(self.positions_path, expect_engine=self.expect_engine)
        write_positions(self.positions_path, [*on_disk, *self._positions.values()])
        write_attempts(self.attempts_path, [*read_attempts(self.attempts_path), *self._attempts])
        self._positions.clear()
        self._attempts.clear()


def log_training_attempt(positions_path: Path, attempts_path: Path, *, position: Mapping[str, Any],
                         **attempt_fields: Any) -> dict:
    """One-shot form of `TrainingLog.log_attempt` + `flush` for a single decision."""
    log = TrainingLog(positions_path, attempts_path)
    attempt = log.log_attempt(position=position, **attempt_fields)
    log.flush()
    return attempt
