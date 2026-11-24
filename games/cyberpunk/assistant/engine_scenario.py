"""engine_scenario: build an exact situation on the engine, play a few actions, report what happened.

Why: ``engine_check`` only answers "can this card attack / block / be played / be sold" from positions
random games happened to reach. Most card questions instead ask what an effect does in one exact
situation (does this Legend's Play effect fire when a Call flips it; does that card draw when it is
defeated). This tool lets the engine answer those directly:

1. **Setup.** The engine's ``composeScenario`` op builds the state the setup describes, at the active
   seat's Main phase: field Units (ready or spent, with Gear), Legends (face up or down), hand, trash,
   deck top, Gigs and Eddies for each seat. The engine checks the setup and validates the state; Python
   passes it through untouched. Each seat must be a legal Constructed deck: exactly 3 unique Legends whose
   RAM covers every card it owns, at most 3 copies of a slug. ``deck`` is its top, in order; the engine
   fills the rest deterministically (docs/engine-scenario-2026-11-21.md).
2. **Steps.** At most ``MAX_STEPS`` actions, each a kind, a card and an optional target or choice
   (``{"kind": "PLAY_CARD", "card": "<slug>"}``, ``{"kind": "DECLARE_ATTACK", "card": "<slug>",
   "target": "gig"}``, ``{"kind": "END_TURN"}``). Python matches each to exactly one action the engine
   offered the acting seat. No match, or more than one, stops the run and returns the offers: Python never
   picks a move the engine did not offer, and never guesses between two it did.
3. **Report.** For every step: who acted, what was applied, a diff of the public observations (cards
   moved, readied or spent, damage, Gigs, Street Cred, counts, turn and window), the pending choice if
   one is open, and the actions the engine offers next. The start and end boards are included.

Only two things are done without a step, both between offered actions and both reported under ``auto``:
a choice with exactly one option is taken (there is nothing to decide), and a payment choice is paid
with the lowest ready Eddie slot unless the step lists ``pay`` choices. Any other choice stops the step
and waits for a ``CHOOSE`` step.

Hidden information. The report is built from each seat's own engine observation (``observe``), never
from raw events or the engine state, so a seat's own hand shows and its deck does not. Face-down Legends
are hidden from their owner too; the report names them from the setup, which the caller wrote.

The engine identity of the running worker is stamped on every result, and the verdict is the engine's.
"""

from __future__ import annotations

import functools
import json
import re
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from games.cyberpunk.config import REPO_ROOT
from games.cyberpunk.engine_adapter import EngineProtocolError, EngineWorker

SCENARIO_VERSION = "engine-scenario-v1"
DEFAULT_SEED = "engine-scenario-v1"
MAX_STEPS = 8
MAX_AUTO = 16           # forced choices taken in one step; more means a loop the report should show
MAX_OFFERS = 40         # offers listed per step; the count is always given
SETUP_SCRIPT = "scripts/local-match-setup.ts"

CARD_KINDS = ("PLAY_CARD", "SELL_CARD", "GO_SOLO", "DECLARE_ATTACK", "DECLARE_BLOCKER", "ACTIVATE_ABILITY")
STEP_KINDS = (*CARD_KINDS, "CALL_LEGEND", "ROLL_GIG", "CHOOSE", "PASS_REACT", "END_TURN")
STEP_FIELDS = ("kind", "card", "target", "choice", "label", "seat", "pay")
_LEGEND_SLOT = re.compile(r"^seat:(\d+):LEGENDS:(\d+)$")


