#!/usr/bin/env python3
"""The engine oracle's position catalog: real engine positions, indexed by what the acting seat can see.

Why: the assistant's 8B model guesses at in-game questions ("can this Unit attack
now?"), and the engine is the only authority on what is legal. The engine oracle
(plan section 4, PR 1 of 4) answers such questions from positions the engine
actually reached. This script builds the catalog it searches. A later PR adds the
``engine_check`` tool on top. Python decides no legality here: "offered" means
only that the engine listed the action at that position.

Positions. The real engine worker (``scripts/engine-worker.ts``) plays the fixed
Demo decks with the deterministic ``baseline_action_id`` policy on both seats,
exactly as ``build_engine_tf_items.py`` does, over seeds ``engine-oracle-v1-0`` ..
``engine-oracle-v1-<N-1>``. That prefix is disjoint from ``engine-tf-v1`` (the
LoRA's legality items) and from ``engine-oracle-eval-v1`` (the held-out set for
the tool's eval), so no catalog position is a training or eval position. One
position is kept per Main phase decision of the active seat and per React Step
decision of the defending seat (``engine_positions.decision_kind``).

Index. ``data/oracle/positions-v1.jsonl`` holds one public row per position:

  - ``position_id``: ``pos-`` + the first 16 hex of sha256 over the engine
    identity, the seed and the decision index;
  - ``seed``, ``decision_index``, ``state_hash`` (the worker's), ``acting_seat``,
    ``turn``, ``step`` (``main`` or ``react``);
  - ``facts``: per card the observation shows, its slug and publicId, side
    (friendly or rival), area, ready or spent, face, lagging, played this turn,
    printed cost and, for the seat's own hand, whether its ready payment pieces
    cover that cost (a described count, not a verdict); the seat's ready payment
    pieces, its sales this turn and, in a React Step, the attack being reacted to;
  - ``offered``: every action the engine lists, in the engine's order, with its
    kind, ``source.publicId`` mapped to a slug, a target slug where the descriptor
    names one, the engine's label (shown, never parsed) and the ``actionId``;
    each ``DECLARE_ATTACK`` also carries ``attack_targets``, what the engine asks
    for next once that attack is applied to a copy of the state;
  - ``engine``: the identity (version, artifactHash) of the content bundle
    (``scripts/engine-identity.ts`` through ``scripts/local-match-setup.ts``).

Every row passes ``engine_positions.check_public``: it names only cards the
acting seat can see. Card identity is the slug, never the name.

Cache. Full states (about 44 KB each) are not committed. They go to the
gitignored ``local/oracle-cache/<position_id>.json``. ``load_position`` reads one,
or on a miss replays that one seed, and checks it against the index: the index's
engine identity must be the running setup's, the cached engine identity the
index's, and the state's hash, recomputed by the worker, the indexed one. Any
mismatch is a hard ``stale_positions`` error, never a silent re-answer.

Size. Positions are capped at ``CAP_PER_CARD_SET_STEP`` per (visible card set,
step), keeping the lowest position ids, so repeated board states cannot dominate.
The manifest next to the index reports card coverage over the 29 Demo cards:
per card, the positions where it is visible (by area and state), those where the
engine offers an action from it (by kind and state), and the cards never seen.

Limits: only the 29 Demo cards can appear, because only the Demo bundle plays
whole games; facts are public only; and "not offered" is a fact about the listed
positions, never a rule reason.

Deterministic: no clock, no network, no model; the same seeds give the same bytes.
Refuses to shrink the index below half without ``--force``.

Usage:
    python scripts/build_oracle_positions.py                # write the index, manifest and local cache
    python scripts/build_oracle_positions.py --check        # regenerate in memory, compare bytes
    python scripts/build_oracle_positions.py --seeds 2 --out /tmp/positions.jsonl --no-cache
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.engine_adapter import EngineProtocolError, EngineWorker  # noqa: E402
from games.cyberpunk.engine_positions import (MAX_DECISIONS, MAX_TURNS, Card, Decision,  # noqa: E402
                                              PositionError, attack_options, card_data, check_public,
                                              decision_kind, payable, public_facts, replay_seed,
                                              slugs_by_public_id)
from games.cyberpunk.local_match import MatchSetup, load_default_setup  # noqa: E402
from harness.core.io import guard_shrink, read_jsonl, write_jsonl_atomic  # noqa: E402

GENERATOR_VERSION = "build-oracle-positions-v1"
INDEX_PATH = REPO_ROOT / "data/oracle/positions-v1.jsonl"
CACHE_DIR = REPO_ROOT / "local/oracle-cache"
SEED_PREFIX = "engine-oracle-v1"
# Prefixes the catalog must never share a seed with: the LoRA's legality items and the tool's held-out eval.
RESERVED_PREFIXES = ("engine-tf-v1", "engine-oracle-eval-v1")
# --eval builds the tool's held-out positions the same way on the eval prefix (scripts/eval_engine_check.py).
EVAL_PREFIX = "engine-oracle-eval-v1"
EVAL_INDEX_PATH = REPO_ROOT / "data/oracle/eval-positions-v1.jsonl"
DEFAULT_SEEDS = 12
DEFAULT_WORKERS = 4
CAP_PER_CARD_SET_STEP = 4
FIELD_AREAS = ("battlefield", "legends")  # where ready/spent is a game fact ("in play" below)


class StalePositions(PositionError):
    """The cached state, the index and the running engine disagree (``stale_positions``)."""
    code = "stale_positions"

    def __init__(self, message: str):
        super().__init__(f"{self.code}: {message}")


class NoPosition(PositionError):
    """The position id is not in the index (``no_position``)."""
    code = "no_position"

    def __init__(self, message: str):
        super().__init__(f"{self.code}: {message}")


# Seeds ----------------------------------------------------------------------------------------

def seeds_for(count: int, prefix: str = SEED_PREFIX) -> list[str]:
    return [f"{prefix}-{n}" for n in range(count)]


def prefixes_disjoint(a: str, b: str) -> bool:
    """No seed ``<a>-<n>`` equals a seed ``<b>-<m>``, and neither prefix's seeds start with the other's ``<p>-``.

    The second half is stricter than needed for equality; it keeps a ``startswith`` filter over seed names
    from ever mixing two sets.
    """
    return a != b and not f"{a}-".startswith(f"{b}-") and not f"{b}-".startswith(f"{a}-")


# Rows -----------------------------------------------------------------------------------------

def engine_identity(setup: MatchSetup) -> dict[str, str]:
    engine = setup.engine
    if not engine.get("version") or not engine.get("artifactHash"):
        raise PositionError("the content bundle carries no engine identity")
    return {"version": engine["version"], "artifactHash": engine["artifactHash"]}


def position_id(engine: Mapping[str, str], seed: str, index: int) -> str:
    key = json.dumps([engine["version"], engine["artifactHash"], seed, index])
    return "pos-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _slug(slugs: Mapping[str, str], public_id: str, what: str) -> str:
    if public_id not in slugs:
        raise PositionError(f"{what} {public_id} is not a card the acting seat can see")
    return slugs[public_id]


def _target(descriptor: Mapping, slugs: Mapping[str, str]) -> dict | None:
    """The card a descriptor names besides its source (``target`` or a CHOOSE ``option``), if any."""
    for key in ("target", "option"):
        value = descriptor.get(key)
        if isinstance(value, Mapping) and value.get("kind") == "CARD" and value.get("publicId"):
            return {"public_id": value["publicId"], "slug": _slug(slugs, value["publicId"], key)}
    return None


def offered_rows(actions: list[dict], slugs: Mapping[str, str],
                 probes: Mapping[str, list[dict]]) -> list[dict]:
    """The engine's offered actions as public descriptors, in the engine's order."""
    out = []
    for a in actions:
        d = a["descriptor"]
        source = d.get("source") or {}
        row: dict[str, Any] = {"kind": d["kind"], "source_kind": source.get("kind"),
                               "source_public_id": source.get("publicId"),
                               "source_slug": _slug(slugs, source["publicId"], "source")
                               if source.get("kind") == "CARD" else None,
                               "target": _target(d, slugs), "label": d.get("label"), "action_id": a["actionId"]}
        if source.get("kind") == "ZONE_SLOT":
            row["source_slot"] = {"seat": source.get("seat"), "zone": source.get("zone"), "slot": source.get("slot")}
        if d["kind"] == "DECLARE_ATTACK":
            row["attack_targets"] = [
                {"kind": "CARD", "public_id": o["publicId"], "slug": _slug(slugs, o["publicId"], "attack target")}
                if o["kind"] == "CARD" else {"kind": o["kind"]} for o in probes[a["actionId"]]]
        out.append(row)
    return out


def combat_facts(obs: Mapping, slugs: Mapping[str, str]) -> dict | None:
    combat = obs.get("combat")
    if not combat:
        return None
    target = combat.get("target") or {}
    out = {"stage": combat.get("stage"), "attacker_public_id": combat.get("attackerId"),
           "attacker_slug": _slug(slugs, combat["attackerId"], "attacker") if combat.get("attackerId") else None,
           "target": {"kind": target.get("kind")}}
    if target.get("kind") == "CARD":
        out["target"].update(public_id=target["cardInstanceId"],
                             slug=_slug(slugs, target["cardInstanceId"], "attack target"))
    return out


def position_row(d: Decision, step: str, engine: Mapping[str, str], cards: Mapping[str, Card],
                 probes: Mapping[str, list[dict]]) -> dict:
    """One public index row for a decision. ``probes``: DECLARE_ATTACK actionId -> ``attack_options``."""
    obs = d.observation
    slugs = slugs_by_public_id(obs)
    row = {
        "position_id": position_id(engine, d.seed, d.index), "seed": d.seed, "decision_index": d.index,
        "state_hash": d.state_hash, "acting_seat": obs["viewerSeat"], "turn": obs["turn"], "step": step,
        "facts": {"cards": public_facts(obs, cards, d.played_this_turn), "payable": payable(obs, cards),
                  "sold_this_turn": d.sold_this_turn, "combat": combat_facts(obs, slugs)},
        "offered": offered_rows(d.actions, slugs, probes),
        "engine": dict(engine),
    }
    check_row_public(row, obs, d.actions, cards)
    return row


def row_slugs(row: Mapping) -> list[str]:
    """Every slug a row names."""
    found: list[str] = []

    def walk(value):
        if isinstance(value, Mapping):
            for k, v in value.items():
                if k in ("slug", "source_slug", "attacker_slug") and isinstance(v, str):
                    found.append(v)
                else:
                    walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    walk(row)
    return sorted(set(found))


def check_row_public(row: Mapping, obs: Mapping, actions: list, cards: Mapping[str, Card]) -> None:
    """The row may name only cards the acting seat sees: every slug, and every name in the engine's labels."""
    labels = " ".join(o["label"] or "" for o in row["offered"])
    check_public(labels, row_slugs(row), obs, actions, cards)


