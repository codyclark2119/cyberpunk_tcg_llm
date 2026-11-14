#!/usr/bin/env python3
"""Tests for the rules-only true/false SFT set (scripts/build_tf_dataset.py).

Why: the set trains the 8B model's habits of judging a statement against a rule,
so every way it could teach the wrong thing must be pinned. A false twin that
is still true teaches a wrong rule; a label skew re-teaches the lean toward No;
a rule in both splits hides overfitting; a prompt that differs from the
scorer's trains a shape the model never sees; a target the scorer cannot parse
trains an answer it will not read; a negation that predicts the label, a
wrapper ("It is not true that") or a double negative teaches a shortcut or
unnatural English; EXAMPLE text or a gold question in the items
breaks "rules text only" and "never train on the eval set". Most tests call the
code on fixtures (a test over the committed files pins the data, not the code);
the committed files are then checked to be exactly what the code builds.
Everything runs on the committed snapshot: no model, no network.
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

import build_tf_dataset as tf  # noqa: E402
import eval_assistant  # noqa: E402
from games.cyberpunk.assistant.loop import split_thinking, system_prompt  # noqa: E402
from games.cyberpunk.assistant.preload import preload  # noqa: E402
from games.cyberpunk.assistant.tools import tool_specs  # noqa: E402
from harness.core.io import read_jsonl, write_jsonl_atomic  # noqa: E402

COMMITTED = tf.OUT_DIR
STRICT_ANSWER_RE = re.compile(r"\nAnswer: ([AB])\Z")
_CACHE: dict = {}


def subset_rows() -> list[dict]:
    """A slice of the real snapshot (game areas, attacks, mulligans, tournament play) for fixture builds."""
    rows = tf.load_sources()
    keep = re.compile(r"^(5\.|9\.|7\.9|TR 3\.4)")
    return [r for r in rows if keep.match(r["id"])]


def subset_build() -> tf.Build:
    if "subset" not in _CACHE:
        _CACHE["subset"] = tf.build(subset_rows())
    return _CACHE["subset"]


def committed_rows() -> list[dict]:
    if "committed" not in _CACHE:
        _CACHE["committed"] = (read_jsonl(COMMITTED / "train.jsonl", missing_ok=False)
                               + read_jsonl(COMMITTED / "valid.jsonl", missing_ok=False))
    return _CACHE["committed"]


def rule(rule_id: str, text: str) -> dict:
    return {"id": rule_id, "kind": "rule", "is_numbered": True, "section": "x", "title": "x", "text": text,
            "anchor": "a", "parent": None, "depth": 1, "refs": []}


# Mutations ------------------------------------------------------------------------------------

def _single_edit(source: str, mutation: tf.Mutation) -> None:
    """The twin is the source with exactly the one site changed, as the mutation says."""
    assert mutation.text != source
    assert source.count(mutation.old) >= 1
    assert mutation.text == source.replace(mutation.old, mutation.new, 1), (source, mutation)


def test_polarity_flips_the_one_modal():
    cases = {
        "Players may not look at their Rival's hand during a game.": ("may not", "may"),
        "Card sleeves must follow current regulations for the game format.": ("must", "do not have to"),
        "You can't look at or change the order of cards in your deck.": ("can't", "can"),
        "The trash is a public area of the game.": ("is", "is not"),
        "A persistent effect never becomes pending during a game.": ("never", "always"),
        "A Unit does not inherit Tags from its equipped Gear.": ("does not", "does"),
    }
    for source, (old, new) in cases.items():
        m = tf.mutate_polarity(source)
        assert isinstance(m, tf.Mutation) and m.kind == "polarity" and (m.old, m.new) == (old, new), (source, m)
        _single_edit(source, m)
    m = tf.mutate_polarity("A Unit must still meet the conditions to attack.")
    assert m.text == "A Unit does not have to meet the conditions to attack.", m  # never "need not still meet"
    assert tf.mutate_polarity("Bottom-decked cards should not be indistinguishable from the deck.") \
        == "polarity-negative-word"


def test_questions_invert_the_modal_naturally():
    cases = {
        "You cannot look at face-down cards in the Eddies area.":
            ("Can you look at face-down cards in the Eddies area?", False),
        "If an effect requires a target, you must choose a legal target.":
            ("If an effect requires a target, do you have to choose a legal target?", True),
        "A Unit must still meet the conditions to attack.": ("Does a Unit have to meet the conditions to attack?", True),
        "Players may not offer compensation for a draw.": ("May players offer compensation for a draw?", False),
        "The fixer area is a public area.": ("Is the fixer area a public area?", True),
        "Your deck is not a public area.": ("Is your deck a public area?", False),
        "A Unit does not inherit Tags from its equipped Gear.": ("Does a Unit inherit Tags from its equipped Gear?", False),
    }
    for source, expected in cases.items():
        assert tf.to_question(source) == expected, (source, tf.to_question(source))
    for source in ("It can attack during your turn.",                   # pronoun subject
                   "Side events may be casual or competition-level events.",  # "may be"
                   "Only ready Units can attack during the Main phase.",      # restricted subject
                   "A persistent effect never becomes pending."):              # no invertible site
        assert tf.to_question(source) is None, source


def test_number_moves_the_one_number():
    m = tf.mutate_number("Your turn consists of two (2) phases in order.", "salt")
    assert m.kind == "number" and m.old == "two (2)" and m.new == "three (3)"  # 2 - 1 would be singular
    _single_edit("Your turn consists of two (2) phases in order.", m)
    for salt in ("a", "b", "c", "d"):  # an upper bound only moves up, whatever the hash says
        up = tf.mutate_number("You may include up to 3 copies of a card in your deck.", salt)
        assert up.new == "4", up
    exact = {tf.mutate_number("You draw 6 cards from the top of your deck.", s).new for s in "abcdefgh"}
    assert exact == {"5", "7"}


def test_number_fires_only_with_exactly_one_number():
    assert tf.mutate_number("You draw 6 cards and gain 2 Eddies at the start.", "s") == "number-several"
    assert tf.mutate_number("A deck holds 3 Legends and 40-50 other cards.", "s") == "number-several"
    assert tf.mutate_number("You roll 1 die at the start of your turn.", "s") == "number-zero-or-one"
    assert tf.mutate_number("A legal deck has at least 40 main deck cards.", "s") == "number-lower-bound"
    assert tf.mutate_number("You cannot draw 2 cards during the Start phase.", "s") == "number-negated"
    assert tf.mutate_number("Players at Level 3 events must register online.", "s") == "number-label"
    assert tf.mutate_number("A Unit enters the field with Lag.", "s") is None


def test_state_and_side_swap_one_restrictive_word():
    m = tf.mutate_state("You may choose a ready Unit to attack with.")
    assert (m.old, m.new) == ("ready", "spent")
    _single_edit("You may choose a ready Unit to attack with.", m)
    assert tf.mutate_state("You cannot choose a ready Unit to attack with.") == "state-negated"
    assert tf.mutate_state("A ready Unit stands upright on the field.") == "state-not-restrictive"
    assert tf.mutate_state("Legends with a tag can be spent to pay costs.") == "state-verb"
    m = tf.mutate_side("You may choose a friendly Legend in your Legends area.")
    assert (m.old, m.new) == ("friendly", "rival")
    _single_edit("You may choose a friendly Legend in your Legends area.", m)
    assert tf.mutate_side("Your Rival may choose a friendly Legend to flip.") == "side-several"
    assert tf.mutate_side("Pieces are not considered friendly Gigs here.") in ("side-negated", "side-not-restrictive")


def test_quantifier_each_becomes_only_one():
    assert tf.mutate_quantifier("Only ready Units can attack during the Main phase.") is None  # no "Not only"
    m = tf.mutate_quantifier("Each player shuffles their deck before the game.")
    assert m.text == "Only one player shuffles their deck before the game."
    assert tf.mutate_quantifier("Each player can't shuffle their deck.") == "quantifier-extra-negation"


def test_ambiguous_sentences_are_skipped_with_a_reason():
    assert tf.mutate_polarity("You may draw a card, and you cannot discard a card.") == "polarity-several-sites"
    assert tf.mutate_polarity("You can only play cards from your hand.") == "polarity-extra-negation"
    assert tf.mutate_polarity("Side events may be casual or competition-level events.") == "polarity-may-be"
    assert tf.sentence_skip("It is considered empty for all effects.", "It is considered empty for all effects.") \
        == "context-pronoun"
    text = 'A Unit with the effect "Draw 1 and then discard 1 card" is a Unit.'
    assert tf.sentence_skip(text, text) == "quotation"
    # A condition is not the main clause: flipping its "can't" would not negate the rule.
    assert tf.mutate_polarity("When you can't pay, you discard the card.") is None
    skips: dict = {}
    pairs = tf.candidate_pairs([rule("1.1", "1.1. You may draw a card, and you cannot discard a card. "
                                            "It is considered empty for all effects. The attacking Unit wins the fight.")], skips)
    assert pairs == [] and skips == {"polarity-several-sites": 1, "context-pronoun": 1, "no-mutation-applies": 1}


def test_example_blocks_never_reach_an_item():
    body = tf.rule_body("9.9. You may choose a friendly Legend to flip.\n\n> **EXAMPLE:** You may draw 3 cards. "
                        "Players must shuffle.")
    assert "EXAMPLE" not in body and "draw 3" not in body
    pairs = tf.candidate_pairs([rule("9.9", "9.9. A Unit always loses ties.\n\n> **EXAMPLE:** You may draw 3 cards "
                                            "from your deck.")], {})
    assert [p.true_text for p in pairs] == ["A Unit always loses ties."]
    examples = set()
    for r in tf.numbered_rules(tf.load_sources()):
        quote = r["text"].split("\n>", 1)
        if len(quote) > 1:
            examples.update(tf.clean(s) for s in tf.raw_sentences(quote[1].replace(">", " ")) if len(s.split()) > 4)
    for row in committed_rows():
        statement = row["statement"]
        assert "example" not in statement.lower(), row["id"]
        for sentence in examples:
            assert sentence not in statement, (row["id"], sentence)


# Phrasing and balance -------------------------------------------------------------------------

def test_labels_are_exactly_balanced():
    for result in (subset_build(),):
        for split, rows in result.rows.items():
            labels = [r["label"] for r in rows]
            assert labels.count("A") == labels.count("B") and labels, split
        assert result.manifest["counts"]["by_label"]["A"] == result.manifest["counts"]["by_label"]["B"]
    rows = committed_rows()
    assert [r["label"] for r in rows].count("A") * 2 == len(rows)


def test_negation_does_not_predict_the_label():
    for rows in (subset_build().rows["train"] + subset_build().rows["valid"], committed_rows()):
        table = tf.negation_table(rows)
        for cell in ("negation", "no_negation"):
            assert table[cell]["A"] and table[cell]["B"], table
            assert 0.40 <= table[cell]["yes_share"] <= 0.60, table
    plain = [(f"1.{i}", [{"id": f"p{i}-yes", "label": "A", "statement": "You may draw a card."},
                         {"id": f"p{i}-no", "label": "B", "statement": "You may not draw a card."}]) for i in range(8)]
    neg = [(f"2.{i}", [{"id": f"q{i}-yes", "label": "A", "statement": "You cannot draw a card."},
                       {"id": f"q{i}-no", "label": "B", "statement": "You can draw a card."}]) for i in range(2)]
    kept, dropped = tf.balance_negation(plain + neg)
    table = tf.negation_table([r for _, g in kept for r in g])
    assert dropped == 6 and table["negation"]["yes_share"] == 0.5, (dropped, table)
    try:
        tf.balance_negation(plain)  # every pair the same shape: nothing can balance it
    except tf.BuildError:
        pass
    else:
        raise AssertionError("an all-positive set must fail closed")


def test_statements_are_natural_with_at_most_one_negation():
    wrapper = re.compile(r"not true that|is it true|not allowed for|forbidden|optional for|need not|not only", re.I)
    for row in committed_rows() + subset_build().rows["train"]:
        statement = row["statement"]
        assert not wrapper.search(statement), statement
        assert tf.negation_count(statement) <= 1, statement
        if row["phrasing"] == "question":
            assert statement.endswith("?") and statement.count("?") == 1, statement
        else:
            assert re.search(r"\.[\"\u201d]?\Z", statement) and "?" not in statement, statement
    assert tf.negation_count("You cannot not draw.") == 2
    skips: dict = {}
    assert tf.candidate_pairs([rule("3.1", "3.1. You cannot draw a card unless no effect is pending.")], skips) == []
    assert skips == {"two-negations": 1}, skips


def test_about_a_third_of_items_are_questions():
    rows = committed_rows()
    share = sum(r["phrasing"] == "question" for r in rows) / len(rows)
    assert 0.25 <= share <= 0.40, share
    assert {r["phrasing"] for r in rows} == {"statement", "question"}


def test_rules_about_the_document_are_excluded():
    rows = tf.load_sources()
    excluded = tf.document_rule_ids(rows)
    assert {"1.1", "1.2", "1.3"} <= excluded and not any(i.startswith(("2.", "5.", "TR")) for i in excluded), excluded
    skips: dict = {}
    pairs = tf.candidate_pairs([rule("1.4.1", "1.4.1. The Official Rules are written in second-person perspective."),
                                rule("2.5", "2.5. The trash is a public area of the game.")], skips)
    assert [p.rule_id for p in pairs] == ["2.5"] and skips == {"document-meta": 1}, (pairs, skips)
    used = {r["source_rule_ids"][0] for r in committed_rows()}
    assert not used & (excluded | {"1.4.1"}), used & excluded


def test_split_never_shares_a_rule():
    for rows in (subset_build().rows, {"all": committed_rows()}):
        flat = [r for split in rows.values() for r in split]
        splits: dict = {}
        for r in flat:
            for rid in r["source_rule_ids"]:
                splits.setdefault(rid, set()).add(tf.split_of(r["source_rule_ids"][0]))
        assert all(len(s) == 1 for s in splits.values())
    train = {r["source_rule_ids"][0] for r in read_jsonl(COMMITTED / "train.jsonl")}
    valid = {r["source_rule_ids"][0] for r in read_jsonl(COMMITTED / "valid.jsonl")}
    assert train and valid and not train & valid
    assert 0.05 < len(read_jsonl(COMMITTED / "valid.jsonl")) / len(committed_rows()) < 0.2


def test_build_is_deterministic_in_any_input_order():
    rows = subset_rows()
    again = tf.build(list(reversed(rows)))
    first = subset_build()
    assert tf.output_texts(again) == tf.output_texts(first)
    shuffled = rows[1::2] + rows[::2]
    assert tf.output_texts(tf.build(shuffled)) == tf.output_texts(first)


def test_committed_set_is_exactly_what_the_code_builds():
    with contextlib.redirect_stdout(io.StringIO()):
        code = tf.main(["--check"])
    assert code == 0, "data/datasets/rules-tf-v1 is stale: rerun scripts/build_tf_dataset.py"


def test_item_rows_record_their_provenance_not_the_rule_text():
    for row in committed_rows():
        assert row["kind"] == tf.TEMPLATE_KIND and row["mutation"] in tf.MUTATIONS and row["label"] in "AB"
        assert isinstance(row["source_rule_ids"], list) and len(row["source_rule_ids"]) == 1
        assert set(row) == {"id", "kind", "source_rule_ids", "mutation", "phrasing", "label", "answer", "statement",
                            "messages", "tools"}, sorted(row)


# Prompt shape and target ----------------------------------------------------------------------

def _check_prompt(row: dict) -> None:
    item = {"question": row["statement"], "choices": [{"letter": "A", "text": "Yes"}, {"letter": "B", "text": "No"}]}
    messages = row["messages"]
    assert messages[0] == {"role": "system", "content": system_prompt()}
    assert messages[1] == {"role": "user", "content": eval_assistant.question_message(item)}
    sent = [s for s in preload(eval_assistant.preload_text(item)) if s.sent]
    assert messages[2] == {"role": "assistant", "content": "", "tool_calls": [
        {"type": "function", "function": {"name": s.tool, "arguments": s.arguments}} for s in sent]}
    assert messages[3:-1] == [{"role": "tool", "content": s.content} for s in sent]
    assert messages[-1]["role"] == "assistant" and len(messages) == 4 + len(sent)
    assert row["tools"] == tool_specs()


def test_examples_use_the_real_system_prompt_preload_and_wrapper():
    for split in subset_build().rows.values():
        for row in split[:6]:
            _check_prompt(row)
    rows = committed_rows()
    for row in rows[:: max(1, len(rows) // 12)]:
        _check_prompt(row)
    assert "A. Yes\nB. No" in rows[0]["messages"][1]["content"]


def test_target_ends_with_a_strict_answer_line_the_scorer_reads_as_the_label():
    rows = committed_rows() + [r for split in subset_build().rows.values() for r in split]
    for row in rows:
        target = row["messages"][-1]["content"]
        thinking, visible = split_thinking(target)
        assert thinking and target.startswith("<think>\n") and "\n</think>\n\n" in target
        match = STRICT_ANSWER_RE.search(visible)
        assert match and match.group(1) == row["label"], row["id"]
        assert eval_assistant.parse_answer_letter(visible, ["A", "B"]) == (row["label"], "ok")
        rid = row["source_rule_ids"][0]
        assert tf.rule_ref(rid, capital=True) in visible  # cites the rule it quotes
        assert re.search(r"^Conclusion: .*$", visible, re.M)


# Leak guard -----------------------------------------------------------------------------------

def test_leak_guard_fires_on_a_copied_gold_question():
    gold_q, gold_all = tf.gold_texts()
    question = gold_q[0]["text"]
    report = tf.leak_guard([{"id": "copy", "statement": question, "target": ""},
                            {"id": "clean", "statement": "Zebras paint the moon on Tuesdays only.", "target": ""}],
                           gold_q, gold_all)
    assert [v["id"] for v in report.violations] == ["copy"] and not report.ok
    assert report.nearest[0]["id"] == "copy" and report.nearest[0]["ratio"] == 1.0
    # An 8-gram shared with a choice text, buried in a target, also trips it.
    choice = next(g["text"] for g in gold_all if len(tf.normalise(g["text"])) >= 8 and ":" in g["source"][-2:])
    tripped = tf.leak_guard([{"id": "t", "statement": "Unrelated words here.", "target": f"So: {choice}"}],
                            gold_q, gold_all)
    assert tripped.violations and tripped.violations[0]["shared_ngram"]


def test_real_dataset_passes_the_leak_guard():
    gold_q, gold_all = tf.gold_texts()
    rows = [{"id": r["id"], "statement": r["statement"], "target": r["messages"][-1]["content"]}
            for r in committed_rows()]
    report = tf.leak_guard(rows, gold_q, gold_all)
    assert report.ok, report.violations[:3]
    manifest = json.loads((COMMITTED / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["leak_guard"]["result"] == "pass" and len(manifest["leak_guard"]["nearest"]) == 5
    assert manifest["leak_guard"]["gold_files"] == sorted(p.name for p in tf.GOLD_DIR.glob("*.jsonl"))


def test_build_drops_whole_pairs_that_leak():
    """A pair where only the Yes item trips the guard still goes whole, so the labels stay 50/50."""
    rows = [r for split in subset_build().rows.values() for r in split]
    chosen = None
    for yes in (r for r in rows if r["label"] == "A"):
        same_rule = [r for r in rows if r["source_rule_ids"] == yes["source_rule_ids"]]
        if len(same_rule) != 2:  # one pair from this rule, so its other row is the twin
            continue
        twin = next(r for r in same_rule if r["label"] == "B")
        # Twins differ by one word, so a gold copy of either trips both; a gold question holding only an
        # 8-gram of the Yes statement that the twin lacks trips the Yes item alone.
        twin_grams = tf.ngrams(tf.normalise(twin["statement"] + " " + twin["messages"][-1]["content"]))
        own = sorted(tf.ngrams(tf.normalise(yes["statement"])) - twin_grams)
        if not own:
            continue
        gold = [{"source": "g1", "text": " ".join(own[0])}]
        alone = tf.leak_guard([{"id": twin["id"], "statement": twin["statement"],
                                "target": twin["messages"][-1]["content"]}], gold, gold)
        hit = tf.leak_guard([{"id": yes["id"], "statement": yes["statement"],
                              "target": yes["messages"][-1]["content"]}], gold, gold)
        if alone.ok and not hit.ok:
            chosen = (yes, twin, gold[0]["text"])
            break
    assert chosen, "no pair in the fixture where only one item trips"
    yes, twin, text = chosen
    with tempfile.TemporaryDirectory() as tmp:
        gold_dir = Path(tmp)
        write_jsonl_atomic(gold_dir / "fake.jsonl", [{"id": "g1", "question": text, "choices": []}])
        result = tf.build(subset_rows(), gold_dir=gold_dir)
    ids = {r["id"] for split in result.rows.values() for r in split}
    assert yes["id"] not in ids and twin["id"] not in ids
    assert result.manifest["leak_guard"]["leak_dropped"] >= 2
    labels = [r["label"] for split in result.rows.values() for r in split]
    assert labels.count("A") == labels.count("B")


# Scenario hook --------------------------------------------------------------------------------

SCENARIOS = [
    {"id": "sc-1", "statement": "You can't look at or change the order of cards in your deck during a game.",
     "label": True, "source_rule_ids": ["5.5.4"], "kind": "scenario-drafted"},
    {"id": "sc-2", "statement": "During a game you can look at the order of cards in your own deck.",
     "label": False, "source_rule_ids": ["5.5.4"], "kind": "scenario-drafted"},
]


def _scenario_file(tmp: str, rows: list[dict]) -> Path:
    path = Path(tmp) / "scenarios.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return path


def test_scenario_rows_are_checked_strictly():
    known = {r["id"] for r in tf.numbered_rules(tf.load_sources())}
    bad_cases = {
        "missing": [{k: v for k, v in SCENARIOS[0].items() if k != "label"}, SCENARIOS[1]],
        "extra": [{**SCENARIOS[0], "note": "x"}, SCENARIOS[1]],
        "unknown rule": [{**SCENARIOS[0], "source_rule_ids": ["99.99"]}, SCENARIOS[1]],
        "duplicate": [SCENARIOS[0], {**SCENARIOS[1], "id": "sc-1"}],
        "unbalanced": [SCENARIOS[0], {**SCENARIOS[1], "label": True}],
        "label type": [{**SCENARIOS[0], "label": "true"}, SCENARIOS[1]],
        "kind": [{**SCENARIOS[0], "kind": "rule-template"}, SCENARIOS[1]],
        "no rules": [{**SCENARIOS[0], "source_rule_ids": []}, SCENARIOS[1]],
    }
    with tempfile.TemporaryDirectory() as tmp:
        for name, rows in bad_cases.items():
            try:
                tf.load_scenarios(_scenario_file(tmp, rows), known)
            except tf.BuildError:
                continue
            raise AssertionError(f"{name} was accepted")
        assert len(tf.load_scenarios(_scenario_file(tmp, SCENARIOS), known)) == 2
        with contextlib.redirect_stderr(io.StringIO()) as err, contextlib.redirect_stdout(io.StringIO()):
            code = tf.main(["--scenarios", str(_scenario_file(tmp, bad_cases["unknown rule"])), "--out", tmp])
        assert code == 1 and "unknown rule id" in err.getvalue()
        assert not (Path(tmp) / "train.jsonl").exists()


def test_scenarios_share_the_prompt_guard_split_and_balance():
    result = tf.build(subset_rows(), scenarios=copy.deepcopy(SCENARIOS))
    rows = [r for split in result.rows.values() for r in split if r["kind"] == tf.SCENARIO_KIND]
    assert sorted(r["id"] for r in rows) == ["sc-1", "sc-2"]
    assert result.manifest["counts"]["by_kind"][tf.SCENARIO_KIND] == 2
    for row in rows:
        _check_prompt(row)
        assert row in result.rows[tf.split_of("5.5.4")]
        letter, _ = eval_assistant.parse_answer_letter(split_thinking(row["messages"][-1]["content"])[1], ["A", "B"])
        assert letter == row["label"] == ("A" if row["id"] == "sc-1" else "B")
    labels = [r["label"] for r in rows]
    assert labels.count("A") == labels.count("B")


def test_scenarios_that_leak_are_dropped_and_rebalanced():
    with tempfile.TemporaryDirectory() as tmp:
        gold = Path(tmp)
        write_jsonl_atomic(gold / "fake.jsonl", [{"id": "g1", "question": SCENARIOS[0]["statement"], "choices": []}])
        result = tf.build(subset_rows(), gold_dir=gold, scenarios=copy.deepcopy(SCENARIOS))
    kinds = result.manifest["counts"]["by_kind"]
    assert tf.SCENARIO_KIND not in kinds  # sc-1 leaked, so sc-2 was trimmed to keep the kind balanced
    assert result.manifest["scenario_skips"] == {"balance-trimmed": 1}
    assert result.manifest["leak_guard"]["leak_dropped_scenarios"] == 1


def test_writing_refuses_to_shrink_without_force():
    result = subset_build()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        write_jsonl_atomic(out / "train.jsonl", [{"x": i} for i in range(len(result.rows["train"]) * 3)])
        try:
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                tf.write_outputs(out, result)
        except SystemExit:
            pass
        else:
            raise AssertionError("a much smaller set was written over a larger one")
        tf.write_outputs(out, result, force=True)
        assert tf.stale_files(out, tf.output_texts(result)) == []


# rules-tf-v2: the combined set -----------------------------------------------------------------

V2_DIR = REPO_ROOT / "data/datasets" / tf.V2_DATASET
ENGINE_FILE = REPO_ROOT / "data/datasets/sources/engine-positions-v1.jsonl"
# sha256 of the committed rules-tf-v1 files: v2 work must never move a byte of v1.
V1_SHA256 = {
    "train.jsonl": "ecb2734e43b07cacdd407e20607474c222bee2e4b16a729fd80432f2263defc4",
    "valid.jsonl": "958dd5e02a28b69d2465357e1f2b7f15f9c82bde758f5233856653fd59399bfd",
    "manifest.json": "0f07f7fc7dfd44792b6cf90904c3104fdaa110eddf6a5408c9d8ade0261e3aa7",
}
V2_SCENARIOS = [
    {"id": "sc-hit-yes", "kind": "scenario-drafted", "label": True, "source_rule_ids": ["9.3.2.1"],
     "statement": "Your Rival has a sideways Unit on the field. Your Unit may go after it this turn.",
     "cards": [], "habit": "state", "why": "9.3.2.1: a spent rival Unit is a valid target.",
     "lookup_query": "which rival Units can be attacked"},
    {"id": "sc-hit-no", "kind": "scenario-drafted", "label": False, "source_rule_ids": ["9.3.2.1"],
     "statement": "Your Rival has an upright Unit on the field. Your Unit may go after it this turn.",
     "cards": [], "habit": "state", "why": "9.3.2.1: only a spent rival Unit is a valid target.",
     "lookup_query": "which rival Units can be attacked"},
    {"id": "sc-miss-yes", "kind": "scenario-drafted", "label": True, "source_rule_ids": ["9.3.1"],
     "statement": "Zebras paint the moon blue on Tuesdays only.", "cards": [], "habit": "state",
     "why": "WHY-MARKER-never-in-a-prompt", "lookup_query": "zebra moon paint"},
    {"id": "sc-miss-no", "kind": "scenario-drafted", "label": False, "source_rule_ids": ["9.3.1"],
     "statement": "Zebras paint the moon red on Tuesdays only.", "cards": [], "habit": "state",
     "why": "WHY-MARKER-never-in-a-prompt", "lookup_query": "zebra moon paint"},
    {"id": "sc-card-yes", "kind": "scenario-drafted", "label": True, "source_rule_ids": ["4.10.1"],
     "statement": "Mantis Blades can be equipped to a friendly face-up Legend.", "cards": ["mantis-blades"],
     "habit": "permissive", "why": "WHY-MARKER-never-in-a-prompt"},
    {"id": "sc-card-no", "kind": "scenario-drafted", "label": False, "source_rule_ids": ["4.10.1"],
     "statement": "Mantis Blades can only be equipped to a rival Unit.", "cards": ["mantis-blades"],
     "habit": "permissive", "why": "WHY-MARKER-never-in-a-prompt"},
    {"id": "sc-straddle-yes", "kind": "scenario-drafted", "label": True, "source_rule_ids": ["4.10.1", "4.10.3"],
     "statement": "A Gear can be equipped to a friendly Unit you control.", "cards": [], "habit": "state",
     "why": "4.10.1 is a train rule and 4.10.3 a valid one."},
    {"id": "sc-straddle-no", "kind": "scenario-drafted", "label": False, "source_rule_ids": ["4.10.1", "4.10.3"],
     "statement": "A Gear can be equipped to a rival Unit you do not control.", "cards": [], "habit": "state",
     "why": "4.10.1 is a train rule and 4.10.3 a valid one."},
]
V2_ENGINE_CAP = 60


def engine_fixture() -> list[dict]:
    """Every engine item from the first six seeds (by name): enough for every class, one valid seed."""
    rows = read_jsonl(ENGINE_FILE, missing_ok=False)
    seeds = sorted({r["provenance"]["seed"] for r in rows})[:6]
    return [r for r in rows if r["provenance"]["seed"] in seeds]


def v2_build(rule_rows=None, scenarios=None, gold_dir=None) -> tf.Build:
    key = ("v2", rule_rows is None, scenarios is None, gold_dir is None)
    if rule_rows is None and scenarios is None and gold_dir is None and key in _CACHE:
        return _CACHE[key]
    result = tf.build_v2(rule_rows if rule_rows is not None else tf.load_sources(),
                         gold_dir=gold_dir or tf.GOLD_DIR,
                         scenarios=scenarios if scenarios is not None else engine_fixture() + copy.deepcopy(V2_SCENARIOS),
                         engine_cap=V2_ENGINE_CAP)
    if rule_rows is None and scenarios is None and gold_dir is None:
        _CACHE[key] = result
    return result


def v2_rows(result: tf.Build) -> list[dict]:
    return result.rows["train"] + result.rows["valid"]


def v2_committed() -> list[dict]:
    if "v2-committed" not in _CACHE:
        _CACHE["v2-committed"] = (read_jsonl(V2_DIR / "train.jsonl", missing_ok=False)
                                  + read_jsonl(V2_DIR / "valid.jsonl", missing_ok=False))
    return _CACHE["v2-committed"]


def v2_manifest() -> dict:
    return json.loads((V2_DIR / "manifest.json").read_text(encoding="utf-8"))


def _search_call(row: dict) -> dict:
    return next(c["function"] for c in row["messages"][-3]["tool_calls"])


def test_v1_is_byte_identical():
    import hashlib
    got = {name: hashlib.sha256((COMMITTED / name).read_bytes()).hexdigest() for name in V1_SHA256}
    assert got == V1_SHA256, got
    assert tf.DATASET == "rules-tf-v1" and COMMITTED == REPO_ROOT / "data/datasets/rules-tf-v1"
    with contextlib.redirect_stdout(io.StringIO()):
        assert tf.main(["--check"]) == 0  # the default dataset is still v1, and its build is unchanged


def test_v2_committed_set_is_exactly_what_the_code_builds():
    manifest = v2_manifest()
    args = ["--dataset-name", tf.V2_DATASET, "--check"]
    for source in manifest["item_sources"]:
        assert tf.file_sha256(REPO_ROOT / source["path"]) == source["sha256"], source
        args += ["--scenarios", str(REPO_ROOT / source["path"])]
    assert {Path(s["path"]).name for s in manifest["item_sources"]} == {
        "engine-positions-v1.jsonl", "scenarios-drafted-v1.jsonl"}
    with contextlib.redirect_stdout(io.StringIO()):
        code = tf.main(args)
    assert code == 0, "data/datasets/rules-tf-v2 is stale: rerun the v2 build command in the README"


def _check_lookup(row: dict, rows_by_id: dict) -> None:
    """A lookup row: preload, the search call, its real result holding a cited rule, then an answer the
    scorer reads as the label; its lookup-call row is the same first step with the call as the target."""
    messages = row["messages"]
    assert messages[0] == {"role": "system", "content": system_prompt()}
    call = _search_call(row)
    assert messages[-3]["role"] == "assistant" and messages[-3]["content"] == ""
    assert call == {"name": "search_rules", "arguments": {"query": row["lookup_query"]}}
    result = json.loads(messages[-2]["content"])
    assert messages[-2]["role"] == "tool" and result["ok"] and result["tool"] == "search_rules"
    assert result["result"]["query"] == row["lookup_query"]
    found = set(result["sources"]["rule_ids"]) & set(row["source_rule_ids"])
    assert found, (row["id"], result["sources"]["rule_ids"])
    # the cited rule really is in the result text, as the real tool rendered it
    assert any(r["rule_ids"] and r["rule_ids"][0] in found for r in result["result"]["results"])
    assert eval_assistant.parse_answer_letter(split_thinking(messages[-1]["content"])[1], ["A", "B"]) \
        == (row["label"], "ok")
    first = rows_by_id[row["id"] + "-call"]
    assert first["shape"] == "lookup-call" and first["messages"][:-1] == messages[:-3]
    target = first["messages"][-1]
    assert target["tool_calls"] == messages[-3]["tool_calls"] and "Answer:" not in target["content"]
    assert target["content"].startswith("<think>\n") and target["content"].endswith("\n</think>\n\n")
    # the preload part is exactly the scorer's prompt for this statement
    prompt = tf.scorer_prompt(row["statement"], row.get("cards") if row["kind"] != tf.TEMPLATE_KIND else None)
    assert messages[:-3] == prompt.messages


def test_v2_lookup_examples_hold_the_call_the_real_result_and_the_answer():
    result = v2_build()
    rows = v2_rows(result)
    by_id = {r["id"]: r for r in rows}
    lookups = [r for r in rows if r["shape"] == "lookup"]
    assert {r["kind"] for r in lookups} >= {tf.ENGINE_KIND, tf.SCENARIO_KIND}, {r["kind"] for r in lookups}
    for row in lookups:
        _check_lookup(row, by_id)
    assert by_id["sc-hit-yes"]["shape"] == by_id["sc-hit-no"]["shape"] == "lookup"
    committed = v2_committed()
    by_id = {r["id"]: r for r in committed}
    for row in [r for r in committed if r["shape"] == "lookup"][::7]:
        _check_lookup(row, by_id)
    # direct rows: no call after the preload, the answer straight away
    for row in [r for r in committed if r["shape"] == "direct"][::40]:
        assert row["messages"][-2]["role"] == "tool" and "tool_calls" not in row["messages"][-1]
        assert row["messages"][-1]["content"].endswith(f"Answer: {row['label']}")
    counts = v2_manifest()["counts"]["by_shape"]
    assert counts["lookup"] == counts["lookup-call"] > 0


def test_v2_lookup_queries_never_name_a_rule_id():
    for rows in (v2_rows(v2_build()), v2_committed()):
        for row in rows:
            if row["shape"] == "direct":
                continue
            query = row["lookup_query"]
            assert not tf.RULE_ID_RE.search(query), (row["id"], query)
            for rid in row["source_rule_ids"]:
                assert rid not in query, (row["id"], query)
            assert row["messages"][-1 if row["shape"] == "lookup-call" else -3]["tool_calls"][0]["function"][
                "arguments"] == {"query": query}
    for bad in ("rules for 9.3.2.1", "TR 3.4.2 dice", "see rule 9 attacking"):
        try:
            tf.check_query(bad, ["9.3.2.1"])
        except tf.BuildError:
            continue
        raise AssertionError(f"{bad!r} was accepted")
    assert tf.check_query("which rival Units can be attacked", ["9.3.2.1"])
    assert tf.key_terms("You cannot activate effects on Lagging Units during 9 turns.") == \
        "activate effects Lagging Units 9 turns"
    assert set(tf.ENGINE_QUERIES) == set(tf.ENGINE_CLASSES)


def test_v2_lookup_misses_are_dropped_and_counted():
    result = v2_build()
    ids = {r["id"] for r in v2_rows(result)}
    assert not ids & {"sc-miss-yes", "sc-miss-no"}
    assert result.manifest["item_skips"]["scenario-drafted:lookup-miss"] == 2
    assert result.manifest["lookup"]["by_kind"]["scenario-drafted"] == {"needed": 4, "hit": 2, "miss": 2}
    manifest = v2_manifest()
    for kind, cell in manifest["lookup"]["by_kind"].items():
        assert cell["needed"] == cell["hit"] + cell["miss"], (kind, cell)
    assert manifest["item_skips"]["engine-position:lookup-miss"] == manifest["lookup"]["by_kind"][
        "engine-position"]["miss"]


def _unit(uid, kind, label, shape, statement="You may draw a card."):
    return tf.Unit(uid, kind, label, statement, shape, [{"id": uid}], ["9.1"], {"question_class": "x",
                                                                                "no_reason": None})


def test_v2_lookup_share_is_capped_at_30_percent():
    pairs = [[_unit(f"p{i}a", tf.TEMPLATE_KIND, "A", "lookup" if i < 6 else "direct"),
              _unit(f"p{i}b", tf.TEMPLATE_KIND, "B", "lookup" if i < 3 else "direct")] for i in range(10)]
    singles = ([_unit(f"e{i}a", tf.ENGINE_KIND, "A", "lookup") for i in range(8)]
               + [_unit(f"e{i}b", tf.ENGINE_KIND, "B", "lookup" if i < 6 else "direct") for i in range(8)])
    kept_pairs, kept_singles, dropped = tf.cap_lookups(pairs, singles)
    items = [u for p in kept_pairs for u in p] + kept_singles
    share = sum(u.shape == "lookup" for u in items) / len(items)
    assert share <= tf.LOOKUP_SHARE_MAX and dropped == 36 - len(items) and dropped > 0, (share, dropped)
    labels = [u.label for u in items]
    assert labels.count("A") == labels.count("B")
    again = tf.cap_lookups(list(reversed(pairs)), list(reversed(singles)))
    assert sorted(u.id for p in again[0] for u in p) == sorted(u.id for p in kept_pairs for u in p)
    assert sorted(u.id for u in again[1]) == sorted(u.id for u in kept_singles)
    manifest = v2_manifest()
    rows = v2_committed()
    items = [r for r in rows if r["shape"] != "lookup-call"]
    assert sum(r["shape"] == "lookup" for r in items) <= tf.LOOKUP_SHARE_MAX * len(items)
    assert manifest["lookup"]["share"] <= tf.LOOKUP_SHARE_MAX


def test_v2_engine_items_split_by_seed_and_the_rest_by_rule():
    result = v2_build()
    pool_seeds = {r["provenance"]["seed"] for r in engine_fixture()}
    valid_seeds = tf.engine_valid_seeds(pool_seeds)
    assert len(valid_seeds) == 1 and tf.engine_valid_seeds(set(reversed(sorted(pool_seeds)))) == valid_seeds
    assert len(tf.engine_valid_seeds({f"s{i}" for i in range(24)})) == 2
    for split, rows in result.rows.items():
        for r in rows:
            if r["kind"] == tf.ENGINE_KIND:
                assert (r["seed"] in valid_seeds) == (split == "valid"), (r["id"], r["seed"], split)
    assert any(r["kind"] == tf.ENGINE_KIND for r in result.rows["valid"])
    ids = {r["id"] for r in v2_rows(result)}
    assert not ids & {"sc-straddle-yes", "sc-straddle-no"}
    assert result.manifest["item_skips"]["scenario-drafted:split-straddle"] == 2
    for rows in (result.rows, {"train": read_jsonl(V2_DIR / "train.jsonl"), "valid": read_jsonl(V2_DIR / "valid.jsonl")}):
        seeds = {split: {r["seed"] for r in rs if r["kind"] == tf.ENGINE_KIND} for split, rs in rows.items()}
        assert seeds["valid"] and seeds["train"] and not seeds["train"] & seeds["valid"], seeds
        rules = {split: {rid for r in rs if r["kind"] != tf.ENGINE_KIND for rid in r["source_rule_ids"]}
                 for split, rs in rows.items()}
        assert rules["valid"] and not rules["train"] & rules["valid"]
        for split, rs in rows.items():
            for r in rs:
                if r["kind"] != tf.ENGINE_KIND:
                    assert {tf.split_of(rid) for rid in r["source_rule_ids"]} == {split}, r["id"]
    manifest = v2_manifest()
    assert manifest["split"]["by_kind"][tf.ENGINE_KIND]["by"] == "seed"
    assert manifest["split"]["by_kind"][tf.TEMPLATE_KIND]["by"] == "source rule id"


def test_v2_composition_caps_and_balance():
    units = []
    for cls, n_yes, reasons in (("a", 30, {"r1": 25, "r2": 5}), ("b", 6, {"r3": 9}), ("c", 40, {"r4": 40})):
        units += [tf.Unit(f"{cls}y{i}", tf.ENGINE_KIND, "A", "x", "direct", [], [], {"question_class": cls,
                                                                                   "no_reason": None})
                  for i in range(n_yes)]
        for reason, n in reasons.items():
            units += [tf.Unit(f"{cls}{reason}{i}", tf.ENGINE_KIND, "B", "x" if i % 2 else "not x", "direct", [], [],
                              {"question_class": cls, "no_reason": reason}) for i in range(n)]
    chosen = tf.select_engine(units, 40)
    count = {}
    for u in chosen:
        key = (u.meta["question_class"], u.label, u.meta["no_reason"])
        count[key] = count.get(key, 0) + 1
    assert len(chosen) == 40
    assert count[("b", "A", None)] == count[("b", "B", "r3")] == 6               # b is full at 6 pairs
    assert count[("a", "A", None)] == count[("c", "A", None)] == 7               # the rest split evenly
    assert count[("a", "B", "r1")] == 4 and count[("a", "B", "r2")] == 3         # the No half even over reasons
    assert [u.id for u in tf.select_engine(list(reversed(units)), 40)] == [u.id for u in chosen]
    manifest = v2_manifest()
    counts = manifest["counts"]
    rows = [r for r in v2_committed() if r["shape"] != "lookup-call"]
    labels = [r["label"] for r in rows]
    assert labels.count("A") == labels.count("B")
    engine = [r for r in rows if r["kind"] == tf.ENGINE_KIND]
    assert len(engine) <= tf.ENGINE_CAP == counts["composition"]["engine_cap"]
    for cls in tf.ENGINE_CLASSES:
        cls_labels = [r["label"] for r in engine if r["question_class"] == cls]
        assert cls_labels and cls_labels.count("A") == cls_labels.count("B"), cls
    for kind in (tf.TEMPLATE_KIND, tf.SCENARIO_KIND):
        kind_labels = [r["label"] for r in rows if r["kind"] == kind]
        assert kind_labels.count("A") == kind_labels.count("B") > 0, kind
    table = tf.negation_table(rows)
    for cell in ("negation", "no_negation"):
        assert table[cell]["A"] and table[cell]["B"] and 0.40 <= table[cell]["yes_share"] <= 0.60, table
    assert counts["label_by_negation"] == table
    for key in ("by_kind", "by_class", "by_habit", "by_label", "by_shape", "by_no_reason"):
        assert counts[key], key
    fixture = v2_build()
    fixture_engine = [r for r in v2_rows(fixture) if r["kind"] == tf.ENGINE_KIND and r["shape"] != "lookup-call"]
    assert len(fixture_engine) <= V2_ENGINE_CAP


def _get_card_calls(row: dict) -> list[str]:
    return [c["function"]["arguments"]["slug"] for c in row["messages"][2]["tool_calls"]
            if c["function"]["name"] == "get_card"]


def test_v2_items_with_cards_preload_exactly_those_cards():
    for rows in (v2_rows(v2_build()), v2_committed()):
        with_cards = [r for r in rows if r["kind"] != tf.TEMPLATE_KIND]
        assert any(r.get("cards") for r in with_cards)
        for row in with_cards:
            assert _get_card_calls(row) == row["cards"], (row["id"], _get_card_calls(row), row["cards"])
            sent = [json.loads(m["content"]) for m in row["messages"] if m["role"] == "tool"]
            got = [slug for t in sent if t["tool"] == "get_card" for slug in t["sources"]["card_slugs"]]
            assert got[:len(row["cards"])] == row["cards"], row["id"]
            assert all(c["function"]["name"] != "find_card" for c in row["messages"][2]["tool_calls"])
    by_id = {r["id"]: r for r in v2_rows(v2_build())}
    assert _get_card_calls(by_id["sc-card-yes"]) == ["mantis-blades"]
    assert _get_card_calls(by_id["sc-hit-yes"]) == []  # cards: [] means no card steps, not name linking


def test_v2_scenario_file_with_habit_and_why_goes_through_the_cli():
    known = {r["id"] for r in tf.numbered_rules(tf.load_sources())}
    with tempfile.TemporaryDirectory() as tmp:
        path = _scenario_file(tmp, V2_SCENARIOS)
        assert len(tf.load_scenarios(path, known, tf.known_card_slugs())) == len(V2_SCENARIOS)
        bad_cases = {"empty habit": {**V2_SCENARIOS[0], "habit": ""},
                     "unknown card": {**V2_SCENARIOS[0], "cards": ["no-such-card"]},
                     "rule id query": {**V2_SCENARIOS[0], "lookup_query": "rule 9.3.2.1"},
                     "unknown field": {**V2_SCENARIOS[0], "note": "x"}}
        for name, bad in bad_cases.items():
            try:
                tf.load_scenarios(_scenario_file(tmp, [bad] + V2_SCENARIOS[1:]), known, tf.known_card_slugs())
            except tf.BuildError:
                continue
            raise AssertionError(f"{name} was accepted")
        out = Path(tmp) / "out"
        rules_path = Path(tmp) / "fixture.jsonl"
        write_jsonl_atomic(rules_path, V2_SCENARIOS)
        with contextlib.redirect_stdout(io.StringIO()):
            code = tf.main(["--dataset-name", tf.V2_DATASET, "--scenarios", str(rules_path),
                            "--scenarios", str(ENGINE_FILE), "--engine-cap", "40", "--out", str(out)])
        assert code == 0
        rows = read_jsonl(out / "train.jsonl") + read_jsonl(out / "valid.jsonl")
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    scenarios = [r for r in rows if r["kind"] == tf.SCENARIO_KIND and r["shape"] != "lookup-call"]
    assert sorted(r["id"] for r in scenarios) == ["sc-card-no", "sc-card-yes", "sc-hit-no", "sc-hit-yes"]
    assert all(r["habit"] in ("state", "permissive") for r in scenarios)
    assert manifest["counts"]["by_habit"] == {"permissive": 2, "state": 2}
    assert [s["path"] for s in manifest["item_sources"]][1].endswith("engine-positions-v1.jsonl")
    assert "WHY-MARKER" not in json.dumps(rows)  # why is provenance only
    assert all("why" not in r for r in rows)


def test_v2_scenarios_on_gold_cards_are_dropped_and_engine_items_counted():
    engine = engine_fixture()
    gold_card = next(r["cards"][0] for r in engine)
    names = tf.card_display_names()
    with tempfile.TemporaryDirectory() as tmp:
        gold = Path(tmp)
        write_jsonl_atomic(gold / "fake.jsonl", [
            {"id": "g1", "question": "Zebras sing in the rain at noon?", "choices": [], "cards": [gold_card]},
            {"id": "g2", "question": "Which Gear is best?", "choices": [{"letter": "A", "text": "Mantis Blades"}]}])
        linked = tf.gold_linked_cards(gold, names)
        assert linked == {gold_card, "mantis-blades"}, linked
        on_card = {**V2_SCENARIOS[0], "id": "sc-gold-yes", "cards": [gold_card]}
        result = v2_build(scenarios=engine + copy.deepcopy(V2_SCENARIOS) + [on_card], gold_dir=gold)
    ids = {r["id"] for r in v2_rows(result)}
    assert not ids & {"sc-card-yes", "sc-card-no", "sc-gold-yes"}
    gold_counts = result.manifest["counts"]["gold_cards"]
    assert result.manifest["item_skips"]["scenario-drafted:gold_card_dropped"] == gold_counts["scenario_dropped"] == 3
    on_gold = [r for r in engine if set(r["cards"]) & linked]
    assert gold_counts["engine_pool_using_gold_card"] == len(on_gold) > 0
    kept = [r for r in v2_rows(result) if r["kind"] == tf.ENGINE_KIND and r["shape"] != "lookup-call"
            and set(r["cards"]) & linked]
    assert kept and gold_counts["engine_kept_using_gold_card"] == len(kept)  # counted, never dropped
    # sc-hit-yes/no survive, so after the drops the scenario labels are rebalanced to equal
    labels = [r["label"] for r in v2_rows(result) if r["kind"] == tf.SCENARIO_KIND and r["shape"] != "lookup-call"]
    assert sorted(r["id"] for r in v2_rows(result) if r["kind"] == tf.SCENARIO_KIND
                  and r["shape"] != "lookup-call") == ["sc-hit-no", "sc-hit-yes"]
    assert sorted(labels) == ["A", "B"], labels
    committed = v2_manifest()["counts"]["gold_cards"]
    assert committed["scenario_dropped"] > 0 and committed["engine_kept_using_gold_card"] >= 0


def test_v2_build_is_deterministic_in_any_input_order():
    first = v2_build()
    again = v2_build(rule_rows=list(reversed(tf.load_sources())),
                     scenarios=list(reversed(engine_fixture() + copy.deepcopy(V2_SCENARIOS))))
    assert tf.output_texts(again) == tf.output_texts(first)


def test_v2_passes_the_leak_guard_over_every_row():
    gold_q, gold_all = tf.gold_texts()
    rows = [{"id": r["id"], "statement": r["statement"], "target": r["messages"][-1]["content"]}
            for r in v2_committed()]
    report = tf.leak_guard(rows, gold_q, gold_all)
    assert report.ok, report.violations[:3]
    assert v2_manifest()["leak_guard"]["result"] == "pass"


def run() -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS tf dataset: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    run()


if __name__ == "__main__":
    main()
