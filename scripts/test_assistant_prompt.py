#!/usr/bin/env python3
"""Tests for the assistant's prompt and context: lean tool specs, the prompt budget, the preload, thinking.

Why: the quiz diagnosis (2026-11-12) put most of the failures on what the 8B
model reads before the question, not on the tools. Each fix here could break
something quietly: a shorter description that also changed a schema would
make the model's calls fail validation; a preload that guessed among cards
sharing a name, ran with preload off, overflowed its budget, cut an erratum
in half, or behaved differently on two wordings of the same card names would
put facts in front of the model that no reviewed path chose; a thinking
default that did not reach the model would leave the comparison measuring
nothing. Everything runs on the committed snapshot with scripted fake models:
no mlx, no weights, no network.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import dataclasses
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.assistant import golden_rules
from games.cyberpunk.assistant import preload as preload_module
from games.cyberpunk.assistant import tools
from games.cyberpunk.assistant.loop import (ANSWERING_GUIDANCE, ASSISTANT_PROMPT_VERSION, DEFAULT_MAX_TOKENS,
                                            DEFAULT_THINKING_MAX_TOKENS, SYSTEM_PROMPT, run_turn,
                                            tool_specs_sha256)
from games.cyberpunk.assistant.preload import DEFAULT_PRELOAD_CHARS, fit_result, link_cards
from games.cyberpunk.assistant_app import ChatService
from harness.core.io import read_jsonl

SCHEMA_SNAPSHOT = REPO_ROOT / "scripts/fixtures/assistant_tool_schemas_v2.json"
BUDGET_SCRIPT = REPO_ROOT / "scripts/prompt_budget.py"
# The overhead before the lean specs (assistant-chat-v2, measured on master 2026-11-12): 10,416 chars of
# tool specs plus a 1,239-char system prompt.
BEFORE_TOTAL_CHARS = 11655
RULES_JSONL = REPO_ROOT / "data/processed/rules.jsonl"
CARDS_JSONL = REPO_ROOT / "data/processed/card_database.jsonl"
# v7's addition (Golden Rules block plus answering guidance) must stay under ~600 tokens. Estimated at 4
# characters a token (no tokenizer on Linux; prompt_budget.py --tokenizer gives the real count on the Mac).
V7_ADDITION_MAX_CHARS = 2400
GOLDEN_RULES_MAX_CHARS = 1600   # ~400 tokens


def v7_addition() -> str:
    return f"\n\n{golden_rules.snapshot_block()}\n\n{ANSWERING_GUIDANCE}"


def base_prompt() -> str:
    """The system prompt without v7's addition: the v5 wording, which the older budgets measure."""
    assert v7_addition() in SYSTEM_PROMPT
    return SYSTEM_PROMPT.replace(v7_addition(), "")


def call(name: str, **arguments) -> str:
    return f'<tool_call>\n{json.dumps({"name": name, "arguments": arguments})}\n</tool_call>'


class ScriptedModel:
    def __init__(self, texts):
        self.texts = list(texts)
        self.seen: list[list[dict]] = []
        self.kwargs: list[dict] = []

    async def generate(self, messages, tools_, *, max_tokens, enable_thinking):
        self.seen.append(copy.deepcopy(messages))
        self.kwargs.append({"max_tokens": max_tokens, "enable_thinking": enable_thinking})
        return {"ok": True, "text": self.texts.pop(0), "finishReason": "stop", "promptTokens": 1,
                "generationTokens": 1, "elapsedMs": 1.0}


class CountRuns:
    """Counts every tool run, by name."""

    def __enter__(self):
        self.runs: list[str] = []
        self.saved = dict(tools.TOOLS)
        for name, tool in self.saved.items():
            def counted(args, original=tool.run, name=name):
                self.runs.append(name)
                return original(args)
            tools.TOOLS[name] = dataclasses.replace(tool, run=counted)
        return self

    def __exit__(self, *exc):
        tools.TOOLS.update(self.saved)


def turn(message: str, **kwargs):
    model = ScriptedModel(["Done."])
    return asyncio.run(run_turn([], message, model, **kwargs)), model


def strip_descriptions(value):
    if isinstance(value, dict):
        return {k: strip_descriptions(v) for k, v in value.items() if k != "description"}
    if isinstance(value, list):
        return [strip_descriptions(v) for v in value]
    return value


def auto_steps(result) -> list[dict]:
    return [s for s in result.trace if s.get("auto")]


def linked_steps(result) -> list[dict]:
    """The automatic search and card steps, without the implied-rule steps that follow them."""
    return [s for s in auto_steps(result) if "implied" not in s]


