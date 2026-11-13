#!/usr/bin/env python3
"""Build the rules-only true/false SFT set for a LoRA on the local assistant's 8B model.

Why: Qwen3-8B 4-bit scores a mean of 33/40 on Cody's mixed quizzes against a bar
of 35, and its misses are reasoning habits rather than missing knowledge: it
leans No (60 No answers against 49 No keys), flips negated statements, reads
effect text as a cost, ignores the more specific rule and answers No when "no
rule explicitly permits" something. This writes training items that drill the
habit of judging a statement, as written, against the rule in front of it --
built only from the rules snapshot, never from a quiz (plan: LoRA on rules-based
true/false, approved by Cody 2026-11-13).

Sources. Only ``data/processed/rules.jsonl`` and
``data/processed/tournament_rules.jsonl``: numbered ``rule`` records, their text
cut at the first block quote (the ``> **EXAMPLE:**`` / ``> Example:`` blocks)
and at any sentence that says "example". Nothing under ``data/gold``,
``eval/`` or ``data/raw/official_tests`` is read, except that the leak guard
reads ``data/gold/*.jsonl`` to compare against.

Items. Each usable rule sentence gives one pair: a true restatement (the
sentence itself, markdown removed, an instruction such as "Draw 6 cards." made
"You draw 6 cards.") and a false twin made by one typed mutation. The mutation
kinds were chosen from the failure patterns above; which rules get used is not:
every numbered rule is scanned the same way. Every mutation acts on the main
clause (after a leading "If/When ...," clause, before the first subordinator):
flipping a word inside a condition ("When you can't pay, ...") would not negate
the rule.

  - ``polarity``: the main clause's one site flips (can/cannot, may/may not,
    must/need not, must not/may, should/should not, is considered/is not
    considered, never/always, is/is not, does not/does, has/does not have).
    Only when it is the main clause's only site, with no other modal or
    negation, "only", "unless", "except" and the like in it, never on "may be"
    (as often "might be" as "is allowed to be"), and on a plain is/has/does
    only within the first nine words (further in it is likely inside a
    clause) and only in the Comprehensive Rules (a plain "is" in the
    Tournament Rules often describes an infraction rather than states a rule).
  - ``permissive``: a sentence allowing something ("<subject> may/can X")
    becomes "it is not allowed for <subject> to X", the "nothing explicitly
    permits it" trap.
  - ``number``: the sentence's one number moves by one (a word with its digit,
    "three (3)", counts as one number). Not when any other digit is present
    (a range "40-50", "7-card", "Bo3"), not for 0 or 1 (the noun after it would
    need its number changed), not after a capitalised label ("Level 1"), not
    with an ordinal, not near a lower bound ("at least", "or more": moving
    those can keep the statement true), not in a condition and not in a
    negated main clause ("can't draw 2" says nothing about 3). Upper bounds
    ("up to", "or less") only move up.
  - ``state`` / ``side``: the one ready/spent or friendly/rival adjective swaps,
    only in a main clause that says what one can, may or must do (a qualifier
    there restricts a choice; in a plain description the swapped statement can
    be just as true: "a rival Unit goes to its owner's trash"), with no
    negation (the side partition is not complete: fixer-area dice are neither
    friendly nor rival), no second state or side word including the noun
    Rival, and not the verb ("can be spent").
  - ``quantifier``: a clause-initial "Only X" becomes "Not only X", and a
    clause-initial "Each/Every X" becomes "Only one X".

A sentence with no mutation that applies unambiguously is skipped, and each
skip is counted by reason in the manifest. Several conditions that make a
sentence unsafe to judge on its own also skip it: a pronoun or "this/these/
also/if so" that points outside the sentence, a quotation longer than three
words or holding a word a mutation could act on, a colon, a list item, a
heading, an abbreviation, a parenthesis, fewer than 5 or more than 45 words.
When a sentence allows several mutations one is picked by a hash of the rule id
and the sentence, so the pick does not depend on input order.

Phrasing. Each pair is phrased one of four ways, so "not" is no cue to the
label and questions sit beside statements as in the quizzes:

  - ``statement``: the true sentence (Yes) and its false twin (No);
  - ``negated``: "It is not true that <false twin>" (Yes) and "It is not true
    that <true sentence>" (No), so both items carry "not";
  - ``lexical`` (polarity twins of a can/may/must rule): the true sentence (Yes)
    and "It is forbidden/optional for <subject> to X" (No), so neither does;
  - ``question``: "Can <subject> X?" from the true sentence (Yes) and from the
    twin (No) for number, state and side twins of a can/may sentence; for a
    polarity twin of a can/may sentence, "Can <subject> X?" and "Is it true
    that <subject> cannot X?", labelled by what the rule says.

About a third of eligible pairs become questions and about one other pair in
five is negated (by hash); the rest start as statements, and while the items
containing a negation lean to one label, statements leaning that way become
lexical or negated (in hash order) until Yes and No items with a negation are
equal. Most rules allow or require something, so their statement twins carry
the "not"; balancing that keeps negations at about 70% of items rather than half.
The phrasing depends only on the pairs, never on their order.

Validity. A pair is dropped when the source sentence is not visible, word for
word, in the preloaded tool results of either of its prompts: the target
quotes it, and training the model to quote a rule it was not shown would teach
it to invent rules. Dropped pairs are counted (``source-not-in-preload``).

Labels. Every pair holds one Yes and one No, so the template items are exactly
50/50; leak-guard drops remove whole pairs. Each row records ``id``, ``kind``
(``rule-template``), ``source_rule_ids``, ``mutation``, ``phrasing``, ``label``
(``A`` = Yes, ``B`` = No, as the gold sets key them) and ``answer``. The rule
text is not a row field: it reaches the model only through the prompt.

Split. By rule id: ``sha256("rules-tf-v1:<rule id>")`` below 10% of the hash
space goes to valid, so no rule is in both splits and the draw ignores order.

Prompt shape: training matches inference. Each example is built by calling
the scorer's own code with a capturing stand-in model: ``loop.run_turn`` with
``eval_assistant.question_message`` (``EVAL_PROMPT_VERSION`` eval-mc-v1, choices
"A. Yes" / "B. No"), ``preload_text``, the default preload settings, thinking on
and the ``--max-tokens 4096`` of the v7 commands. The messages and tool specs
the stand-in receives on its first step are exactly what the MLX worker would
render; they become ``messages`` (plus the assistant target) and ``tools``,
which mlx-lm 0.31.3's ``ChatDataset`` passes to ``apply_chat_template`` as the
worker does.

Retrieval index. ``search_rules`` fuses an embedding index when
``data/processed/corpus_index.npz`` exists and matches the corpus, and
otherwise falls back to lexical BM25 with a ``fallback_reason`` (the scorer
does the same; the index is a git-ignored Mac build artifact). This script does
exactly what the scorer does on the machine it runs on and records the search
methods and fallback reasons it saw in the manifest. Built on Linux, every
preload is lexical.

Thinking. The Mac worker passes ``enable_thinking`` to Qwen3's chat template;
the scorer turns it on by default, so the generation prompt is
``<|im_start|>assistant\\n`` and the model writes ``<think>...</think>`` and then
its answer, which ``loop.split_thinking`` separates before the scorer parses
``Answer: X``. mlx-lm's ``ChatDataset`` renders without ``enable_thinking``,
which Qwen3's template treats as on: the masked prompt ends with the same
``<|im_start|>assistant\\n``, and a final assistant message holding
``<think>\\n...\\n</think>\\n\\n...`` renders as the model's own output does. So
the target is a short think block (the statement set against the quoted rule)
followed by the visible part: the rule cited by number and quoted, the one-line
conclusion the v7 guidance asks for, and ``Answer: A`` or ``Answer: B``. An
empty think block would instead teach thinking mode to skip thinking, which
the model never sees at inference with thinking on. The short think block may
shorten the model's thinking on hard questions; the Mac eval will show it.

Leak guard. ``leak_guard`` normalises text (lowercase, brackets and
punctuation removed) and fails an item whose statement or target shares a word
8-gram with any question or choice text in ``data/gold/*.jsonl``, or whose
statement's ``difflib.SequenceMatcher`` ratio to any gold question (over the
two lists of normalised words) is 0.8 or more. Rules text overlaps quiz questions that quote rules, so items that trip
it are dropped as whole pairs and counted (``leak_dropped``); nothing is tuned
to make it pass. The guard then runs again over what is written and is a hard
error if anything still trips. The five nearest pairs are printed either way
and stored in the manifest.

Scenario hook. ``--scenarios FILE`` adds drafted scenario items (rows with
exactly ``id``, ``statement``, ``label`` true/false, ``source_rule_ids`` and
``kind: "scenario-drafted"``). Each row is checked and the build fails closed
on a missing or extra field, a wrong type, an unknown rule id, a duplicate id
or a file whose labels are not exactly balanced. They go through the same
prompt shape, preload check (every cited rule must appear in the preload's
sources), leak guard and split by rule (by their first cited rule), and are
balanced on their own: after drops the larger label is trimmed by hash and
counted. The committed set is built without it.

Output: ``data/datasets/rules-tf-v1/{train,valid}.jsonl`` and ``manifest.json``
(source paths and sha256s, both rules versions, counts by kind, mutation,
phrasing and label, skip reasons, the leak-guard result, the preload's search
methods and per-example size estimates). Deterministic: no clock, no network,
no model, and the same inputs in any order give the same bytes. Refuses to
shrink an existing set below half without ``--force``.

Usage:
    python scripts/build_tf_dataset.py
    python scripts/build_tf_dataset.py --check     # build in memory, compare with the committed files
    python scripts/build_tf_dataset.py --scenarios drafts.jsonl --out /tmp/tf
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import difflib
import hashlib
import json
import re
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import eval_assistant  # noqa: E402  (the scorer: its wrapper, preload text and answer parser)
from games.cyberpunk.assistant.loop import (ASSISTANT_PROMPT_VERSION, MAX_TOOL_CALLS,  # noqa: E402
                                            run_turn, split_thinking)
from games.cyberpunk.assistant.preload import DEFAULT_PRELOAD_CHARS, DEFAULT_PRELOAD_K  # noqa: E402
from games.cyberpunk.prompts import RULES_VERSION, TOURNAMENT_RULES_VERSION  # noqa: E402
from harness.core.io import file_sha256, guard_shrink, read_jsonl, write_jsonl_atomic  # noqa: E402

DATASET = "rules-tf-v1"
BUILDER_VERSION = "build-tf-dataset-v1"
SOURCES = ("data/processed/rules.jsonl", "data/processed/tournament_rules.jsonl")
OUT_DIR = REPO_ROOT / "data/datasets" / DATASET
GOLD_DIR = REPO_ROOT / "data/gold"
SPLIT_SALT = DATASET
VALID_PERCENT = 10
EVAL_MAX_TOKENS = 4096  # the v7 commands' --max-tokens; the stand-in model ignores it
QUESTION_EVERY = 3      # about one eligible pair in three becomes a question
NEGATED_EVERY = 5       # about one other pair in five is always phrased "It is not true that ..."
LEAK_NGRAM = 8
LEAK_RATIO = 0.8
MIN_WORDS, MAX_WORDS = 5, 45
MAX_SUBJECT_WORDS = 9   # a plain is/are/has/does-not site further into its clause is not taken as the main verb
CHOICES = [{"letter": "A", "text": "Yes"}, {"letter": "B", "text": "No"}]
LABEL_ANSWER = {"A": "Yes", "B": "No"}
TEMPLATE_KIND = "rule-template"
SCENARIO_KIND = "scenario-drafted"
SCENARIO_FIELDS = ("id", "statement", "label", "source_rule_ids", "kind")
MUTATIONS = ("polarity", "permissive", "number", "state", "side", "quantifier")


class BuildError(Exception):
    """A fail-closed problem with the inputs or the result."""


def _h(*parts: str) -> int:
    return int(hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest(), 16)


# Rule text ---------------------------------------------------------------------------------

ID_PREFIX_RE = re.compile(r"^\s*(?:TR\s+)?[A-Z]?\d+(?:\.\d+)*\.?\s+")
SENTENCE_SPLIT_RE = re.compile(r"(?:(?<=[.!?])|(?<=[.!?][\"”]))\s+(?=[A-Z\[\"“])")
LINK_RE = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
EMPHASIS_RE = re.compile(r"(\*\*|__|(?<![\w*])\*(?=\S)|(?<=\S)\*(?![\w*])|(?<![\w])_(?=\S)|(?<=\S)_(?![\w]))")


def numbered_rules(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r.get("kind") == "rule" and r.get("is_numbered")]


def rule_body(text: str) -> str:
    """The rule's own text: id prefix removed, cut at the first block quote (EXAMPLE blocks)."""
    lines = []
    for line in text.split("\n"):
        if line.lstrip().startswith(">"):
            break
        lines.append(line)
    return ID_PREFIX_RE.sub("", "\n".join(lines), count=1)


