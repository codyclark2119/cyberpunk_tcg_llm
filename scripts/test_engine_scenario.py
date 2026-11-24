"""Tests for the engine scenario tool (games/cyberpunk/assistant/engine_scenario.py).

Why: the tool's value is that every verdict is the engine's. These tests pin the parts Python owns: the
step list's shape, matching a step to exactly one offered action (and refusing with the offers otherwise),
the forced-choice and payment rules, the diff, and that the report never shows a card neither seat can see.

The real worker runs every scenario: the engine's ``composeScenario`` op builds the setup on the reviewed
content bundle, and the tool steps it with modelInput and applyAction.

Usage:
    python scripts/test_engine_scenario.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from games.cyberpunk.assistant import engine_scenario as es
from games.cyberpunk.config import REPO_ROOT
from games.cyberpunk.engine_adapter import EngineProtocolError, EngineWorker


def raises(fn, kind: str) -> es.ScenarioError:
    try:
        fn()
    except es.ScenarioError as exc:
        assert exc.kind == kind, (exc.kind, str(exc))
        return exc
    raise AssertionError(f"expected ScenarioError({kind})")


def action(kind: str, label: str, **descriptor) -> dict:
    return {"actionId": f"id-{label}", "descriptor": {"schemaVersion": 2, "kind": kind, "label": label, **descriptor}}


def card(pid: str) -> dict:
    return {"kind": "CARD", "publicId": pid}


SLUGS = {"p0-c1": "alpha-unit", "p0-c2": "alpha-unit", "p0-c3": "beta-program", "p1-c9": "gamma-unit"}
LEGENDS = {(0, 1): "delta-legend"}
ACTIONS = [
    action("PLAY_CARD", "Play Alpha", source=card("p0-c1")),
    action("PLAY_CARD", "Play Alpha", source=card("p0-c2")),
    action("PLAY_CARD", "Play Beta", source=card("p0-c3")),
    action("SELL_CARD", "Sell Beta", source=card("p0-c3")),
    action("CALL_LEGEND", "Call legend 2", source={"kind": "ZONE_SLOT", "seat": 0, "zone": "LEGENDS", "slot": 1}),
    action("END_TURN", "End turn"),
]


def test_step_shapes_are_checked_before_anything_runs():
    raises(lambda: es.parse_steps({"kind": "END_TURN"}), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "END_TURN"}] * (es.MAX_STEPS + 1)), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "FLY"}]), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "END_TURN", "speed": 3}]), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "PLAY_CARD"}]), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "CHOOSE"}]), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "PLAY_CARD", "card": " "}]), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "END_TURN", "seat": 2}]), "invalid_steps")
    raises(lambda: es.parse_steps([{"kind": "PLAY_CARD", "card": "x", "pay": "eddie"}]), "invalid_steps")
    assert es.parse_steps([{"kind": "PLAY_CARD", "card": "x", "target": "gig", "pay": ["EDDIES 0"]}])


def test_a_step_matches_exactly_one_offer_or_returns_the_offers():
    m = lambda step: es.match_step(step, ACTIONS, SLUGS, LEGENDS)
    assert m({"kind": "PLAY_CARD", "card": "beta-program"})["actionId"] == "id-Play Beta"
    assert m({"kind": "SELL_CARD", "card": "Beta-Program "})["actionId"] == "id-Sell Beta"
    assert m({"kind": "PLAY_CARD", "card": "p0-c2"})["descriptor"]["source"]["publicId"] == "p0-c2"
    assert m({"kind": "CALL_LEGEND", "card": "delta-legend"})["actionId"] == "id-Call legend 2"
    assert m({"kind": "END_TURN"})["actionId"] == "id-End turn"
    # Two copies of the same card: refused, both named, never one picked.
    exc = raises(lambda: m({"kind": "PLAY_CARD", "card": "alpha-unit"}), "ambiguous")
    assert len(exc.extra["matches"]) == 2 and len(exc.extra["offers"]) == len(ACTIONS)
    exc = raises(lambda: m({"kind": "DECLARE_ATTACK", "card": "alpha-unit"}), "no_match")
    assert {"kind": "END_TURN", "label": "End turn"} in exc.extra["offers"]
    raises(lambda: m({"kind": "PLAY_CARD", "card": "gamma-unit"}), "no_match")
    # The engine's label narrows but never widens.
    raises(lambda: m({"kind": "SELL_CARD", "label": "Play Beta"}), "no_match")
    assert m({"kind": "PLAY_CARD", "label": "play beta"})["actionId"] == "id-Play Beta"


def test_choices_match_by_card_option_or_label():
    choices = [action("CHOOSE", "Target Gamma", choiceKind="TARGET", option=card("p1-c9")),
               action("CHOOSE", "Target the gig area", choiceKind="TARGET", option={"kind": "GIG_AREA", "seat": 1}),
               action("CHOOSE", "Yes", choiceKind="OPTIONAL", option={"kind": "CONFIRM", "value": True}),
               action("CHOOSE", "Mode A", choiceKind="MODE", option={"kind": "MODE", "value": "A"})]
    m = lambda choice: es.match_step({"kind": "CHOOSE", "choice": choice}, choices, SLUGS, LEGENDS)
    assert m("gamma-unit")["actionId"] == "id-Target Gamma"
    assert m("p1-c9")["actionId"] == "id-Target Gamma"
    assert m("gig")["actionId"] == "id-Target the gig area"
    assert m("rival gig")["actionId"] == "id-Target the gig area"
    assert m("yes")["actionId"] == "id-Yes"
    assert m("a")["actionId"] == "id-Mode A"
    assert m("Target Gamma")["actionId"] == "id-Target Gamma"
    raises(lambda: m("no"), "no_match")


def test_only_forced_choices_and_payments_are_taken_without_a_step():
    pay = [action("CHOOSE", f"Pay with eddie {i}", choiceKind="PAYMENT",
                  option={"kind": "ZONE_SLOT", "seat": 0, "zone": "EDDIES", "slot": i}) for i in (2, 0, 1)]
    legend = action("CHOOSE", "Pay with legend 1", choiceKind="PAYMENT", option=card("p0-c3"))
    picked, why = es._auto_option(pay + [legend], [], SLUGS, LEGENDS)
    assert picked["descriptor"]["option"]["slot"] == 0 and "Eddie" in why
    picked, _ = es._auto_option(pay + [legend], ["beta-program"], SLUGS, LEGENDS)
    assert picked is legend
    picked, why = es._auto_option([legend], [], SLUGS, LEGENDS)
    assert picked is legend and why == "only option"
    # A real decision is never taken: two targets, an optional yes/no, or a choice mixed with other offers.
    two = [action("CHOOSE", "A", choiceKind="TARGET", option=card("p0-c1")),
           action("CHOOSE", "B", choiceKind="TARGET", option=card("p0-c2"))]
    assert es._auto_option(two, [], SLUGS, LEGENDS) == (None, "")
    assert es._auto_option([legend, ACTIONS[-1]], [], SLUGS, LEGENDS) == (None, "")
    assert es._auto_option([legend], [], SLUGS, LEGENDS)[0] is legend
    assert es._auto_option([action("CHOOSE", "Pay with legend 2", choiceKind="PAYMENT", option=card("p0-c1")),
                            legend], [], SLUGS, LEGENDS) == (None, "")


def _view(seat: int, cards: list, **extra) -> dict:
    me = {"seat": seat, "streetCred": extra.pop("cred", 0), "counts": extra.pop("counts", {}), "cards": cards,
          "gigs": extra.pop("gigs", [])}
    return {"viewerSeat": seat, "turn": 3, "activeSeat": 0, "actingSeat": 0, "window": "MAIN",
            "players": [me, {"seat": 1 - seat, "cards": [], "counts": {}, "gigs": []}], **extra}


def test_diff_names_moves_readiness_gigs_and_hidden_cards():
    hand = {"publicId": "p0-c3", "zone": "HAND", "readiness": "READY", "face": "DOWN", "content": {"cardId": "beta-program"}}
    down = {"publicId": "seat:0:LEGENDS:1", "zone": "LEGENDS", "readiness": "READY", "face": "DOWN"}
    eddie = {"publicId": "seat:0:EDDIES:0", "zone": "EDDIES", "readiness": "READY"}
    gig = {"id": "p0-D6", "dieType": "D6", "zone": "GIGS", "roll": {"kind": "ROLLED", "currentValue": 3}}
    before = es.snapshot([_view(0, [hand, down, eddie], counts={"HAND": 1}, gigs=[gig]), _view(1, [])], LEGENDS)
    played = {**hand, "zone": "TRASH", "face": "UP"}
    flipped = {"publicId": "p0-c7", "zone": "LEGENDS", "readiness": "SPENT", "face": "UP",
               "content": {"cardId": "delta-legend"}}
    gig2 = {**gig, "roll": {"kind": "ROLLED", "currentValue": 5}}
    after = es.snapshot([_view(0, [played, flipped, {**eddie, "readiness": "SPENT"}], counts={"HAND": 0},
                               gigs=[gig2], cred=2), _view(1, [])], LEGENDS)
    lines = es.diff(before, after)
    assert "seat 0 street cred: 0 -> 2" in lines, lines
    assert "seat 0 HAND count: 1 -> 0" in lines, lines
    assert "seat 0 gig p0-D6: D6=3 in GIGS -> D6=5 in GIGS" in lines, lines
    assert "beta-program [p0-c3] seat 0: zone HAND -> TRASH; face DOWN -> UP" in lines, lines
    # A Call turns the face-down Legend face up: one line, though its id changes from a slot to a card.
    assert "delta-legend [p0-c7] seat 0: face-down Legend -> face up in LEGENDS (spent)" in lines, lines
    assert not any("(not visible)" in line for line in lines), lines
    assert "seat 0 eddies ready/spent: 1/0 -> 0/1" in lines, lines
    assert es.diff(before, before) == []


class RecordingWorker(EngineWorker):
    """The real worker, keeping every state it composed or reached (to check what the report may show)."""

    def __init__(self):
        super().__init__(REPO_ROOT)
        self.states, self.scenarios = [], []

    def compose_scenario(self, *, content, scenario):
        self.scenarios.append(scenario)
        state = super().compose_scenario(content=content, scenario=scenario)
        self.states.append(state)
        return state

    def apply_action(self, **kwargs):
        transition = super().apply_action(**kwargs)
        self.states.append(transition["state"])
        return transition


LEGENDS_BY_SEAT = (
    ["jackie-welles-pour-one-out-for-me", "saburo-arasaka-stubborn-patriarch", "yorinobu-arasaka-embracing-destruction"],
    ["goro-takemura-hands-unclean", "v-corporate-exile", "viktor-vektor-sit-down-and-relax"],
)


def setup(**edits) -> dict:
    """Seat 0: a ready Unit, a Unit in hand, two ready Eddies. Seat 1: a spent Unit. All Legends face down."""
    players = [{"field": [], "legends": [{"card": slug, "face": "DOWN", "readiness": "READY"} for slug in legends],
                "hand": [], "trash": [], "deck": [], "gigs": [{"die": "D6", "value": 3}],
                "eddies": {"ready": 2, "spent": 0}} for legends in LEGENDS_BY_SEAT]
    players[0]["field"] = [{"card": "field-operator", "readiness": "READY"}]
    players[0]["hand"] = ["corpo-security"]
    players[1]["field"] = [{"card": "corpo-security", "readiness": "SPENT"}]
    value = {"activeSeat": 0, "players": players}
    value.update(edits)
    return value


def _visible_slugs(worker, content, state) -> set:
    return set(es.slug_map(es.observe_both(worker, content, state)).values())


def _assert_nothing_hidden_shown(worker, content, report, described) -> None:
    """Every card id in the report is one a seat's own view showed at some point, or one the caller described."""
    text = json.dumps(report)
    seen = set().union(*(_visible_slugs(worker, content, st) for st in worker.states)) | described
    leaked = sorted(c["id"] for c in content["cards"] if c["id"] not in seen
                    and (f'"{c["id"]}' in text or f"{c['id']} [" in text or f"{c['id']} (" in text))
    assert not leaked, leaked