# Tool specs and the prompt budget ----------------------------------------------------------


def test_lean_specs_keep_every_name_and_schema():
    before = json.loads(SCHEMA_SNAPSHOT.read_text(encoding="utf-8"))
    # The two deliberate schema changes since the v2 snapshot (the Tournament Rules, 2026-11-13): get_rule's
    # pattern also takes "TR 3.4.2" ids, and search_rules gains an optional ``doc`` filter. Every v2 argument
    # is kept, nothing becomes required, and the old pattern's ids still match the new one.
    old_pattern = before["get_rule"]["properties"]["rule_id"]["pattern"]
    before["get_rule"]["properties"]["rule_id"]["pattern"] = tools.RULE_NUMBER_PATTERN
    before["search_rules"]["properties"]["doc"] = {"type": "string", "enum": ["comprehensive", "tournament"]}
    # And one since (2026-11-13, prompt v5): get_rule gains an optional ``offset`` to read a long rule in parts.
    before["get_rule"]["properties"]["offset"] = {"type": "integer", "minimum": 0, "maximum": 100000}
    for rule_id in ("9", "9.3.2", "11.24.", "3.18.1.2.2.1"):
        assert re.search(old_pattern, rule_id) and re.search(tools.RULE_NUMBER_PATTERN, rule_id), rule_id
    specs = tools.tool_specs()
    now = {s["function"]["name"]: strip_descriptions(s["function"]["parameters"]) for s in specs}
    assert list(now) == list(tools.TOOLS) and sorted(now) == sorted(before), "a tool was renamed, added or lost"
    for name in before:
        assert now[name] == before[name], f"{name}: the argument schema changed, not just its prose"
    for spec in specs:
        description = spec["function"]["description"]
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", description.strip()) if s]
        assert 1 <= len(sentences) <= 3 and len(description) <= 160, (spec["function"]["name"], description)
    # The lean specs' saving is measured against the v5-wording prompt; v7's deliberate addition has its own
    # budget (test_v7_addition_stays_under_its_budget).
    total = sum(len(json.dumps(s, ensure_ascii=False)) for s in specs) + len(base_prompt())
    assert total < BEFORE_TOTAL_CHARS * 0.85, total


def test_prompt_budget_reports_chars_and_tokens_when_it_can():
    proc = subprocess.run([sys.executable, str(BUDGET_SCRIPT), "--json"], capture_output=True, text=True,
                          cwd=REPO_ROOT)
    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout)
    assert set(report) == {"prompt_version", "tool_specs_sha256", "tools", "tool_count", "tool_chars",
                           "system_prompt_chars", "total_chars", "tool_tokens", "system_prompt_tokens",
                           "rendered_prefix_tokens", "tokenizer_note"}
    assert [r["tool"] for r in report["tools"]] == list(tools.TOOLS) and report["tool_count"] == 12
    assert all(set(r) == {"tool", "chars", "description_chars", "tokens"} and r["tokens"] is None
               for r in report["tools"])
    by_name = {r["tool"]: r for r in report["tools"]}
    for spec in tools.tool_specs():
        assert by_name[spec["function"]["name"]]["chars"] == len(json.dumps(spec, ensure_ascii=False))
    assert report["tool_chars"] == sum(r["chars"] for r in report["tools"])
    assert report["system_prompt_chars"] == len(SYSTEM_PROMPT)
    assert report["total_chars"] == report["tool_chars"] + report["system_prompt_chars"]
    assert report["tool_specs_sha256"] == tool_specs_sha256() and "characters only" in report["tokenizer_note"]
    text = subprocess.run([sys.executable, str(BUDGET_SCRIPT), "--tokenizer", "no/such/dir"], capture_output=True,
                          text=True, cwd=REPO_ROOT)
    assert text.returncode == 0 and f"total: {report['total_chars']} chars" in text.stdout
    assert "not a local directory; characters only" in text.stdout
    # With a tokenizer, every count is a real count from it (a stand-in that counts words here).
    spec = __import__("importlib.util").util.spec_from_file_location("prompt_budget", BUDGET_SCRIPT)
    module = __import__("importlib.util").util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class Words:
        def encode(self, text, add_special_tokens=False):
            return text.split()

        def apply_chat_template(self, messages, tools=None, tokenize=True, add_generation_prompt=False):
            return (messages[0]["content"] + json.dumps(tools)).split()

    counted = module.budget(Words())
    assert counted["system_prompt_tokens"] == len(SYSTEM_PROMPT.split())
    assert counted["tool_tokens"] == sum(r["tokens"] for r in counted["tools"]) > 0
    assert counted["rendered_prefix_tokens"] == len((SYSTEM_PROMPT + json.dumps(tools.tool_specs())).split())

    # transformers 5 returns a BatchEncoding (a mapping with input_ids and attention_mask):
    # the count is the ids, not the two keys (the Mac first reported "2 tokens").
    class Encoded(Words):
        def apply_chat_template(self, messages, tools=None, tokenize=True, add_generation_prompt=False):
            ids = super().apply_chat_template(messages, tools, tokenize, add_generation_prompt)
            return {"input_ids": ids, "attention_mask": [1] * len(ids)}

    assert module.budget(Encoded())["rendered_prefix_tokens"] == counted["rendered_prefix_tokens"]