def raw_sentences(body: str) -> list[str]:
    """Sentences of the body as written (markdown and curly quotes kept), one paragraph line at a time."""
    out = []
    for line in body.split("\n"):
        line = line.strip()
        if not line:
            continue
        out.extend(s.strip() for s in SENTENCE_SPLIT_RE.split(line) if s.strip())
    return out


IMPERATIVES = {"draw", "place", "shuffle", "choose", "roll", "put", "pay", "spend", "play", "follow", "ignore", "use",
               "communicate", "resolve", "reveal", "return", "discard", "trash", "remove", "add", "gain", "look",
               "present", "forgo", "treat", "check", "count", "take", "keep", "move", "select", "attach", "equip",
               "steal", "attack", "deal", "give", "apply", "repeat", "assume", "announce", "declare", "determine",
               "perform", "record", "report", "ensure", "submit", "bring", "wait", "randomize", "flip", "set", "turn",
               "begin", "end", "pass", "activate", "sell", "search", "ready", "top-deck", "bottom-deck", "conduct",
               "complete", "reroll", "proceed", "continue", "note", "inform", "contact", "issue", "leave"}


def declarative(text: str) -> str:
    """An instruction made a statement: "Draw 6 cards." -> "You draw 6 cards." (also after "If X, ").

    A bare instruction is not a statement to judge, and "It is not true that draw 6 cards" is not English.
    """
    prefix = CLAUSE_PREFIX_RE.match(text).group(0)
    rest = text[len(prefix):]
    words = rest.split(" ", 2)
    first = words[0].lower()
    if first in ("always", "never") and len(words) > 1 and words[1].lower() in IMPERATIVES:
        return f"{prefix}{'You' if not prefix else 'you'} {first} {rest.split(' ', 1)[1]}"
    if first in IMPERATIVES:
        return f"{prefix}{'You' if not prefix else 'you'} {rest[0].lower()}{rest[1:]}"
    if first in ("do", "don't") and len(words) > 2 and (words[1].lower() == "not" and words[2].split(" ")[0].lower()
                                                        in IMPERATIVES or first == "don't"
                                                        and words[1].lower() in IMPERATIVES):
        return f"{prefix}{'You' if not prefix else 'you'} {rest[0].lower()}{rest[1:]}"
    return text


def clean(sentence: str) -> str:
    """Markdown emphasis and links removed, straight apostrophes and quotes, single spaces."""
    text = LINK_RE.sub(r"\1", sentence)
    text = EMPHASIS_RE.sub("", text)
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip()


PRONOUN_START = {"it", "its", "they", "them", "their", "this", "these", "that", "those", "he", "she", "such",
                 "here", "there", "then", "also", "otherwise", "however", "instead", "likewise", "similarly", "so"}
CONTEXT_RE = re.compile(r"\b(this|these|those|above|below|following|aforementioned|such|here|former|latter|also|"
                        r"if so|if not|in that case|in this case|as well)\b", re.I)
ABBREV_RE = re.compile(r"\b(e\.g|i\.e|etc|vs|approx|fig|no)\.", re.I)
QUOTED_RE = re.compile(r'"([^"]*)"')
MAX_QUOTED_WORDS = 3


def sentence_skip(raw: str, text: str) -> str | None:
    """Why a sentence cannot be judged on its own, or None."""
    stripped = raw.lstrip()
    if stripped.startswith("#"):
        return "heading"
    if re.match(r"^([-*+]|\d+[.)])\s", stripped) or "|" in text:
        return "list-or-table"
    if "example" in text.lower():
        return "example-text"
    if not (text.endswith(".") or text.endswith('."')):
        return "not-a-declarative-sentence"
    if text.count('"') % 2:
        return "quotation"
    for quoted in QUOTED_RE.findall(text):
        if len(quoted.split()) > MAX_QUOTED_WORDS or TRIGGER_RE.search(quoted):
            return "quotation"
    if ":" in text or ";" in text:
        return "colon-or-semicolon"
    if ABBREV_RE.search(text):
        return "abbreviation"
    words = text.split()
    if not MIN_WORDS <= len(words) <= MAX_WORDS:
        return "length"
    first = re.sub(r"[^\w']", "", words[0]).lower()
    if first in PRONOUN_START:
        return "context-pronoun"
    if CONTEXT_RE.search(text) or (re.search(r"\bthen\b", text, re.I) and first not in ("if", "when", "whenever")):
        return "context-reference"
    if re.search(r"\bsee\b", text, re.I):
        return "cross-reference"
    pronoun = re.search(r"\b(it|them)\b", text, re.I)
    if pronoun and len(text[:pronoun.start()].split()) < 7:
        return "context-pronoun"  # "you can't look at them": what "them" is lies in another sentence
    if "(" in re.sub(r"\(\d+\)", "", text):
        return "parenthetical"
    if not text[0].isupper():
        return "fragment"
    return None


