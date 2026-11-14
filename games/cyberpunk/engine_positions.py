"""Engine positions: replay a seed to its decisions and read what the acting seat can see there.

Shared by ``scripts/build_engine_tf_items.py`` (engine-verified legality items) and
``scripts/build_oracle_positions.py`` (the engine oracle's position catalog). Like
``engine_adapter``, this module decides nothing about the game. Every position comes
from the real engine worker playing the fixed Demo decks with the deterministic
``baseline_action_id`` policy on both seats. Every "offered" here means only that
the engine listed the action. Attack targets come from applying an offered
``DECLARE_ATTACK`` to a copy of the state and reading what the engine asks next.
Card identity is the slug (``content.cardId``), never the name.

Python only describes. It reads the acting seat's public ``ModelInputV2`` (its
observation and offered actions), the content bundle's card data, and the seat's
own public history: its sales this turn, and the cards played this turn, which
were face-up plays both seats saw. ``check_public`` fails when anything names a
card the seat cannot see.
"""

from __future__ import annotations

import collections
from dataclasses import dataclass, field
from typing import Any, Iterator, Mapping

from games.cyberpunk.engine_adapter import EngineWorker
from games.cyberpunk.local_match import MatchSetup
from games.cyberpunk.policy_bot import baseline_action_id
from games.cyberpunk.policy_prompt import visible_slugs

MAX_DECISIONS = 600
MAX_TURNS = 40
IN_PLAY = ("BATTLEFIELD", "LEGENDS", "EDDIES")  # zones where the engine's ready/spent is a game fact


class PositionError(Exception):
    """A fail-closed problem: a hidden card named, an engine answer out of shape, a card out of scope."""


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
            raise PositionError(f"{c.get('id')}: only revision 1 cards are handled")
        cost = c.get("printedCost") or {}
        out[c["id"]] = Card(c["id"], c["displayName"], c["type"],
                            cost.get("amount") if cost.get("kind") == "EDDIES" else None,
                            bool((c.get("sellProfile") or {}).get("allowed")),
                            tuple((c.get("mechanics") or {}).get("keywords") or c.get("keywords") or ()))
    return out


# Seed replay ----------------------------------------------------------------------------------

@dataclass
class Decision:
    """One decision of a replayed baseline game, before the baseline's action is applied."""
    seed: str
    index: int
    state: dict
    state_hash: str
    actor: str
    model_input: dict
    sold_this_turn: int                   # the acting seat's own sales this turn
    played_this_turn: frozenset[str]      # publicIds the engine applied a PLAY_CARD for this turn (either seat)

    @property
    def observation(self) -> dict:
        return self.model_input["observation"]

    @property
    def actions(self) -> list[dict]:
        return self.model_input["legalActions"]


def replay_seed(worker: EngineWorker, setup: MatchSetup, seed: str, *, max_decisions: int = MAX_DECISIONS,
                max_turns: int = MAX_TURNS) -> Iterator[Decision]:
    """Play one baseline game from ``seed`` and yield every decision before its action is applied.

    The engine creates the game, lists the actions, and applies the baseline's pick. The yielded state is the
    engine's own state, so a consumer may ask the worker about a copy of it before the generator moves on.
    """
    s = setup.for_seed(seed)
    content = s.content
    created = worker.create_game(content=content, initialization=s.initialization)
    state, state_hash = created["state"], created["stateHash"]
    sold: collections.Counter = collections.Counter()
    played: dict[int, set[str]] = collections.defaultdict(set)
    index = 0
    while not state["match"].get("outcome") and index < max_decisions and state["timing"]["turn"] <= max_turns:
        actor = state["timing"]["actingPlayer"]
        model_input = worker.model_input(content=content, state=state, actor_id=actor)
        actions = model_input["legalActions"]
        if not actions:
            break
        obs = model_input["observation"]
        key = (obs["viewerSeat"], obs["turn"])
        yield Decision(seed, index, state, state_hash, actor, model_input, sold[key],
                       frozenset(played[obs["turn"]]))
        chosen = baseline_action_id(tuple(actions))
        descriptor = next(a for a in actions if a["actionId"] == chosen)["descriptor"]
        if descriptor["kind"] == "SELL_CARD":
            sold[key] += 1
        if descriptor["kind"] == "PLAY_CARD" and (descriptor.get("source") or {}).get("kind") == "CARD":
            played[obs["turn"]].add(descriptor["source"]["publicId"])
        transition = worker.apply_action(content=content, state=state, actor_id=actor, action_id=chosen)
        state, state_hash = transition["state"], transition["stateHash"]
        index += 1


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