def test_system_prompt_v4_warns_from_the_snapshot_wording():
    rules = {r["id"]: r["text"] for r in read_jsonl(REPO_ROOT / "data/processed/rules.jsonl")}
    # The warning cites two rules; it must say only what they say.
    assert "spend a friendly ready Unit to attack" in rules["9.1"]
    assert "A spent rival Unit is a valid attack target" in rules["9.3.2.1"]
    assert "an attack spends a friendly ready Unit (rule 9.1)" in SYSTEM_PROMPT
    assert "a spent rival Unit is a valid attack target (rule 9.3.2.1)" in SYSTEM_PROMPT
    for needle in ("rules text is right", "Answer only from tool results", "the snapshot does not cover it",
                   "Do not guess", "card slugs", "rule numbers", "Errata override",
                   # v4: policy is answered from the Tournament Rules and cited; what neither covers is not covered.
                   "Tournament procedure, penalties, deck registration, event policy: use the Tournament Rules "
                   "(TR 3.4.2), cite them. Anything in neither is not covered.",
                   "Snapshot 2026-10-29, TR 2026-10-28. Prompt assistant-chat-v7."):
        assert needle in SYSTEM_PROMPT, needle
    assert "not in the snapshot" not in SYSTEM_PROMPT, "v3's 'policy is not in the snapshot' is gone"
    assert "rule:TR 3.4.2" in {d["doc_id"] for d in tools.rule_docs()}, "the prompt's example id exists"
    assert len(base_prompt()) < 1239, "v4's wording must stay shorter than v2 (v7's addition is budgeted apart)"


# v7: the Golden Rules and the answering guidance ---------------------------------------------


def test_golden_rules_block_is_2_1_to_2_10_2_without_conduct_or_examples():
    rows = list(read_jsonl(RULES_JSONL))
    block = golden_rules.golden_rules_block(rows)
    assert block == golden_rules.golden_rules_block(list(rows)) == golden_rules.snapshot_block(), "deterministic"
    lines = block.split("\n")
    assert lines[0] == golden_rules.HEADER
    expected = ["2.1", "2.1.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.10.1", "2.10.2"]
    assert [line.split(" ", 1)[0] for line in lines[1:]] == [i + "." for i in expected], lines
    # The snapshot's own conduct rules are there to be left out, and its examples to be stripped.
    by_id = {r["id"]: r for r in rows}
    conduct = [i for i in by_id if re.fullmatch(r"2\.(1[1-9]|[2-9]\d)(\.\d+)*", i)]
    assert {"2.11", "2.12", "2.12.3", "2.13", "2.13.1"} <= set(conduct), conduct
    for rule_id in conduct:
        assert by_id[rule_id]["text"].split(" ", 1)[1][:30] not in block, rule_id
        assert not re.search(rf"(?m)^{re.escape(rule_id)}\. ", block), rule_id
    assert "civility" not in block.lower() and "hygiene" not in block.lower()
    assert sum("EXAMPLE" in by_id[i]["text"] for i in expected) >= 3, "the fixture must contain examples"
    assert "EXAMPLE" not in block and ">" not in block
    for rule_id in expected:  # each line is the rule's own text up to its first example
        assert by_id[rule_id]["text"].split("\n\n")[0] in block, rule_id
    assert len(block) <= GOLDEN_RULES_MAX_CHARS, len(block)
    assert block in SYSTEM_PROMPT