# Mutations ---------------------------------------------------------------------------------

@dataclass(frozen=True)
class Mutation:
    kind: str
    text: str     # the false twin
    old: str      # what the rule says, as written in the true sentence
    new: str      # what the twin says instead


NEGATION_RE = re.compile(r"\b(not|no|never|none|nothing|neither|nor|cannot|without)\b|n't\b", re.I)
RESTRICTOR_RE = re.compile(r"\b(only|unless|except|otherwise|instead|rather)\b", re.I)
OTHER_MODAL_RE = re.compile(r"\b(will|would|could|might|shall|won't|wouldn't|couldn't)\b", re.I)
# A word any mutation could act on; quoted terms may not contain one (a site inside a quote is never changed).
TRIGGER_RE = re.compile(r"\b(can|may|must|should|need|not|no|never|always|is|are|has|have|only|each|every|ready|"
                        r"spent|friendly|rival|considered)\b|n't\b|\d", re.I)
SUBORDINATOR_RE = re.compile(r"\b(if|when|whenever|while|unless|until|after|before|once|because|since|although|"
                             r"though|whether|that|which|who|whom|whose|where|than|as soon as|as long as|so that|even if)\b",
                             re.I)
CLAUSE_PREFIX_RE = re.compile(r"^((?:If|When|While|During|After|Before|Once|Whenever|Until|At|In|As long as|"
                              r"As soon as|Each time|Any time|Unless|Since|Although|Even if|Whether|For|On|Upon|"
                              r"Throughout|Within|Outside of|Following)\b[^,]*,\s+)?")
POSSESSED = ("a", "an", "the", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "its",
             "their", "your", "multiple", "any", "up", "no")

_CONTRACTED = {"doesn't": "does", "don't": "do", "isn't": "is", "aren't": "are"}

# (pattern, replacement, negative?) -- negative forms first so "may not" is never read as "may", and the bare
# copula last so "is considered" is read whole. A replacement is a template or a function of the match.
POLARITY_FORMS = [
    (r"\bcan(?:not|'t| not)\b", "can", True),
    (r"\bmay not\b", "may", True),
    (r"\bmust not\b|\bmustn't\b", "may", True),
    (r"\b(?:need not|do not have to|does not have to|don't have to|doesn't have to)\b", "must", True),
    (r"\bshould not\b|\bshouldn't\b", "should", True),
    (r"\b(is|are) not considered\b", r"\1 considered", True),
    (r"\bnever\b", "always", True),
    (r"\b(does|do|is|are) not\b", r"\1", True),
    (r"\b(?:doesn't|don't|isn't|aren't)\b", lambda m: _CONTRACTED[m.group().lower()], True),
    (r"\bcan\b", "cannot", False),
    (r"\bmay\b", "may not", False),
    (r"\bmust\b", "need not", False),
    (r"\bshould\b", "should not", False),
    (r"\b(is|are) considered\b", r"\1 not considered", False),
    (r"\balways\b", "never", False),
    (r"\bhas\b(?=\s+(?:" + "|".join(POSSESSED) + r"|\d)\b)", "does not have", False),
    (r"\bhave\b(?=\s+(?:" + "|".join(POSSESSED) + r"|\d)\b)", "do not have", False),
    (r"\b(is|are)\b", r"\1 not", False),
]


@dataclass(frozen=True)
class ModalSite:
    start: int
    end: int
    text: str
    replacement: str
    negative: bool


def modal_sites(text: str) -> list[ModalSite]:
    sites: list[ModalSite] = []
    taken: list[tuple[int, int]] = []
    for pattern, replacement, negative in POLARITY_FORMS:
        for m in re.finditer(pattern, text, re.I):
            if any(m.start() < e and s < m.end() for s, e in taken):
                continue
            taken.append((m.start(), m.end()))
            new = replacement(m) if callable(replacement) else m.expand(replacement)
            if m.group()[0].isupper():
                new = new[0].upper() + new[1:]
            sites.append(ModalSite(m.start(), m.end(), m.group(), new, negative))
    return sorted(sites, key=lambda s: s.start)


def main_clause(text: str) -> tuple[int, int] | None:
    """(start, end) of the main clause: after a leading "If ...," clause, up to the first subordinator.

    None when the sentence opens with a subordinate clause that has no comma to end it.
    """
    start = len(CLAUSE_PREFIX_RE.match(text).group(0))
    first = text[start:].split(" ", 1)[0].lower()
    if start == 0 and SUBORDINATOR_RE.fullmatch(first):
        return None
    after = SUBORDINATOR_RE.search(text, start)
    return start, (after.start() if after else len(text))


def main_sites(text: str) -> tuple[list[ModalSite], tuple[int, int] | None]:
    span = main_clause(text)
    if span is None:
        return [], None
    return [s for s in modal_sites(text) if span[0] <= s.start < span[1]], span


def _replace(text: str, start: int, end: int, new: str) -> str:
    return text[:start] + new + text[end:]


DEONTIC_RE = re.compile(r"^(can|cannot|can't|can not|may|may not|must|must not|mustn't|need not|do not have to|"
                        r"does not have to|don't have to|doesn't have to|should|should not|shouldn't)$", re.I)


def mutate_polarity(text: str, deontic_only: bool = False) -> Mutation | str | None:
    """``deontic_only``: flip only can/may/must/should (the Tournament Rules, whose plain "is" sentences
    often describe an infraction rather than state a rule)."""
    sites, span = main_sites(text)
    if span is None:
        return "subordinate-opening" if modal_sites(text) else None
    if not sites:
        return None
    if len(sites) > 1:
        return "polarity-several-sites"
    site = sites[0]
    if deontic_only and not DEONTIC_RE.match(site.text):
        return "polarity-descriptive-tournament"
    if not DEONTIC_RE.match(site.text) and len(text[span[0]:site.start].split()) > MAX_SUBJECT_WORDS:
        # "The bottom textbox contains effects inherited by the Unit the Gear is equipped to": a plain "is"
        # this far in is more likely inside a clause than the main verb.
        return "polarity-late-copula"
    main = text[span[0]:span[1]]
    if OTHER_MODAL_RE.search(main):
        return "polarity-other-modal"
    if site.text.lower() == "may" and text[site.end:].split(" ", 2)[1:2] == ["be"]:
        return "polarity-may-be"  # "may be" is as often "might be" as "is allowed to be"
    before = text[span[0]:site.start].split()
    if len(before) > 1 and before[-1].lower() in ("it", "they", "he", "she", "we", "you", "them"):
        return "polarity-embedded"  # "the Unit it is equipped to": a clause inside the main one
    rest = text[span[0]:site.start] + text[site.end:span[1]]
    if NEGATION_RE.search(rest) or RESTRICTOR_RE.search(main):
        return "polarity-extra-negation"
    return Mutation("polarity", _replace(text, site.start, site.end, site.replacement), site.text, site.replacement)


SUBJECT_WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*$|^\[[A-Za-z ]+\]$")
LOWERABLE = {"you", "a", "an", "the", "each", "every", "players", "player", "your", "their", "both", "all", "any",
             "only", "if", "when", "while", "during", "after", "before", "once", "at", "in", "until", "whenever",
             "as", "not", "to", "for", "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
             "ten", "draw", "place", "choose", "pay", "spend", "play", "ignore", "follow", "use", "communicate",
             "resolve", "reveal", "return", "put", "shuffle", "roll", "remove", "add", "gain", "look", "present",
             "treat", "check", "count", "take", "keep", "move", "select", "attach", "equip", "call", "steal",
             "attack", "deal", "give", "apply", "repeat", "assume", "announce", "declare", "determine", "perform",
             "record", "report", "ensure", "submit", "bring", "forgo", "trash", "discard", "judges", "event",
             "events", "tournament", "organizers", "competitors", "participants", "decklists", "on", "upon",
             "unless", "since", "although", "even", "whether", "throughout", "within", "outside", "following",
             "card", "cards", "effects", "an", "pieces", "spectators", "judge", "it", "always", "never", "some"}


def lcfirst(text: str) -> str:
    first = text.split(" ", 1)[0]
    lower = first.lower() in LOWERABLE or (first.endswith("ing") and first[1:].islower())  # "Moving a card"
    return text[0].lower() + text[1:] if lower else text


