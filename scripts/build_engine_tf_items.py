#!/usr/bin/env python3
"""Engine-verified legality questions: a second kind of training item for the assistant LoRA.

Why: the 8B assistant misses in-game situation questions. It leans No, and it
misjudges ready/spent, attack targets, timing and costs. The engine is the
authority on legality: at every decision point it lists exactly the legal
actions, so "Can you do X now?" has an engine-verified answer. This script turns
engine positions into Yes/No questions whose label is whether the engine offers
the action described (plan: LoRA on rules-based true/false, addendum approved
by Cody 2026-11-13). Python implements no game rule here: every label comes
from the engine's legal-action list.

Positions. The real engine worker (``scripts/engine-worker.ts``) plays the fixed
Demo decks through ``games/cyberpunk/engine_adapter.py`` with the deterministic
``baseline_action_id`` policy on both seats, exactly as ``run_local_matches.py``
does, over seeds ``engine-tf-v1-0`` .. ``engine-tf-v1-<N-1>``. Two kinds of
decision are used: the active seat's Main phase decision, and the defending
seat's React Step decision during the rival's attack. Everything a question says
comes from the acting seat's public ``ModelInputV2`` (its observation and
offered actions), the engine content bundle's card data (name, type, cost,
Sell Tag, keywords) for cards that observation shows, and one fact from the
seat's own history: how many times it took the Sell action this turn (each sale
is that seat's own action and reveals the card). Nothing comes from the game
state or another seat's hidden cards; ``check_public`` fails the build if a
question names a card the seat cannot see.

Question classes. Each class is one question shape about one kind of engine
action; its items carry the facts that decide it, and its No items are the
plausible actions the engine does NOT offer in that position:

  - ``attack-declare`` -- "Can your <Unit> attack now?" (``DECLARE_ATTACK``). Facts:
    the step, the Unit's ready/spent and lagging state, [ADRENALINE], gone solo,
    and whether the rival has spent Units or Gig dice. No reasons: ``spent``,
    ``lagging``, ``outside-main`` (asked in the React Step of the rival's
    attack), ``no-target``.
  - ``attack-target`` -- "Can your <Unit> attack the rival's <Unit>?" A declared
    attack names only the attacker; the target is chosen next. So the engine is
    asked: the offered ``DECLARE_ATTACK`` is applied to a copy of the state and
    the targets it then offers (or the one it locks in) are the label. Facts: the
    target's ready/spent state and both Units' keywords. No reason: ``ready-target``.
  - ``play-from-hand`` -- "Can you play <card> from your hand now?" (``PLAY_CARD``
    from HAND). Facts: the step, the card's type, cost and [QUICK], the seat's
    ready Eddies and ready Legends (face-down, face-up with and without a Sell
    Tag) and, for a Gear, how many Units and face-up Legends it has. No reasons:
    ``unaffordable``, ``outside-main``, ``no-equip-target``.
  - ``sell`` -- "Can you sell <card> now?" (``SELL_CARD``). Facts: the step, the Sell
    Tag and, in the Main phase, the sales this turn. No reasons: ``no-sell-tag``,
    ``already-sold``, ``outside-main``.
  - ``block`` -- "Can your <Unit> use [BLOCKER] to block this attack?"
    (``DECLARE_BLOCKER``, React Step only). Facts: ready/spent, lagging,
    [BLOCKER], whether it is already the attack's target. No reasons: ``spent``,
    ``no-blocker``, ``already-target``.

Classes considered and left out: an attack on the rival's Gig area (the
target is whole-area, and the dice count already decides ``attack-declare``);
calling a Legend, going solo and activating abilities (their limits are not all
visible: the once-per-turn limit on Call is not in the observation). A No item's reason is assigned from its described
facts only to pick the rule that explains it; the label is still the engine's.
A No item whose facts show no reason is never kept (``no-reason``): it means the
engine refused for something the text does not say. A Yes item whose facts
show a reason is never kept either (``reason-mismatch``).

Consistency audit. Each item's signature is its class plus every fact the text
states, with card identities left out (a Unit is "a ready, lagging Unit", not
which one). If two items share a signature but the engine labelled them
differently, the text is missing a deciding fact, and every item with that
signature is dropped. The audit runs over every candidate, including the
``no-reason`` ones, so a Yes item is never kept beside an unexplained No with
the same description. Drops are counted per class in the manifest.

Reasoning. Each (class, reason) maps to one or two rule ids in
``data/processed/rules.jsonl`` (``RULE_IDS``); a missing id fails the build. The
item carries them as ``source_rule_ids``; the target quotes them from the
snapshot later (``build_tf_dataset.py``), never from here.

Text. A short scenario (the step and whose turn, then the facts about the
objects involved, card names with subtitle), then a question ("Can you ...?")
or a statement to judge ("You may ..."), chosen by a hash of the item, about
half each. At most one negation, and no "It is not true that" wrapper.

Selection. After the audit: the reason filters, a negation check, the leak
guard of ``build_tf_dataset.py`` against ``data/gold/*.jsonl`` (over the statement
and over what the target will say: the deciding fact and the cited rules as quoted;
trips are dropped and counted, the 5 nearest pairs printed and stored),
identical question texts deduplicated, at most ``CAP_PER_KEY`` items per
(class, label, card), then each class trimmed by hash to equal Yes and No, so
the whole file is exactly 50/50. Every pick is by a hash of the item id, which
spreads items over seeds, turns and both seats.

Provenance. Each item records the engine identity (``scripts/engine-identity.ts``
through ``scripts/local-match-setup.ts``), the seed, the deck ids (matched to the
Demo manifests in ``packages/domain/src/demo-manifests.v1.json``), the seat,
turn, step, the decision index and the state hash the worker reported for that
decision, plus ``engine_check``: the action whose presence or absence is the
label, which ``verify_items`` replays.

Output: ``data/datasets/sources/engine-positions-v1.jsonl`` and
``engine-positions-v1.manifest.json`` next to it. Deterministic: no clock, no
network, no model; the same seeds give the same bytes. Refuses to shrink the file
below half without ``--force``.

Usage:
    python scripts/build_engine_tf_items.py
    python scripts/build_engine_tf_items.py --check          # regenerate in memory, compare bytes
    python scripts/build_engine_tf_items.py --seeds 4 --out /tmp/engine-items.jsonl
    python scripts/build_engine_tf_items.py --verify 40      # replay 40 committed items on the engine
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import build_tf_dataset as tf  # noqa: E402  (leak guard, negation count, rule loading)
from games.cyberpunk.engine_adapter import EngineWorker  # noqa: E402
from games.cyberpunk.local_match import MatchSetup, load_default_setup  # noqa: E402
from games.cyberpunk.policy_bot import baseline_action_id  # noqa: E402
from games.cyberpunk.policy_prompt import visible_slugs  # noqa: E402
from harness.core.io import guard_shrink, read_jsonl, write_jsonl_atomic  # noqa: E402

SOURCE_NAME = "engine-positions-v1"
GENERATOR_VERSION = "build-engine-tf-items-v1"
KIND = tf.ENGINE_KIND
OUT_PATH = REPO_ROOT / "data/datasets/sources" / f"{SOURCE_NAME}.jsonl"
SEED_PREFIX = "engine-tf-v1"
DEFAULT_SEEDS = 24
DEFAULT_WORKERS = 4
MAX_DECISIONS = 600
MAX_TURNS = 40
CAP_PER_KEY = 8          # items per (class, label, card)
MAX_PER_CLASS = 300      # items per class after balancing (hash order), so no class dominates
DEMO_MANIFESTS = REPO_ROOT / "packages/domain/src/demo-manifests.v1.json"
RULES_PATH = REPO_ROOT / "data/processed/rules.jsonl"

CLASSES = tf.ENGINE_CLASSES  # the builder validates against the same names
# (class, reason) -> rule ids that explain the answer; "yes" (or "yes-react") for offered actions.
RULE_IDS: dict[tuple[str, str], tuple[str, ...]] = {
    ("attack-declare", "yes"): ("9.3.1",),
    ("attack-declare", "spent"): ("9.3.1",),
    ("attack-declare", "lagging"): ("9.3.1.1",),
    ("attack-declare", "outside-main"): ("8.15",),
    ("attack-declare", "no-target"): ("9.3.2.4",),
    ("attack-target", "yes"): ("9.3.2.1",),
    ("attack-target", "ready-target"): ("9.3.2.1",),
    ("play-from-hand", "yes"): ("5.8.1.3",),
    ("play-from-hand", "yes-react"): ("11.30.2",),
    ("play-from-hand", "unaffordable"): ("5.8.1.3",),
    ("play-from-hand", "outside-main"): ("11.30.1",),
    ("play-from-hand", "no-equip-target"): ("4.10.1",),
    ("sell", "yes"): ("5.8.2.2",),
    ("sell", "no-sell-tag"): ("5.8.2.2",),  # 3.12.1 shares an 8-gram with a gold question
    ("sell", "already-sold"): ("8.11.1",),
    ("sell", "outside-main"): ("5.8.2.2",),
    ("block", "yes"): ("9.9", "11.28.2"),
    ("block", "spent"): ("9.9",),
    ("block", "no-blocker"): ("11.28.1",),
    ("block", "already-target"): ("11.28.3.1",),
}
KEYWORD_TEXT = {"BLOCKER": "[BLOCKER]", "GO_SOLO": "[GO SOLO]", "ADRENALINE": "[ADRENALINE]", "QUICK": "[QUICK]"}
TYPE_TEXT = {"UNIT": "Unit", "GEAR": "Gear", "PROGRAM": "Program", "LEGEND": "Legend"}
ITEM_FIELDS = tf.ENGINE_FIELDS


class GenerationError(Exception):
    """A fail-closed problem: a missing rule id, a hidden card in a text, an engine answer out of shape."""


def _h(*parts: Any) -> int:
    return int(hashlib.sha256("\x1f".join(str(p) for p in parts).encode("utf-8")).hexdigest(), 16)


# Rules ----------------------------------------------------------------------------------------

def check_rule_ids(known: set[str], mapping: Mapping[tuple[str, str], tuple[str, ...]] = RULE_IDS) -> None:
    """Every rule id the classes cite must be a numbered rule of the snapshot (fail closed)."""
    missing = sorted({r for ids in mapping.values() for r in ids if r not in known})
    if missing:
        raise GenerationError(f"rule ids missing from the snapshot: {missing}")


def known_rule_ids(path: Path = RULES_PATH) -> set[str]:
    return {r["id"] for r in tf.numbered_rules(read_jsonl(path, missing_ok=False))}


# Cards ----------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Card:
    slug: str
    name: str
    type: str
    cost: int | None
    sell_tag: bool
    keywords: tuple[str, ...]


def card_data(content: Mapping[str, Any]) -> dict[str, Card]:
    """The engine content bundle's public card data by slug (``cardId``; only revision 1 is admitted)."""
    out: dict[str, Card] = {}
    for c in content.get("cards") or []:
        if c.get("revision") != 1:
            raise GenerationError(f"{c.get('id')}: only revision 1 cards are handled")
        cost = c.get("printedCost") or {}
        out[c["id"]] = Card(c["id"], c["displayName"], c["type"],
                            cost.get("amount") if cost.get("kind") == "EDDIES" else None,
                            bool((c.get("sellProfile") or {}).get("allowed")),
                            tuple((c.get("mechanics") or {}).get("keywords") or c.get("keywords") or ()))
    return out