def probe_attacks(worker: EngineWorker, content: Mapping, d: Decision) -> dict[str, list[dict]]:
    return {a["actionId"]: attack_options(worker, content, d.state, d.actor, a["actionId"])
            for a in d.actions if a["descriptor"]["kind"] == "DECLARE_ATTACK"}


def seed_positions(worker: EngineWorker, setup: MatchSetup, seed: str,
                   cards: Mapping[str, Card]) -> list[tuple[dict, dict]]:
    """(row, full state) for every Main and React decision of one baseline game."""
    engine = engine_identity(setup)
    out = []
    for d in replay_seed(worker, setup, seed, max_decisions=MAX_DECISIONS, max_turns=MAX_TURNS):
        step = decision_kind(d.observation)
        if step:
            out.append((position_row(d, step, engine, cards, probe_attacks(worker, setup.content, d)), d.state))
    return out


def collect(setup: MatchSetup, seeds: list[str], workers: int = DEFAULT_WORKERS,
            node: str = "node") -> list[tuple[dict, dict]]:
    """Play every seed (in parallel worker processes) and return (row, state) pairs in seed order."""
    cards = card_data(setup.content)
    chunks = [seeds[i::workers] for i in range(max(1, min(workers, len(seeds))))]

    def run(chunk):
        with EngineWorker(REPO_ROOT, node=node) as worker:
            return {seed: seed_positions(worker, setup, seed, cards) for seed in chunk}

    by_seed: dict[str, list] = {}
    with ThreadPoolExecutor(max_workers=len(chunks)) as pool:
        for part in pool.map(run, chunks):
            by_seed.update(part)
    return [p for seed in seeds for p in by_seed[seed]]