def test_golden_rules_fail_closed():
    rows = list(read_jsonl(RULES_JSONL))
    # A Golden Rule missing from the snapshot, an extra one, the conduct heading gone, an example that will
    # not strip: each is an error, never a quietly different prompt.
    broken = {
        "missing 2.7": [r for r in rows if r["id"] != "2.7"],
        "extra rule": rows + [{**next(r for r in rows if r["id"] == "2.10.2"), "id": "2.10.3"}],
        "no cut heading": [r for r in rows if r.get("text") != golden_rules.STOP_HEADING],
        "no section": [r for r in rows if r["id"] != "2"],
        "loose example": [{**r, "text": r["text"] + " EXAMPLE: x"} if r["id"] == "2.3" else r for r in rows],
    }
    for label, fixture in broken.items():
        try:
            golden_rules.golden_rules_block(fixture)
        except ValueError:
            continue
        raise AssertionError(f"{label}: the Golden Rules block built anyway")


def test_v7_addition_stays_under_its_budget():
    added = v7_addition()
    assert len(added) <= V7_ADDITION_MAX_CHARS, len(added)
    assert len(SYSTEM_PROMPT) == len(base_prompt()) + len(added)
    assert ASSISTANT_PROMPT_VERSION == "assistant-chat-v7" and "Prompt assistant-chat-v7." in SYSTEM_PROMPT


def test_answering_guidance_says_each_point_and_names_no_card():
    for needle in (
            # (a) permissive rules
            "something is allowed unless a rule or card text forbids it or a cost can't be paid",
            '"No rule explicitly permits it" is not a reason to answer No',
            # (b) polarity, and the conclusion line
            'including any "not" or "may not", is true; pick Yes only if it is true',
            "State that conclusion in one line just before your final answer line",
            # (c) only a cost gates an effect
            'Only a cost (text before a colon, or "pay ...") can stop an effect from being used',
            "resolves as much as possible (2.4, 10.10)", '"You may" parts are optional',
            # (d) numbered order, (e) specific beats general, (f) search past the preload
            "Numbered sub-steps of a rule happen in their numbered order",
            "the more specific one wins, and card text beats the rules (2.5)",
            "Check every preloaded rule before answering, not only the first",
            "call search_rules or get_rule before answering"):
        assert needle in ANSWERING_GUIDANCE, needle
    assert ANSWERING_GUIDANCE in SYSTEM_PROMPT
    rules = {r["id"] for r in read_jsonl(RULES_JSONL)}
    assert {"2.4", "2.5", "10.10"} <= rules, "the guidance cites rules that exist"
    added = v7_addition()
    for card in read_jsonl(CARDS_JSONL):
        for name in {card["name"], card["display_name"], card["id"]}:
            pattern = rf"(?<!\w){re.escape(name)}(?!\w)"
            assert not re.search(pattern, added, re.I), f"v7's addition names a card: {name}"
            # The v4 wording cites one slug, `v-streetkid`, as the citation format; no card name appears.
            if name != card["id"]:
                assert not re.search(pattern, SYSTEM_PROMPT), f"the system prompt names a card: {name}"


# The preload --------------------------------------------------------------------------------


def test_preload_searches_rules_and_links_named_cards():
    with CountRuns() as counter:
        result, model = turn("What happens when Sketchy Ripper attacks V, Corporate Exile?")
    steps = linked_steps(result)
    implied = [s for s in auto_steps(result) if "implied" in s]
    assert auto_steps(result) == steps + implied, "implied-rule steps come after the search and the cards"
    assert all(s["tool"] == "get_rule" for s in implied)
    assert [(s["tool"], s["arguments"]) for s in steps] == [
        ("search_rules", {"query": "What happens when Sketchy Ripper attacks V, Corporate Exile?", "k": 5}),
        ("get_card", {"slug": "sketchy-ripper"}), ("get_card", {"slug": "v-corporate-exile"})]
    assert counter.runs == ["search_rules", "get_card", "get_card"] + ["get_rule"] * len(implied), \
        "the links resolved without find_card"
    assert steps[1]["link"] == {"span": "Sketchy Ripper", "slugs": ["sketchy-ripper"], "ambiguous": False}
    assert steps[2]["link"]["span"] == "V, Corporate Exile", "longest match first: not the bare V"
    assert all(s["sent"] and s["ok"] for s in steps) and result.tool_calls == 0
    assert result.auto_calls == 3 + len(implied)
    # What the model saw first: system, question, one assistant tool-call message and the results sent.
    first = model.seen[0]
    sent_implied = sum(1 for s in implied if s["sent"])
    assert [m["role"] for m in first] == ["system", "user", "assistant"] + ["tool"] * (3 + sent_implied)
    assert [c["function"]["name"] for c in first[2]["tool_calls"]] == ["search_rules", "get_card",
                                                                       "get_card"] + ["get_rule"] * sent_implied
    sent = [json.loads(m["content"]) for m in first[3:]]
    assert sent[1]["result"]["card"]["slug"] == "sketchy-ripper" and "printings" not in sent[1]["result"]["card"]
    assert sent[1]["result"]["text_with_errata"] == tools.get_card("sketchy-ripper")["result"]["text_with_errata"]
    assert {"sketchy-ripper", "v-corporate-exile"} <= set(result.sources["card_slugs"]) and result.sources["rule_ids"]
    assert result.to_dict()["preload"] is True and result.to_dict()["autoToolCalls"] == 3 + len(implied)