def deck_ids(initialization: Mapping[str, Any], path: Path = DEMO_MANIFESTS) -> list[str]:
    """The Demo manifest id of each initialization deck; a deck matching none is an error."""
    manifests = json.loads(path.read_text(encoding="utf-8"))
    keyed = {}
    for m in manifests:
        legends = sorted(e["cardId"] for e in m["entries"] if e["zone"] == "LEGENDS" for _ in range(e["quantity"]))
        main = sorted(e["cardId"] for e in m["entries"] if e["zone"] == "MAIN" for _ in range(e["quantity"]))
        keyed[json.dumps([legends, main])] = m["id"]
    out = []
    for deck in initialization["decks"]:
        key = json.dumps([sorted(deck["legends"]), sorted(deck["main"])])
        if key not in keyed:
            raise GenerationError("a deck matches no Demo manifest")
        out.append(keyed[key])
    return out


# Positions ------------------------------------------------------------------------------------

@dataclass
class Position:
    seed: str
    index: int
    state_hash: str
    observation: dict
    actions: list[dict]
    sold_this_turn: int
    probes: dict[str, list[str]] = field(default_factory=dict)  # attacker publicId -> target publicIds


def decision_kind(obs: Mapping[str, Any]) -> str | None:
    """"main" (the active seat's Main phase decision), "react" (the defender's React Step decision) or None."""
    if obs.get("resolutionStage") != "DECISION" or obs.get("outcome"):
        return None
    if obs.get("window") == "MAIN" and obs["actingSeat"] == obs["activeSeat"] == obs["viewerSeat"] \
            and not obs.get("combat"):
        return "main"
    combat = obs.get("combat") or {}
    if obs.get("window") == "RIVAL_REACT" and obs["actingSeat"] == obs["viewerSeat"] != obs["activeSeat"] \
            and combat.get("defendingSeat") == obs["viewerSeat"]:
        return "react"
    return None