# Selection and coverage -----------------------------------------------------------------------

def card_set(row: Mapping) -> str:
    """The visible board as a key: each visible card's slug, side, area and state (copies counted)."""
    return json.dumps(sorted(json.dumps([c["slug"], c["side"], c["area"], c["state"]])
                             for c in row["facts"]["cards"]))


def cap_positions(rows: list[dict], cap: int = CAP_PER_CARD_SET_STEP) -> tuple[list[dict], int]:
    """Keep at most ``cap`` positions per (visible card set, step): the lowest position ids, then seed order."""
    groups: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    for r in rows:
        groups[(card_set(r), r["step"])].append(r)
    keep = {r["position_id"] for group in groups.values()
            for r in sorted(group, key=lambda r: r["position_id"])[:cap]}
    return [r for r in rows if r["position_id"] in keep], len(rows) - len(keep)


def sort_rows(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r["seed"].rsplit("-", 1)[0], int(r["seed"].rsplit("-", 1)[1]),
                                       r["decision_index"]))


def coverage(rows: list[dict], cards: Mapping[str, Card]) -> dict:
    """Per Demo card: positions where it is visible (by area:state) and where an action from it is offered."""
    out: dict[str, dict] = {}
    for slug in sorted(cards):
        visible: collections.Counter = collections.Counter()
        offered: collections.Counter = collections.Counter()
        seen, offered_at = set(), set()
        for r in rows:
            mine = [c for c in r["facts"]["cards"] if c["slug"] == slug]
            if mine:
                seen.add(r["position_id"])
            for state in sorted({f"{c['area']}:{c['state']}" for c in mine}):
                visible[state] += 1
            by_pid = {c["public_id"]: c for c in r["facts"]["cards"]}
            kinds = set()
            for o in r["offered"]:
                if o["source_slug"] == slug:
                    c = by_pid[o["source_public_id"]]
                    kinds.add(f"{o['kind']}:{c['area']}:{c['state']}")
            if kinds:
                offered_at.add(r["position_id"])
            for k in sorted(kinds):
                offered[k] += 1
        states = {k.split(":")[1] for k in visible if k.split(":")[0] in FIELD_AREAS}
        out[slug] = {"type": cards[slug].type, "visible_positions": len(seen), "visible_by_area_state":
                     dict(sorted(visible.items())), "offered_positions": len(offered_at),
                     "offered_by_kind_area_state": dict(sorted(offered.items())),
                     "seen_ready": "ready" in states, "seen_spent": "spent" in states}  # in play only
    return out


