#!/usr/bin/env python3
"""Tests for the shared engine position helpers and the engine oracle's position catalog.

Why: the catalog (``scripts/build_oracle_positions.py``) will let the assistant answer
"can I do X here?" from the engine, so every fact in it must be what the engine and
the acting seat's observation say, and nothing a seat cannot see. The tests ask the
engine again rather than trusting the index: sampled positions are replayed and
their offered actions and attack targets compared with a fresh listing and a fresh
copy-state query; ``load_position`` must refuse a tampered state or another engine
(``stale_positions``); ``--check`` regenerates the committed index byte for byte.
Moving the helpers out of ``build_engine_tf_items.py`` must not change one byte of
``engine-positions-v1``, so its ``--check`` runs here too. Needs node and installed
npm dependencies; no model, no network.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import io
import json
import re
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import build_engine_tf_items as ep  # noqa: E402
import build_oracle_positions as op  # noqa: E402
from games.cyberpunk import engine_positions as positions  # noqa: E402
from games.cyberpunk.engine_adapter import EngineWorker  # noqa: E402
from games.cyberpunk.local_match import load_default_setup  # noqa: E402
from harness.core.io import read_jsonl  # noqa: E402

CTX: dict = {}
SMALL_SEEDS = [f"{op.SEED_PREFIX}-0", f"{op.SEED_PREFIX}-1"]


def setup():
    if "setup" not in CTX:
        CTX["setup"] = load_default_setup(REPO_ROOT)
    return CTX["setup"]


def committed() -> list[dict]:
    if "rows" not in CTX:
        CTX["rows"] = read_jsonl(op.INDEX_PATH, missing_ok=False)
    return CTX["rows"]


def small_pairs():
    if "pairs" not in CTX:
        CTX["pairs"] = op.collect(setup(), SMALL_SEEDS, workers=2)
    return CTX["pairs"]


def sample() -> list[dict]:
    """Early positions of seed 0 (short replays): main ones with an attack offered, and a react one."""
    rows = [r for r in committed() if r["seed"] == SMALL_SEEDS[0]]
    attacks = [r for r in rows if any(o["kind"] == "DECLARE_ATTACK" for o in r["offered"])]
    with_card_targets = [r for r in attacks if any(t["kind"] == "CARD" for o in r["offered"]
                                                   for t in o.get("attack_targets", []))]
    react = [r for r in rows if r["step"] == "react"]
    picked = {r["position_id"]: r for r in [rows[0], attacks[0], with_card_targets[0], react[0]]}
    return sorted(picked.values(), key=lambda r: r["decision_index"])


def _stale(fn) -> str:
    try:
        fn()
    except op.StalePositions as exc:
        assert str(exc).startswith("stale_positions:"), exc
        return str(exc)
    raise AssertionError("a stale position was accepted")


# The helpers refactor -------------------------------------------------------------------------

def test_engine_tf_items_are_byte_identical_after_the_move():
    assert ep.play_seed is positions.play_seed and ep.check_public is positions.check_public
    assert ep.GenerationError is positions.PositionError and ep.attack_targets is positions.attack_targets
    with contextlib.redirect_stdout(io.StringIO()) as out:
        code = ep.main(["--check"])
    assert code == 0 and "up to date" in out.getvalue(), out.getvalue()[-500:]


# The catalog builder --------------------------------------------------------------------------

def test_a_small_real_run_is_deterministic_and_matches_the_committed_rows():
    first = op.build(setup(), small_pairs(), SMALL_SEEDS)
    again = op.build(setup(), op.collect(setup(), SMALL_SEEDS, workers=1), SMALL_SEEDS)
    assert op.output_texts(first) == op.output_texts(again)
    fresh = {r["position_id"]: r for r, _ in small_pairs()}
    mine = [r for r in committed() if r["seed"] in SMALL_SEEDS]
    assert mine and all(fresh[r["position_id"]] == r for r in mine)
    assert {r["step"] for r in mine} == {"main", "react"}


def test_committed_index_is_what_the_code_builds():
    with contextlib.redirect_stdout(io.StringIO()) as out:
        code = op.main(["--check"])
    assert code == 0 and "up to date" in out.getvalue(), out.getvalue()[-500:]


def test_committed_index_is_small_public_and_covers_the_demo_cards():
    rows = committed()
    assert op.INDEX_PATH.stat().st_size < 5_000_000
    engine = op.engine_identity(setup())
    assert rows and all(r["engine"] == engine for r in rows)
    manifest = json.loads(op.manifest_path(op.INDEX_PATH).read_text(encoding="utf-8"))
    assert manifest["counts"]["positions"] == len(rows) and manifest["engine"] == engine
    cards = positions.card_data(setup().content)
    assert manifest["coverage"]["demo_cards"] == len(cards) == 29
    assert set(manifest["coverage"]["by_card"]) == set(cards)
    assert manifest["coverage"]["never_visible"] == []
    for r in rows:
        assert r["step"] in ("main", "react")
        known = {c["public_id"]: c["slug"] for c in r["facts"]["cards"]}
        for o in r["offered"]:
            if o["source_kind"] == "CARD":
                assert known[o["source_public_id"]] == o["source_slug"]
            for t in o.get("attack_targets", []):
                assert t["kind"] != "CARD" or known[t["public_id"]] == t["slug"]
        assert all(c["state"] is None or c["area"] in ("battlefield", "legends", "eddies") for c in r["facts"]["cards"])


def test_cap_keeps_the_lowest_ids_per_card_set_and_step():
    def row(pid, step, slug="minotaur"):
        return {"position_id": pid, "step": step, "facts": {"cards": [
            {"slug": slug, "side": "friendly", "area": "battlefield", "state": "ready"}]}}
    rows = [row("pos-3", "main"), row("pos-1", "main"), row("pos-2", "main"), row("pos-0", "react"),
            row("pos-4", "main", "corpo-security")]
    kept, capped = op.cap_positions(rows, cap=2)
    assert [r["position_id"] for r in kept] == ["pos-1", "pos-2", "pos-0", "pos-4"] and capped == 1
    assert {r["position_id"] for r in op.cap_positions(list(reversed(rows)), cap=2)[0]} == \
        {r["position_id"] for r in kept}


# Replaying positions --------------------------------------------------------------------------

def test_load_position_round_trips_through_the_cache_and_fails_closed():
    rows = sample()
    index = {r["position_id"]: r for r in committed()}
    a, b = rows[0], rows[1]
    with tempfile.TemporaryDirectory() as tmp, EngineWorker(REPO_ROOT) as worker:
        cache = Path(tmp)
        load = lambda pid, **kw: op.load_position(pid, worker=worker, setup=setup(), index=kw.pop("index", index),  # noqa: E731
                                                  cache_dir=kw.pop("cache_dir", cache))
        assert not op.cache_path(a["position_id"], cache).exists()
        state = load(a["position_id"])                     # a miss: replays the seed
        assert op.cache_path(a["position_id"], cache).exists()
        actor = state["timing"]["actingPlayer"]
        assert worker.hashes(content=setup().content, state=state, actor_id=actor)["stateHash"] == a["state_hash"]
        assert load(a["position_id"]) == state             # a hit: the cached state
        good = op.cache_path(a["position_id"], cache).read_text(encoding="utf-8")

        def write(value):
            op.cache_path(a["position_id"], cache).write_text(json.dumps(value), encoding="utf-8")

        tampered = json.loads(good)
        card = next(iter(tampered["state"]["objects"]["cards"].values()))
        card["readiness"] = "SPENT" if card["readiness"] == "READY" else "READY"
        write(tampered)
        _stale(lambda: load(a["position_id"]))
        other = json.loads(good)                           # another position's state under this id
        other["state"] = load(b["position_id"])
        write(other)
        _stale(lambda: load(a["position_id"]))
        wrong = json.loads(good)
        wrong["engine"] = {**wrong["engine"], "artifactHash": "0" * 64}
        write(wrong)
        _stale(lambda: load(a["position_id"]))
        op.cache_path(a["position_id"], cache).write_text(good, encoding="utf-8")
        assert load(a["position_id"]) == state
        moved = {a["position_id"]: {**a, "engine": {**a["engine"], "version": "0.0.0-other"}}}
        _stale(lambda: load(a["position_id"], index=moved))
        bad_hash = {a["position_id"]: {**a, "state_hash": "f" * 64}}
        with tempfile.TemporaryDirectory() as empty:       # a replay that reaches another hash
            _stale(lambda: load(a["position_id"], index=bad_hash, cache_dir=Path(empty)))
        try:
            load("pos-0000000000000000")
        except op.NoPosition as exc:
            assert str(exc).startswith("no_position:")
        else:
            raise AssertionError("an unknown position id was accepted")


def test_offered_descriptors_and_attack_targets_match_the_engine():
    rows = sample()
    with tempfile.TemporaryDirectory() as tmp, EngineWorker(REPO_ROOT) as worker:
        content = setup().content
        checked_targets = 0
        for r in rows:
            state = op.load_position(r["position_id"], worker=worker, setup=setup(), cache_dir=Path(tmp))
            actor = state["timing"]["actingPlayer"]
            model_input = worker.model_input(content=content, state=state, actor_id=actor)
            obs, actions = model_input["observation"], model_input["legalActions"]
            assert obs["viewerSeat"] == r["acting_seat"] and positions.decision_kind(obs) == r["step"]
            content_of = {c["publicId"]: c["content"]["cardId"] for p in obs["players"] for c in p["cards"]
                          if "content" in c}
            assert [(a["descriptor"]["kind"], a["descriptor"].get("label"), a["actionId"]) for a in actions] == \
                [(o["kind"], o["label"], o["action_id"]) for o in r["offered"]]
            for a, o in zip(actions, r["offered"]):
                source = a["descriptor"].get("source") or {}
                assert o["source_public_id"] == source.get("publicId")
                if source.get("kind") == "CARD":
                    assert o["source_slug"] == content_of[source["publicId"]]
                if o["kind"] == "DECLARE_ATTACK":
                    fresh = positions.attack_targets(worker, content, state, actor, a["actionId"])
                    assert fresh == [t["public_id"] for t in o["attack_targets"] if t["kind"] == "CARD"]
                    assert [content_of[p] for p in fresh] == [t["slug"] for t in o["attack_targets"]
                                                              if t["kind"] == "CARD"]
                    checked_targets += len(fresh)
            for c in r["facts"]["cards"]:
                assert content_of[c["public_id"]] == c["slug"]
        assert checked_targets >= 1


# Hidden information ---------------------------------------------------------------------------

def test_no_hidden_card_reaches_the_index():
    r = sample()[0]
    cards = positions.card_data(setup().content)
    with tempfile.TemporaryDirectory() as tmp, EngineWorker(REPO_ROOT) as worker:
        state = op.load_position(r["position_id"], worker=worker, setup=setup(), cache_dir=Path(tmp))
        model_input = worker.model_input(content=setup().content, state=state,
                                         actor_id=state["timing"]["actingPlayer"])
    obs, actions = model_input["observation"], model_input["legalActions"]
    visible = {s.split("@")[0] for s in positions.visible_slugs(obs, actions)}
    # The full state knows every card, including the rival's hand and both decks; the seat does not.
    hidden = {c["cardId"] for c in state["objects"]["cards"].values()} - visible
    assert hidden
    text = json.dumps(r)
    assert not set(op.row_slugs(r)) & hidden and not [s for s in hidden if f'"{s}"' in text]
    op.check_row_public(r, obs, actions, cards)
    # Fixtures: a fact about a hidden card, an attack target that is one, and a label naming one all fail.
    slug = sorted(hidden)[0]
    leaked_fact = copy.deepcopy(r)
    leaked_fact["facts"]["cards"].append({**leaked_fact["facts"]["cards"][0], "slug": slug, "public_id": "p9-c99"})
    leaked_target = copy.deepcopy(r)
    leaked_target["offered"].append({"kind": "DECLARE_ATTACK", "source_slug": None, "label": "Attack",
                                     "attack_targets": [{"kind": "CARD", "public_id": "p9-c99", "slug": slug}]})
    leaked_label = copy.deepcopy(r)
    leaked_label["offered"][0]["label"] = f"Play {cards[slug].name}"
    for fixture in (leaked_fact, leaked_target, leaked_label):
        try:
            op.check_row_public(fixture, obs, actions, cards)
        except positions.PositionError:
            continue
        raise AssertionError("a row naming a hidden card passed the check")
    # A source the observation does not show is refused when the row is built, not mapped by guesswork.
    try:
        op.offered_rows([{"actionId": "x", "descriptor": {"kind": "PLAY_CARD", "label": "Play",
                                                          "source": {"kind": "CARD", "publicId": "p9-c99"}}}],
                        positions.slugs_by_public_id(obs), {})
    except positions.PositionError:
        pass
    else:
        raise AssertionError("an unseen source publicId was mapped")


# Ids and seeds --------------------------------------------------------------------------------

def test_position_ids_are_stable_and_unique():
    assert op.position_id({"version": "v", "artifactHash": "a"}, "s", 0) == "pos-ba4441dda86c78b6"
    rows = committed()
    ids = [r["position_id"] for r in rows]
    assert len(set(ids)) == len(ids)
    for r in rows:
        assert re.fullmatch(r"pos-[0-9a-f]{16}", r["position_id"])
        assert r["position_id"] == op.position_id(r["engine"], r["seed"], r["decision_index"])
    other_engine = {**rows[0]["engine"], "artifactHash": "0" * 64}
    assert op.position_id(other_engine, rows[0]["seed"], rows[0]["decision_index"]) != rows[0]["position_id"]


def test_seed_prefixes_are_disjoint():
    prefixes = [op.SEED_PREFIX, *op.RESERVED_PREFIXES]
    assert ep.SEED_PREFIX in op.RESERVED_PREFIXES and "engine-oracle-eval-v1" in op.RESERVED_PREFIXES
    for i, a in enumerate(prefixes):
        for b in prefixes[i + 1:]:
            assert op.prefixes_disjoint(a, b), (a, b)
            assert not set(op.seeds_for(200, a)) & set(op.seeds_for(200, b))
    assert not op.prefixes_disjoint("engine-x", "engine-x")
    assert not op.prefixes_disjoint("engine-x", "engine-x-1")
    seeds = {r["seed"] for r in committed()}
    assert seeds <= set(op.seeds_for(op.DEFAULT_SEEDS))
    assert not [s for s in seeds for p in op.RESERVED_PREFIXES if s.startswith(f"{p}-")]


def run() -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
        print(f"OK  {test.__name__}", flush=True)
    print(f"PASS engine positions: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    run()


if __name__ == "__main__":
    main()