def test_a_bare_shared_name_goes_through_find_card_never_a_guess():
    with CountRuns() as counter:
        result, model = turn("Can V attack the turn it is played?")
    steps = linked_steps(result)
    assert [s["tool"] for s in steps] == ["search_rules", "find_card"] and "get_card" not in counter.runs
    found = steps[1]
    assert found["arguments"] == {"query": "V"} and found["link"]["ambiguous"] is True
    assert found["result"]["ambiguous"] is True and [m["slug"] for m in found["result"]["matches"]] == [
        "v-corporate-exile", "v-roamer-of-the-badlands", "v-streetkid"]
    tool_messages = [json.loads(m["content"]) for m in model.seen[0] if m["role"] == "tool"]
    assert tool_messages[1]["result"]["count"] == 3, "the model is given every candidate"


def test_preload_off_runs_and_adds_nothing():
    with CountRuns() as counter:
        result, model = turn("What happens when Sketchy Ripper attacks V, Corporate Exile?", preload=False)
    assert counter.runs == [] and auto_steps(result) == [] and result.auto_calls == 0
    assert [m["role"] for m in model.seen[0]] == ["system", "user"] and result.to_dict()["preload"] is False
    assert [s["kind"] for s in result.trace] == ["model"]


def test_auto_steps_come_first_and_respect_the_budget():
    question = "Sketchy Ripper, V: Streetkid, Jackie Welles and Take Control: how does Blocker work?"
    full, _ = turn(question)
    steps = auto_steps(full)
    assert full.trace[:len(steps)] == steps and [s["step"] for s in steps] == list(range(1, len(steps) + 1))
    assert len(linked_steps(full)) == 5 and sum(s["contextChars"] for s in steps) <= DEFAULT_PRELOAD_CHARS
    for budget in (5000, 2500, 900):
        result, model = turn(question, preload_chars=budget)
        sent = [m["content"] for m in model.seen[0] if m["role"] == "tool"]
        assert sum(len(c) for c in sent) <= budget, budget
        assert [len(c) for c in sent] == [s["contextChars"] for s in auto_steps(result) if s["sent"]]
        for content in sent:
            json.loads(content)  # never cut mid-JSON
        unsent = [s for s in auto_steps(result) if not s["sent"]]
        assert all(s["contextChars"] == 0 and "not sent" in s["contextNote"] for s in unsent)
        assert len(linked_steps(result)) == 5, "every step still runs and shows in the trace"
        for step in auto_steps(result):
            if not step["sent"]:
                assert not any(step["sources"].values()), "an unsent result is not a source"
        sent_ids = {v for s in auto_steps(result) if s["sent"] for vs in s["sources"].values() for v in vs}
        assert {v for vs in result.sources.values() for v in vs} == sent_ids, budget
    # A tool error (a question with no searchable words) is traced but never sent.
    failed, model = turn("?!")
    assert [(s["tool"], s["ok"], s["sent"]) for s in auto_steps(failed)] == [("search_rules", False, False)]
    assert [m["role"] for m in model.seen[0]] == ["system", "user"] and auto_steps(failed)[0]["errorKind"]
    nothing, model = turn(question, preload_chars=50)
    assert [m["role"] for m in model.seen[0]] == ["system", "user"] and not any(s["sent"] for s in auto_steps(nothing))
    # A long list is shortened from the end and its dropped ids leave the sources; the JSON stays whole.
    long = tools.search_rules("attack a spent unit with blocker", k=20)
    content, note, sources = fit_result(long, 2000)
    shown = json.loads(content)
    assert len(content) <= 2000 and 0 < len(shown["result"]["results"]) < 20 and "left out the last" in note
    assert sources["chunk_ids"] == [r["chunk_id"] for r in shown["result"]["results"]]
    assert shown["sources"] == sources and "Call the tool for the full result" in shown["context_note"]
    # An erratum is never trimmed away from its card: a card that does not fit whole is not sent.
    errata_card = next(slug for slug, rows in tools.errata_by_slug().items() if rows)
    whole = tools.get_card(errata_card)
    content, _, _ = fit_result(whole, 100000)
    assert json.loads(content)["result"]["errata"] == whole["result"]["errata"]
    assert fit_result(whole, len(content) - 1)[0] is None
    # No card in the snapshot has two errata yet; one that did would keep both or not be sent at all.
    two_errata = {"ok": True, "sources": {}, "result": {"card": {"slug": "x"}, "errata": [
        {"id": "errata:a", "text": "first " * 40}, {"id": "errata:b", "text": "second " * 40}]}}
    assert len(fit_result(two_errata, 100000)[0]) > 600 and fit_result(two_errata, 600)[0] is None
    # Nor is a card's own list (its classifications) shortened to make it fit.
    two = next(c["id"] for c in tools.cards() if len(c.get("classifications") or []) > 1)
    card, _, _ = fit_result(tools.get_card(two), 100000)
    assert fit_result(tools.get_card(two), len(card) - 1)[0] is None


