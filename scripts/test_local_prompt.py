#!/usr/bin/env python3
"""Tests for the compact local gameplay prompt (local-choice-v4) on real engine positions.

Why: v3 shortened the prompt the local MLX bot prefills on every decision. That is
only safe if it drops no fact the acting seat can see, adds nothing the seat
cannot see, stays deterministic and keeps {"choice": i} meaning the i-th offered
action. Every check runs over all decisions of real baseline games on the
engine worker, comparing the prompt against the facts in the retired v2 JSON
prompt (kept in games/cyberpunk/prompt_size.py). The card checks decode the text
back into facts and compare facts, so a wording change that keeps the facts
passes and a dropped fact fails. v4 adds a card reference (docs/local-prompt-v4.md):
these tests also check that every card the seat can see has exactly one line whose
facts match the engine content bundle, that no card the seat cannot see (per the
real engine state) gets one, that trimming follows its documented rules and that
the whole prompt stays within its size bound. No model, server or network is
used. Needs node and installed npm dependencies.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import REPO_ROOT as APP_ROOT, build_decision, load_default_setup
from games.cyberpunk.policy_bot import Decision, baseline_action_id
from games.cyberpunk.policy_mlx import MLXPolicy
from games.cyberpunk.policy_prompt import (MAX_CARD_TEXT_CHARS, MAX_REFERENCE_TEXT_CHARS, PROMPT_VERSION,
                                        SYSTEM_PROMPT, build_choice_messages, card_catalog, card_reference,
                                        parse_choice, prompt_fingerprint, render_position)
from measure_prompt_size import baseline_games, prompt_chars, v2_messages, v3_messages

# Together these games show re-rolled gigs, stolen gigs, lag, Go Solo, gear,
# restrictions, triggers, inspected cards and temporary modifiers.
SEEDS = ["test-local-prompt-0", "test-local-prompt-1", "benchmark-0"]
CTX: dict = {}
FLAGS = {"ready", "spent", "lag", "solo", "face-up", "face-down"}
FACE_DOWN_ZONES = ("HAND", "EDDIES")
# Size guard for the largest-v2 position of game 0 (decision 124 of 144, turn 11):
# 12,721 characters in v2 and 3,663 in v3 on 2026-11-11. v3 must stay under
# 1,400 tokens at 3 characters per token and at most 35% of v2.
MAX_V3_CHARS = 4_200
MAX_V3_SHARE_OF_V2 = 0.35
# v4 (2026-11-12) adds the card reference; no position of these games may pass
# 1,850 tokens at 3 characters per token (the largest was 5,3xx characters).
MAX_V4_CHARS = 5_550


def decisions():
    return [decision for game in CTX["games"] for decision in game]


def v2_position(decision):
    return json.loads(v2_messages(decision)[1]["content"])


def slug(ref):
    return ref["cardId"] if ref["revision"] == 1 else f"{ref['cardId']}@r{ref['revision']}"


def v2_card_fact(card, seat):
    """A card's facts from the v2 prompt; empty and absent mean the same thing."""
    return {"publicId": card["publicId"], "zone": card["zone"],
            "content": slug(card["content"]) if "content" in card else None,
            "readiness": card["readiness"], "power": card.get("effectivePower"),
            "kw": list(card.get("effectiveKeywords") or []), "type": list(card.get("effectiveTypes") or []),
            "restrict": list(card.get("restrictions") or []), "gear": list(card.get("attachments") or []),
            "known": [str(s) for s in card.get("knownToSeats") or []],
            "remembered": slug(card["rememberedContent"]) if "rememberedContent" in card else None,
            "damage": card["damage"], "counters": dict(card["counters"]), "lag": bool(card.get("lagging")),
            "solo": bool(card.get("goSolo")), "face": card["face"],
            "owner": card["ownerSeat"], "ctrl": card["controllerSeat"]}