# The build ------------------------------------------------------------------------------------

@dataclass
class Result:
    rows: list[dict]
    states: dict[str, dict]       # position_id -> full state (for the local cache only)
    manifest: dict


def build(setup: MatchSetup, pairs: list[tuple[dict, dict]], seeds: list[str],
          cap: int = CAP_PER_CARD_SET_STEP, *, prefix: str = SEED_PREFIX, index_name: str = INDEX_PATH.name) -> Result:
    cards = card_data(setup.content)
    rows = [r for r, _ in pairs]
    ids = [r["position_id"] for r in rows]
    if len(set(ids)) != len(ids):
        raise PositionError("two positions share a position id")
    kept, capped = cap_positions(rows, cap)
    kept = sort_rows(kept)
    keep = {r["position_id"] for r in kept}
    states = {r["position_id"]: s for r, s in pairs if r["position_id"] in keep}
    cov = coverage(kept, cards)
    counter = lambda key: dict(sorted(collections.Counter(key(r) for r in kept).items()))  # noqa: E731
    manifest = {
        "generator_version": GENERATOR_VERSION, "index": index_name, "engine": engine_identity(setup),
        "ruleset": (setup.content.get("manifest") or {}).get("ruleset"),
        "content_manifest_hash": setup.content.get("manifestHash"), "format": setup.initialization.get("format"),
        "seeds": {"prefix": prefix, "count": len(seeds), "first": seeds[0] if seeds else None,
                  "last": seeds[-1] if seeds else None,
                  "disjoint_from": [p for p in (SEED_PREFIX, *RESERVED_PREFIXES) if p != prefix]},
        "policy": "baseline_action_id on both seats", "limits": {"max_decisions": MAX_DECISIONS,
                                                                 "max_turns": MAX_TURNS},
        "selection": {"cap_per_card_set_step": cap, "order": "lowest position_id within a (card set, step)",
                      "decisions": len(rows), "capped": capped},
        "counts": {"positions": len(kept), "by_step": counter(lambda r: r["step"]),
                   "by_seat": counter(lambda r: str(r["acting_seat"])),
                   "offered_by_kind": dict(sorted(collections.Counter(
                       o["kind"] for r in kept for o in r["offered"]).items())),
                   "seeds_used": len({r["seed"] for r in kept})},
        "coverage": {"demo_cards": len(cards),
                     "visible": sum(1 for c in cov.values() if c["visible_positions"]),
                     "never_visible": sorted(s for s, c in cov.items() if not c["visible_positions"]),
                     "never_offered": sorted(s for s, c in cov.items() if not c["offered_positions"]),
                     "never_in_play": sorted(s for s, c in cov.items() if not c["seen_ready"]
                                             and not c["seen_spent"]),
                     "never_ready_in_play": sorted(s for s, c in cov.items() if c["seen_spent"]
                                                   and not c["seen_ready"]),
                     "never_spent_in_play": sorted(s for s, c in cov.items() if c["seen_ready"]
                                                   and not c["seen_spent"]),
                     "by_card": cov},
        "limits_of_the_catalog": ["only the 29 Demo cards can appear (the Demo bundle alone plays whole games)",
                                  "facts are what the acting seat's observation shows, nothing hidden",
                                  "'not offered' is a fact about these positions, not a rule reason",
                                  "affordable is a described count of ready payment pieces, not a verdict"],
    }
    return Result(kept, states, manifest)