class ScenarioError(Exception):
    """A setup or step the tool cannot run. ``kind`` names why; ``extra`` carries offers or engine errors."""

    def __init__(self, kind: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.kind = kind
        self.extra = extra


# Content -------------------------------------------------------------------------------------

@functools.lru_cache(maxsize=2)
def _reviewed(app_root: str, node: str) -> tuple[str, str]:
    completed = subprocess.run([node, "--import", "tsx", SETUP_SCRIPT, "--content"], cwd=app_root,
                               capture_output=True, text=True, encoding="utf-8", check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"{SETUP_SCRIPT} --content failed: {completed.stderr.strip()[-500:]}")
    value = json.loads(completed.stdout)
    return json.dumps(value["content"]), json.dumps(value["engine"])


def reviewed_content(app_root: str | Path = REPO_ROOT, node: str = "node") -> tuple[dict, dict]:
    """(content bundle, engine identity): every admitted card, read from the TypeScript fixtures."""
    content, engine = _reviewed(str(Path(app_root).resolve()), node)
    return json.loads(content), json.loads(engine)


# Steps ---------------------------------------------------------------------------------------

def parse_steps(steps: Any) -> list[dict]:
    """Check the step list's shape (Python's own input; the setup is the engine's to check)."""
    if not isinstance(steps, list):
        raise ScenarioError("invalid_steps", "steps must be a list")
    if len(steps) > MAX_STEPS:
        raise ScenarioError("invalid_steps", f"at most {MAX_STEPS} steps (got {len(steps)})")
    out = []
    for i, step in enumerate(steps):
        where = f"steps[{i}]"
        if not isinstance(step, dict):
            raise ScenarioError("invalid_steps", f"{where} must be an object")
        unknown = sorted(set(step) - set(STEP_FIELDS))
        if unknown:
            raise ScenarioError("invalid_steps", f"{where}: unknown field(s) {unknown} (allowed: {list(STEP_FIELDS)})")
        kind = step.get("kind")
        if kind not in STEP_KINDS:
            raise ScenarioError("invalid_steps", f"{where}.kind must be one of {list(STEP_KINDS)}")
        for name in ("card", "target", "choice", "label"):
            if name in step and (not isinstance(step[name], str) or not step[name].strip()):
                raise ScenarioError("invalid_steps", f"{where}.{name} must be a non-empty string")
        if "seat" in step and step["seat"] not in (0, 1):
            raise ScenarioError("invalid_steps", f"{where}.seat must be 0 or 1")
        if "pay" in step and (not isinstance(step["pay"], list)
                              or not all(isinstance(p, str) and p.strip() for p in step["pay"])):
            raise ScenarioError("invalid_steps", f"{where}.pay must be a list of non-empty strings")
        if kind in (*CARD_KINDS, "CALL_LEGEND") and "card" not in step and "label" not in step:
            raise ScenarioError("invalid_steps", f"{where}: {kind} needs a card (or the offer's exact label)")
        if kind == "CHOOSE" and "choice" not in step and "label" not in step:
            raise ScenarioError("invalid_steps", f"{where}: CHOOSE needs a choice (or the offer's exact label)")
        out.append(dict(step))
    return out


def _norm(text: str) -> str:
    return " ".join(text.strip().lower().split())


def option_text(option: Mapping, slugs: Mapping[str, str]) -> str:
    """A choice option as the report shows it, built only from the public descriptor."""
    kind = option.get("kind")
    if kind == "CARD":
        pid = option["publicId"]
        return f"{slugs[pid]} ({pid})" if pid in slugs else pid
    if kind == "GIG_AREA":
        return f"gig area of seat {option['seat']}"
    if kind == "GIG":
        return option["gigId"]
    if kind == "ZONE_SLOT":
        return f"{option['zone']} slot {option['slot']} of seat {option['seat']}"
    if kind == "CONFIRM":
        return "yes" if option["value"] else "no"
    if kind in ("MODE", "AMOUNT"):
        return str(option["value"])
    if kind == "EFFECT":
        return option["effectId"]
    if kind == "INSPECTED_CARD":
        return option["inspectedId"]
    return json.dumps(option, sort_keys=True)


def _option_names(option: Mapping, slugs: Mapping[str, str], legends: Mapping[tuple[int, int], str]) -> set[str]:
    """Every string a step may use to name this option."""
    kind = option.get("kind")
    names = {option_text(option, slugs)}
    if kind == "CARD":
        names |= {option["publicId"], slugs.get(option["publicId"], "")}
    elif kind == "GIG_AREA":
        names |= {"gig", "gig area", "rival gig", f"gig area {option['seat']}"}
    elif kind == "ZONE_SLOT":
        names.add(f"{option['zone']} {option['slot']}")
        if option["zone"] == "LEGENDS":
            names.add(legends.get((option["seat"], option["slot"]), ""))
    elif kind == "GIG":
        names.add(option["gigId"].rsplit("-", 1)[-1])
    return {_norm(n) for n in names if n}


def describe(action: Mapping, slugs: Mapping[str, str], legends: Mapping[tuple[int, int], str]) -> dict:
    """One offered action as the report lists it: kind, card or option, and the engine's label."""
    d = action["descriptor"]
    out: dict[str, Any] = {"kind": d["kind"]}
    source = d.get("source") or {}
    if source.get("kind") == "CARD":
        out["card"] = slugs.get(source["publicId"], source["publicId"])
        out["public_id"] = source["publicId"]
    elif source.get("kind") == "ZONE_SLOT":
        out["card"] = legends.get((source["seat"], source["slot"]), f"legend slot {source['slot']}")
    elif source.get("kind") == "GIG":
        out["card"] = source["gigId"]
    if d["kind"] == "CHOOSE":
        out["choice_kind"] = d["choiceKind"]
        out["option"] = option_text(d["option"], slugs)
    out["label"] = d["label"]
    return out


def _source_names(d: Mapping, slugs: Mapping[str, str], legends: Mapping[tuple[int, int], str]) -> set[str]:
    source = d.get("source") or {}
    if source.get("kind") == "CARD":
        names = {source["publicId"], slugs.get(source["publicId"], "")}
    elif source.get("kind") == "ZONE_SLOT":
        names = {legends.get((source["seat"], source["slot"]), ""), f"legend {source['slot']}"}
    elif source.get("kind") == "GIG":
        names = {source["gigId"], source["gigId"].rsplit("-", 1)[-1]}
    else:
        names = set()
    return {_norm(n) for n in names if n}


def match_step(step: Mapping, actions: Sequence[Mapping], slugs: Mapping[str, str],
               legends: Mapping[tuple[int, int], str]) -> Mapping:
    """The one offered action ``step`` names, or ScenarioError(no_match | ambiguous) with the offers."""
    kind = step["kind"]
    hits = [a for a in actions if a["descriptor"]["kind"] == kind]
    if "card" in step:
        want = _norm(step["card"])
        hits = [a for a in hits if want in _source_names(a["descriptor"], slugs, legends)]
    if kind == "CHOOSE" and "choice" in step:
        want = _norm(step["choice"])
        hits = [a for a in hits if want in _option_names(a["descriptor"]["option"], slugs, legends)
                or want == _norm(a["descriptor"]["label"])]
    if "label" in step:
        hits = [a for a in hits if _norm(a["descriptor"]["label"]) == _norm(step["label"])]
    if len(hits) == 1:
        return hits[0]
    offers = sorted((describe(a, slugs, legends) for a in actions), key=_offer_key)
    what = json.dumps({k: step[k] for k in ("kind", "card", "choice", "label") if k in step})
    if not hits:
        raise ScenarioError("no_match", f"the engine offers no action matching {what}", offers=offers)
    raise ScenarioError("ambiguous", f"{len(hits)} offered actions match {what}; name the card by its publicId "
                        "or give the offer's exact label", offers=offers,
                        matches=[describe(a, slugs, legends) for a in hits])


# Observations --------------------------------------------------------------------------------

def _seat_ids(state: Mapping) -> list[str]:
    return list(state["match"]["playerOrder"])


def observe_both(worker: EngineWorker, content: Mapping, state: Mapping) -> list[dict]:
    """Each seat's own engine observation, seat 0 first."""
    return [worker.observe(content=content, state=state, actor_id=pid) for pid in _seat_ids(state)]


def _own(obs: Mapping) -> Mapping:
    return next(p for p in obs["players"] if p["seat"] == obs["viewerSeat"])


def slug_map(views: Sequence[Mapping]) -> dict[str, str]:
    """publicId -> slug for every card either seat's own view shows."""
    return {c["publicId"]: c["content"]["cardId"] for v in views for p in v["players"]
            for c in p["cards"] if c.get("content")}


def legend_names(setup: Mapping) -> dict[tuple[int, int], str]:
    """(seat, slot) -> slug from the setup the caller wrote: face-down Legends are hidden even from their owner."""
    out = {}
    for seat, player in enumerate(setup.get("players") or []):
        for slot, legend in enumerate((player or {}).get("legends") or []):
            if isinstance(legend, Mapping) and isinstance(legend.get("card"), str):
                out[(seat, slot)] = legend["card"]
    return out


def _card_name(card: Mapping, legends: Mapping[tuple[int, int], str]) -> str:
    if card.get("content"):
        return card["content"]["cardId"]
    m = _LEGEND_SLOT.match(card["publicId"])
    if m and (int(m[1]), int(m[2])) in legends:
        return f"{legends[(int(m[1]), int(m[2]))]} (face down)"
    return f"hidden {card['publicId']}"


def _gig_text(gig: Mapping) -> str:
    roll = gig.get("roll") or {}
    value = roll.get("currentValue") if roll.get("kind") == "ROLLED" else None
    return f"{gig['dieType']}={value}" if value is not None else gig["dieType"]


def snapshot(views: Sequence[Mapping], legends: Mapping[tuple[int, int], str]) -> dict:
    """The facts the diff compares, from each seat's own view of itself (plus the shared match facts)."""
    first = views[0]
    snap: dict[str, Any] = {"match": {k: first.get(k) for k in ("turn", "activeSeat", "actingSeat", "window",
                                                                "step", "resolutionStage", "outcome")},
                            "cards": {}, "seats": {}}
    for view in views:
        me = _own(view)
        seat = me["seat"]
        snap["seats"][seat] = {"street_cred": me.get("streetCred"), "counts": dict(me.get("counts") or {}),
                               "gigs": {g["id"]: (g.get("zone"), _gig_text(g)) for g in me.get("gigs") or []}}
        for c in me["cards"]:
            snap["cards"][c["publicId"]] = {
                "name": _card_name(c, legends), "seat": seat, "zone": c.get("zone"), "readiness": c.get("readiness"),
                "face": c.get("face"), "damage": c.get("damage"), "power": c.get("effectivePower"),
                "counters": c.get("counters") or {}, "attachments": list(c.get("attachments") or []),
                "keywords": list(c.get("effectiveKeywords") or [])}
    return snap


_EDDIE = re.compile(r"^seat:\d+:EDDIES:\d+$")


def diff(before: Mapping, after: Mapping) -> list[str]:
    """Readable changes between two snapshots, in a fixed order."""
    lines = []
    for key, old in before["match"].items():
        new = after["match"].get(key)
        if old != new:
            lines.append(f"{key}: {old} -> {new}")
    for seat in sorted(set(before["seats"]) | set(after["seats"])):
        b, a = before["seats"].get(seat, {}), after["seats"].get(seat, {})
        if b.get("street_cred") != a.get("street_cred"):
            lines.append(f"seat {seat} street cred: {b.get('street_cred')} -> {a.get('street_cred')}")
        for zone in sorted(set(b.get("counts", {})) | set(a.get("counts", {}))):
            old, new = b.get("counts", {}).get(zone, 0), a.get("counts", {}).get(zone, 0)
            if old != new:
                lines.append(f"seat {seat} {zone} count: {old} -> {new}")
        for gid in sorted(set(b.get("gigs", {})) | set(a.get("gigs", {}))):
            old, new = b.get("gigs", {}).get(gid), a.get("gigs", {}).get(gid)
            if old != new:
                lines.append(f"seat {seat} gig {gid}: {_gig_state(old)} -> {_gig_state(new)}")
    bc, ac = before["cards"], after["cards"]
    for pid in sorted(set(bc) | set(ac), key=_pid_key):
        if _EDDIE.match(pid):
            continue  # Eddie slots: the EDDIES count and readiness lines below say it
        old, new = bc.get(pid), ac.get(pid)
        if old is None:
            lines.append(f"{new['name']} [{pid}] seat {new['seat']}: (not visible) -> {new['zone']}")
            continue
        if new is None:
            lines.append(f"{old['name']} [{pid}] seat {old['seat']}: {old['zone']} -> (not visible)")
            continue
        changes = [f"{f} {old[f]} -> {new[f]}" for f in ("zone", "readiness", "face", "damage", "power",
                                                          "counters", "attachments", "keywords")
                   if old[f] != new[f]]
        if changes:
            lines.append(f"{new['name']} [{pid}] seat {new['seat']}: " + "; ".join(changes))
    for seat in sorted(set(before["seats"]) | set(after["seats"])):
        old, new = _eddies(bc, seat), _eddies(ac, seat)
        if old != new:
            lines.append(f"seat {seat} eddies ready/spent: {old[0]}/{old[1]} -> {new[0]}/{new[1]}")
    return lines


def _gig_state(value) -> str:
    return "none" if value is None else f"{value[1]} in {value[0]}"


def _eddies(cards: Mapping, seat: int) -> tuple[int, int]:
    mine = [c for pid, c in cards.items() if _EDDIE.match(pid) and c["seat"] == seat]
    return (sum(c["readiness"] == "READY" for c in mine), sum(c["readiness"] == "SPENT" for c in mine))


def _pid_key(pid: str) -> tuple:
    return tuple(int(p) if p.isdigit() else p for p in re.split(r"(\d+)", pid))


def board(views: Sequence[Mapping], legends: Mapping[tuple[int, int], str]) -> dict:
    """Both seats' boards, compact, from each seat's own view."""
    first = views[0]
    out: dict[str, Any] = {k: first.get(k) for k in ("turn", "activeSeat", "actingSeat", "window", "step",
                                                     "resolutionStage", "outcome") if first.get(k) is not None}
    if first.get("choice"):
        out["choice"] = {k: first["choice"].get(k) for k in ("kind", "actorSeat", "min", "max")}
    seats = []
    for view in views:
        me = _own(view)
        by_zone: dict[str, list[str]] = {}
        for c in sorted(me["cards"], key=lambda c: _pid_key(c["publicId"])):
            if c.get("zone") == "EDDIES":
                continue
            text = _card_name(c, legends)
            if c.get("zone") in ("BATTLEFIELD", "LEGENDS"):
                extras = [c.get("readiness", "").lower()]
                if text.endswith(" (face down)"):
                    text, extras = text[: -len(" (face down)")], ["face down", *extras]
                if c.get("effectivePower") is not None:
                    extras.append(f"power {c['effectivePower']}")
                if c.get("damage"):
                    extras.append(f"damage {c['damage']}")
                if c.get("effectiveKeywords"):
                    extras.append("/".join(k.lower() for k in c["effectiveKeywords"]))
                if c.get("attachments"):
                    extras.append("gear " + ", ".join(c["attachments"]))
                text += " (" + ", ".join(e for e in extras if e) + ")"
            by_zone.setdefault(c.get("zone", "?"), []).append(f"{text} [{c['publicId']}]")
        gigs = me.get("gigs") or []
        eddies = [c for c in me["cards"] if c.get("zone") == "EDDIES"]
        seats.append({"seat": me["seat"], "street_cred": me.get("streetCred"),
                      "counts": {k: v for k, v in (me.get("counts") or {}).items() if v},
                      "gigs": [_gig_text(g) for g in gigs if g.get("zone") == "GIGS"],
                      "fixer": [g["dieType"] for g in gigs if g.get("zone") == "FIXER"],
                      "eddies": {"ready": sum(c.get("readiness") == "READY" for c in eddies),
                                 "spent": sum(c.get("readiness") == "SPENT" for c in eddies)},
                      **{zone.lower(): cards for zone, cards in by_zone.items()}})
    out["seats"] = seats
    return out


# Running -------------------------------------------------------------------------------------

def _offer_key(offer: Mapping) -> tuple:
    return (STEP_KINDS.index(offer["kind"]), offer.get("card", ""), _pid_key(offer.get("public_id", "")),
            offer.get("option", ""), offer["label"])


def _offers(actions: Sequence[Mapping], slugs, legends) -> dict:
    """The engine's offers, in a fixed reading order (the engine's own order carries no meaning here)."""
    listed = sorted((describe(a, slugs, legends) for a in actions), key=_offer_key)
    return {"count": len(actions), "actions": listed[:MAX_OFFERS]}


def _auto_option(actions: Sequence[Mapping], pay: list[str], slugs, legends) -> tuple[Mapping | None, str]:
    """The choice the tool may take without a step, and why; (None, "") when the caller must choose."""
    choose = [a for a in actions if a["descriptor"]["kind"] == "CHOOSE"]
    if not choose or len(choose) != len(actions):
        return None, ""
    if len(choose) == 1:
        return choose[0], "only option"
    if all(a["descriptor"]["choiceKind"] == "PAYMENT" for a in choose):
        if pay:
            return match_step({"kind": "CHOOSE", "choice": pay.pop(0)}, choose, slugs, legends), "pay as listed"
        eddies = [a for a in choose if (a["descriptor"]["option"].get("kind") == "ZONE_SLOT"
                                        and a["descriptor"]["option"].get("zone") == "EDDIES")]
        if eddies:
            return min(eddies, key=lambda a: a["descriptor"]["option"]["slot"]), "pay with the lowest Eddie slot"
    return None, ""


class _Run:
    def __init__(self, worker: EngineWorker, content: Mapping, setup: Mapping, state: Mapping):
        self.worker, self.content, self.legends = worker, content, legend_names(setup)
        self.state = state
        self.refresh()

    def refresh(self) -> None:
        self.views = observe_both(self.worker, self.content, self.state)
        self.slugs = slug_map(self.views)
        actor = self.state["timing"]["actingPlayer"]
        self.actor_seat = _seat_ids(self.state).index(actor)
        if self.state["match"].get("outcome"):
            self.actions: list[Mapping] = []
        else:
            mi = self.worker.model_input(content=self.content, state=self.state, actor_id=actor)
            self.actions = list(mi["legalActions"])

    def apply(self, action: Mapping) -> None:
        actor = self.state["timing"]["actingPlayer"]
        self.state = self.worker.apply_action(content=self.content, state=self.state, actor_id=actor,
                                              action_id=action["actionId"])["state"]
        self.refresh()

    def describe(self, action: Mapping) -> dict:
        return describe(action, self.slugs, self.legends)

    def pending(self) -> dict | None:
        choice = self.views[0].get("choice")
        if not choice:
            return None
        return {"kind": choice.get("kind"), "seat": choice.get("actorSeat"),
                "options": [self.describe(a)["option"] for a in self.actions if a["descriptor"]["kind"] == "CHOOSE"]}

    def settle(self, pay: list[str], auto: list[dict]) -> None:
        while len(auto) < MAX_AUTO:
            action, why = _auto_option(self.actions, pay, self.slugs, self.legends)
            if action is None:
                return
            auto.append({**self.describe(action), "seat": self.actor_seat, "why": why})
            self.apply(action)


def run_scenario(worker: EngineWorker, content: Mapping, setup: Mapping, steps: Any,
                 *, seed: str = DEFAULT_SEED, engine: Mapping | None = None) -> dict:
    """Compose ``setup`` on the engine, play ``steps``, and return the report.

    Raises ScenarioError for a bad step list (before anything runs) or a setup the engine rejects
    (``invalid_setup`` with the engine's errors). A step the engine does not offer does not raise: the report
    stops there with the offers, so the caller sees how far the scenario got.
    """
    steps = parse_steps(steps)
    if not isinstance(setup, Mapping):
        raise ScenarioError("invalid_setup", "setup must be an object")
    scenario = {"seed": seed, **setup}
    try:
        state = worker.compose_scenario(content=content, scenario=scenario)
    except EngineProtocolError as exc:
        if not exc.errors:
            raise
        raise ScenarioError("invalid_setup", f"the engine rejected the setup: {exc}", engine_errors=exc.errors) from exc
    run = _Run(worker, content, setup, state)
    report: dict[str, Any] = {"scenario_version": SCENARIO_VERSION, "seed": seed}
    if engine is not None:
        report["engine"] = dict(engine)
    report["start"] = {"board": board(run.views, run.legends), "offers": _offers(run.actions, run.slugs, run.legends)}
    results, stopped = [], None
    for i, step in enumerate(steps):
        before = snapshot(run.views, run.legends)
        entry: dict[str, Any] = {"step": step, "seat": run.actor_seat}
        try:
            if "seat" in step and step["seat"] != run.actor_seat:
                raise ScenarioError("wrong_seat", f"seat {step['seat']} was named, but seat {run.actor_seat} is "
                                    "the one to act", offers=_offers(run.actions, run.slugs, run.legends)["actions"])
            if not run.actions:
                raise ScenarioError("game_over", "the game is over; nothing is offered", offers=[])
            action = match_step(step, run.actions, run.slugs, run.legends)
            entry["applied"] = run.describe(action)
            run.apply(action)
            auto: list[dict] = []
            pay = list(step.get("pay") or [])
            run.settle(pay, auto)
            if "target" in step and step["kind"] != "CHOOSE":
                targets = [a for a in run.actions if a["descriptor"]["kind"] == "CHOOSE"
                           and a["descriptor"]["choiceKind"] == "TARGET"]
                if targets:
                    chosen = match_step({"kind": "CHOOSE", "choice": step["target"]}, targets, run.slugs, run.legends)
                    entry["target"] = run.describe(chosen)
                    run.apply(chosen)
                    run.settle(pay, auto)
                else:
                    entry["target"] = {"note": "the engine asked for no target choice; see the diff for what it locked in"}
            if auto:
                entry["auto"] = auto
        except ScenarioError as exc:
            stopped = {"at": i, "reason": exc.kind, "message": str(exc), **exc.extra}
            entry["error"] = exc.kind
        entry["diff"] = diff(before, snapshot(run.views, run.legends))
        entry["pending"] = run.pending()
        entry["next_seat"] = run.actor_seat
        entry["offers"] = _offers(run.actions, run.slugs, run.legends)
        results.append(entry)
        if stopped:
            break
    report["steps"] = results
    report["stopped"] = stopped
    report["final"] = {"board": board(run.views, run.legends)}
    return report