def test_card_steps_depend_only_on_the_card_names():
    a, _ = turn("Does Sketchy Ripper beat V, Corporate Exile in a fight?")
    b, _ = turn("sketchy-ripper ... v corporate exile!!! explain the timing window please")
    c, _ = turn("SKETCHY RIPPER vs. V: CORPORATE EXILE — who wins a steal?")

    def cards_only(result):
        return [{k: v for k, v in s.items() if k not in ("elapsedMs", "link")} for s in linked_steps(result)
                if s["tool"] != "search_rules"]
    assert cards_only(a) == cards_only(b) == cards_only(c) and len(cards_only(a)) == 2
    # The search step differs only in its query, which is the text itself.
    assert [s["arguments"]["query"] for s in (auto_steps(a)[0], auto_steps(b)[0])] == [
        "Does Sketchy Ripper beat V, Corporate Exile in a fight?",
        "sketchy-ripper ... v corporate exile!!! explain the timing window please"]
    # Whole words only, longest first, each card once; text with no card name links nothing.
    assert link_cards("Overwatching the vs. screen") == []
    # Overlapping names from different starts: the longer one wins even though the shorter starts first.
    assert [l.span for l in link_cards("Hanako Arasaka Emergency Radioport")] == ["Arasaka Emergency Radioport"]
    links = link_cards("Sketchy Ripper and sketchy ripper, then V: Streetkid and V")
    assert [(l.span, l.slugs) for l in links] == [
        ("Sketchy Ripper", ("sketchy-ripper",)), ("V: Streetkid", ("v-streetkid",)),
        ("V", ("v-corporate-exile", "v-roamer-of-the-badlands", "v-streetkid"))]
    assert link_cards("Nocturne OP55 N1")[0].slugs == link_cards("nocturne op55 n1")[0].slugs


def test_no_code_path_reads_the_question_beyond_the_linker():
    loop_source = (REPO_ROOT / "games/cyberpunk/assistant/loop.py").read_text(encoding="utf-8")
    uses = [line.strip() for line in loop_source.splitlines() if re.search(r"\buser_message\b", line)
            and not line.strip().startswith(("async def", "def", "#"))]
    assert uses == ['return [{"role": "system", "content": system}, *history, {"role": "user", "content": user_message}]',
                    "messages = build_messages(history, user_message, deck, max_tool_calls=max_tool_calls)",
                    "auto = run_preload(user_message if preload_text is None else preload_text, k=preload_k,"], uses
    preload_source = (REPO_ROOT / "games/cyberpunk/assistant/preload.py").read_text(encoding="utf-8")
    body = preload_source[preload_source.index("def preload("):]
    body = body[body.index('"""', body.index('"""') + 3) + 3:]  # the code after the docstring
    # The text reaches only the search query and the linker; nothing compares it to a phrase.
    code = [line.strip() for line in body.splitlines() if re.search(r"\btext\b", line)]
    assert code == ['steps = [_run("search_rules", {"query": text.strip()[:SEARCH_QUERY_MAX], "k": k})]',
                    "for link in link_cards(text):"], code
    assert not re.search(r"""(text|question)\s*(==|\.startswith|\.endswith)|["'][a-z ]+["']\s+in\s+text""",
                         preload_source)
    # A step's tool and arguments come from the linker's slugs and spans, never from a word list.
    assert preload_module.link_cards.__module__ == "games.cyberpunk.assistant.preload"


# Implied rules ------------------------------------------------------------------------------

