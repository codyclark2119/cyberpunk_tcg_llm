#!/usr/bin/env python3
"""Tests for the engine-verified legality items (scripts/build_engine_tf_items.py).

Why: these items teach the 8B assistant what is legal in a position, and their
labels are only worth anything because the engine decided them. So the tests
re-ask the engine: a real small run on the engine worker is deterministic and
every label it produces matches the engine's offered actions; a sample of the
committed items is replayed from its seed to the recorded state hash and checked
again; ``--check`` regenerates the committed file byte for byte. The rest call
the code on fixtures: the consistency audit drops a signature with both labels,
a text that names a card the seat cannot see fails the build, a missing rule id
fails closed, balance, caps and dedupe hold, the dataset builder accepts the
kind strictly and its leak guard applies, and rules-tf-v1 is unchanged. Needs
node and installed npm dependencies; no model, no network.
"""

from __future__ import annotations

import argparse
import collections
import contextlib
import copy
import io
import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import build_engine_tf_items as ep  # noqa: E402
import build_tf_dataset as tf  # noqa: E402
from games.cyberpunk.engine_adapter import EngineWorker  # noqa: E402
from games.cyberpunk.local_match import load_default_setup  # noqa: E402
from harness.core.io import read_jsonl, write_jsonl_atomic  # noqa: E402

CTX: dict = {}
SMALL_SEEDS = ["engine-tf-test-0", "engine-tf-test-1"]


def setup():
    if "setup" not in CTX:
        CTX["setup"] = load_default_setup(REPO_ROOT)
    return CTX["setup"]


def small_positions():
    if "positions" not in CTX:
        CTX["positions"] = ep.collect_positions(setup(), SMALL_SEEDS, workers=2)
    return CTX["positions"]


def committed() -> list[dict]:
    return read_jsonl(ep.OUT_PATH, missing_ok=False)


def fake_candidate(cls: str, facts: dict, label: bool, reason, pid: str = "p0-c1") -> ep.Candidate:
    position = ep.Position("fixture-0", 1, "0" * 64, {}, [], 0)
    return ep.Candidate(cls, {"step": "main", **facts}, label, reason, "minotaur", ["minotaur"], "s", "q?", "c.",
                        "d.", {"action": "DECLARE_ATTACK", "public_ids": [pid]}, position)


# Labels come from the engine ------------------------------------------------------------------

def _engine_says(position: ep.Position, check: dict) -> bool:
    """Independent of ``candidates``: is the checked action among the engine's offers for this position?"""
    if check["action"] == "ATTACK_TARGET":
        return check["target"] in position.probes.get(check["attacker"], [])
    return any(a["descriptor"]["kind"] == check["action"]
               and (a["descriptor"].get("source") or {}).get("publicId") in check["public_ids"]
               for a in position.actions)


def test_every_candidate_label_is_the_engines_answer():
    cards = ep.card_data(setup().content)
    seen = collections.Counter()
    for position in small_positions():
        for c in ep.candidates(position, cards, collections.Counter()):
            assert c.label == _engine_says(position, c.engine_check), (c.question_class, c.scenario)
            seen[(c.question_class, c.label)] += 1
    for cls in ("attack-declare", "attack-target", "play-from-hand", "sell"):
        assert seen[(cls, True)] and seen[(cls, False)], (cls, seen)


def test_a_small_real_run_is_deterministic():
    first = ep.output_texts(ep.build(setup(), small_positions(), SMALL_SEEDS))
    again = ep.output_texts(ep.build(setup(), ep.collect_positions(setup(), SMALL_SEEDS, workers=1), SMALL_SEEDS))
    assert first == again
    rows = [json.loads(line) for line in first[0].splitlines()]
    assert rows and {r["kind"] for r in rows} == {tf.ENGINE_KIND}
    assert all(r["provenance"]["seed"] in SMALL_SEEDS for r in rows)
    assert all(r["provenance"]["engine"] == dict(setup().engine) for r in rows)
    assert {d for r in rows for d in r["provenance"]["decks"]} == {"ARASAKA_DEMO_V1", "MERC_DEMO_V1"}


def test_committed_file_is_what_the_code_builds():
    with contextlib.redirect_stdout(io.StringIO()) as out:
        code = ep.main(["--check"])
    assert code == 0 and "up to date" in out.getvalue(), out.getvalue()[-500:]