# Output ---------------------------------------------------------------------------------------

def manifest_path(out: Path) -> Path:
    return out.with_name(out.name.removesuffix(".jsonl") + ".manifest.json")


def output_texts(result: Result) -> tuple[str, str]:
    rows = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in result.rows)
    return rows, json.dumps(result.manifest, ensure_ascii=False, indent=1) + "\n"


def write_outputs(out: Path, result: Result, *, force: bool = False) -> None:
    guard_shrink(out, len(result.rows), force, what="positions", hint="pass --force to replace it")
    write_jsonl_atomic(out, result.rows)
    tmp = manifest_path(out).with_suffix(".json.tmp")
    tmp.write_text(output_texts(result)[1], encoding="utf-8")
    tmp.replace(manifest_path(out))


# Local cache ----------------------------------------------------------------------------------

def cache_path(pid: str, cache_dir: Path = CACHE_DIR) -> Path:
    return cache_dir / f"{pid}.json"


def write_cache(row: Mapping, state: Mapping, cache_dir: Path = CACHE_DIR) -> Path:
    path = cache_path(row["position_id"], cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"position_id": row["position_id"], "engine": row["engine"], "seed": row["seed"],
                               "decision_index": row["decision_index"], "state_hash": row["state_hash"],
                               "state": state}, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    return path


def read_index(path: Path = INDEX_PATH) -> dict[str, dict]:
    return {r["position_id"]: r for r in read_jsonl(path, missing_ok=False)}


def _replay_to(worker: EngineWorker, setup: MatchSetup, seed: str, index: int) -> Decision:
    for d in replay_seed(worker, setup, seed, max_decisions=MAX_DECISIONS, max_turns=MAX_TURNS):
        if d.index == index:
            return d
    raise StalePositions(f"{seed} never reaches decision {index}")