Q09 = ("You played a friendly Jacked-in Voodoo Boy in the field area this turn, then played a Pyramid Song. Can you "
       "then declare an attack with the friendly Jacked-in Voodoo Boy?\nA. Yes\nB. No")


def test_implied_rules_bring_the_lag_rules_for_an_attack_question_that_never_says_lag():
    # Cody's quiz 09 (key B): Units enter with Lag (4.7) and lagging Units can't attack (9.3.1.1, 11.3.1.1). The
    # question never says "lag"; the search finds the attack declaration rule 9.3.1, and the data does the rest.
    steps = preload_module.preload(Q09)
    search = steps[0]
    assert search.tool == "search_rules" and search.sources["rule_ids"][0] == "9.3.1"
    assert not any("11.3" in i for i in search.sources["rule_ids"]), "the search alone does not reach Lag"
    implied = [s for s in steps if s.implied is not None]
    assert [(s.tool, s.arguments, s.implied) for s in implied] == [
        ("get_rule", {"rule_id": "9.3.1.1"}, {"via": "sub-rule", "of": "9.3.1"}),
        ("get_rule", {"rule_id": "11.3"}, {"via": "see", "of": "9.3.1.1"}),
        ("get_rule", {"rule_id": "4.6"}, {"via": "card type", "of": "Unit"})]
    assert all(s.sent for s in implied) and sum(len(s.content) for s in steps if s.sent) <= DEFAULT_PRELOAD_CHARS
    lag = json.loads(implied[1].content)["result"]
    assert lag["rule"]["text"] == "11.3. ### Lag" and "11.3.1" in implied[1].sources["rule_ids"]
    assert {"9.3.1.1", "4.7"} <= {r["id"] for r in lag["referenced_by"]}, "who points at Lag, with their titles"
    assert json.loads(implied[0].content)["result"]["rule"]["text"].startswith("9.3.1.1. Lagging Units can")
    # The same steps reach the model through the loop, after the search and the cards, marked as implied.
    result, model = turn(Q09)
    traced = [s for s in auto_steps(result) if "implied" in s]
    assert [s["arguments"] for s in traced] == [s.arguments for s in implied]
    assert [s["implied"] for s in traced] == [s.implied for s in implied]
    assert {"9.3.1.1", "11.3"} <= set(result.sources["rule_ids"])
    assert [c["function"]["name"] for c in model.seen[0][2]["tool_calls"]][-3:] == ["get_rule"] * 3