def test_committed_sample_replays_to_the_recorded_hash_and_labels():
    """One Yes and one No item per class (the earliest decision, so the replays stay short)."""
    sample = {}
    for row in sorted(committed(), key=lambda r: (r["provenance"]["decision_index"], r["id"])):
        sample.setdefault((row["question_class"], row["label"]), row)
    assert len(sample) == 2 * len(ep.CLASSES)
    with EngineWorker(REPO_ROOT) as worker:
        problems = ep.verify_items(worker, setup(), list(sample.values()))
        assert problems == [], problems
        flipped = copy.deepcopy(next(iter(sample.values())))
        flipped["label"] = not flipped["label"]
        assert ep.verify_items(worker, setup(), [flipped])  # a wrong label is caught
        moved = copy.deepcopy(next(iter(sample.values())))
        moved["provenance"]["state_hash"] = "f" * 64
        assert ep.verify_items(worker, setup(), [moved])  # a wrong position is caught


# The audit ------------------------------------------------------------------------------------

def test_audit_drops_every_item_of_a_conflicting_signature():
    facts = {"ready": True, "lagging": False}
    cands = [fake_candidate("attack-declare", facts, True, None, "p0-c1"),
             fake_candidate("attack-declare", facts, True, None, "p0-c2"),
             fake_candidate("attack-declare", facts, False, None, "p0-c3"),  # same description, other label
             fake_candidate("attack-declare", {"ready": False, "lagging": False}, False, "spent", "p0-c4")]
    kept, report = ep.audit(cands)
    assert [c.engine_check["public_ids"] for c in kept] == [["p0-c4"]]
    assert report["attack-declare"] == {"candidates": 4, "signatures": 2, "conflicting_signatures": 1,
                                        "dropped": 3, "dropped_share": 0.75}
    # Card identity is not part of the signature: the same facts about another card collide.
    other = fake_candidate("attack-declare", facts, False, None, "p1-c9")
    other.subject, other.cards = "delamain-cab", ["delamain-cab"]
    assert other.signature() == cands[0].signature()


def test_unexplained_and_mismatched_items_are_never_kept():
    positions = small_positions()
    result = ep.build(setup(), positions, SMALL_SEEDS)
    for row in result.rows:
        assert (row["no_reason"] is None) == row["label"]
        key = (row["question_class"], row["no_reason"] or ("yes-react" if row["provenance"]["step"] != "MAIN"
                                                             and row["question_class"] == "play-from-hand" else "yes"))
        assert row["source_rule_ids"] == list(ep.RULE_IDS[key])


# Rules ----------------------------------------------------------------------------------------

def test_rule_ids_exist_and_a_missing_id_fails_closed():
    known = ep.known_rule_ids()
    ep.check_rule_ids(known)
    for row in committed():
        assert row["source_rule_ids"] and set(row["source_rule_ids"]) <= known
    try:
        ep.check_rule_ids(known, {("attack-declare", "spent"): ("9.3.1", "99.99.99")})
    except ep.GenerationError as exc:
        assert "99.99.99" in str(exc)
    else:
        raise AssertionError("a missing rule id was accepted")
    try:
        ep.build(setup(), [], [], known_rules=known - {"9.3.1.1"})
    except ep.GenerationError:
        pass
    else:
        raise AssertionError("a build without a cited rule went ahead")


# Hidden information ---------------------------------------------------------------------------

def test_no_hidden_card_reaches_a_text():
    cards = ep.card_data(setup().content)
    position = next(p for p in small_positions() if ep.decision_kind(p.observation) == "main")
    obs = position.observation
    rival = next(p for p in obs["players"] if p["seat"] != obs["viewerSeat"])
    hidden = [c for c in rival["cards"] if c["zone"] in ("HAND", "DECK") or c["face"] == "DOWN"]
    assert hidden and all("content" not in c for c in hidden)  # the engine never shows them
    visible = {s.split("@")[0] for s in ep.visible_slugs(obs, position.actions)}
    unseen = sorted(s for s in cards if s not in visible)
    assert unseen
    # A fixture text naming a card the seat cannot see, and a fixture ``cards`` list holding one, both fail.
    for text, named in ((f"The rival holds {cards[unseen[0]].name}.", []), ("Nothing named.", [unseen[0]])):
        try:
            ep.check_public(text, named, obs, position.actions, cards)
        except ep.GenerationError:
            continue
        raise AssertionError(f"{text!r} / {named} passed the hidden-card check")
    # Every real candidate passes it, and names only cards its seat sees.
    for c in ep.candidates(position, cards, collections.Counter()):
        ep.check_public(f"{c.scenario} {c.question} {c.claim} {c.deciding_fact}", c.cards, obs, position.actions,
                        cards)
        assert set(c.cards) <= visible


