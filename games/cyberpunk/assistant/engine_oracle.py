"""engine_check: answer "can this play be made?" from real engine positions, not from model reasoning.

Why: the 8B assistant's quiz misses are mostly reasoning slips about legality (ready/spent,
attack targets, timing, costs) over rules it already retrieved. The engine is the only authority on
legality (CLAUDE.md), and ``data/oracle/positions-v1.jsonl`` (``scripts/build_oracle_positions.py``)
records, for 677 real decision points of Demo games, the acting seat's public facts and exactly which
actions the engine offered there. This tool looks a described play up in that index and reports what
the engine did. It never decides legality itself and never runs the engine at question time.

What it can and cannot say, each one load-bearing:

  - ``offered`` is reported only for an action the engine listed (its kind and source card slug, and
    for ``attack_target`` the target the engine offered after that attack was declared).
  - ``not_offered`` is a fact about the listed positions, never a rule reason. The engine enumerates all
    legal actions, so absence at that position means it was not legal there, but *why* is not stated.
  - The verdict needs every matched position (each copy of the card counts separately) to agree.
    Disagreement is ``depends``: the stated facts do not decide it, and examples of both are returned,
    with ``facts_that_split``: fact values seen only where the play was not offered. That list is
    observational (what co-occurred with the engine's answers here), not a rule reason;
    the model can narrow the question with the ``step``, state, ``lagging``, ``played_this_turn``,
    ``affordable`` and ``sold_this_turn`` filters (the last two added 2026-11-15, after the held-out
    eval showed affordability and an earlier sale left most hand plays at ``depends``).
  - No position is generalised beyond its facts, and ``not_visible`` lists what an observation cannot
    show (sales and Calls earlier this turn are counted, the rival's hand and decks are hidden).
  - Only the 29 Demo cards can appear in positions. Any other card is refused with ``no_position``, and
    the model is told to answer from rules and card text and say the engine did not check it.

Card identity is the slug, never the name. Matching uses the index's ``source_slug``/``slug`` fields,
which the builder derives from the engine's public ids.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from games.cyberpunk.config import REPO_ROOT
from harness.core.io import read_jsonl

INDEX_PATH = REPO_ROOT / "data/oracle/positions-v1.jsonl"
MANIFEST_PATH = REPO_ROOT / "data/oracle/positions-v1.manifest.json"

PLAYS = ("attack", "attack_target", "play_from_hand", "sell", "block")
STEPS = ("main", "react")
STATES = ("ready", "spent")
YES_NO = ("yes", "no")
MAX_EXAMPLES = 3

# play -> (engine action kind, area the card must be in for the acting seat)
PLAY_KINDS = {"attack": ("DECLARE_ATTACK", "battlefield"), "attack_target": ("DECLARE_ATTACK", "battlefield"),
              "play_from_hand": ("PLAY_CARD", "hand"), "sell": ("SELL_CARD", "hand"),
              "block": ("DECLARE_BLOCKER", "battlefield")}

NOT_VISIBLE = [
    "why an action was not offered: the engine lists legal actions, it does not give reasons",
    "the rival's hand and both decks",
    "anything outside these recorded Demo-game positions; other situations may differ",
    "cards outside the 29 Demo cards (the engine only plays Demo games here)",
]

DESCRIPTION = ("Use to check if a play (attack, attack a target, play or sell a card, block) can be made: "
               "returns what the game engine offered in real positions.")


class OracleError(Exception):
    def __init__(self, kind: str, message: str, **extra: Any):
        super().__init__(message)
        self.kind = kind
        self.extra = extra


@lru_cache(maxsize=1)
def index() -> tuple[dict, ...]:
    return tuple(read_jsonl(INDEX_PATH))


@lru_cache(maxsize=1)
def manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def catalog_slugs() -> frozenset[str]:
    return frozenset(c["slug"] for row in index() for c in row["facts"]["cards"])


def _card_view(fact: dict) -> dict:
    return {k: fact[k] for k in ("slug", "public_id", "side", "area", "state", "lagging", "played_this_turn",
                                 "cost", "affordable")}


def _instances(row: dict, slug: str, side: str, area: str) -> list[dict]:
    return [c for c in row["facts"]["cards"] if c["slug"] == slug and c["side"] == side and c["area"] == area]


def _fits(inst: dict, card_state: str | None, lagging: str | None, played_this_turn: str | None,
          affordable: str | None = None) -> bool:
    return ((not card_state or inst["state"] == card_state)
            and (not lagging or inst["lagging"] == (lagging == "yes"))
            and (not played_this_turn or inst["played_this_turn"] == (played_this_turn == "yes"))
            and (not affordable or inst["affordable"] == (affordable == "yes")))


def _observations(row: dict, play: str, card: str, target: str | None, card_state: str | None,
                  target_state: str | None, lagging: str | None = None,
                  played_this_turn: str | None = None, affordable: str | None = None) -> list[dict]:
    """One observation per (copy of card[, copy of target]) at this position that fits the stated facts."""
    kind, area = PLAY_KINDS[play]
    offered = [o for o in row["offered"] if o["kind"] == kind]
    out = []
    for inst in _instances(row, card, "friendly", area):
        if not _fits(inst, card_state, lagging, played_this_turn, affordable):
            continue
        actions = [o for o in offered if o["source_public_id"] == inst["public_id"]]
        if play != "attack_target":
            out.append({"card": inst, "target": None, "offered": actions[0] if actions else None})
            continue
        for tgt in _instances(row, target, "rival", "battlefield"):
            if target_state and tgt["state"] != target_state:
                continue
            hit = next((a for a in actions
                        if any(t.get("public_id") == tgt["public_id"] for t in a.get("attack_targets", []))), None)
            out.append({"card": inst, "target": tgt, "offered": hit})
    return out


def _example(row: dict, obs: dict, kind: str) -> dict:
    facts = row["facts"]
    return {"position_id": row["position_id"], "seed": row["seed"], "decision_index": row["decision_index"],
            "state_hash": row["state_hash"], "turn": row["turn"], "step": row["step"],
            "card": _card_view(obs["card"]), "target": _card_view(obs["target"]) if obs["target"] else None,
            "payable": facts["payable"], "sold_this_turn": facts["sold_this_turn"], "combat": facts["combat"],
            "offered": ({"kind": obs["offered"]["kind"], "label": obs["offered"]["label"],
                         "action_id": obs["offered"]["action_id"]} if obs["offered"] else None),
            "offered_same_kind": [o["label"] for o in row["offered"] if o["kind"] == kind]}


def _facts_of(row: dict, obs: dict) -> dict:
    """The stated facts an observation can be split on (public facts only)."""
    card = obs["card"]
    rival_spent = sum(1 for c in row["facts"]["cards"]
                      if c["side"] == "rival" and c["area"] == "battlefield" and c["state"] == "spent")
    facts = {"step": row["step"], "card state": card["state"], "card lagging": card["lagging"],
             "card played this turn": card["played_this_turn"], "card affordable now": card["affordable"],
             "rival has a spent Unit": rival_spent > 0, "a card was sold this turn": row["facts"]["sold_this_turn"] > 0}
    if obs["target"]:
        facts["target state"] = obs["target"]["state"]
    return facts


def _fact_split(yes: list, no: list) -> list[dict]:
    """Fact values seen in not-offered matches and never in offered ones.

    Observational only: in these positions the engine never offered the play when a fact had one of
    these values. It is not a rule reason, and several facts can co-occur, so it names candidates for
    the model to check against the rules (or to narrow the question with filters), nothing more.
    """
    if not yes or not no:
        return []
    yes_f = [_facts_of(r, o) for r, o in yes]
    no_f = [_facts_of(r, o) for r, o in no]
    out = []
    for key in no_f[0]:
        never = {f.get(key) for f in no_f} - {f.get(key) for f in yes_f}
        if never:
            out.append({"fact": key, "never_offered_when": sorted(map(str, never))})
    return out


def _unique_positions(pairs: list, limit: int) -> list:
    seen, out = set(), []
    for r, o in pairs:
        if r["position_id"] not in seen:
            seen.add(r["position_id"])
            out.append((r, o))
        if len(out) == limit:
            break
    return out


def engine_check(play: str, card: str, target: str | None = None, step: str | None = None,
                 card_state: str | None = None, target_state: str | None = None,
                 lagging: str | None = None, played_this_turn: str | None = None,
                 affordable: str | None = None, sold_this_turn: str | None = None,
                 limit: int = MAX_EXAMPLES) -> dict:
    """The engine's verdict on ``play`` with ``card`` across matching recorded positions."""
    if (play == "attack_target") != (target is not None):
        raise OracleError("invalid_arguments", "target is required for attack_target and only allowed there.")
    if target_state and play != "attack_target":
        raise OracleError("invalid_arguments", "target_state is only allowed with attack_target.")
    for slug in (card, target):
        if slug is not None and slug not in catalog_slugs():
            raise OracleError("no_position", f"The engine has no recorded position with {slug!r}: only the 29 "
                              "Demo cards are played. Answer from the rules and card text, and say the engine "
                              "did not check it.")
    kind = PLAY_KINDS[play][0]
    matched = []  # (row, observation)
    for row in index():
        if step and row["step"] != step:
            continue
        if sold_this_turn and (row["facts"]["sold_this_turn"] > 0) != (sold_this_turn == "yes"):
            continue
        matched += [(row, obs) for obs in _observations(row, play, card, target, card_state, target_state,
                                                        lagging, played_this_turn, affordable)]
    yes = [(r, o) for r, o in matched if o["offered"]]
    no = [(r, o) for r, o in matched if not o["offered"]]
    if not matched:
        verdict = "no_position"
    elif yes and no:
        verdict = "depends"
    else:
        verdict = "offered" if yes else "not_offered"
    if verdict == "depends":
        picks = _unique_positions(yes, (limit + 1) // 2) + _unique_positions(no, max(1, limit // 2))
    else:
        picks = _unique_positions(yes or no, limit)
    engine = manifest()["engine"]
    return {"verdict": verdict, "play": play, "card": card, "target": target,
            "filters": {"step": step, "card_state": card_state, "target_state": target_state,
                        "lagging": lagging, "played_this_turn": played_this_turn,
                        "affordable": affordable, "sold_this_turn": sold_this_turn},
            "matched": len(matched), "offered_count": len(yes), "not_offered_count": len(no),
            "positions": [_example(r, o, kind) for r, o in picks],
            "facts_that_split": _fact_split(yes, no),
            "not_visible": NOT_VISIBLE,
            "engine": {"version": engine["version"], "artifactHash": engine["artifactHash"],
                       "index": "data/oracle/positions-v1.jsonl"}}
