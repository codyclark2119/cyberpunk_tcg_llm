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