# Selection ------------------------------------------------------------------------------------

def _row(n: int, cls: str, label: bool, card: str, text: str | None = None) -> dict:
    return {"id": f"ep-{n:04d}", "question_class": cls, "label": label, "cards": [card],
            "statement": text or f"Statement {n}."}


def test_balance_dedupes_caps_and_equalises_each_class():
    rows = [_row(n, "sell", True, "floor-it") for n in range(20)]           # one card, many Yes
    rows += [_row(100 + n, "sell", False, f"card-{n % 3}") for n in range(9)]
    rows += [_row(200, "sell", False, "card-0", "Statement 100.")]           # a duplicate text
    rows += [_row(300 + n, "block", True, "corpo-security") for n in range(3)]
    kept, drops = ep.balance(rows, cap=4, per_class=100)
    assert drops["duplicate-text"] == 1
    assert len({r["statement"] for r in kept}) == len(kept)
    per_key = collections.Counter((r["question_class"], r["label"], r["cards"][-1]) for r in kept)
    assert max(per_key.values()) <= 4
    for cls in ("sell", "block"):
        labels = [r["label"] for r in kept if r["question_class"] == cls]
        assert labels.count(True) == labels.count(False)
    assert not [r for r in kept if r["question_class"] == "block"]  # Yes only: nothing to pair it with
    assert ep.balance(list(reversed(rows)), cap=4, per_class=100) == (kept, drops)  # order does not matter


def test_committed_items_are_balanced_capped_spread_and_natural():
    rows = committed()
    assert 600 <= len(rows) <= 1000
    labels = [r["label"] for r in rows]
    assert labels.count(True) == labels.count(False)
    for cls in ep.CLASSES:
        mine = [r["label"] for r in rows if r["question_class"] == cls]
        assert mine and mine.count(True) == mine.count(False), cls
    per_key = collections.Counter((r["question_class"], r["label"], r["cards"][-1]) for r in rows)
    assert max(per_key.values()) <= ep.CAP_PER_KEY
    assert len({r["statement"] for r in rows}) == len(rows) and len({r["id"] for r in rows}) == len(rows)
    assert {r["provenance"]["seat"] for r in rows} == {0, 1}
    assert len({r["provenance"]["seed"] for r in rows}) >= ep.DEFAULT_SEEDS // 2
    assert len({r["provenance"]["turn"] for r in rows}) >= 5
    phrasing = collections.Counter(r["phrasing"] for r in rows)
    assert 0.4 <= phrasing["question"] / len(rows) <= 0.6
    for r in rows:
        assert tf.negation_count(r["statement"]) <= 1, r["statement"]
        assert "not true that" not in r["statement"].lower()
        assert r["statement"].endswith("?") == (r["phrasing"] == "question")
    manifest = json.loads(ep.manifest_path(ep.OUT_PATH).read_text(encoding="utf-8"))
    assert manifest["counts"]["items"] == len(rows) and manifest["engine"] == dict(setup().engine)
    assert set(manifest["audit"]["by_class"]) == set(ep.CLASSES)


def test_generator_leak_guard_drops_near_gold_items():
    result = ep.build(setup(), small_positions(), SMALL_SEEDS)
    victim = result.rows[0]["statement"]
    with tempfile.TemporaryDirectory() as tmp:
        write_jsonl_atomic(Path(tmp) / "fake.jsonl", [{"id": "g1", "question": victim, "choices": []}])
        guarded = ep.build(setup(), small_positions(), SMALL_SEEDS, gold_dir=Path(tmp))
    assert guarded.manifest["leak_guard"]["dropped"] >= 1
    assert victim not in {r["statement"] for r in guarded.rows}
    assert guarded.manifest["leak_guard"]["nearest"] and guarded.leak.ok


# The dataset builder --------------------------------------------------------------------------