# Attack targets -------------------------------------------------------------------------------

def attack_options(worker: EngineWorker, content: Mapping, state: Mapping, actor: str,
                   action_id: str) -> list[dict]:
    """What the engine asks for once this attack is declared (applied to a copy of the state).

    With several targets the engine asks for one (CHOOSE TARGET options); with one it locks it in, and the
    attacker's observation shows it as the combat target. Returns ``{"kind": "CARD", "publicId": ...}`` and
    ``{"kind": <other option kind>}`` entries, card targets sorted by publicId first.
    """
    after = worker.apply_action(content=content, state=state, actor_id=actor, action_id=action_id)["state"]
    model_input = worker.model_input(content=content, state=after, actor_id=after["timing"]["actingPlayer"])
    obs = model_input["observation"]
    combat = obs.get("combat") or {}
    if combat.get("stage") == "ATTACK_TARGET_SELECTION":
        cards, other = [], []
        for a in model_input["legalActions"]:
            d = a["descriptor"]
            if d.get("kind") != "CHOOSE" or d.get("choiceKind") != "TARGET":
                raise PositionError(f"unexpected action during target selection: {d.get('label')}")
            option = d.get("option") or {}
            if option.get("kind") == "CARD":
                cards.append(option["publicId"])
            else:
                other.append(str(option.get("kind")))
        return [{"kind": "CARD", "publicId": p} for p in sorted(cards)] + [{"kind": k} for k in sorted(other)]
    target = combat.get("target") or {}
    if target.get("kind") == "CARD":
        return [{"kind": "CARD", "publicId": target["cardInstanceId"]}]
    if target.get("kind") == "GIG_AREA":
        return [{"kind": "GIG_AREA"}]
    raise PositionError(f"the attack produced no target: {combat}")


def attack_targets(worker: EngineWorker, content: Mapping, state: Mapping, actor: str, action_id: str) -> list[str]:
    """The card targets (publicIds, sorted) the engine offers once this attack is declared; Gig areas left out."""
    return [o["publicId"] for o in attack_options(worker, content, state, actor, action_id) if o["kind"] == "CARD"]


# Positions (engine-tf items) ------------------------------------------------------------------

@dataclass
class Position:
    seed: str
    index: int
    state_hash: str
    observation: dict
    actions: list[dict]
    sold_this_turn: int
    probes: dict[str, list[str]] = field(default_factory=dict)  # attacker publicId -> target publicIds


def play_seed(worker: EngineWorker, setup: MatchSetup, seed: str, *, probe: bool = True,
              max_decisions: int = MAX_DECISIONS, max_turns: int = MAX_TURNS) -> list[Position]:
    """Play one baseline game and keep its Main and React decision positions (with attack probes)."""
    content = setup.for_seed(seed).content
    out: list[Position] = []
    for d in replay_seed(worker, setup, seed, max_decisions=max_decisions, max_turns=max_turns):
        kind = decision_kind(d.observation)
        if not kind:
            continue
        position = Position(seed, d.index, d.state_hash, d.observation, d.actions, d.sold_this_turn)
        if kind == "main" and probe:
            for a in d.actions:
                if a["descriptor"]["kind"] == "DECLARE_ATTACK":
                    position.probes[a["descriptor"]["source"]["publicId"]] = attack_targets(
                        worker, content, d.state, d.actor, a["actionId"])
        out.append(position)
    return out


# Public facts ---------------------------------------------------------------------------------

def player(obs: Mapping, seat: int) -> Mapping:
    return next(p for p in obs["players"] if p["seat"] == seat)


def field_units(seat_view: Mapping, cards: Mapping[str, Card]) -> list[Mapping]:
    """Face-up Units (and Legends gone solo) on a field; attached Gears share the zone and are left out."""
    return [c for c in seat_view["cards"] if c["zone"] == "BATTLEFIELD" and c["face"] == "UP" and c.get("content")
            and cards[c["content"]["cardId"]].type in ("UNIT", "LEGEND")]


def offered_ids(actions: list[dict], kind: str) -> set[str]:
    """publicIds of the card sources of the offered actions of this ``kind`` (an engine listing, not a rule)."""
    return {a["descriptor"]["source"]["publicId"] for a in actions
            if a["descriptor"]["kind"] == kind and (a["descriptor"].get("source") or {}).get("kind") == "CARD"}