def _described(value: dict) -> set:
    out = set()
    for p in value["players"]:
        out |= {f["card"] for f in p["field"]} | {lg["card"] for lg in p["legends"]}
        out |= set(p["hand"]) | set(p["trash"]) | set(p["deck"])
        out |= {g for f in p["field"] + p["legends"] for g in f.get("gear", [])}
    return out


def test_a_composed_scenario_plays_steps_and_shows_only_what_the_seats_see():
    content, engine = es.reviewed_content(REPO_ROOT)
    with RecordingWorker() as worker:
        value = setup()
        value["players"][0]["eddies"] = {"ready": 6, "spent": 0}
        steps = [{"kind": "PLAY_CARD", "card": "corpo-security", "seat": 0},
                 {"kind": "CALL_LEGEND", "card": "jackie-welles-pour-one-out-for-me"},
                 {"kind": "DECLARE_ATTACK", "card": "field-operator", "target": "corpo-security"}]
        report = es.run_scenario(worker, content, value, steps, engine=engine)
        assert worker.scenarios[0] == {"seed": es.DEFAULT_SEED, **value}
        assert report["engine"] == engine and report["scenario_version"] == es.SCENARIO_VERSION
        start = report["start"]["board"]
        assert start["turn"] == 3 and start["activeSeat"] == 0 and start["window"] == "MAIN", start
        # Face-down Legends are hidden from their owner too; the board names them from the setup.
        assert "jackie-welles-pour-one-out-for-me (face down, ready) [seat:0:LEGENDS:0]" in \
            " ".join(start["seats"][0]["legends"]), start["seats"][0]["legends"]
        play, call, attack = report["steps"][:3]
        assert report["stopped"] is None or report["stopped"]["at"] >= 3, report["stopped"]
        assert play["applied"]["card"] == "corpo-security", play
        assert any(line.startswith("corpo-security [") and "zone HAND -> BATTLEFIELD" in line
                   for st in report["steps"] for line in st["diff"]), [st["diff"] for st in report["steps"]]
        assert call["applied"]["kind"] == "CALL_LEGEND", call
        assert call["applied"]["card"] == "jackie-welles-pour-one-out-for-me", call
        assert any("jackie-welles-pour-one-out-for-me [" in line and "face-down Legend -> face up in LEGENDS" in line
                   for line in call["diff"]), call["diff"]
        assert attack["applied"]["kind"] == "DECLARE_ATTACK", attack
        # The spent rival Unit was targeted (by choice, or locked in when it was the only target).
        assert attack.get("target", {}).get("option", "").startswith("corpo-security") or \
            "note" in attack.get("target", {}), attack
        assert attack["next_seat"] in (0, 1)
        _assert_nothing_hidden_shown(worker, content, report, _described(value))