def attack_targets(worker: EngineWorker, content: Mapping, state: Mapping, actor: str, action_id: str) -> list[str]:
    """The card targets the engine offers once this attack is declared (applied to a copy of the state).

    With several targets the engine asks for one (CHOOSE TARGET options); with one it locks it in, and the
    attacker's observation shows it as the combat target. Gig-area targets are left out.
    """
    after = worker.apply_action(content=content, state=state, actor_id=actor, action_id=action_id)["state"]
    model_input = worker.model_input(content=content, state=after, actor_id=after["timing"]["actingPlayer"])
    obs = model_input["observation"]
    combat = obs.get("combat") or {}
    if combat.get("stage") == "ATTACK_TARGET_SELECTION":
        out = []
        for a in model_input["legalActions"]:
            d = a["descriptor"]
            if d.get("kind") != "CHOOSE" or d.get("choiceKind") != "TARGET":
                raise GenerationError(f"unexpected action during target selection: {d.get('label')}")
            if (d.get("option") or {}).get("kind") == "CARD":
                out.append(d["option"]["publicId"])
        return sorted(out)
    target = combat.get("target") or {}
    if target.get("kind") == "CARD":
        return [target["cardInstanceId"]]
    if target.get("kind") == "GIG_AREA":
        return []
    raise GenerationError(f"the attack produced no target: {combat}")


def play_seed(worker: EngineWorker, setup: MatchSetup, seed: str, *, probe: bool = True,
              max_decisions: int = MAX_DECISIONS, max_turns: int = MAX_TURNS) -> list[Position]:
    """Play one baseline game and keep its Main and React decision positions (with attack probes)."""
    s = setup.for_seed(seed)
    content = s.content
    created = worker.create_game(content=content, initialization=s.initialization)
    state, state_hash = created["state"], created["stateHash"]
    sold: collections.Counter = collections.Counter()
    out: list[Position] = []
    index = 0
    while not state["match"].get("outcome") and index < max_decisions and state["timing"]["turn"] <= max_turns:
        actor = state["timing"]["actingPlayer"]
        model_input = worker.model_input(content=content, state=state, actor_id=actor)
        actions = model_input["legalActions"]
        if not actions:
            break
        obs = model_input["observation"]
        key = (obs["viewerSeat"], obs["turn"])
        kind = decision_kind(obs)
        if kind:
            position = Position(seed, index, state_hash, obs, actions, sold[key])
            if kind == "main" and probe:
                for a in actions:
                    if a["descriptor"]["kind"] == "DECLARE_ATTACK":
                        position.probes[a["descriptor"]["source"]["publicId"]] = attack_targets(
                            worker, content, state, actor, a["actionId"])
            out.append(position)
        chosen = baseline_action_id(tuple(actions))
        if next(a for a in actions if a["actionId"] == chosen)["descriptor"]["kind"] == "SELL_CARD":
            sold[key] += 1
        transition = worker.apply_action(content=content, state=state, actor_id=actor, action_id=chosen)
        state, state_hash = transition["state"], transition["stateHash"]
        index += 1
    return out


# Candidates -----------------------------------------------------------------------------------

@dataclass
class Candidate:
    question_class: str
    facts: dict
    label: bool
    reason: str | None       # why the engine refuses, read from the facts (None: the facts show no reason)
    subject: str             # the card the item is mainly about (slug), for caps
    cards: list[str]         # slugs named in the text, in order of mention
    scenario: str            # the facts, as text
    question: str            # "Can ...?"
    claim: str               # "You may ..." (the same claim as a statement)
    deciding_fact: str
    engine_check: dict
    position: Position
    yes_rule: str = "yes"     # the RULE_IDS key an offered action cites

    def signature(self) -> str:
        return json.dumps([self.question_class, self.facts], sort_keys=True)


def _player(obs: Mapping, seat: int) -> Mapping:
    return next(p for p in obs["players"] if p["seat"] == seat)


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _kw(keywords) -> str:
    return " and ".join(KEYWORD_TEXT.get(k, f"[{k}]") for k in keywords)


def _offered(actions: list[dict], kind: str) -> set[str]:
    return {a["descriptor"]["source"]["publicId"] for a in actions
            if a["descriptor"]["kind"] == kind and (a["descriptor"].get("source") or {}).get("kind") == "CARD"}


def _field_units(player: Mapping, cards: Mapping[str, Card]) -> list[Mapping]:
    """Face-up Units (and Legends gone solo) on a field; attached Gears share the zone and are left out."""
    return [c for c in player["cards"] if c["zone"] == "BATTLEFIELD" and c["face"] == "UP" and c.get("content")
            and cards[c["content"]["cardId"]].type in ("UNIT", "LEGEND")]