@dataclass(frozen=True)
class Clause:
    prefix: str    # "If X, " or ""
    subject: str
    modal: ModalSite
    rest: str      # after the modal, without the final period


def parse_clause(text: str, modals: tuple[str, ...] = ("can", "may")) -> Clause | None:
    """``<prefix>, <subject> <modal> <rest>.``: the main clause's one site is one of ``modals``, after a short
    plain subject."""
    sites, span = main_sites(text)
    if span is None or len(sites) != 1 or sites[0].negative or sites[0].text.lower() not in modals:
        return None
    site = sites[0]
    if site.text.lower() == "may" and text[site.end:].split(" ", 2)[1:2] == ["be"]:
        return None
    prefix = text[:span[0]]
    subject = text[span[0]:site.start].strip()
    words = subject.split()
    if not 1 <= len(words) <= 5 or not all(SUBJECT_WORD_RE.match(w) for w in words):
        return None
    if (words[0].lower() in PRONOUN_START or words[0].lower() in ("only", "not", "some", "most", "many", "any")
            or SUBORDINATOR_RE.search(subject)):
        return None
    rest = text[site.end:].strip()
    if not rest.endswith(".") or len(rest.split()) < 2:
        return None
    return Clause(prefix, subject, site, rest[:-1])


LEXICAL_WORDS = {"can": "forbidden", "may": "forbidden", "must": "optional"}


def lexical_twin(text: str) -> str | None:
    """The negation of a can/may/must sentence with no "not": "It is forbidden/optional for <subject> to X."."""
    clause = parse_clause(text, tuple(LEXICAL_WORDS))
    if clause is None:
        return None
    lead = "it" if clause.prefix else "It"
    word = LEXICAL_WORDS[clause.modal.text.lower()]
    return f"{clause.prefix}{lead} is {word} for {lcfirst(clause.subject)} to {clause.rest}."


def to_question(text: str) -> str | None:
    clause = parse_clause(text)
    if clause is None:
        return None
    subject = lcfirst(clause.subject)
    lead = f"{clause.prefix}can" if clause.prefix else "Can"
    return f"{lead} {subject} {clause.rest}?"


def mutate_permissive(text: str) -> Mutation | str | None:
    clause = parse_clause(text)
    if clause is None:
        return None
    start, end = main_clause(text)
    main = text[start:clause.modal.start] + text[clause.modal.end:end]
    if NEGATION_RE.search(main) or RESTRICTOR_RE.search(main) or OTHER_MODAL_RE.search(main):
        return "permissive-extra-negation"
    subject = clause.subject[0].lower() + clause.subject[1:] if clause.subject.split()[0].lower() in LOWERABLE \
        else clause.subject
    lead = "it" if clause.prefix else "It"
    new = f"{lead} is not allowed for {subject} to {clause.rest}"
    twin = f"{clause.prefix}{new}."
    return Mutation("permissive", twin, f"{clause.subject} {clause.modal.text} {clause.rest}", new)


NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
                "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]
NUMBER_RE = re.compile(r"\b(" + "|".join(NUMBER_WORDS) + r")\b(\s*\((\d+)\))?|(?<![\w.\-/])(\d+)(?![\w%°\-/]|\.\d)",
                       re.I)
NUMBER_LIKE_RE = re.compile(r"\b(once|twice|thrice|single|double|triple|half|dozen|several|couple|first|second|"
                            r"third|fourth|fifth|sixth|seventh|last)\b|\d+(?:st|nd|rd|th)\b", re.I)
LOWER_BOUND_RE = re.compile(r"\b(at least|or more|or greater|or higher|minimum|more than|greater than|over|"
                            r"exceed\w*|between|or above)\b", re.I)
UPPER_BOUND_RE = re.compile(r"\b(up to|at most|or less|or fewer|or lower|maximum|no more than|fewer than|less than)\b",
                            re.I)


def mutate_number(text: str, salt: str) -> Mutation | str | None:
    found = list(NUMBER_RE.finditer(text))
    if not found:
        return None
    if len(found) > 1:
        return "number-several"
    if NUMBER_LIKE_RE.search(text):
        return "number-like-word"
    m = found[0]
    if re.search(r"\d", text[:m.start()] + text[m.end():].replace(m.group(3) or "\x00", "", 1)):
        return "number-several"  # a range ("40-50"), a hyphenated count ("7-card") or a code ("Bo3")
    if m.group(1):
        value = NUMBER_WORDS.index(m.group(1).lower())
        if m.group(3) is not None and int(m.group(3)) != value:
            return "number-word-digit-disagree"
    else:
        value = int(m.group(4))
    if value <= 1:
        return "number-zero-or-one"
    before = text[:m.start()].split()
    if before and before[-1][0].isupper() and before[-1].lower() not in LOWERABLE:
        return "number-label"  # "Level 1", "Game 2"
    span = main_clause(text)
    if span is None or not span[0] <= m.start() < span[1]:
        return "number-in-condition"
    main = text[span[0]:span[1]]
    if NEGATION_RE.search(main) or RESTRICTOR_RE.search(main):
        return "number-negated"
    window = " ".join(text[:m.start()].split()[-3:] + [m.group()] + text[m.end():].split()[:3])
    if LOWER_BOUND_RE.search(window):
        return "number-lower-bound"
    if UPPER_BOUND_RE.search(window):
        new_value = value + 1
    else:
        new_value = value + 1 if _h(salt, "number") % 2 == 0 or value - 1 < 2 else value - 1
    if m.group(1):
        if new_value >= len(NUMBER_WORDS):
            return "number-word-out-of-range"
        word = NUMBER_WORDS[new_value]
        if m.group(1)[0].isupper():
            word = word.capitalize()
        new = word + (f" ({new_value})" if m.group(2) else "")
    else:
        new = str(new_value)
    return Mutation("number", _replace(text, m.start(), m.end(), new), m.group(), new)


def _restrictive_main(text: str, at: int, kind: str) -> str | None:
    """Why a state or side word at ``at`` cannot be swapped, or None.

    The word must sit in the main clause of a sentence whose main clause says what one can, may or must do
    (a qualifier there restricts a choice: "You may choose a friendly Legend"), with no negation in it. In a
    condition or a plain description the swapped statement can still be true by another rule ("a rival
    Unit goes to its owner's trash" is as true as the friendly one).
    """
    sites, span = main_sites(text)
    if span is None or not span[0] <= at < span[1]:
        return f"{kind}-in-condition"
    main = text[span[0]:span[1]]
    if NEGATION_RE.search(main) or RESTRICTOR_RE.search(main):
        return f"{kind}-negated"
    if not any(not s.negative and s.text.lower() in ("can", "may", "must") for s in sites):
        return f"{kind}-not-restrictive"
    return None


STATE_RE = re.compile(r"\b(ready|spent|readies|readied|readying|spend|spends|spending)\b", re.I)
VERB_FOLLOWERS = {"all", "a", "an", "the", "it", "your", "each", "that", "this", "them", "any", "one", "up", "to"}


def mutate_state(text: str) -> Mutation | str | None:
    found = list(STATE_RE.finditer(text))
    adjectives = [m for m in found if m.group().lower() in ("ready", "spent")]
    if not adjectives:
        return None
    if len(found) > 1:
        return "state-several"
    m = adjectives[0]
    if m.group()[0].isupper():
        return "state-capitalised"
    after = text[m.end():].split()
    if m.group() == "ready" and after and re.sub(r"\W", "", after[0]).lower() in VERB_FOLLOWERS:
        return "state-verb"
    before = text[:m.start()].split()
    if before and before[-1].lower() in ("have", "has", "had", "be", "been", "being", "get", "gets"):
        return "state-verb"  # "can be spent" is the verb spend, not the state
    problem = _restrictive_main(text, m.start(), "state")
    if problem:
        return problem
    new = "spent" if m.group() == "ready" else "ready"
    return Mutation("state", _replace(text, m.start(), m.end(), new), m.group(), new)


SIDE_RE = re.compile(r"\b(friendly|rivals?|rival's)\b", re.I)


def mutate_side(text: str) -> Mutation | str | None:
    found = list(SIDE_RE.finditer(text))
    if not found:
        return None
    if len(found) > 1:
        return "side-several"
    m = found[0]
    word = m.group()
    if word not in ("friendly", "rival"):
        return "side-noun"
    after = text[m.end():].split()
    if word == "rival" and (not after or not after[0][0].isupper()):
        return "side-noun"  # "rival" is an adjective only before a capitalised game noun ("rival Unit")
    problem = _restrictive_main(text, m.start(), "side")
    if problem:
        return problem
    new = "rival" if word == "friendly" else "friendly"
    return Mutation("side", _replace(text, m.start(), m.end(), new), word, new)