def test_the_deck_top_is_drawn_in_order_and_filler_stays_hidden():
    content, _ = es.reviewed_content(REPO_ROOT)
    with RecordingWorker() as worker:
        value = setup()
        value["players"][1]["deck"] = ["corpo-security"]
        report = es.run_scenario(worker, content, value, [{"kind": "END_TURN"}])
        assert report["stopped"] is None, report["stopped"]
        diff = report["steps"][0]["diff"]
        assert "activeSeat: 0 -> 1" in diff, diff
        # Seat 1 draws the described top card at the start of its turn.
        assert any(line.startswith("corpo-security [") and "(not visible) -> HAND" in line for line in diff), diff
        _assert_nothing_hidden_shown(worker, content, report, _described(value))


def test_steps_the_engine_does_not_offer_stop_the_run_with_the_offers():
    content, _ = es.reviewed_content(REPO_ROOT)
    with RecordingWorker() as worker:
        # The spent Unit may not attack: refused, with the engine's offers, after the earlier step stands.
        value = setup()
        value["players"][0]["field"].append({"card": "corpo-security", "readiness": "SPENT"})
        value["players"][0]["hand"] = []
        report = es.run_scenario(worker, content, value, [
            {"kind": "DECLARE_ATTACK", "card": "corpo-security"}, {"kind": "END_TURN"}])
        assert report["stopped"]["at"] == 0 and report["stopped"]["reason"] == "no_match", report["stopped"]
        offered = report["stopped"]["offers"]
        assert {"kind": "END_TURN", "label": "END_TURN"} in offered or any(o["kind"] == "END_TURN" for o in offered)
        assert any(o["kind"] == "DECLARE_ATTACK" and o["card"] == "field-operator" for o in offered), offered
        assert len(report["steps"]) == 1 and report["steps"][0]["diff"] == []
        # Two copies in hand: refused as ambiguous, both named; a publicId picks one.
        value = setup()
        value["players"][0]["hand"] = ["corpo-security", "corpo-security"]
        value["players"][0]["eddies"] = {"ready": 4, "spent": 0}
        report = es.run_scenario(worker, content, value, [{"kind": "PLAY_CARD", "card": "corpo-security"}])
        assert report["stopped"]["reason"] == "ambiguous" and len(report["stopped"]["matches"]) == 2
        pid = report["stopped"]["matches"][1]["public_id"]
        report = es.run_scenario(worker, content, value, [{"kind": "PLAY_CARD", "card": pid}])
        assert report["stopped"] is None and report["steps"][0]["applied"]["public_id"] == pid, report["stopped"]
        # Naming the wrong seat is refused before anything is applied.
        report = es.run_scenario(worker, content, setup(), [{"kind": "END_TURN", "seat": 1}])
        assert report["stopped"]["reason"] == "wrong_seat" and report["steps"][0]["diff"] == []