def load_position(pid: str, *, worker: EngineWorker | None = None, setup: MatchSetup | None = None,
                  index: Mapping[str, Mapping] | None = None, index_path: Path = INDEX_PATH,
                  cache_dir: Path = CACHE_DIR, node: str = "node") -> dict:
    """The full engine state of an indexed position, from the local cache or by replaying its seed.

    Fails closed with ``stale_positions`` when the index was built on another engine than the running setup,
    the cache on another engine than the index, or the state's hash (recomputed by the worker) is not the
    indexed one. A position id the index lacks raises ``no_position``.
    """
    index = read_index(index_path) if index is None else index
    if pid not in index:
        raise NoPosition(f"{pid} is not in the index")
    row = index[pid]
    setup = load_default_setup(REPO_ROOT, node=node) if setup is None else setup
    running = engine_identity(setup)
    if dict(row["engine"]) != running:
        raise StalePositions(f"{pid} was indexed on engine {row['engine']}, the running engine is {running}")
    own = worker is None
    worker = EngineWorker(REPO_ROOT, node=node) if own else worker
    try:
        path = cache_path(pid, cache_dir)
        if path.exists():
            cached = json.loads(path.read_text(encoding="utf-8"))
            if cached.get("engine") != row["engine"] or cached.get("position_id") != pid:
                raise StalePositions(f"{path.name} was cached for engine {cached.get('engine')}, "
                                     f"the index has {row['engine']}")
            state = cached["state"]
        else:
            d = _replay_to(worker, setup, row["seed"], row["decision_index"])
            state = d.state
        try:
            actual = worker.hashes(content=setup.content, state=state,
                                   actor_id=state["timing"]["actingPlayer"])["stateHash"]
        except (EngineProtocolError, KeyError, TypeError) as exc:
            raise StalePositions(f"the engine refuses the state of {pid}: {exc}") from exc
        if actual != row["state_hash"]:
            raise StalePositions(f"{pid}: state hash {actual[:12]} is not the indexed {row['state_hash'][:12]}")
        if not path.exists():
            write_cache(row, state, cache_dir)
        return state
    finally:
        if own:
            worker.close()


# CLI ------------------------------------------------------------------------------------------

def print_summary(result: Result, rows_text: str) -> None:
    m = result.manifest
    cov = m["coverage"]
    print(f"positions {m['counts']['positions']} of {m['selection']['decisions']} decisions "
          f"(capped {m['selection']['capped']}); by step {m['counts']['by_step']}; "
          f"index {len(rows_text.encode('utf-8')) / 1e6:.2f} MB")
    print(f"Demo cards visible {cov['visible']}/{cov['demo_cards']}; never visible {cov['never_visible']}")
    print(f"never offered {cov['never_offered']}\nnever in play {cov['never_in_play']}\n"
          f"in play but never ready {cov['never_ready_in_play']}\nin play but never spent "
          f"{cov['never_spent_in_play']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=None,
                        help=f"index jsonl (default: {INDEX_PATH.relative_to(REPO_ROOT)}, or "
                             f"{EVAL_INDEX_PATH.relative_to(REPO_ROOT)} with --eval)")
    parser.add_argument("--eval", action="store_true",
                        help=f"build the held-out eval positions on seed prefix {EVAL_PREFIX} (never cached)")
    parser.add_argument("--seeds", type=int, default=DEFAULT_SEEDS, help="number of seeds (default %(default)s)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="engine worker processes")
    parser.add_argument("--check", action="store_true", help="regenerate in memory and compare with --out")
    parser.add_argument("--force", action="store_true", help="allow writing an index less than half the current size")
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR, help="local state cache (default: %(default)s)")
    parser.add_argument("--no-cache", action="store_true", help="do not write the local state cache")
    parser.add_argument("--node", default="node")
    args = parser.parse_args(argv)
    if args.seeds < 1 or args.workers < 1:
        parser.error("--seeds and --workers must be positive")
    prefix = EVAL_PREFIX if args.eval else SEED_PREFIX
    if args.out is None:
        args.out = EVAL_INDEX_PATH if args.eval else INDEX_PATH
    if args.eval:
        args.no_cache = True  # the cache serves load_position for catalog rows only
    setup = load_default_setup(REPO_ROOT, node=args.node)
    seeds = seeds_for(args.seeds, prefix)
    try:
        result = build(setup, collect(setup, seeds, args.workers, args.node), seeds, prefix=prefix,
                       index_name=args.out.name)
    except PositionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    rows_text, manifest_text = output_texts(result)
    print_summary(result, rows_text)
    if args.check:
        stale = [p.name for p, text in ((args.out, rows_text), (manifest_path(args.out), manifest_text))
                 if not p.exists() or p.read_text(encoding="utf-8") != text]
        print("up to date" if not stale else f"differs: {', '.join(stale)}")
        return 1 if stale else 0
    write_outputs(args.out, result, force=args.force)
    if not args.no_cache:
        for row in result.rows:
            write_cache(row, result.states[row["position_id"]], args.cache_dir)
    print(f"Wrote {args.out} and {manifest_path(args.out).name}"
          + ("" if args.no_cache else f"; cached {len(result.rows)} states in {args.cache_dir}"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