def candidates(position: Position, cards: Mapping[str, Card], skips: collections.Counter) -> list[Candidate]:
    """Every question this position supports: one per (class, card) the classes cover."""
    obs, actions = position.observation, position.actions
    step = decision_kind(obs)
    seat = obs["viewerSeat"]
    me, rival = _player(obs, seat), _player(obs, 1 - seat)
    name = {c["publicId"]: cards[c["content"]["cardId"]].name for p in obs["players"] for c in p["cards"]
            if c.get("content")}
    slug = {c["publicId"]: c["content"]["cardId"] for p in obs["players"] for c in p["cards"] if c.get("content")}
    mine = _field_units(me, cards)
    rival_units = _field_units(rival, cards)
    rival_spent = sum(1 for c in rival_units if c["readiness"] == "SPENT")
    rival_gigs = sum(1 for g in rival.get("gigs") or [] if g["zone"] == "GIGS")
    out: list[Candidate] = []

    if step == "main":
        header, header_cards = "It is your turn, in your Main phase.", []
    else:
        combat = obs["combat"]
        attacker = combat["attackerId"]
        if attacker not in name:
            skips["react-attacker-not-visible"] += 1
            return []
        target = combat.get("target") or {}
        if target.get("kind") == "GIG_AREA":
            target_text = "your Gig area"
        elif target.get("kind") == "CARD" and target["cardInstanceId"] in name:
            target_text = f"your {name[target['cardInstanceId']]}"
        else:
            skips["react-target-not-visible"] += 1
            return []
        header = (f"It is your rival's turn. Their {name[attacker]} is attacking {target_text}, and you are in the "
                  "React Step of that attack.")
        header_cards = [slug[attacker]] + ([slug[target["cardInstanceId"]]] if target.get("kind") == "CARD" else [])

    def add(cls, facts, label, reason, subject, named, scenario, question, claim, deciding, check, yes_rule="yes"):
        named_cards = list(dict.fromkeys(header_cards + named))
        out.append(Candidate(cls, {"step": step, **facts}, label, reason, subject, named_cards,
                             f"{header} {scenario}", question, claim, deciding, check, position, yes_rule))

    # attack-declare -----------------------------------------------------------------------
    attack_offered = _offered(actions, "DECLARE_ATTACK")
    for unit in mine:
        pid, card = unit["publicId"], cards[slug[unit["publicId"]]]
        if unit.get("restrictions"):
            skips["attack-declare:restricted"] += 1
            continue
        ready, lagging = unit["readiness"] == "READY", bool(unit.get("lagging"))
        kws = [k for k in unit.get("effectiveKeywords") or [] if k == "ADRENALINE"]
        solo = bool(unit.get("goSolo"))
        facts = {"ready": ready, "lagging": lagging, "adrenaline": bool(kws), "solo": solo,
                 "rival_spent_units": rival_spent > 0, "rival_gigs": rival_gigs > 0}
        if step == "react":
            reason = "outside-main"
        elif not ready:
            reason = "spent"
        elif lagging and not kws and not solo:
            reason = "lagging"
        elif not rival_spent and not rival_gigs:
            reason = "no-target"
        else:
            reason = None
        # A spent Unit's lag is not stated (the audit confirms the engine never needs it to decide).
        if ready:
            text = f"Your {card.name} is a ready Unit on your field, and it is {'lagging' if lagging else 'not lagging'}."
        else:
            text = f"Your {card.name} is a spent Unit on your field."
            facts["lagging"] = None
        if kws:
            text += f" It has {_kw(kws)}."
        if solo:
            text += " It is a Legend that went solo."
        text += (f" The rival has {_plural(rival_spent, 'spent Unit')} on their field and "
                 f"{_plural(rival_gigs, 'Gig die', 'Gig dice')} in their Gig area.")
        deciding = {None: f"Your {card.name} is ready and not lagging, it is your Main phase, and the rival has "
                          f"{'a spent Unit' if rival_spent else 'Gig dice'} to attack.",
                    "spent": f"Your {card.name} is spent.", "lagging": f"Your {card.name} is lagging.",
                    "outside-main": "It is your rival's turn, so it is not your Main phase.",
                    "no-target": "The rival has no spent Unit and no Gig die in their Gig area."}[reason]
        add("attack-declare", facts, pid in attack_offered, reason, card.slug, [card.slug], text,
            f"Can your {card.name} attack now?", f"Your {card.name} may attack now.", deciding,
            {"action": "DECLARE_ATTACK", "public_ids": [pid]})

    # attack-target (Main only: the engine was asked which targets each offered attack gets) -------
    for attacker_id, targets in sorted(position.probes.items()):
        unit = next((u for u in mine if u["publicId"] == attacker_id), None)
        if unit is None:
            skips["attack-target:attacker-not-a-field-unit"] += 1
            continue
        a_card = cards[slug[attacker_id]]
        a_kws = sorted(k for k in unit.get("effectiveKeywords") or [] if k in KEYWORD_TEXT)
        for other in rival_units:
            pid, card = other["publicId"], cards[slug[other["publicId"]]]
            ready = other["readiness"] == "READY"
            x_kws = sorted(k for k in other.get("effectiveKeywords") or [] if k in KEYWORD_TEXT)
            facts = {"target_ready": ready, "attacker_lagging": bool(unit.get("lagging")),
                     "attacker_keywords": a_kws, "target_keywords": x_kws, "rival_spent_units": rival_spent}
            text = (f"Your {a_card.name} is ready and {'lagging' if unit.get('lagging') else 'not lagging'}, and "
                    "you may declare an attack with it now.")
            if a_kws:
                text += f" It has {_kw(a_kws)}."
            text += f" The rival's {card.name} is a {'ready' if ready else 'spent'} Unit on their field."
            if x_kws:
                text += f" It has {_kw(x_kws)}."
            text += f" The rival has {_plural(rival_spent, 'spent Unit')} in all."
            add("attack-target", facts, pid in targets, "ready-target" if ready else None, card.slug,
                [a_card.slug, card.slug], text, f"Can your {a_card.name} attack the rival's {card.name}?",
                f"Your {a_card.name} may attack the rival's {card.name}.",
                f"The rival's {card.name} is {'ready' if ready else 'spent'}.",
                {"action": "ATTACK_TARGET", "attacker": attacker_id, "target": pid})

    # play-from-hand and sell: one item per card in hand (copies are the same question) ---------
    hand: dict[str, list[str]] = {}
    for c in me["cards"]:
        if c["zone"] == "HAND" and c.get("content"):
            hand.setdefault(c["content"]["cardId"], []).append(c["publicId"])
    eddies = sum(1 for c in me["cards"] if c["zone"] == "EDDIES" and c["readiness"] == "READY")
    legends = [c for c in me["cards"] if c["zone"] == "LEGENDS" and c["readiness"] == "READY"
               and (c["face"] == "DOWN" or (c.get("content") and cards[c["content"]["cardId"]].type == "LEGEND"))]
    face_down = sum(1 for c in legends if c["face"] == "DOWN")
    tagged = sum(1 for c in legends if c["face"] == "UP" and cards[c["content"]["cardId"]].sell_tag)
    untagged = sum(1 for c in legends if c["face"] == "UP" and not cards[c["content"]["cardId"]].sell_tag)
    hosts_units = len(mine)
    hosts_legends = sum(1 for c in me["cards"] if c["zone"] == "LEGENDS" and c["face"] == "UP" and c.get("content")
                        and cards[c["content"]["cardId"]].type == "LEGEND")
    legend_parts = [p for p in (_plural(face_down, "face-down Legend") if face_down else "",
                                _plural(tagged, "face-up Legend") + " with a Sell Tag" if tagged else "",
                                _plural(untagged, "face-up Legend") + " that lack" + ("s" if untagged == 1 else "")
                                + " a Sell Tag" if untagged else "") if p]
    pieces = (f"To pay costs, you have {_plural(eddies, 'Eddie')} ready in your Eddies area and "
              + (" and ".join(legend_parts) if legend_parts else "0 Legends") + " ready in your Legends area.")
    play_offered = _offered(actions, "PLAY_CARD")
    sell_offered = _offered(actions, "SELL_CARD")
    for card_slug, ids in sorted(hand.items()):
        card = cards[card_slug]
        # play-from-hand
        offered = {pid in play_offered for pid in ids}
        if card.cost is None:
            skips["play-from-hand:no-cost"] += 1
        elif len(offered) > 1:
            skips["play-from-hand:copies-disagree"] += 1
        else:
            quick = "QUICK" in card.keywords
            facts = {"type": card.type, "quick": quick, "cost": card.cost, "eddies": eddies,
                     "legends_face_down": face_down, "legends_tagged": tagged, "legends_untagged": untagged}
            quick_text = " with [QUICK]" if quick else (" that lacks [QUICK]" if step == "react" else "")
            text = (f"You have {card.name} in your hand, a {TYPE_TEXT[card.type]}{quick_text}; it costs "
                    f"{card.cost} €$. {pieces}")
            if card.type == "GEAR":
                facts["hosts"] = hosts_units + hosts_legends > 0
                text += (f" You have {_plural(hosts_units, 'Unit')} on your field and "
                         f"{_plural(hosts_legends, 'face-up Legend')} in your Legends area.")
            payable = eddies + face_down + tagged
            if step == "react" and not quick:
                reason = "outside-main"
            elif card.cost > payable:
                reason = "unaffordable"
            elif card.type == "GEAR" and not facts["hosts"]:
                reason = "no-equip-target"
            else:
                reason = None
            deciding = {None: (f"{card.name} has [QUICK], and your ready Eddies and Legends cover its cost of "
                               f"{card.cost} €$." if step == "react" else
                               f"It is your Main phase, and your ready Eddies and Legends cover its cost of "
                               f"{card.cost} €$."),
                        "unaffordable": f"Its cost is {card.cost} €$, more than your ready Eddies and Legends can pay.",
                        "outside-main": f"It is your rival's turn, and {card.name} lacks [QUICK].",
                        "no-equip-target": "You have no Unit or face-up Legend to equip it to."}[reason]
            add("play-from-hand", facts, True in offered, reason, card.slug, [card.slug], text,
                f"Can you pay for {card.name} and play it from your hand now?",
                f"You may pay for {card.name} and play it from your hand now.",
                deciding, {"action": "PLAY_CARD", "public_ids": sorted(ids)},
                "yes-react" if step == "react" else "yes")
        # sell
        offered = {pid in sell_offered for pid in ids}
        if card.type == "LEGEND":
            continue
        if len(offered) > 1:
            skips["sell:copies-disagree"] += 1
            continue
        facts = {"sell_tag": card.sell_tag}
        text = f"You have {card.name} in your hand; its card {'has' if card.sell_tag else 'lacks'} a Sell Tag."
        if step == "main":
            facts["sold_this_turn"] = position.sold_this_turn
            text += f" You have sold {_plural(position.sold_this_turn, 'card')} this turn."
        if step == "react":
            reason = "outside-main"
        elif not card.sell_tag:
            reason = "no-sell-tag"
        elif position.sold_this_turn:
            reason = "already-sold"
        else:
            reason = None
        deciding = {None: f"{card.name} has a Sell Tag, it is your Main phase, and you have not sold a card this turn.",
                    "no-sell-tag": f"{card.name} lacks a Sell Tag.",
                    "already-sold": "You have already sold a card this turn.",
                    "outside-main": "It is your rival's turn, so it is not your Main phase."}[reason]
        add("sell", facts, True in offered, reason, card.slug, [card.slug], text,
            f"Can you sell {card.name} now?", f"You may sell {card.name} now.", deciding,
            {"action": "SELL_CARD", "public_ids": sorted(ids)})

    # block (React Step only) -----------------------------------------------------------------
    if step == "react":
        block_offered = _offered(actions, "DECLARE_BLOCKER")
        target = (obs["combat"].get("target") or {})
        for unit in mine:
            pid, card = unit["publicId"], cards[slug[unit["publicId"]]]
            ready, lagging = unit["readiness"] == "READY", bool(unit.get("lagging"))
            blocker = "BLOCKER" in (unit.get("effectiveKeywords") or [])
            is_target = target.get("kind") == "CARD" and target.get("cardInstanceId") == pid
            facts = {"ready": ready, "lagging": lagging, "blocker": blocker, "is_target": is_target}
            if not blocker:
                reason = "no-blocker"
            elif not ready:
                reason = "spent"
            elif is_target:
                reason = "already-target"
            else:
                reason = None
            text = (f"Your {card.name} is on your field; it is {'ready' if ready else 'spent'} and "
                    f"{'lagging' if lagging else 'not lagging'}, and it {'has' if blocker else 'lacks'} [BLOCKER].")
            deciding = {None: f"Your {card.name} is ready and has [BLOCKER], and this is the React Step of your "
                              "rival's attack.",
                        "no-blocker": f"Your {card.name} lacks [BLOCKER].", "spent": f"Your {card.name} is spent.",
                        "already-target": f"Your {card.name} is already the target of this attack."}[reason]
            add("block", facts, pid in block_offered, reason, card.slug, [card.slug], text,
                f"Can your {card.name} use [BLOCKER] to block this attack?",
                f"Your {card.name} may use [BLOCKER] to block this attack.", deciding,
                {"action": "DECLARE_BLOCKER", "public_ids": [pid]})
    return out