def test_a_setup_the_engine_rejects_comes_back_with_its_errors():
    content, _ = es.reviewed_content(REPO_ROOT)
    with RecordingWorker() as worker:
        value = setup()
        value["players"][1]["hand"] = ["no-such-card"]
        exc = raises(lambda: es.run_scenario(worker, content, value, []), "invalid_setup")
        assert exc.extra["engine_errors"] == [{"code": "UNKNOWN_CARD", "message": "no-such-card is not in the "
                                               "content bundle", "path": "players[1].hand[0]"}], exc.extra
        value = setup()
        value["players"][0]["legends"] = value["players"][0]["legends"][:2]
        exc = raises(lambda: es.run_scenario(worker, content, value, []), "invalid_setup")
        assert [e["code"] for e in exc.extra["engine_errors"]] in (["INVALID_DECK"], ["INVALID_SCENARIO"]), exc.extra
        # A bad step list is refused before the engine is asked anything.
        raises(lambda: es.run_scenario(worker, content, setup(), [{"kind": "FLY"}]), "invalid_steps")
        assert len(worker.scenarios) == 2


def test_go_solo_closes_up_the_legends_area_and_the_hidden_names_follow():
    content, _ = es.reviewed_content(REPO_ROOT)
    value = setup()
    value["players"][0]["legends"] = [{"card": "sasha-yakovleva-won-t-let-you-down", "face": "UP", "readiness": "READY"},
                                      {"card": "jackie-welles-pour-one-out-for-me", "face": "DOWN", "readiness": "READY"},
                                      {"card": "wakako-okada-peace-and-harmony", "face": "DOWN", "readiness": "READY"}]
    value["players"][0]["eddies"] = {"ready": 7, "spent": 0}
    value["players"][0]["hand"], value["players"][0]["field"] = [], []
    with RecordingWorker() as worker:
        report = es.run_scenario(worker, content, value, [
            {"kind": "GO_SOLO", "card": "sasha-yakovleva-won-t-let-you-down"},
            {"kind": "CALL_LEGEND", "card": "wakako-okada-peace-and-harmony"}])
    assert report["stopped"] is None, report["stopped"]
    solo, call = report["steps"]
    # Sasha left slot 0, so Jackie and Wakako moved to slots 0 and 1: the offers still name them right.
    calls = sorted(o["card"] for o in solo["offers"]["actions"] if o["kind"] == "CALL_LEGEND")
    assert calls == ["jackie-welles-pour-one-out-for-me", "wakako-okada-peace-and-harmony"], calls
    assert not any("(face down)" in line for line in solo["diff"]), solo["diff"]
    assert any(line.startswith("wakako-okada-peace-and-harmony [") and "face-down Legend -> face up" in line
               for line in call["diff"]), call["diff"]
    assert call["applied"]["card"] == "wakako-okada-peace-and-harmony", call["applied"]