def decode_card(item, zone, seat):
    """One v3 card item back into the facts v2_card_fact extracts."""
    tokens = item.split(" ")
    first = tokens.pop(0)
    public_id = f"seat:{seat}:{zone}:{first[1:]}" if first.startswith("#") else first
    fact = {"publicId": public_id, "zone": zone, "content": None, "readiness": "READY", "power": None,
            "kw": [], "type": [], "restrict": [], "gear": [], "known": [], "remembered": None,
            "damage": 0, "counters": {}, "lag": False, "solo": False,
            "face": "DOWN" if zone in FACE_DOWN_ZONES else "UP", "owner": seat, "ctrl": seat}
    if tokens and tokens[0] not in FLAGS and "=" not in tokens[0]:
        fact["content"] = tokens.pop(0)
    for token in tokens:
        key, _, value = token.partition("=")
        if token in ("ready", "spent"):
            fact["readiness"] = token.upper()
        elif token in ("face-up", "face-down"):
            fact["face"] = token.split("-")[1].upper()
        elif token in ("lag", "solo"):
            fact[token] = True
        elif key == "pow":
            fact["power"] = int(value)
        elif key in ("kw", "type", "restrict", "gear"):
            fact[key] = value.split(",")
        elif key == "known-to":
            fact["known"] = value.split(",")
        elif key == "remembered":
            fact["remembered"] = value
        elif key == "dmg":
            fact["damage"] = int(value)
        elif key == "counters":
            fact["counters"] = {k: int(v) for k, v in (pair.split(":") for pair in value.split(","))}
        elif key in ("owner", "ctrl"):
            fact[key] = int(value.removeprefix("s"))
        else:
            raise AssertionError(f"undecodable card token {token!r} in {item!r}")
    return fact


def decode_players(text):
    """{seat: {"streetCred", "counts", "cards", "gigs"}} from the v3 position text."""
    players, current = {}, None
    for line in text.split("\nActions:\n")[0].splitlines():
        head = re.fullmatch(r"s(\d+) \((?:you|rival)\): street cred (-?\d+)", line)
        if head:
            current = players.setdefault(int(head[1]), {"streetCred": int(head[2]), "counts": {},
                                                        "cards": [], "gigs": []})
            continue
        if current is None or not line.startswith(" "):
            continue
        seat = next(s for s, p in players.items() if p is current)
        dice = re.fullmatch(r" (\w+) dice: (.*)", line)
        if dice:
            for item in dice[2].split("; "):
                gig = re.fullmatch(r"(\S+?)(?:=(\d+)(?: \(rolled (\d+)\))?| unrolled)((?: \w+=s\d+)*)", item)
                assert gig, item
                roll = ({"kind": "UNROLLED"} if gig[2] is None else
                        {"kind": "ROLLED", "initialValue": int(gig[3] or gig[2]), "currentValue": int(gig[2])})
                extra = dict(pair.split("=") for pair in gig[4].split())
                current["gigs"].append({"id": gig[1], "dieType": gig[1].rsplit("-", 1)[1], "roll": roll,
                                        "ownerSeat": int(extra.get("owner", f"s{seat}")[1:]),
                                        "controllerSeat": int(extra.get("ctrl", f"s{seat}")[1:]),
                                        "zone": dice[1]})
            continue
        zone = re.fullmatch(r" (\w+)\((\d+)\)(?: hidden|: (.*))?", line)
        assert zone, line
        current["counts"][zone[1]] = int(zone[2])
        for item in (zone[3] or "").split("; "):
            if item and not re.fullmatch(r"\+\d+ hidden", item):
                current["cards"].append(decode_card(item, zone[1], seat))
    return players


async def test_every_card_gig_and_count_fact_survives():
    checked = 0
    for decision in decisions():
        snapshot = v2_position(decision)["snapshot"]
        decoded = decode_players(render_position(decision))
        assert set(decoded) == {p["seat"] for p in snapshot["players"]}
        for player in snapshot["players"]:
            got = decoded[player["seat"]]
            assert got["streetCred"] == player["streetCred"]
            assert got["counts"] == {z: n for z, n in player["counts"].items() if n}, (got["counts"], player["counts"])
            expected = sorted((v2_card_fact(c, player["seat"]) for c in player["cards"]), key=json.dumps)
            assert sorted(got["cards"], key=json.dumps) == expected, (got["cards"], expected)
            assert sorted(got["gigs"], key=json.dumps) == sorted(player["gigs"], key=json.dumps)
            checked += len(expected) + len(player["gigs"])
    assert checked > 5000, checked
    seen = "\n".join(render_position(decision) for decision in decisions())
    for feature in ("(rolled", "owner=s", " lag", " solo", "gear=", "restrict=", "face-up", " kw=",
                    " type=", "hidden"):
        assert feature in seen, f"the test games no longer exercise {feature!r}"