def rule_ids_for(c: Candidate) -> list[str]:
    key = c.reason if c.reason is not None else c.yes_rule
    return list(RULE_IDS[(c.question_class, key)])


# Hidden information ---------------------------------------------------------------------------

def check_public(text: str, named: list[str], observation: Mapping, actions: list, cards: Mapping[str, Card]) -> None:
    """Fail if the text names a card the acting seat cannot see, or ``named`` holds one.

    Visible cards are exactly ``policy_prompt.visible_slugs`` of the seat's observation and offered actions
    (the engine's observation never carries a rival's hand or any deck order).
    """
    visible = {s.split("@")[0] for s in visible_slugs(observation, actions)}
    hidden = [s for s in named if s not in visible]
    if hidden:
        raise GenerationError(f"names cards the seat cannot see: {hidden}")
    visible_names = {cards[s].name for s in visible if s in cards}
    for card in cards.values():
        if card.slug not in visible and card.name not in visible_names and card.name in text:
            raise GenerationError(f"the text names {card.name}, which the seat cannot see")


# Selection ------------------------------------------------------------------------------------

def item_id(c: Candidate) -> str:
    p = c.position
    return "ep-" + hashlib.sha256(json.dumps([p.seed, p.index, c.question_class, c.engine_check],
                                             sort_keys=True).encode("utf-8")).hexdigest()[:14]