class FailingWorker(RecordingWorker):
    """Fails like the worker does when the engine throws: no structured error, a transport message with an id."""

    def __init__(self):
        super().__init__()
        self.fail = False

    def apply_action(self, **kwargs):
        transition = super().apply_action(**kwargs)
        self.fail = True
        return transition

    def model_input(self, **kwargs):
        if self.fail:
            raise EngineProtocolError("request/response mismatch: expected 'py-9', got ''")
        return super().model_input(**kwargs)


def test_an_engine_failure_stops_the_run_as_an_engine_fault():
    content, _ = es.reviewed_content(REPO_ROOT)
    with FailingWorker() as worker:
        report = es.run_scenario(worker, content, setup(), [{"kind": "END_TURN"}, {"kind": "END_TURN"}])
    assert report["stopped"]["reason"] == "engine_error" and report["stopped"]["at"] == 0, report["stopped"]
    # The message is stable (no request id) and says it is not an answer; the board stays the last one observed.
    assert "py-9" not in report["stopped"]["message"] and "not an answer" in report["stopped"]["message"]
    assert report["final"]["board"]["activeSeat"] == 0


def test_a_reveal_to_the_rival_shows_in_the_diff():
    hand = {"publicId": "p0-c3", "zone": "HAND", "readiness": "READY", "face": "DOWN", "content": {"cardId": "beta-program"}}
    unseen = [_view(0, [hand]), _view(1, [])]
    rival_view = _view(1, [])
    rival_view["players"][1]["cards"] = [hand]
    seen = [_view(0, [hand]), rival_view]
    lines = es.diff(es.snapshot(unseen, {}), es.snapshot(seen, {}))
    assert lines == ["seat 1 now sees its rival's beta-program [p0-c3] in HAND"], lines