ONLY_RE = re.compile(r"\bonly\b", re.I)
EACH_RE = re.compile(r"\b(each|every)\b", re.I)


def mutate_quantifier(text: str) -> Mutation | str | None:
    span = main_clause(text)
    if span is None:
        return None
    prefix = text[:span[0]]
    clause = text[span[0]:]
    first = clause.split(" ", 1)[0]
    if first.lower() not in ("only", "each", "every"):
        return None
    main = text[span[0]:span[1]]
    others = NEGATION_RE.search(main) or OTHER_MODAL_RE.search(main) or re.search(
        r"\b(unless|except|otherwise|instead|rather)\b", main, re.I)
    if others:
        return "quantifier-extra-negation"
    if first.lower() == "only":
        if len(ONLY_RE.findall(text)) != 1:
            return "quantifier-several"
        new = "Not only" if not prefix else "not only"
    else:
        if len(EACH_RE.findall(text)) != 1 or ONLY_RE.search(text):
            return "quantifier-several"
        noun = clause.split()[1] if len(clause.split()) > 1 else ""
        if not noun or noun.endswith("s") and not noun.endswith("ss"):
            return "quantifier-plural"
        new = "Only one" if not prefix else "only one"
    start = len(prefix)
    return Mutation("quantifier", _replace(text, start, start + len(first), new), first, new)


def mutations_for(text: str, salt: str, tournament: bool = False) -> tuple[list[Mutation], list[str]]:
    """Every mutation that applies unambiguously, and the reasons the ones that looked applicable were refused."""
    found, refused = [], []
    for result in (mutate_polarity(text, deontic_only=tournament), mutate_permissive(text), mutate_number(text, salt), mutate_state(text),
                   mutate_side(text), mutate_quantifier(text)):
        if isinstance(result, Mutation):
            if result.text != text:
                found.append(result)
        elif isinstance(result, str):
            refused.append(result)
    return found, refused


# Phrasing and targets ----------------------------------------------------------------------

NEG_TOKEN_RE = re.compile(r"\b(not|cannot|never|no)\b|n't\b", re.I)


def has_negation(text: str) -> bool:
    return bool(NEG_TOKEN_RE.search(text))


def negated(text: str) -> str:
    return f"It is not true that {lcfirst(text[:-1] if text.endswith('.') else text)}."


def rule_ref(rule_id: str, capital: bool = False) -> str:
    if rule_id.startswith("TR "):
        return rule_id
    return f"{'Rule' if capital else 'rule'} {rule_id}"


def _visible(ref: str, quote: str, conclusion: str, label: str) -> str:
    return f'{ref} says: "{quote}"\n{conclusion}\nAnswer: {label}'


def _conclusion(phrasing: str, label: str) -> str:
    answer = LABEL_ANSWER[label]
    if phrasing == "question":
        return f"Conclusion: by the rule, the answer to the question is {answer.lower()}, so the answer is {answer}."
    truth = "true" if label == "A" else "false"
    return f"Conclusion: the statement as written is {truth}, so the answer is {answer}."


def _difference(mutation: Mutation) -> str:
    if mutation.kind == "permissive":
        return ("says it is not allowed, but the rule allows it; the rules are permissive, so nothing else has to "
                "permit it")
    return f'says "{mutation.new}" where the rule says "{mutation.old}"'


@dataclass
class Pair:
    rule_id: str
    sentence_index: int
    raw: str          # the sentence as written in the rules text (must appear in the preload)
    true_text: str
    mutation: Mutation
    phrasing: str = ""
    items: list[dict] = field(default_factory=list)


def pair_items(pair: Pair) -> list[tuple[str, str, str, str]]:
    """(statement, label, think, visible) for the Yes item and the No item of ``pair``."""
    rid, quote, m = pair.rule_id, clean(pair.raw), pair.mutation  # the rule as written, not made declarative
    ref, Ref = rule_ref(rid), rule_ref(rid, capital=True)
    false_text = m.text
    out = []
    if pair.phrasing == "statement":
        out.append((true_text := pair.true_text, "A",
                    f'The statement to judge: "{true_text}" {Ref} says: "{quote}" The statement says the same '
                    f"thing as the rule{', including its negation' if has_negation(true_text) else ''}, so it is true.",
                    _visible(Ref, quote, _conclusion("statement", "A"), "A")))
        out.append((false_text, "B",
                    f'The statement to judge: "{false_text}" {Ref} says: "{quote}" The statement {_difference(m)}, '
                    "so it contradicts the rule and is false.",
                    _visible(Ref, quote, _conclusion("statement", "B"), "B")))
    elif pair.phrasing == "negated":
        yes, no = negated(false_text), negated(pair.true_text)
        out.append((yes, "A",
                    f'The statement to judge: "{yes}" It denies that "{false_text}" {Ref} says: "{quote}" '
                    f"What it denies {_difference(m)}, so what it denies is false, and the statement, which denies "
                    "it, is true.",
                    _visible(Ref, quote, _conclusion("negated", "A"), "A")))
        out.append((no, "B",
                    f'The statement to judge: "{no}" It denies that "{pair.true_text}" {Ref} says: "{quote}" '
                    f"That is exactly what {ref} says, so what it denies is true, and the statement, which denies "
                    "it, is false.",
                    _visible(Ref, quote, _conclusion("negated", "B"), "B")))
    elif pair.phrasing == "question":
        out.extend(question_items(pair) or ())
    elif pair.phrasing == "lexical":
        twin = lexical_twin(pair.true_text)
        word = LEXICAL_WORDS[m.old.lower()]
        out.append((pair.true_text, "A",
                    f'The statement to judge: "{pair.true_text}" {Ref} says: "{quote}" The statement says the same '
                    "thing as the rule, so it is true.",
                    _visible(Ref, quote, _conclusion("statement", "A"), "A")))
        out.append((twin, "B",
                    f'The statement to judge: "{twin}" {Ref} says: "{quote}" The statement says it is {word} where '
                    f'the rule says "{m.old}", so it contradicts the rule and is false.',
                    _visible(Ref, quote, _conclusion("statement", "B"), "B")))
    else:
        raise BuildError(f"unknown phrasing {pair.phrasing!r}")
    return out


QUESTION_MODALS = ("can", "can't", "cannot", "can not", "may", "may not")


def question_items(pair: Pair) -> list[tuple[str, str, str, str]] | None:
    """The pair as two questions, or None when it cannot be asked as one.

    A number, state or side twin of a can/may sentence asks "Can <subject> X?" of the sentence (Yes) and of
    the twin (No). A polarity twin of a can/may sentence asks "Can <subject> X?" of whichever of the two
    says "can" or "may" (Yes when that is the rule) and "Is it true that <subject> cannot X?" of the other.
    """
    m, rid, quote = pair.mutation, pair.rule_id, clean(pair.raw)
    Ref = rule_ref(rid, capital=True)
    if m.kind in ("number", "state", "side"):
        yes, no = to_question(pair.true_text), to_question(m.text)
        if not yes or not no:
            return None
        return [(yes, "A", f'The question: "{yes}" {Ref} says: "{quote}" The question asks about exactly what the '
                           "rule allows, so the answer is yes.",
                 _visible(Ref, quote, _conclusion("question", "A"), "A")),
                (no, "B", f'The question: "{no}" {Ref} says: "{quote}" The question {_difference(m)}, so the rule '
                          "does not allow what it asks about and the answer is no.",
                 _visible(Ref, quote, _conclusion("question", "B"), "B"))]
    if m.kind != "polarity" or m.old.lower() not in QUESTION_MODALS:
        return None
    rule_allows = m.old.lower() in ("can", "may")
    positive, negative = (pair.true_text, m.text) if rule_allows else (m.text, pair.true_text)
    ask = to_question(positive)
    if not ask or not negative.endswith("."):
        return None
    deny = f"Is it true that {lcfirst(negative[:-1])}?"
    can_label, deny_label = ("A", "B") if rule_allows else ("B", "A")
    verdict = "allows" if rule_allows else "forbids"
    return sorted([
        (ask, can_label, f'The question: "{ask}" {Ref} says: "{quote}" The rule {verdict} it, so the answer is '
                         f"{LABEL_ANSWER[can_label].lower()}.",
         _visible(Ref, quote, _conclusion("question", can_label), can_label)),
        (deny, deny_label, f'The question asks whether "{negative[:-1]}" is true. {Ref} says: "{quote}" '
                           + ("That is what the rule says" if deny_label == "A" else "The rule says the opposite")
                           + f", so the answer is {LABEL_ANSWER[deny_label].lower()}.",
         _visible(Ref, quote, _conclusion("question", deny_label), deny_label)),
    ], key=lambda item: item[1])