def audit(cands: list[Candidate]) -> tuple[list[Candidate], dict]:
    """Drop every candidate whose signature (class + described facts) carries both labels.

    Returns (kept, per-class report: candidates, signatures, conflicting signatures, dropped items).
    """
    labels: dict[str, set[bool]] = collections.defaultdict(set)
    for c in cands:
        labels[c.signature()].add(c.label)
    report: dict[str, dict] = {}
    for cls in CLASSES:
        mine = [c for c in cands if c.question_class == cls]
        sigs = {c.signature() for c in mine}
        bad = {s for s in sigs if len(labels[s]) > 1}
        report[cls] = {"candidates": len(mine), "signatures": len(sigs), "conflicting_signatures": len(bad),
                       "dropped": sum(1 for c in mine if c.signature() in bad)}
        report[cls]["dropped_share"] = round(report[cls]["dropped"] / len(mine), 4) if mine else 0.0
    return [c for c in cands if len(labels[c.signature()]) == 1], report


def phrase(c: Candidate) -> tuple[str, str]:
    """(statement, phrasing): about half questions, half statements to judge, by a hash of the item."""
    if _h(item_id(c), "phrasing") % 2 == 0:
        return f"{c.scenario} {c.question}", "question"
    return f"{c.scenario} {c.claim}", "statement"


def to_row(c: Candidate, engine: Mapping, decks: list[str]) -> dict:
    statement, phrasing = phrase(c)
    obs = c.position.observation
    return {"id": item_id(c), "kind": KIND, "statement": statement, "label": c.label, "phrasing": phrasing,
            "question_class": c.question_class, "no_reason": None if c.label else c.reason,
            "deciding_fact": c.deciding_fact, "source_rule_ids": rule_ids_for(c), "cards": list(c.cards),
            "provenance": {"generator": GENERATOR_VERSION, "engine": dict(engine), "seed": c.position.seed,
                           "decks": list(decks), "seat": obs["viewerSeat"], "turn": obs["turn"],
                           "step": obs["step"], "decision_index": c.position.index,
                           "state_hash": c.position.state_hash},
            "engine_check": c.engine_check}


def balance(rows: list[dict], cap: int = CAP_PER_KEY, per_class: int = MAX_PER_CLASS) -> tuple[list[dict], dict]:
    """Dedupe texts, cap (class, label, card), then equal Yes and No in each class, all in hash order."""
    drops = collections.Counter()
    seen, unique = set(), []
    for r in sorted(rows, key=lambda r: (_h(r["id"], "order"), r["id"])):
        if r["statement"] in seen:
            drops["duplicate-text"] += 1
            continue
        seen.add(r["statement"])
        unique.append(r)
    counts: collections.Counter = collections.Counter()
    capped = []
    for r in unique:
        key = (r["question_class"], r["label"], r["cards"][-1])  # the card asked about is named last
        if counts[key] >= cap:
            drops["cap"] += 1
            continue
        counts[key] += 1
        capped.append(r)
    out = []
    for cls in CLASSES:
        yes = [r for r in capped if r["question_class"] == cls and r["label"]]
        no = [r for r in capped if r["question_class"] == cls and not r["label"]]
        keep = min(len(yes), len(no), per_class // 2)
        drops["balance"] += len(yes) + len(no) - 2 * keep
        out.extend(yes[:keep] + no[:keep])
    return out, dict(drops)


def sort_rows(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r["provenance"]["seed"].rsplit("-", 1)[0],
                                       int(r["provenance"]["seed"].rsplit("-", 1)[1]),
                                       r["provenance"]["decision_index"], r["question_class"], r["id"]))