def test_trigger_order_choices_match_by_the_card_their_label_names():
    order = [action("CHOOSE", "Resolve Beta Program (p0-c3) for Alpha Unit", choiceKind="ORDER",
                    option={"kind": "EFFECT", "effectId": "f" * 64}),
             action("CHOOSE", "Resolve Alpha Unit (p0-c1) for Alpha Unit", choiceKind="ORDER",
                    option={"kind": "EFFECT", "effectId": "e" * 64})]
    m = es.match_step({"kind": "CHOOSE", "choice": "beta-program"}, order, SLUGS, LEGENDS)
    assert m["descriptor"]["label"].startswith("Resolve Beta Program"), m
    # The report names an effect option by its label, never by the opaque id.
    assert es.describe(order[0], SLUGS, LEGENDS)["option"] == "Resolve Beta Program (p0-c3) for Alpha Unit"


# The assistant's entry point (PR 4): short setups, the model's view of the report, the tool ----------


class ComposeFailingWorker(RecordingWorker):
    """Fails composeScenario like a worker exception does: no structured error."""

    def compose_scenario(self, *, content, scenario):
        raise EngineProtocolError("request/response mismatch: expected 'py-3', got ''")


def test_a_short_setup_gets_defaults_and_filler_legends_the_engine_accepts():
    content, _ = es.reviewed_content(REPO_ROOT)
    colours = {c["id"]: c.get("colors") or [] for c in content["cards"]}
    short = {"players": [{"field": [{"card": "field-operator", "readiness": "READY"}], "hand": ["animals-wrecker"]},
                         {"legends": setup()["players"][1]["legends"]}]}
    with RecordingWorker() as worker:
        full, filled = es.complete_setup(worker, content, short)
        assert len(worker.scenarios) >= 1 and worker.scenarios[-1] == {"seed": es.DEFAULT_SEED, **full}
    assert full["activeSeat"] == 0 and list(filled) == [0], "only the seat without Legends is filled"
    seat0, seat1 = full["players"]
    assert seat1["legends"] == short["players"][1]["legends"] and seat1["hand"] == [] and seat1["eddies"] == {"ready": 0, "spent": 0}
    assert seat0["field"] == short["players"][0]["field"] and seat0["trash"] == [] and seat0["gigs"] == []
    assert [l["card"] for l in seat0["legends"]] == filled[0] and len(set(filled[0])) == 3
    assert all(l["face"] == "DOWN" and l["readiness"] == "READY" for l in seat0["legends"])
    # The engine took a GREEN + RED deck, so the filler covers both colours.
    legend_colours = {c for slug in filled[0] for c in colours[slug]}
    assert {"GREEN", "RED"} <= legend_colours, filled
    assert short["players"][0].get("legends") is None, "the caller's setup is not changed"
    # The candidate order is a pure function of the cards: the same setup gets the same Legends.
    assert es.legend_candidates(short["players"][0], colours) == es.legend_candidates(dict(short["players"][0]), colours)