def target_text(think: str, visible: str) -> str:
    return f"<think>\n{think}\n</think>\n\n{visible}"


# Prompt shape: the scorer's own code -------------------------------------------------------

class _CaptureModel:
    """Stands in for the MLX worker on the first step: keeps what it was sent and answers at once."""

    def __init__(self):
        self.messages: list[dict] | None = None
        self.tools: list[dict] | None = None
        self.enable_thinking: bool | None = None

    async def generate(self, messages, tools, *, max_tokens, enable_thinking):
        if self.messages is None:
            self.messages, self.tools = copy.deepcopy(messages), copy.deepcopy(tools)
            self.enable_thinking = enable_thinking
        return {"ok": True, "text": "Answer: A", "finishReason": "stop", "promptTokens": 0, "generationTokens": 0,
                "elapsedMs": 0}


@dataclass
class Prompt:
    messages: list[dict]
    tools: list[dict]
    preload_rule_ids: set[str]
    preload_texts: list[str]
    search_methods: list[str]
    fallback_reasons: list[str]


def _strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


def eval_item(statement: str) -> dict:
    return {"question": statement, "choices": copy.deepcopy(CHOICES)}


def scorer_prompt(statement: str) -> Prompt:
    """The messages and tool specs the scorer's first model step sends for ``statement`` (preload on, thinking on)."""
    item = eval_item(statement)
    model = _CaptureModel()
    turn = asyncio.run(run_turn([], eval_assistant.question_message(item), model, max_tokens=EVAL_MAX_TOKENS,
                                enable_thinking=True, preload=True, preload_text=eval_assistant.preload_text(item),
                                preload_k=DEFAULT_PRELOAD_K, preload_chars=DEFAULT_PRELOAD_CHARS,
                                max_tool_calls=MAX_TOOL_CALLS))
    if model.messages is None or model.enable_thinking is not True:
        raise BuildError(f"the loop never reached the model for {statement!r}")
    sent = [s for s in turn.trace if s.get("auto") and s.get("sent")]
    rule_ids = {r for s in sent for r in (s.get("sources") or {}).get("rule_ids") or []}
    texts = []
    for message in model.messages:
        if message["role"] == "tool":
            texts.extend(_strings(json.loads(message["content"])))
    searches = [s for s in sent if s["tool"] == "search_rules"]
    return Prompt(model.messages, model.tools, rule_ids, texts,
                  [s["result"].get("method") for s in searches],
                  [s["result"]["fallback_reason"] for s in searches if s["result"].get("fallback_reason")])


def example_row(prompt: Prompt, target: str, meta: dict) -> dict:
    return {**meta, "messages": [*prompt.messages, {"role": "assistant", "content": target}], "tools": prompt.tools}


# Leak guard --------------------------------------------------------------------------------

def normalise(text: str) -> list[str]:
    """Lowercased words with brackets and punctuation removed."""
    text = text.lower().replace("’", "'").replace("'", "")
    return re.findall(r"[^\W_]+", text)


def ngrams(words: list[str], n: int = LEAK_NGRAM) -> set[tuple[str, ...]]:
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


def gold_texts(gold_dir: Path = GOLD_DIR) -> tuple[list[dict], list[dict]]:
    """(questions, all question and choice texts) of every ``*.jsonl`` gold set, as {source, text}."""
    questions, texts = [], []
    for path in sorted(gold_dir.glob("*.jsonl")):
        for row in read_jsonl(path):
            q = {"source": f"{path.name}:{row['id']}", "text": row["question"]}
            questions.append(q)
            texts.append(q)
            texts.extend({"source": f"{path.name}:{row['id']}:{c['letter']}", "text": c["text"]}
                         for c in row.get("choices") or [])
    return questions, texts


@dataclass
class LeakReport:
    violations: list[dict]
    nearest: list[dict]

    @property
    def ok(self) -> bool:
        return not self.violations


def leak_guard(items: list[dict], gold_questions: list[dict], gold_all: list[dict], *,
               n: int = LEAK_NGRAM, ratio: float = LEAK_RATIO, nearest: int = 5) -> LeakReport:
    """Items (``id``, ``statement``, ``target``) too close to a gold question or choice, and the nearest pairs.

    An item trips the guard when its statement or target shares a word ``n``-gram with any gold
    question or choice text, or its statement's ``difflib.SequenceMatcher`` ratio to a gold question
    (over the two lists of normalised words, so a ratio of 0.8 means 80% of the words line up in order)
    is ``ratio`` or more.
    """
    gold_grams: dict[tuple[str, ...], str] = {}
    for g in gold_all:
        for gram in ngrams(normalise(g["text"]), n):
            gold_grams.setdefault(gram, g["source"])
    gold_norm = [(g["source"], normalise(g["text"]), g["text"]) for g in gold_questions]
    violations, best = [], []
    for item in items:
        statement = normalise(item["statement"])
        shared = sorted(gram for text in (item["statement"], item.get("target", ""))
                        for gram in ngrams(normalise(text), n) if gram in gold_grams)
        top = (-1.0, "", "")
        matcher = difflib.SequenceMatcher(autojunk=False)
        matcher.set_seq2(statement)
        for source, norm, original in gold_norm:
            matcher.set_seq1(norm)
            if matcher.real_quick_ratio() <= top[0] or matcher.quick_ratio() <= top[0]:
                continue
            r = matcher.ratio()
            if r > top[0] or (r == top[0] and source < top[1]):
                top = (r, source, original)
        best.append({"id": item["id"], "statement": item["statement"], "gold": top[1], "gold_text": top[2],
                     "ratio": round(top[0], 4)})
        if shared or top[0] >= ratio:
            violations.append({"id": item["id"], "statement": item["statement"],
                               "shared_ngram": " ".join(shared[0]) if shared else None,
                               "ngram_gold": gold_grams[shared[0]] if shared else None,
                               "ratio": round(top[0], 4), "ratio_gold": top[1]})
    best.sort(key=lambda b: (-b["ratio"], b["id"]))
    return LeakReport(violations, best[:nearest])


# Scenario hook -----------------------------------------------------------------------------