async def test_rare_card_fields_round_trip():
    """Card fields the baseline games never set: damage, counters, control, memory, revision."""
    decision = decisions()[-1]
    snapshot = copy.deepcopy(decision.snapshot)
    player = snapshot["players"][0]
    cards = [card for card in player["cards"] if "content" in card]
    cards[0].update(damage=2, counters={"plus": 1, "aura": 3}, controllerSeat=1 - player["seat"],
                    content={"cardId": cards[0]["content"]["cardId"], "revision": 2})
    cards[1].update(knownToSeats=[0, 1], rememberedContent={"cardId": "some-card", "revision": 1},
                    lagging=True, goSolo=True, readiness="SPENT")
    face_down = next(card for card in player["cards"] if "content" not in card)
    face_down.update(face="UP" if face_down["face"] == "DOWN" else "DOWN")
    variant = Decision(**{**decision.__dict__, "snapshot": snapshot})
    got = decode_players(render_position(variant))[player["seat"]]["cards"]
    expected = [v2_card_fact(card, player["seat"]) for card in player["cards"]]
    assert sorted(got, key=json.dumps) == sorted(expected, key=json.dumps), (got, expected)


def leaves(value, path=""):
    if isinstance(value, dict):
        if set(value) == {"cardId", "revision"}:
            yield path, slug(value)
            return
        for key, item in value.items():
            yield from leaves(item, f"{path}.{key}")
    elif isinstance(value, list):
        for item in value:
            yield from leaves(item, f"{path}[]")
    else:
        yield path, value


DROPPED = {".schemaVersion", ".choice.id", ".fightPreventions[].id", ".pendingTriggers[].id",
           ".temporaryModifiers[].origin.effectId"}


async def test_every_other_visible_fact_survives():
    """Turn, choice, combat, triggers and history: each value the v2 prompt held is in v3."""
    kinds = set()
    for decision in decisions():
        text = render_position(decision).split("\ns0 (")[0]
        words = set(re.findall(r"[A-Za-z0-9_@\-]+", text)) | {f"s{n}" for n in range(2)}
        snapshot = v2_position(decision)["snapshot"]
        for key, value in snapshot.items():
            if key == "players":
                continue
            kinds.add(key)
            for path, leaf in leaves(value, f".{key}"):
                if path in DROPPED:
                    continue
                if path == ".combat.target.kind":  # GIG_AREA reads "gig area"; CARD is its id
                    assert leaf == "CARD" or "gig area" in text, text
                    continue
                word = {True: "true", False: "false", None: "none"}.get(leaf, leaf) \
                    if not isinstance(leaf, int) or isinstance(leaf, bool) else str(leaf)
                seat = path.lower().endswith("seat") and f"s{leaf}" in words
                assert str(word) in words or seat, (path, leaf, text)
        if snapshot.get("pendingTriggers"):
            assert len(re.findall(r"^Trigger T\d+:", text, re.M)) == len(snapshot["pendingTriggers"])
    # The games must exercise the uncommon structures, or this test proves little.
    assert {"combat", "pendingTriggers", "gigSteals", "turnPlays", "choice"} <= kinds, kinds