# The build ------------------------------------------------------------------------------------

@dataclass
class Result:
    rows: list[dict]
    manifest: dict
    leak: Any


def seeds_for(count: int, prefix: str = SEED_PREFIX) -> list[str]:
    return [f"{prefix}-{n}" for n in range(count)]


def collect_positions(setup: MatchSetup, seeds: list[str], workers: int = DEFAULT_WORKERS,
                      node: str = "node") -> list[Position]:
    """Play every seed (in parallel worker processes) and return the positions in seed order."""
    chunks = [seeds[i::workers] for i in range(max(1, min(workers, len(seeds))))]

    def run(chunk):
        with EngineWorker(REPO_ROOT, node=node) as worker:
            return {seed: play_seed(worker, setup, seed) for seed in chunk}

    by_seed: dict[str, list[Position]] = {}
    with ThreadPoolExecutor(max_workers=len(chunks)) as pool:
        for part in pool.map(run, chunks):
            by_seed.update(part)
    return [p for seed in seeds for p in by_seed[seed]]


def build(setup: MatchSetup, positions: list[Position], seeds: list[str], *, gold_dir: Path = tf.GOLD_DIR,
          known_rules: set[str] | None = None, do_audit: bool = True) -> Result:
    known_rules = known_rule_ids() if known_rules is None else known_rules
    check_rule_ids(known_rules)
    cards = card_data(setup.content)
    decks = deck_ids(setup.initialization)
    skips: collections.Counter = collections.Counter()
    cands: list[Candidate] = []
    for position in positions:
        for c in candidates(position, cards, skips):
            check_public(f"{c.scenario} {c.question} {c.claim} {c.deciding_fact}", c.cards, position.observation,
                         position.actions, cards)
            cands.append(c)
    kept, audit_report = audit(cands) if do_audit else (cands, {})
    drops: collections.Counter = collections.Counter()
    rows = []
    for c in kept:
        if not c.label and c.reason is None:
            drops[f"{c.question_class}:no-reason"] += 1
            continue
        if c.label and c.reason is not None:
            drops[f"{c.question_class}:reason-mismatch"] += 1
            continue
        row = to_row(c, setup.engine, decks)
        if tf.negation_count(row["statement"]) > 1:
            drops[f"{c.question_class}:two-negations"] += 1
            continue
        rows.append(row)
    gold_q, gold_all = tf.gold_texts(gold_dir)
    rule_rows = {r["id"]: r for r in tf.load_sources()}

    def guarded(items):
        # The statement, and what the target will say: the deciding fact and the cited rules as quoted.
        return [{"id": r["id"], "statement": r["statement"],
                 "target": " ".join([r["deciding_fact"]] + [tf.rule_quote(rule_rows[i]) for i in r["source_rule_ids"]])}
                for r in items]

    first = tf.leak_guard(guarded(rows), gold_q, gold_all)
    tripped = {v["id"] for v in first.violations}
    leak_dropped = sum(1 for r in rows if r["id"] in tripped)
    rows = [r for r in rows if r["id"] not in tripped]
    rows, select_drops = balance(rows)
    rows = sort_rows(rows)
    final = tf.leak_guard(guarded(rows), gold_q, gold_all)
    if not final.ok:
        raise GenerationError(f"leak guard still fails after drops: {final.violations[:3]}")
    labels = [r["label"] for r in rows]
    if labels.count(True) * 2 != len(labels):
        raise GenerationError("labels are not 50/50")

    def counter(key, items=rows):
        return dict(sorted(collections.Counter(key(r) for r in items).items()))

    manifest = {
        "source": SOURCE_NAME, "generator_version": GENERATOR_VERSION, "kind": KIND,
        "engine": dict(setup.engine), "ruleset": (setup.content.get("manifest") or {}).get("ruleset"),
        "content_manifest_hash": setup.content.get("manifestHash"), "decks": decks,
        "format": setup.initialization.get("format"),
        "seeds": {"prefix": SEED_PREFIX, "count": len(seeds), "first": seeds[0] if seeds else None,
                  "last": seeds[-1] if seeds else None},
        "policy": "baseline_action_id on both seats", "limits": {"max_decisions": MAX_DECISIONS, "max_turns": MAX_TURNS},
        "positions": len(positions), "candidates": len(cands),
        "counts": {"items": len(rows),
                   "by_class_and_label": counter(lambda r: f"{r['question_class']}:{'yes' if r['label'] else 'no'}"),
                   "by_class_and_no_reason": counter(lambda r: f"{r['question_class']}:{r['no_reason']}",
                                                     [r for r in rows if not r["label"]]),
                   "by_phrasing": counter(lambda r: r["phrasing"]),
                   "by_seat": counter(lambda r: str(r["provenance"]["seat"])),
                   "by_step": counter(lambda r: r["provenance"]["step"]),
                   "seeds_used": len({r["provenance"]["seed"] for r in rows}),
                   "turns": counter(lambda r: f"{r['provenance']['turn']:02d}"),
                   "distinct_cards": len({s for r in rows for s in r["cards"]}),
                   "by_rule_ids": counter(lambda r: ",".join(r["source_rule_ids"]))},
        "audit": {"signature": "question class + every fact the text states, card identities left out",
                  "by_class": audit_report},
        "drops": {**dict(sorted(drops.items())), "leak_guard": leak_dropped, **select_drops},
        "skips": dict(sorted(skips.items())),
        "selection": {"cap_per_class_label_card": CAP_PER_KEY, "max_per_class": MAX_PER_CLASS,
                      "order": "sha256 of the item id"},
        "rule_ids": {f"{cls}:{reason}": list(ids) for (cls, reason), ids in RULE_IDS.items()},
        "leak_guard": {"gold_files": sorted(p.name for p in gold_dir.glob("*.jsonl")), "gold_questions": len(gold_q),
                       "dropped": leak_dropped, "tripped_first_pass": first.violations,
                       "result": "pass" if final.ok else "fail", "nearest": final.nearest},
    }
    return Result(rows, manifest, final)