def load_scenarios(path: Path, known_rules: set[str]) -> list[dict]:
    """Drafted scenario rows, checked strictly; any problem is a ``BuildError`` naming the row."""
    rows = read_jsonl(path, missing_ok=False)
    seen: set[str] = set()
    for n, row in enumerate(rows, 1):
        where = f"{path}:{n}"
        if not isinstance(row, dict):
            raise BuildError(f"{where}: not a JSON object")
        missing = [f for f in SCENARIO_FIELDS if f not in row]
        extra = sorted(set(row) - set(SCENARIO_FIELDS))
        if missing or extra:
            raise BuildError(f"{where}: missing fields {missing}, unexpected fields {extra}")
        if not isinstance(row["id"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", row["id"]):
            raise BuildError(f"{where}: id must be a plain string")
        if row["id"] in seen:
            raise BuildError(f"{where}: duplicate id {row['id']!r}")
        seen.add(row["id"])
        if not isinstance(row["statement"], str) or len(row["statement"].split()) < 3:
            raise BuildError(f"{where}: statement must be a sentence")
        if type(row["label"]) is not bool:
            raise BuildError(f"{where}: label must be true or false")
        ids = row["source_rule_ids"]
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
            raise BuildError(f"{where}: source_rule_ids must be a non-empty list of distinct rule ids")
        unknown = [i for i in ids if i not in known_rules]
        if unknown:
            raise BuildError(f"{where}: unknown rule id(s) {unknown}")
        if row["kind"] != SCENARIO_KIND:
            raise BuildError(f"{where}: kind must be {SCENARIO_KIND!r}")
    trues = sum(1 for r in rows if r["label"])
    if trues * 2 != len(rows):
        raise BuildError(f"{path}: labels are not balanced ({trues} true, {len(rows) - trues} false)")
    return rows


def scenario_target(row: dict, label: str) -> tuple[str, str]:
    refs = ", ".join(rule_ref(r) for r in row["source_rule_ids"])
    truth = "true" if label == "A" else "false"
    think = (f'The statement to judge: "{row["statement"]}" The rules that decide it are {refs}. Checked against '
             f"those rules, the statement as written is {truth}.")
    visible = (f"{refs[0].upper() + refs[1:]} decide this.\n{_conclusion('statement', label)}\nAnswer: {label}")
    return think, visible


# The build ---------------------------------------------------------------------------------

def rule_sort_key(rule_id: str) -> tuple:
    doc = 1 if rule_id.startswith("TR ") else 0
    parts = re.split(r"[ .]", rule_id.removeprefix("TR "))
    return (doc, tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in parts if p))


def split_of(rule_id: str) -> str:
    return "valid" if _h(SPLIT_SALT, rule_id) % 100 < VALID_PERCENT else "train"


def candidate_pairs(rules: list[dict], skips: dict[str, int]) -> list[Pair]:
    """One pair per usable sentence, in rule order (input order never matters)."""
    pairs = []
    for rule in sorted(rules, key=lambda r: rule_sort_key(r["id"])):
        for index, raw in enumerate(raw_sentences(rule_body(rule["text"]))):
            text = clean(raw)
            reason = sentence_skip(raw, text)
            text = declarative(text)
            if reason is None:
                found, refused = mutations_for(text, f"{rule['id']}:{index}", rule["id"].startswith("TR "))
                if not found:
                    reason = refused[0] if len(set(refused)) == 1 else ("mutation-refused" if refused
                                                                        else "no-mutation-applies")
            if reason is not None:
                skips[reason] = skips.get(reason, 0) + 1
                continue
            mutation = sorted(found, key=lambda m: m.kind)[_h(rule["id"], text, "mutation") % len(found)]
            pairs.append(Pair(rule["id"], index, raw, text, mutation))
    return pairs


def lexical_eligible(pair: Pair) -> bool:
    """A polarity pair from a rule that allows or requires something, whose twin can be said with no "not"."""
    return (pair.mutation.kind == "polarity" and pair.mutation.old.lower() in LEXICAL_WORDS
            and lexical_twin(pair.true_text) is not None)


def _negation_balance(pair: Pair) -> int:
    """Yes items minus No items of ``pair`` (as phrased now) that contain a negation."""
    return sum((1 if label == "A" else -1) * has_negation(statement) for statement, label, *_ in pair_items(pair))


def choose_phrasing(pairs: list[Pair]) -> None:
    """Give every pair a phrasing so that a negation is no cue to the label, with as few negations as that allows.

    About one eligible pair in ``QUESTION_EVERY`` becomes a question and about one other pair in
    ``NEGATED_EVERY`` is negated ("It is not true that ..."), both by hash, so double negations are drilled
    whatever the balance. The rest start as statements. A statement pair from a rule that allows something
    has its "not" on the No item, one from a rule that forbids on the Yes item; negating a pair puts "not"
    on both, and a ``lexical`` pair (a can/may/must rule's twin said as "It is forbidden/optional for
    <subject> to X") on neither. So while the items with a negation lean to one label, statement pairs
    leaning that way become lexical where they can and negated otherwise, in hash order, until the Yes and
    No items with a negation are equal (or no such pair is left).
    The choice depends only on the pairs, never on their order.
    """
    rest = []
    for pair in pairs:
        h = _h(pair.rule_id, pair.true_text, "phrasing")
        if h % QUESTION_EVERY == 0 and question_items(pair):
            pair.phrasing = "question"
        elif (h >> 16) % NEGATED_EVERY == 0:
            pair.phrasing = "negated"
        else:
            pair.phrasing = "statement"
            rest.append((h, pair))
    balance = sum(_negation_balance(p) for p in pairs)
    for _, pair in sorted(rest, key=lambda r: (r[0], r[1].rule_id, r[1].sentence_index)):
        if balance == 0:
            break
        lean = _negation_balance(pair)
        if lean and (lean > 0) == (balance > 0):
            pair.phrasing = "lexical" if lexical_eligible(pair) else "negated"
            balance += _negation_balance(pair) - lean


@dataclass
class Build:
    rows: dict[str, list[dict]]
    manifest: dict
    leak: LeakReport


def _estimate(row: dict) -> int:
    chars = len(json.dumps(row["tools"], ensure_ascii=False))
    for m in row["messages"]:
        chars += len(m.get("content") or "") + 16
        for call in m.get("tool_calls") or ():
            chars += len(json.dumps(call, ensure_ascii=False))
    return chars


def build(rule_rows: list[dict], gold_dir: Path = GOLD_DIR, scenarios: list[dict] | None = None) -> Build:
    rules = numbered_rules(rule_rows)
    ids = [r["id"] for r in rules]
    if len(set(ids)) != len(ids):
        raise BuildError("duplicate rule ids in the sources")
    skips: dict[str, int] = {}
    pairs = candidate_pairs(rules, skips)
    choose_phrasing(pairs)

    methods: dict[str, int] = {}
    reasons: set[str] = set()
    tools_seen: set[str] = set()
    staged: list[tuple[str, list[dict]]] = []  # (group key, rows) -- a group is dropped whole
    for pair in pairs:
        rows = []
        for role, (statement, label, think, visible) in zip(("yes", "no"), pair_items(pair)):
            if statement is None:
                raise BuildError(f"no statement for {pair.rule_id}")
            prompt = scorer_prompt(statement)
            for m in prompt.search_methods:
                methods[m] = methods.get(m, 0) + 1
            reasons.update(prompt.fallback_reasons)
            if not any(pair.raw in t for t in prompt.preload_texts):
                rows = None
                break
            tools_seen.add(json.dumps(prompt.tools, sort_keys=True))
            meta = {"id": "tf-" + hashlib.sha256(f"{pair.rule_id}\x1f{pair.sentence_index}\x1f{role}".encode())
                    .hexdigest()[:12], "kind": TEMPLATE_KIND, "source_rule_ids": [pair.rule_id],
                    "mutation": pair.mutation.kind, "phrasing": pair.phrasing, "label": label,
                    "answer": LABEL_ANSWER[label], "statement": statement}
            rows.append(example_row(prompt, target_text(think, visible), meta))
        if rows is None:
            skips["source-not-in-preload"] = skips.get("source-not-in-preload", 0) + 1
            continue
        staged.append((pair.rule_id, rows))

    scenario_skips: dict[str, int] = {}
    scenario_rows: list[dict] = []
    for row in scenarios or []:
        label = "A" if row["label"] else "B"
        prompt = scorer_prompt(row["statement"])
        if not set(row["source_rule_ids"]) <= prompt.preload_rule_ids:
            scenario_skips["cited-rule-not-in-preload"] = scenario_skips.get("cited-rule-not-in-preload", 0) + 1
            continue
        think, visible = scenario_target(row, label)
        meta = {"id": row["id"], "kind": SCENARIO_KIND, "source_rule_ids": list(row["source_rule_ids"]),
                "mutation": None, "phrasing": "statement", "label": label, "answer": LABEL_ANSWER[label],
                "statement": row["statement"]}
        scenario_rows.append(example_row(prompt, target_text(think, visible), meta))

    gold_q, gold_all = gold_texts(gold_dir)

    def guard_rows(rows):
        return [{"id": r["id"], "statement": r["statement"], "target": r["messages"][-1]["content"]} for r in rows]

    first = leak_guard(guard_rows([r for _, rows in staged for r in rows] + scenario_rows), gold_q, gold_all)
    tripped = {v["id"] for v in first.violations}
    leak_dropped = 0
    kept_groups = []
    for key, rows in staged:
        if any(r["id"] in tripped for r in rows):
            leak_dropped += len(rows)
        else:
            kept_groups.append((key, rows))
    scenario_kept = [r for r in scenario_rows if r["id"] not in tripped]
    scenario_leak = len(scenario_rows) - len(scenario_kept)
    leak_dropped += scenario_leak
    # Scenarios are balanced on their own: after drops, the larger label is trimmed by hash.
    by_label = {lab: sorted((r for r in scenario_kept if r["label"] == lab), key=lambda r: _h(r["id"], "trim"))
                for lab in ("A", "B")}
    keep = min(len(by_label["A"]), len(by_label["B"]))
    trimmed = len(scenario_kept) - 2 * keep
    if trimmed:
        scenario_skips["balance-trimmed"] = trimmed
    scenario_final = {r["id"] for lab in ("A", "B") for r in by_label[lab][:keep]}
    scenario_kept = [r for r in scenario_kept if r["id"] in scenario_final]

    all_rows = [r for _, rows in kept_groups for r in rows] + scenario_kept
    final = leak_guard(guard_rows(all_rows), gold_q, gold_all)
    if not final.ok:
        raise BuildError(f"leak guard still fails after drops: {final.violations[:3]}")
    if len(tools_seen) > 1:
        raise BuildError("the tool specs differed between items")

    out = {"train": [], "valid": []}
    for row in all_rows:
        out[split_of(row["source_rule_ids"][0])].append(row)
    for split in out:
        out[split].sort(key=lambda r: (rule_sort_key(r["source_rule_ids"][0]), r["kind"], r["id"]))
        for kind in (TEMPLATE_KIND, SCENARIO_KIND):
            labels = [r["label"] for r in out[split] if r["kind"] == kind]
            if labels.count("A") * 2 != len(labels) and kind == TEMPLATE_KIND:
                raise BuildError(f"{split} {kind} labels are not 50/50")
    for row in all_rows:
        letter, how = eval_assistant.parse_answer_letter(split_thinking(row["messages"][-1]["content"])[1],
                                                         ["A", "B"])
        if letter != row["label"]:
            raise BuildError(f"{row['id']}: the scorer reads {letter} ({how}) from the target, not {row['label']}")
    labels = [r["label"] for r in all_rows]
    if labels.count("A") * 2 != len(labels):
        raise BuildError("labels are not 50/50 overall")

    def count(key, rows=all_rows):
        out_counts: dict[str, int] = {}
        for r in rows:
            k = str(r[key])
            out_counts[k] = out_counts.get(k, 0) + 1
        return dict(sorted(out_counts.items()))

    sizes = sorted(_estimate(r) for r in all_rows)
    target_sizes = sorted(len(r["messages"][-1]["content"]) for r in all_rows)
    neg_by_label = {lab: sum(1 for r in all_rows if r["label"] == lab and has_negation(r["statement"]))
                    for lab in ("A", "B")}
    manifest = {
        "dataset": DATASET, "builder_version": BUILDER_VERSION,
        "sources": [{"path": p, "sha256": file_sha256(REPO_ROOT / p)} for p in SOURCES],
        "rules_version": RULES_VERSION, "tournament_rules_version": TOURNAMENT_RULES_VERSION,
        "assistant_prompt_version": ASSISTANT_PROMPT_VERSION, "eval_prompt_version": eval_assistant.EVAL_PROMPT_VERSION,
        "prompt_shape": {"built_by": "loop.run_turn with a capturing stand-in model",
                         "question_message": "eval_assistant.question_message",
                         "preload_text": "eval_assistant.preload_text", "preload": True,
                         "preload_k": DEFAULT_PRELOAD_K, "preload_chars": DEFAULT_PRELOAD_CHARS,
                         "enable_thinking": True, "max_tokens": EVAL_MAX_TOKENS, "max_tool_calls": MAX_TOOL_CALLS,
                         "choices": [f"{c['letter']}. {c['text']}" for c in CHOICES],
                         "target": "<think> short reasoning </think> + rule quote + one-line conclusion + Answer: X"},
        "preload_search": {"methods": dict(sorted(methods.items())), "fallback_reasons": sorted(reasons),
                           "note": ("search_rules falls back to lexical BM25 when no usable rules index exists, as "
                                    "the scorer does; a build where data/processed/corpus_index.npz is usable would "
                                    "record 'hybrid' here")},
        "split": {"by": "first source rule id", "hash": f"sha256('{SPLIT_SALT}:<rule id>') % 100 < {VALID_PERCENT}",
                  "train": len(out["train"]), "valid": len(out["valid"]),
                  "valid_rules": len({r["source_rule_ids"][0] for r in out["valid"]}),
                  "train_rules": len({r["source_rule_ids"][0] for r in out["train"]})},
        "counts": {"items": len(all_rows), "by_kind": count("kind"), "by_label": count("label"),
                   "by_mutation": count("mutation", [r for r in all_rows if r["kind"] == TEMPLATE_KIND]),
                   "by_phrasing": count("phrasing"),
                   "by_mutation_and_label": count("ml", [{"ml": f"{r['mutation']}:{r['label']}"} for r in all_rows
                                                        if r["kind"] == TEMPLATE_KIND]),
                   "negated_statements_by_label": neg_by_label,
                   "rules_used": len({r["source_rule_ids"][0] for r in all_rows}),
                   "numbered_rules": len(rules)},
        "skips": dict(sorted(skips.items())), "scenario_skips": dict(sorted(scenario_skips.items())),
        "leak_guard": {"method": (f"normalised words (lowercase, brackets and punctuation removed); fails on a shared "
                                  f"word {LEAK_NGRAM}-gram between an item's statement or target and any gold "
                                  f"question or choice, or a difflib.SequenceMatcher ratio >= {LEAK_RATIO} between "
                                  "an item's statement and any gold question, both as lists of normalised words"),
                       "gold_files": sorted(p.name for p in gold_dir.glob("*.jsonl")),
                       "gold_questions": len(gold_q), "leak_dropped": leak_dropped,
                       "leak_dropped_scenarios": scenario_leak,
                       "tripped_first_pass": first.violations, "result": "pass" if final.ok else "fail",
                       "nearest": final.nearest},
        "size_estimate": {"note": ("characters of the tool specs, every message and the preload's tool calls, as the "
                                   "loop's PromptGuard counts them; tokens at 4 and at 3 characters a token"),
                          "chars": {"min": sizes[0], "median": int(statistics.median(sizes)), "max": sizes[-1]},
                          "tokens_chars_div_4": {"min": sizes[0] // 4, "median": int(statistics.median(sizes)) // 4,
                                                 "max": -(-sizes[-1] // 4)},
                          "tokens_chars_div_3": {"min": sizes[0] // 3, "median": int(statistics.median(sizes)) // 3,
                                                 "max": -(-sizes[-1] // 3)},
                          "target_chars": {"min": target_sizes[0], "median": int(statistics.median(target_sizes)),
                                           "max": target_sizes[-1]}},
    }
    return Build(out, manifest, final)


def load_sources() -> list[dict]:
    return [row for p in SOURCES for row in read_jsonl(REPO_ROOT / p, missing_ok=False)]


def serialise(rows: list[dict]) -> str:
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)


def manifest_text(manifest: dict) -> str:
    return json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"


def print_nearest(report: LeakReport) -> None:
    print("Leak guard nearest pairs (statement ratio to the closest gold question):")
    for n in report.nearest:
        print(f"  {n['ratio']:.3f}  {n['id']}: {n['statement']!r}\n         ~ {n['gold']}: {n['gold_text']!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="output directory (default: %(default)s)")
    parser.add_argument("--scenarios", type=Path, help="drafted scenario items (JSONL) to add; see the docstring")
    parser.add_argument("--force", action="store_true", help="allow writing a set less than half the current size")
    parser.add_argument("--check", action="store_true", help="build in memory and compare with --out; write nothing")
    args = parser.parse_args(argv)
    rows = load_sources()
    try:
        scenarios = (load_scenarios(args.scenarios, {r["id"] for r in numbered_rules(rows)})
                     if args.scenarios else None)
        result = build(rows, scenarios=scenarios)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print_nearest(result.leak)
    m = result.manifest
    print(f"leak guard: {m['leak_guard']['result']}; leak_dropped {m['leak_guard']['leak_dropped']}")
    print(f"items {m['counts']['items']} (train {m['split']['train']}, valid {m['split']['valid']}); "
          f"labels {m['counts']['by_label']}; mutations {m['counts']['by_mutation']}")
    print(f"skips {m['skips']}")
    print(f"size estimate (chars/4 tokens): {m['size_estimate']['tokens_chars_div_4']}; "
          f"(chars/3): {m['size_estimate']['tokens_chars_div_3']}")
    texts = output_texts(result)
    if args.check:
        stale = stale_files(args.out, texts)
        print("up to date" if not stale else f"differs: {', '.join(stale)}")
        return 1 if stale else 0
    write_outputs(args.out, result, force=args.force)
    print(f"Wrote {args.out}")
    return 0


def output_texts(result: Build) -> dict[str, str]:
    """The three files' exact text (the jsonl as ``write_jsonl_atomic`` writes it)."""
    return {"train.jsonl": serialise(result.rows["train"]), "valid.jsonl": serialise(result.rows["valid"]),
            "manifest.json": manifest_text(result.manifest)}


def stale_files(out: Path, texts: dict[str, str]) -> list[str]:
    return [n for n, t in texts.items() if not (out / n).exists() or (out / n).read_text(encoding="utf-8") != t]


def write_outputs(out: Path, result: Build, *, force: bool = False) -> None:
    """Write both splits and the manifest; refuses (SystemExit) to shrink a split below half without ``force``."""
    for split in ("train", "valid"):
        guard_shrink(out / f"{split}.jsonl", len(result.rows[split]), force, what="examples",
                     hint="pass --force to replace it")
    out.mkdir(parents=True, exist_ok=True)
    for split in ("train", "valid"):
        write_jsonl_atomic(out / f"{split}.jsonl", result.rows[split])
    tmp = out / "manifest.json.tmp"
    tmp.write_text(manifest_text(result.manifest), encoding="utf-8")
    tmp.replace(out / "manifest.json")


if __name__ == "__main__":
    raise SystemExit(main())