async def test_actions_keep_order_labels_and_references():
    for decision in decisions():
        lines = render_position(decision).split("\nActions:\n")[1].splitlines()
        assert len(lines) == len(decision.legal_actions)
        for index, (line, action) in enumerate(zip(lines, decision.legal_actions)):
            descriptor = action["descriptor"]
            assert line.startswith(f"{index}: {descriptor['label']}"), (line, descriptor)
            for key in ("source", "option"):
                ref = descriptor.get(key) or {}
                for field in ("publicId", "gigId", "inspectedId", "value"):
                    if field in ref:
                        assert str(ref[field]).lower() in line.lower(), (line, ref)
                if ref.get("kind") == "ZONE_SLOT":
                    assert f"s{ref['seat']} {ref['zone']}#{ref['slot']}" in line, line
            if descriptor["kind"] not in ("CHOOSE", descriptor["label"]):
                assert descriptor["kind"] in line, line


class FakeWorker:
    def __init__(self, choice):
        self.choice, self.messages = choice, None

    async def request(self, payload):
        self.messages = payload["messages"]
        return {"ok": True, "text": json.dumps({"choice": self.choice})}


async def test_choice_maps_to_the_same_offered_action_id():
    for decision in decisions()[::7]:
        for order in (list(decision.legal_actions), list(reversed(decision.legal_actions))):
            variant = Decision(**{**decision.__dict__, "legal_actions": order})
            for index in {0, len(order) - 1}:
                worker = FakeWorker(index)
                assert await MLXPolicy(worker)(variant) == order[index]["actionId"]
                assert worker.messages == build_choice_messages(variant)
                line = worker.messages[1]["content"].split("\nActions:\n")[1].splitlines()[index]
                assert line.startswith(f"{index}: {order[index]['descriptor']['label']}")
    assert parse_choice('{"choice":1}', 2) == 1