def _pair() -> list[dict]:
    """A committed Yes and No sell item (their cited rules are in the preload)."""
    rows = [r for r in committed() if r["question_class"] == "sell"]
    return [next(r for r in rows if r["label"]), next(r for r in rows if not r["label"])]


def _scenario_file(tmp: str, rows: list[dict]) -> Path:
    path = Path(tmp) / "engine.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return path


def test_dataset_builder_checks_engine_rows_strictly():
    known, cards = {r["id"] for r in tf.numbered_rules(tf.load_sources())}, tf.known_card_slugs()
    yes, no = _pair()
    bad = {
        "missing cards": [{k: v for k, v in yes.items() if k != "cards"}, no],
        "unknown card": [{**yes, "cards": ["not-a-card"]}, no],
        "unknown rule": [{**yes, "source_rule_ids": ["99.99"]}, no],
        "yes with a reason": [{**yes, "no_reason": "spent"}, no],
        "no without a reason": [yes, {**no, "no_reason": None}],
        "unknown class": [{**yes, "question_class": "teleport"}, no],
        "bad state hash": [{**yes, "provenance": {**yes["provenance"], "state_hash": "abc"}}, no],
        "extra provenance": [{**yes, "provenance": {**yes["provenance"], "note": 1}}, no],
        "unknown check": [{**yes, "engine_check": {"action": "TELEPORT"}}, no],
        "unbalanced": [yes, {**no, "label": True, "no_reason": None}],
        "extra field": [{**yes, "note": "x"}, no],
    }
    with tempfile.TemporaryDirectory() as tmp:
        for name, rows in bad.items():
            try:
                tf.load_scenarios(_scenario_file(tmp, rows), known, cards)
            except tf.BuildError:
                continue
            raise AssertionError(f"{name} was accepted")
        assert len(tf.load_scenarios(_scenario_file(tmp, [yes, no]), known, cards)) == 2
        assert len(tf.load_scenarios(_scenario_file(tmp, committed()), known, cards)) == len(committed())


def test_dataset_builder_runs_engine_rows_through_prompt_preload_split_and_guard():
    rows = _pair()
    result = tf.build(tf.load_sources(), scenarios=copy.deepcopy(rows))
    built = [r for split in result.rows.values() for r in split if r["kind"] == tf.ENGINE_KIND]
    assert sorted(r["id"] for r in built) == sorted(r["id"] for r in rows)
    for row, source in zip(sorted(built, key=lambda r: r["id"]), sorted(rows, key=lambda r: r["id"])):
        assert row in result.rows[tf.split_of(source["source_rule_ids"][0])]
        assert row["cards"] == source["cards"] and row["question_class"] == source["question_class"]
        calls = [c["function"] for m in row["messages"] if m.get("tool_calls") for c in m["tool_calls"]]
        assert [c["arguments"]["slug"] for c in calls if c["name"] == "get_card"] == source["cards"]
        target = row["messages"][-1]["content"]
        for rid in source["source_rule_ids"]:
            assert tf.rule_quote({"id": rid, "text": next(r["text"] for r in tf.load_sources()
                                                          if r["id"] == rid)}) in target
        assert source["deciding_fact"] in target and target.endswith(f"Answer: {row['label']}")
        assert row["label"] == ("A" if source["label"] else "B")
    with tempfile.TemporaryDirectory() as tmp:
        write_jsonl_atomic(Path(tmp) / "fake.jsonl", [{"id": "g1", "question": rows[0]["statement"], "choices": []}])
        leaked = tf.build(tf.load_sources(), gold_dir=Path(tmp), scenarios=copy.deepcopy(rows))
    # The copied item trips the guard; its twin (same scenario frame) is then dropped or trimmed, so the kind
    # never goes out unbalanced.
    assert leaked.manifest["leak_guard"]["leak_dropped_scenarios"] >= 1
    assert tf.ENGINE_KIND not in leaked.manifest["counts"]["by_kind"]


def test_rules_tf_v1_is_byte_identical():
    with contextlib.redirect_stdout(io.StringIO()) as out:
        code = tf.main(["--check"])
    assert code == 0 and "up to date" in out.getvalue()


def run() -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
        print(f"OK  {test.__name__}", flush=True)
    print(f"PASS engine tf items: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    run()


if __name__ == "__main__":
    main()