def test_a_setup_no_filler_can_make_legal_is_refused_with_the_ram_rule():
    content, _ = es.reviewed_content(REPO_ROOT)
    # Three colours that each need more than one Legend's RAM cannot fit three Legends (2 RAM each).
    greedy = {"players": [{"hand": ["animals-wrecker", "adrenaline-converter", "psycho-squad", "field-operator"]}, {}]}
    with RecordingWorker() as worker:
        exc = raises(lambda: es.complete_setup(worker, content, greedy), "invalid_setup")
        assert len(worker.scenarios) <= es.MAX_LEGEND_TRIES
    assert "2 RAM" in str(exc) and "fewer colours" in str(exc), str(exc)
    for bad in (None, {"players": [{}]}, {"players": [{}, "seat"]}):
        with RecordingWorker() as worker:
            raises(lambda: es.complete_setup(worker, content, bad), "invalid_setup")
            assert worker.scenarios == [], "a malformed setup never reaches the engine"
    with ComposeFailingWorker() as worker:
        exc = raises(lambda: es.complete_setup(worker, content, {"players": [{}, {}]}), "engine_error")
    assert "py-3" not in str(exc) and "not an answer" in str(exc)


def test_the_model_sees_labels_short_offers_and_what_was_added():
    content, engine = es.reviewed_content(REPO_ROOT)
    short = {"players": [{"field": [{"card": "field-operator", "readiness": "READY"}]},
                         {"field": [{"card": "corpo-security", "readiness": "SPENT"}]}]}
    with RecordingWorker() as worker:
        full, filled = es.complete_setup(worker, content, short)
        report = es.run_scenario(worker, content, full, [{"kind": "DECLARE_ATTACK", "card": "field-operator",
                                                          "target": "corpo-security"}], engine=engine)
        stopped = es.run_scenario(worker, content, full, [{"kind": "PLAY_CARD", "card": "field-operator"}],
                                  engine=engine)
    out = es.for_model(report, filled)
    assert set(out) == {"engine", "start", "legends_added", "legends_note", "steps", "final"}
    assert out["engine"] == engine and out["legends_added"] == {f"seat {s}": filled[s] for s in (0, 1)}
    assert "do nothing unless Called" in out["legends_note"]
    (step,) = out["steps"]
    assert step["applied"] == report["steps"][0]["applied"]["label"] and step["changes"] == report["steps"][0]["diff"]
    assert step["next_seat"] == 1 and step["offers"]["count"] == report["steps"][0]["offers"]["count"]
    assert all(isinstance(o, str) for o in step["offers"]["actions"]) and "PASS_REACT" in step["offers"]["actions"]
    assert len(step["offers"]["actions"]) <= es.MODEL_OFFERS and out["final"] == report["final"]["board"]
    assert any("attacks corpo-security" in line for line in step["changes"]), step["changes"]
    # A stop keeps its reason and offers (as strings) but never the raw engine errors; no filler, no note. The
    # stopped step is listed with nothing applied and no changes.
    out = es.for_model(stopped, {})
    assert "legends_added" not in out and "legends_note" not in out
    assert [("applied" in st, st["changes"]) for st in out["steps"]] == [(False, [])], out["steps"]
    assert out["stopped"]["reason"] == "no_match" and "engine_errors" not in out["stopped"]
    assert all(isinstance(o, str) for o in out["stopped"]["offers"]), out["stopped"]
    assert len(json.dumps(out)) < 12000, "a report the 8B can read in one tool result"