def slugs_by_public_id(obs: Mapping) -> dict[str, str]:
    """publicId -> slug for every card whose content the observation shows."""
    return {c["publicId"]: c["content"]["cardId"] for p in obs["players"] for c in p["cards"] if c.get("content")}


def payable(obs: Mapping, cards: Mapping[str, Card]) -> dict[str, int]:
    """The acting seat's ready payment pieces as the observation shows them (counts only, decides nothing)."""
    me = player(obs, obs["viewerSeat"])
    eddies = sum(1 for c in me["cards"] if c["zone"] == "EDDIES" and c["readiness"] == "READY")
    legends = [c for c in me["cards"] if c["zone"] == "LEGENDS" and c["readiness"] == "READY"
               and (c["face"] == "DOWN" or (c.get("content") and cards[c["content"]["cardId"]].type == "LEGEND"))]
    return {"eddies": eddies,
            "legends_face_down": sum(1 for c in legends if c["face"] == "DOWN"),
            "legends_tagged": sum(1 for c in legends if c["face"] == "UP" and cards[c["content"]["cardId"]].sell_tag),
            "legends_untagged": sum(1 for c in legends if c["face"] == "UP"
                                    and not cards[c["content"]["cardId"]].sell_tag)}


def public_facts(obs: Mapping, cards: Mapping[str, Card], played_this_turn: frozenset[str] | set[str]) -> list[dict]:
    """One row per card the acting seat can see, in observation order (rows sorted by side, area, publicId).

    ``affordable`` is set for the seat's own hand only: the printed cost against its ready Eddies, ready
    face-down Legends and ready face-up Legends with a Sell Tag, the counting ``build_engine_tf_items`` states
    in its texts. It is a described fact, not the engine's verdict; only an offered action is that.
    ``state`` (ready or spent) is given in play only; elsewhere (hand, trash) it is null.
    """
    seat = obs["viewerSeat"]
    pay = payable(obs, cards)
    budget = pay["eddies"] + pay["legends_face_down"] + pay["legends_tagged"]
    rows = []
    for p in obs["players"]:
        for c in p["cards"]:
            if not c.get("content"):
                continue
            card = cards.get(c["content"]["cardId"])
            if card is None:
                raise PositionError(f"{c['content']['cardId']}: not in the content bundle")
            mine = c.get("controllerSeat", c["ownerSeat"]) == seat
            in_hand = c["zone"] == "HAND"
            rows.append({
                "slug": card.slug, "public_id": c["publicId"], "side": "friendly" if mine else "rival",
                "area": c["zone"].lower(), "face": c["face"].lower(),
                "state": c["readiness"].lower() if c["zone"] in IN_PLAY else None,
                "lagging": bool(c.get("lagging")), "played_this_turn": c["publicId"] in played_this_turn,
                "cost": card.cost,
                "affordable": (card.cost <= budget) if (mine and in_hand and card.cost is not None) else None,
            })
    order = {"friendly": 0, "rival": 1}
    return sorted(rows, key=lambda r: (order[r["side"]], r["area"], _pid_key(r["public_id"])))


def _pid_key(public_id: str) -> tuple:
    """Natural order for ids like ``p0-c12``, so p0-c2 sorts before p0-c10."""
    head, _, tail = public_id.rpartition("c")
    return (head, int(tail)) if tail.isdigit() else (public_id, -1)


# Hidden information ---------------------------------------------------------------------------

def check_public(text: str, named: list[str], observation: Mapping, actions: list, cards: Mapping[str, Card]) -> None:
    """Fail if the text names a card the acting seat cannot see, or ``named`` holds one.

    Visible cards are exactly ``policy_prompt.visible_slugs`` of the seat's observation and offered actions
    (the engine's observation never carries a rival's hand or any deck order).
    """
    visible = {s.split("@")[0] for s in visible_slugs(observation, actions)}
    hidden = [s for s in named if s not in visible]
    if hidden:
        raise PositionError(f"names cards the seat cannot see: {hidden}")
    visible_names = {cards[s].name for s in visible if s in cards}
    for card in cards.values():
        if card.slug not in visible and card.name not in visible_names and card.name in text:
            raise PositionError(f"the text names {card.name}, which the seat cannot see")