def strings(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from strings(item)
    elif isinstance(value, str):
        yield value


def without_reference(text):
    """The prompt text without its "Cards:" section (checked by the card reference tests)."""
    head, actions = text.split("\nActions:\n")
    return head.split("\nCards:\n")[0] + "\nActions:\n" + actions


def reference_lines(text):
    """{slug: line} of the "Cards:" section; asserts each slug has one line."""
    head = text.split("\nActions:\n")[0]
    if "\nCards:\n" not in head:
        return {}
    lines = head.split("\nCards:\n")[1].splitlines()
    slugs = [line.split(": ", 1)[0] for line in lines]
    assert len(slugs) == len(set(slugs)), f"a card appears twice in the reference: {slugs}"
    assert slugs == sorted(slugs), slugs
    return dict(zip(slugs, lines))


async def test_no_hidden_or_unusable_information():
    """Every id or slug in the position comes from the seat's own observation or offered actions."""
    for decision in decisions():
        text = without_reference(render_position(decision))
        source = {word for value in [*strings(decision.snapshot), *strings(list(decision.legal_actions))]
                  for word in re.findall(r"[A-Za-z0-9_\-]+", value)}
        for token in re.findall(r"\b[a-z0-9]+(?:-[a-z0-9]+)+(?:@r\d+)?\b", text):
            assert token.split("@")[0] in source or token in ("face-up", "face-down"), token
        assert decision.player_id not in text and decision.match_id not in text
        assert not re.search(r"[0-9a-f]{32}", text), "hash or opaque id leaked"
        for action in decision.legal_actions:
            assert action["actionId"] not in text
    # Hand cards of the rival never show content in these games.
    for decision in decisions():
        viewer = decision.snapshot["viewerSeat"]
        for player in decision.snapshot["players"]:
            if player["seat"] != viewer:
                assert all("content" not in c for c in player["cards"] if c["zone"] == "HAND")


def reorder(value):
    """The same data with every object's keys in reverse order."""
    if isinstance(value, dict):
        return {key: reorder(value[key]) for key in reversed(list(value))}
    if isinstance(value, list):
        return [reorder(item) for item in value]
    return value


async def test_rendering_is_deterministic():
    for decision in decisions():
        first = build_choice_messages(decision)
        assert build_choice_messages(copy.deepcopy(decision)) == first
        shuffled = Decision(**{**decision.__dict__, "snapshot": reorder(decision.snapshot),
                               "legal_actions": [reorder(a) for a in decision.legal_actions],
                               "turn": reorder(decision.turn), "metadata": reorder(decision.metadata),
                               "pending": reorder(decision.pending)})
        assert build_choice_messages(shuffled) == first


async def test_unrecognized_fields_are_rendered_not_dropped():
    decision = decisions()[-1]
    snapshot = copy.deepcopy(decision.snapshot)
    snapshot["futureField"] = {"note": "kept"}
    snapshot["players"][0]["cards"][0]["futureCardField"] = 7
    actions = [dict(a) for a in decision.legal_actions]
    actions[0] = {**actions[0], "descriptor": {**actions[0]["descriptor"], "futureHint": "x1"}}
    variant = Decision(**{**decision.__dict__, "snapshot": snapshot, "legal_actions": actions,
                          "prompt": "Pick one.", "metadata": {"rulesVersion": "current"},
                          "pending": {"kind": "other"}, "turn": {"turn": 99}})
    text = render_position(variant)
    for expected in ("futureField: {note=kept}", "futureCardField=7", "futureHint=x1", "Pick one.",
                     "rulesVersion=current", "Pending: {kind=other}", "Turn info: {turn=99}"):
        assert expected in text, expected
    assert "Turn info" not in render_position(decision) and "Pending" not in render_position(decision)


def visible(decision):
    """The slugs the seat can see, by this test's own walk over its observation and actions."""
    return {slug(ref) for ref in refs([dict(decision.snapshot), list(decision.legal_actions)])}


def refs(value):
    if isinstance(value, dict):
        if set(value) == {"cardId", "revision"}:
            yield value
            return
        for item in value.values():
            yield from refs(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from refs(item)


def strip_reminders(text):
    return re.sub(r"\s+", " ", re.sub(r"\s*\([^()]*\)", "", text)).strip()


def without_flavour(text):
    """Rules text minus whole-line quotes and [Flavour] lines, lines joined by spaces."""
    lines = [line.strip() for line in text.splitlines()]
    return " ".join(line for line in lines if line and not line.startswith("[Flavour]")
                    and not (line[0] in "\"\u201c" and line[-1] in "\"\u201d"))


async def test_every_visible_card_has_one_reference_line_from_the_engine_content():
    catalog = {f"{c['id']}" if c["revision"] == 1 else f"{c['id']}@r{c['revision']}": c
               for c in CTX["setup"].content["cards"]}
    lines_seen = with_text = cut = omitted = 0
    for decision in decisions():
        lines = reference_lines(render_position(decision))
        expected = visible(decision)
        assert set(lines) == expected, (sorted(lines), sorted(expected))
        assert set(decision.cards) == expected, "the driver passed facts for a card the seat cannot see"
        for card_slug, line in lines.items():
            card = catalog[card_slug]
            head, _, body = line.partition(". ")
            tokens = head.split(" ")
            assert tokens[0] == f"{card_slug}:" and tokens[1] == card["type"], line
            facts = dict(token.split("=", 1) for token in tokens[2:] if "=" in token)
            cost = card["printedCost"]
            assert facts["cost"] == (str(cost["amount"]) if cost["kind"] == "EDDIES" else cost["kind"]), line
            assert facts.get("pow") == (None if card.get("power") is None else str(card["power"])), line
            keywords = card["mechanics"]["keywords"] or card["keywords"]
            assert facts.get("kw", "") == ",".join(keywords), line
            assert set(facts.get("tags", "").split(",")) - {""} <= {t.replace(" ", "_") for t in card["tags"]}
            lines_seen += 1
            if head.endswith(" ..."):
                omitted += 1
                continue
            if not body:
                continue
            with_text += 1
            # The text is the content's rulesText, trimmed: never reworded or invented.
            shown = strip_reminders(body.removesuffix("..."))
            source = strip_reminders(without_flavour(card["rulesText"]))
            if body.endswith("...") and not source.endswith("..."):
                cut += 1
                assert len(body) <= MAX_CARD_TEXT_CHARS and source.startswith(shown.rstrip(" ,.;:")), (shown, source)
            else:
                assert shown == source, (shown, source)
    assert lines_seen > 1000 and with_text > 500 and omitted > 0 and cut > 0, (lines_seen, with_text, omitted, cut)


async def test_no_card_the_seat_cannot_see_reaches_the_reference():
    """Against the real engine state: rival hand, decks and face-down cards never get a line."""
    setup = CTX["setup"].for_seed("test-local-prompt-hidden")
    catalog = card_catalog(setup.content)
    checked, hidden_only = 0, set()
    with EngineWorker(APP_ROOT, node=CTX["node"]) as engine:
        state = engine.create_game(content=setup.content, initialization=setup.initialization)["state"]
        while not state["match"].get("outcome") and checked < 80:
            actor = state["timing"]["actingPlayer"]
            model_input = engine.model_input(content=setup.content, state=state, actor_id=actor)
            decision = build_decision("m", checked, actor, model_input, catalog)
            observed = {card["publicId"] for player in model_input["observation"]["players"]
                        for card in player["cards"] if "content" in card}
            unseen = {obj["cardId"] for iid, obj in state["objects"]["cards"].items() if iid not in observed}
            secret = unseen - visible(decision)
            hidden_only |= secret
            lines = reference_lines(render_position(decision))
            assert not secret & set(lines), sorted(secret & set(lines))
            assert not secret & set(decision.cards)
            # A driver that passed the whole catalog would still not leak: the renderer filters.
            leaky = Decision(**{**decision.__dict__, "cards": catalog})
            assert render_position(leaky) == render_position(decision)
            action_id = baseline_action_id(decision.legal_actions)
            state = engine.apply_action(content=setup.content, state=state, actor_id=actor,
                                        action_id=action_id)["state"]
            checked += 1
    assert checked == 80 and len(hidden_only) > 5, (checked, sorted(hidden_only))


async def test_card_reference_trimming_rules():
    decision = next(d for d in decisions() if d.cards)
    blocker = "(You may spend this Unit to redirect a rival Unit's attack to it instead.)"
    long_text = "Draw 1. " * 40
    cards = {
        "a-card": {"type": "UNIT", "printedCost": {"kind": "EDDIES", "amount": 2}, "power": 3,
                   "tags": ["Trauma Team", "Corpo"], "keywords": ["BLOCKER"],
                   "rulesText": f"{{Blocker}} {blocker}\n\"A quoted flavour line.\""},
        "b-card": {"type": "PROGRAM", "printedCost": {"kind": "DASH"}, "tags": ["Merc"], "keywords": [],
                   "rulesText": f"Friendly CORPO Units gain {{Blocker}} {blocker}\n[Flavour] Old news."},
        "c-card": {"type": "GEAR", "printedCost": {"kind": "EDDIES", "amount": 1}, "power": 1,
                   "tags": [], "keywords": [], "rulesText": long_text, "ram": {"RED": 1}},
    }
    snapshot = copy.deepcopy(decision.snapshot)
    me = next(p for p in snapshot["players"] if p["seat"] == snapshot["viewerSeat"])
    me["cards"] = [{**card, "zone": "BATTLEFIELD", "content": {"cardId": name, "revision": 1}}
                   for card, name in zip([c for c in me["cards"] if "content" in c][:3], cards)]
    variant = Decision(**{**decision.__dict__, "snapshot": snapshot, "cards": cards,
                          "legal_actions": [{"actionId": "x", "descriptor": {"label": "END_TURN",
                                                                               "kind": "END_TURN"}}]})
    lines = reference_lines(render_position(variant))
    rival = {s for s in visible(variant) if s not in cards}
    assert set(lines) == set(cards) | rival
    a, b, c = lines["a-card"], lines["b-card"], lines["c-card"]
    # Flavour is dropped, a repeated reminder is shown once, tags only when text names them.
    assert a == f"a-card: UNIT cost=2 pow=3 tags=Corpo kw=BLOCKER. {{Blocker}} {blocker}", a
    assert b == "b-card: PROGRAM cost=DASH. Friendly CORPO Units gain {Blocker}", b
    # Long text is cut at a word; an unknown field is rendered, not dropped.
    body = c.split(". ", 1)[1]
    assert c.startswith("c-card: GEAR cost=1 pow=1 ram={RED=1}. Draw 1.") and body.endswith("...")
    assert len(body) <= MAX_CARD_TEXT_CHARS and long_text.startswith(body[:-3]), body
    # Past the text budget, lower-tier cards keep their line but lose their text.
    many = {f"x{i:02d}-card": dict(cards["c-card"], rulesText=f"Card {i}: " + "Ready 1 Eddie. " * 8)
            for i in range(12)}
    me["cards"] = [{**me["cards"][0], "publicId": f"p-{name}", "content": {"cardId": name, "revision": 1}}
                   for name in many]
    assert me["cards"][0]["zone"] == "BATTLEFIELD"
    crowded = Decision(**{**variant.__dict__, "snapshot": snapshot, "cards": many})
    lines = reference_lines(render_position(crowded))
    kept = [s for s in many if not lines[s].endswith(" ...")]
    assert kept and len(kept) < len(many) and kept == sorted(kept)[:len(kept)], kept
    assert sum(len(lines[s].split(". ", 1)[1]) for s in kept) <= MAX_REFERENCE_TEXT_CHARS
    # An offered action's card gets text first, whatever its slug.
    last = sorted(many)[-1]
    offered = Decision(**{**crowded.__dict__, "legal_actions": [{"actionId": "y", "descriptor": {
        "label": "Play", "kind": "PLAY_CARD", "source": {"kind": "CARD", "publicId": f"p-{last}"}}}]})
    assert not reference_lines(render_position(offered))[last].endswith(" ...")
    # Without card facts (an old decision record) there is no reference at all.
    assert "\nCards:\n" not in render_position(Decision(**{**decision.__dict__, "cards": {}}))


async def test_card_reference_is_deterministic_under_reordering():
    for decision in decisions()[::5]:
        first = build_choice_messages(decision)
        flipped = Decision(**{**decision.__dict__,
                              "legal_actions": list(reversed(decision.legal_actions)),
                              "cards": reorder({k: decision.cards[k] for k in reversed(list(decision.cards))})})
        again = build_choice_messages(flipped)[1]["content"]
        assert again.split("\nActions:\n")[0] == first[1]["content"].split("\nActions:\n")[0]


async def test_version_fingerprint_and_size_guard():
    assert PROMPT_VERSION == "local-choice-v4"
    sample = decisions()[:5]
    stamp = prompt_fingerprint(sample)
    assert stamp == prompt_fingerprint(copy.deepcopy(sample))
    assert set(stamp["parts"]) == {"prompt_version", "system_prompt", "message_shapes"}
    game = CTX["games"][0]
    late = max(game, key=lambda d: prompt_chars(v2_messages(d)))
    assert game.index(late) > len(game) // 2, "the largest v2 prompt should be a late-game position"
    v2, v3 = prompt_chars(v2_messages(late)), prompt_chars(v3_messages(late))
    assert v3 <= MAX_V3_CHARS and v3 <= MAX_V3_SHARE_OF_V2 * v2, (v2, v3)
    # v3 is v4 without the card reference.
    for decision in decisions()[::9]:
        v4 = build_choice_messages(decision)
        assert v3_messages(decision)[1]["content"] == without_reference(v4[1]["content"])
        assert v4[0]["content"].startswith(v3_messages(decision)[0]["content"] + "\nCards: ")
    largest = max(prompt_chars(build_choice_messages(d)) for d in decisions())
    assert largest <= MAX_V4_CHARS, largest
    assert len(SYSTEM_PROMPT) < 1500


async def run_tests(node):
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    CTX["node"] = node
    CTX["setup"] = load_default_setup(APP_ROOT, node=node)
    CTX["games"] = await baseline_games(SEEDS, node)
    for test in tests:
        await test()
        print(f"OK  {test.__name__}")
    print(f"PASS local prompt: {len(tests)}/{len(tests)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    asyncio.run(run_tests(args.node))


if __name__ == "__main__":
    main()