def test_implied_rules_follow_only_data_relations():
    implied_rules = preload_module.implied_rules
    # A pure function of rule ids and card types: no text goes in, so the same hits give the same rules.
    assert implied_rules(["9.3.1"], []) == implied_rules(["9.3.1"], []) == [
        ("9.3.1.1", {"via": "sub-rule", "of": "9.3.1"}), ("11.3", {"via": "see", "of": "9.3.1.1"})]
    assert implied_rules(["9.3.1"], [], kinds=("children",)) == [("9.3.1.1", {"via": "sub-rule", "of": "9.3.1"})]
    assert implied_rules(["9.3.1"], [], kinds=("see",)) == [], "9.3.1 itself links nowhere"
    assert implied_rules(["4.7"], [], kinds=("see",)) == [("11.3", {"via": "see", "of": "4.7"})]
    assert implied_rules(["9.3.1"], [], kinds=()) == []
    # A hit that is already there is not added again; nor is a whole section or an unnumbered heading.
    assert implied_rules(["9.3.1", "9.3.1.1", "11.3"], [], kinds=("see",)) == []
    assert implied_rules(["9.3.1", "9.3.1.1"], [], kinds=("children", "see")) == [
        ("11.3", {"via": "see", "of": "9.3.1.1"})]
    assert all(tools.rules_by_id()[i]["kind"] != "section" and re.fullmatch(r"[\d.]+|TR .+", i)
               for i, _ in implied_rules(["9.6", "9.3"], [], kinds=("see",), limit=20))
    assert "9" not in [i for i, _ in implied_rules(["9.6"], [], kinds=("see",))], "See ATTACK, FIGHT, AND STEAL"
    # Only short sub-rules: a child over CHILD_MAX_CHARS is a rule of its own, not a clarification.
    long_child = next(c for r in tools.rules() for c in tools.rule_children().get(r["id"], ())
                      if re.fullmatch(r"[\d.]+", c) and re.fullmatch(r"[\d.]+", r["id"])
                      and len(tools.rules_by_id()[c]["text"]) > preload_module.CHILD_MAX_CHARS)
    parent = tools.rules_by_id()[long_child]["parent"]
    assert long_child not in [i for i, _ in implied_rules([parent], [], kinds=("children",), limit=50)]
    # Card types: the rules under the heading named for the type, and nothing for a type with no heading.
    assert [i for i, _ in implied_rules([], ["Unit"], kinds=("card_type",), limit=10)] == ["4.6", "4.7", "4.8"]
    assert [i for i, _ in implied_rules([], ["Program"], kinds=("card_type",), limit=10)] == ["4.13", "4.14"]
    assert implied_rules([], ["Spaceship"], kinds=("card_type",)) == []
    assert len(implied_rules(["9.3.1", "4.7"], ["Unit", "Gear"], limit=2)) == 2
    # Two wordings that link the same card: the card's part of the expansion is the same.
    a = preload_module.preload("Does the Jacked-In Voodoo Boy have to wait a turn?", implied=("card_type",))
    b = preload_module.preload("jacked-in voodoo boy: what can it do right after I play it", implied=("card_type",))
    expansion = [[(s.arguments, s.implied) for s in steps if s.implied is not None] for steps in (a, b)]
    assert expansion[0] == expansion[1] == [({"rule_id": i}, {"via": "card type", "of": "Unit"})
                                            for i in ("4.6", "4.7", "4.8")]
    # With the default kinds, each wording's expansion is exactly implied_rules of what was sent: hits and types.
    for text in ("Does the Jacked-In Voodoo Boy have to wait a turn?", Q09):
        steps = preload_module.preload(text)
        hits = [i for s in steps if s.tool == "search_rules" and s.sent for i in s.sources["rule_ids"]]
        types = [s.result["result"]["card"]["card_type"] for s in steps if s.tool == "get_card" and s.sent]
        assert [(s.arguments["rule_id"], s.implied) for s in steps if s.implied is not None] == implied_rules(hits, types)
    # A type named by two headings is ambiguous and adds nothing (fail closed), whatever the snapshot has now.
    rows = dict(tools.rules_by_id())
    rows["rule-duplicate"] = {**rows["rule-1cd8bea3-a2e2-52ee-b00a-7e4dfe3c5824"], "id": "rule-duplicate"}
    saved = preload_module.rules_by_id
    preload_module.rules_by_id = lambda: rows
    try:
        assert implied_rules([], ["Unit"], kinds=("card_type",)) == []
        assert implied_rules([], ["Gear"], kinds=("card_type",)) != []
    finally:
        preload_module.rules_by_id = saved
    # Only what was sent is expanded: a search that did not fit implies nothing.
    starved = preload_module.preload(Q09, budget=50)
    assert not any(s.sent for s in starved) and not [s for s in starved if s.implied is not None]
    # Off means off; and a budget too small for them sends none (they run and are traced, never sent).
    assert not [s for s in preload_module.preload(Q09, implied=()) if s.implied is not None]
    tight = preload_module.preload(Q09, budget=4700)
    assert [s.sent for s in tight if s.implied is not None] and not all(s.sent for s in tight if s.implied is not None)
    assert sum(len(s.content) for s in tight if s.sent) <= 4700


# Thinking -----------------------------------------------------------------------------------


def test_thinking_is_on_by_default_with_a_larger_token_limit():
    _, model = turn("hi", preload=False)
    assert model.kwargs[0] == {"max_tokens": DEFAULT_THINKING_MAX_TOKENS, "enable_thinking": True}
    _, model = turn("hi", preload=False, enable_thinking=False)
    assert model.kwargs[0] == {"max_tokens": DEFAULT_MAX_TOKENS, "enable_thinking": False}
    result, model = turn("hi", preload=False, max_tokens=300)
    assert model.kwargs[0]["max_tokens"] == 300 and result.to_dict()["maxTokens"] == 300
    assert (DEFAULT_THINKING_MAX_TOKENS, DEFAULT_MAX_TOKENS) == (2048, 1024)
    chat = ChatService(ScriptedModel(["a", "b"]))
    assert chat.enable_thinking is True and chat.preload is True and chat.max_tokens is None
    asyncio.run(chat.chat("s", "hi", preload=False))
    asyncio.run(chat.chat("s", "hi", thinking=False, preload=False))
    assert chat.model.kwargs == [{"max_tokens": 2048, "enable_thinking": True},
                                 {"max_tokens": 1024, "enable_thinking": False}]


def run() -> None:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS assistant prompt: {len(tests)}/{len(tests)}")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    run()


if __name__ == "__main__":
    main()