def test_the_assistant_tool_runs_one_scenario_and_maps_refusals():
    from games.cyberpunk.assistant import tools

    short = {"players": [{"field": [{"card": "field-operator", "readiness": "READY"}]},
                         {"field": [{"card": "corpo-security", "readiness": "SPENT"}]}]}
    steps = [{"kind": "DECLARE_ATTACK", "card": "field-operator", "target": "corpo-security"}]
    out = tools.call_tool("engine_scenario", {"setup": short, "steps": steps})
    assert out["ok"] and out["result"]["steps"][0]["applied"] == "Attack with Field Operator", out
    assert out["sources"]["card_slugs"] == ["field-operator", "corpo-security"], "the cards the call named, in order"
    assert tools.call_tool("engine_scenario", {"setup": short, "steps": steps}) == out, "deterministic"
    bad = {"players": [{"hand": ["no-such-card"]}, {}]}
    out = tools.call_tool("engine_scenario", {"setup": bad})
    assert not out["ok"] and out["error_kind"] == "invalid_setup", out
    assert any(e.get("path") == "players[0].hand[0]" for e in out.get("engine_errors", [])), out
    out = tools.call_tool("engine_scenario", {"setup": short, "steps": [{"kind": "FLY"}]})
    assert not out["ok"] and out["error_kind"] == "invalid_steps", out
    out = tools.call_tool("engine_scenario", {"setup": short, "steps": {"kind": "END_TURN"}})
    assert not out["ok"], "steps must be a list"


def test_the_quiz_checks_feed_nothing_but_their_own_measurement():
    """data/scenario holds scenarios derived from eval questions: only the stage-1 script and this test name it."""
    allowed = {"scripts/eval_engine_scenarios.py", "scripts/test_engine_scenario.py"}
    names = []
    for path in [*REPO_ROOT.glob("games/**/*.py"), *REPO_ROOT.glob("harness/**/*.py"), *REPO_ROOT.glob("scripts/*.py"),
                 *REPO_ROOT.glob("scripts/**/*.ts"), *REPO_ROOT.glob("games/**/*.js")]:
        rel = str(path.relative_to(REPO_ROOT))
        if rel not in allowed and "data/scenario" in path.read_text(encoding="utf-8", errors="ignore"):
            names.append(rel)
    assert not names, names
    checks = json.loads((REPO_ROOT / "data/scenario/quiz-checks-v1.json").read_text(encoding="utf-8"))
    gold = "\n".join((REPO_ROOT / f).read_text(encoding="utf-8") for f in (
        "data/gold/quiz_mc_2026-11-12.jsonl", "data/gold/quiz_mc_2026-11-13.jsonl",
        "data/gold/official_basic_test.jsonl"))
    for c in checks["checks"]:
        assert '"id": "%s"' % c.get("control_for", c["id"]) in gold, c["id"]
        assert "question" not in c and "choices" not in c, c["id"]  # the text and the key stay in data/gold


def test_the_stage_one_report_is_current():
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    import eval_engine_scenarios as stage1
    checks = json.loads(stage1.CHECKS_PATH.read_text(encoding="utf-8"))
    fresh = stage1.report_text(stage1.evaluate(checks, stage1.gold_keys()))
    assert stage1._without_engine(fresh) == stage1._without_engine(stage1.REPORT_PATH.read_text(encoding="utf-8")), \
        "run scripts/eval_engine_scenarios.py and review what changed"


def test_reviewed_content_holds_every_admitted_card():
    content, engine = es.reviewed_content(REPO_ROOT)
    coverage = json.loads((REPO_ROOT / "data/engine-candidates/card-coverage.v1.json").read_text(encoding="utf-8"))
    assert len(content["cards"]) == coverage["totals"]["admitted"], (len(content["cards"]), coverage["totals"])
    assert set(engine) == {"version", "artifactHash"}


def main() -> int:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
        print(f"OK  {test.__name__}")
    print(f"PASS engine scenario: {len(tests)}/{len(tests)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