# Verification ---------------------------------------------------------------------------------

def verify_items(worker: EngineWorker, setup: MatchSetup, items: list[dict]) -> list[str]:
    """Replay each item's seed to its decision and ask the engine again; returns the problems found.

    The state hash must match the recorded one, an offered action must be offered exactly when the label is
    Yes, and an attack target must be one the engine offers once that attack is declared.
    """
    problems = []
    by_seed: dict[str, list[dict]] = collections.defaultdict(list)
    for item in items:
        by_seed[item["provenance"]["seed"]].append(item)
    for seed, group in sorted(by_seed.items()):
        wanted = collections.defaultdict(list)
        for item in group:
            wanted[item["provenance"]["decision_index"]].append(item)
        s = setup.for_seed(seed)
        created = worker.create_game(content=s.content, initialization=s.initialization)
        state, state_hash = created["state"], created["stateHash"]
        for index in range(max(wanted) + 1):
            actor = state["timing"]["actingPlayer"]
            model_input = worker.model_input(content=s.content, state=state, actor_id=actor)
            actions = model_input["legalActions"]
            for item in wanted.get(index, ()):
                if item["provenance"]["state_hash"] != state_hash:
                    problems.append(f"{item['id']}: state hash differs at decision {index}")
                    continue
                check = item["engine_check"]
                if check["action"] == "ATTACK_TARGET":
                    attack = next((a for a in actions if a["descriptor"]["kind"] == "DECLARE_ATTACK"
                                   and a["descriptor"]["source"]["publicId"] == check["attacker"]), None)
                    found = attack is not None and check["target"] in attack_targets(
                        worker, s.content, state, actor, attack["actionId"])
                else:
                    found = any(a["descriptor"]["kind"] == check["action"]
                                and (a["descriptor"].get("source") or {}).get("publicId") in check["public_ids"]
                                for a in actions)
                if found != item["label"]:
                    problems.append(f"{item['id']}: engine says {found}, label {item['label']}")
            chosen = baseline_action_id(tuple(actions))
            transition = worker.apply_action(content=s.content, state=state, actor_id=actor, action_id=chosen)
            state, state_hash = transition["state"], transition["stateHash"]
    return problems


# Output ---------------------------------------------------------------------------------------

def manifest_path(out: Path) -> Path:
    return out.with_name(out.name.removesuffix(".jsonl") + ".manifest.json")


def output_texts(result: Result) -> tuple[str, str]:
    rows = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in result.rows)
    return rows, json.dumps(result.manifest, ensure_ascii=False, indent=1) + "\n"


def write_outputs(out: Path, result: Result, *, force: bool = False) -> None:
    guard_shrink(out, len(result.rows), force, what="items", hint="pass --force to replace it")
    write_jsonl_atomic(out, result.rows)
    tmp = manifest_path(out).with_suffix(".json.tmp")
    tmp.write_text(output_texts(result)[1], encoding="utf-8")
    tmp.replace(manifest_path(out))


def print_summary(result: Result) -> None:
    m = result.manifest
    print("Leak guard nearest pairs (statement ratio to the closest gold question):")
    for n in m["leak_guard"]["nearest"]:
        print(f"  {n['ratio']:.3f}  {n['id']}: {n['statement']!r}\n         ~ {n['gold']}: {n['gold_text']!r}")
    print(f"leak guard: {m['leak_guard']['result']}; dropped {m['leak_guard']['dropped']}")
    print(f"positions {m['positions']}, candidates {m['candidates']}, items {m['counts']['items']}; "
          f"distinct cards {m['counts']['distinct_cards']}; seeds used {m['counts']['seeds_used']}")
    print(f"by class and label: {m['counts']['by_class_and_label']}")
    print(f"No reasons: {m['counts']['by_class_and_no_reason']}")
    for cls, a in m["audit"]["by_class"].items():
        print(f"audit {cls:15} candidates {a['candidates']:5}  signatures {a['signatures']:4}  "
              f"conflicting {a['conflicting_signatures']:3}  dropped {a['dropped']:5} ({a['dropped_share']:.1%})")
    print(f"drops: {m['drops']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT_PATH, help="output jsonl (default: %(default)s)")
    parser.add_argument("--seeds", type=int, default=DEFAULT_SEEDS, help="number of seeds (default %(default)s)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="engine worker processes")
    parser.add_argument("--check", action="store_true", help="regenerate in memory and compare with --out")
    parser.add_argument("--force", action="store_true", help="allow writing a file less than half the current size")
    parser.add_argument("--verify", type=int, metavar="N", help="replay N items of --out (hash order) on the engine")
    parser.add_argument("--node", default="node")
    args = parser.parse_args(argv)
    if args.seeds < 1 or args.workers < 1:
        parser.error("--seeds and --workers must be positive")
    setup = load_default_setup(REPO_ROOT, node=args.node)
    if args.verify is not None:
        items = sorted(read_jsonl(args.out, missing_ok=False), key=lambda r: _h(r["id"], "verify"))[:args.verify]
        with EngineWorker(REPO_ROOT, node=args.node) as worker:
            problems = verify_items(worker, setup, items)
        print("\n".join(problems) if problems else f"verified {len(items)} items against the engine")
        return 1 if problems else 0
    seeds = seeds_for(args.seeds)
    try:
        result = build(setup, collect_positions(setup, seeds, args.workers, args.node), seeds)
    except GenerationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print_summary(result)
    rows_text, manifest_text = output_texts(result)
    if args.check:
        stale = [p.name for p, text in ((args.out, rows_text), (manifest_path(args.out), manifest_text))
                 if not p.exists() or p.read_text(encoding="utf-8") != text]
        print("up to date" if not stale else f"differs: {', '.join(stale)}")
        return 1 if stale else 0
    write_outputs(args.out, result, force=args.force)
    print(f"Wrote {args.out} and {manifest_path(args.out).name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
