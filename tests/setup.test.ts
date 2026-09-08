import test from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema, createContentBundle, type GameState } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, validateState, observe, hashPosition, hashReplayState, resolveActionId } from "@tcg/engine";
import { modelInput } from "@tcg/training-harness";
import { setupContext, setupInput } from "./setup-fixture";
import { setupReplay } from "./setup-replay";
import { turnInput } from "./turn-fixture";
import { unwrap } from "./turn-replay";
import golden from "./fixtures/setup-replay.v1.json";
const context = setupContext();
function initial(seed?: string) { return unwrap(createGameWithEvents(setupInput(seed), context)); }
function choose(state: GameState, index: number) {
    return unwrap(applyAction(state, { actorId: state.timing.actingPlayer, action: { kind: "CHOOSE", choiceId: state.resolution.choice!.id, optionIndices: [index] } }, context));
}
function mulliganState() {
    let state = initial().state;
    for (const option of [0, 0, 0, 0, 0]) state = choose(state, option).state;
    return state;
}
test("engine setup begins before shuffles and exposes random winner's first/second choice", () => {
    const created = initial(), s = created.state;
    assert.equal(s.timing.turn, 0);
    assert.equal(s.timing.step, "CHOOSE_FIRST_PLAYER");
    assert.equal(s.timing.firstPlayer, undefined);
    assert.equal(s.rng.counter, 1);
    assert.deepEqual(created.events.map(e => e.payload.kind), ["FIRST_PLAYER_DETERMINED"]);
    for (const p of Object.values(s.players)) assert.equal(p.zones.HAND.length, 0);
    const first = choose(s, 0).state, second = choose(s, 1).state;
    assert.equal(first.timing.firstPlayer, s.timing.actingPlayer);
    assert.notEqual(second.timing.firstPlayer, s.timing.actingPlayer);
    assert.deepEqual(unwrap(listLegalActions(s, s.match.playerOrder.find(id => id !== s.timing.actingPlayer)!, context)), []);
    assert.equal(createGameWithEvents(turnInput(), context).ok, false);
});
test("main cuts, Legend randomization/cuts, initial spending, draw, mulligans follow captured order", () => {
    const replay = setupReplay();
    assert.deepEqual(replay.steps.slice(0, 7).map(s => s.step), ["CUT_DECISION", "CUT_DECISION", "CUT_DECISION", "CUT_DECISION", "MULLIGAN_DECISION", "MULLIGAN_DECISION", "CHOOSE_GIG"]);
    const setupEvents = replay.steps.slice(0, 7).flatMap(s => s.events);
    const lastCut = setupEvents.map(e => e.payload.kind).lastIndexOf("SETUP_CUT");
    const firstDraw = setupEvents.findIndex(e => e.payload.kind === "CARD_MOVED");
    const firstMulligan = setupEvents.findIndex(e => e.payload.kind === "MULLIGAN_DECLARED");
    assert.ok(lastCut < firstDraw && firstDraw < firstMulligan);
    assert.equal(setupEvents.filter(e => e.payload.kind === "SETUP_CUT").length, 4);
    assert.equal(setupEvents.filter(e => e.payload.kind === "MULLIGAN_DECLARED").length, 2);
    assert.equal(setupEvents.filter(e => e.payload.kind === "MULLIGAN_RESOLVED").length, 1);
    const full = [...replay.initialized.events, ...replay.steps.flatMap(s => s.events)];
    assert.deepEqual(full.map(e => e.sequence), Array.from({ length: full.length }, (_, i) => i + 1));
});
test("cut is exact cyclic rotation; decline leaves order and RNG unchanged", () => {
    const s = choose(initial().state, 0).state, owner = s.match.playerOrder[0], order = s.players[owner].zones.DECK;
    const declined = choose(s, 0), cut = choose(s, 5);
    assert.deepEqual(declined.state.players[owner].zones.DECK, order);
    assert.deepEqual(cut.state.players[owner].zones.DECK, [...order.slice(5), ...order.slice(0, 5)]);
    assert.deepEqual(cut.state.rng, s.rng);
    assert.deepEqual(cut.events.map(e => e.payload.kind), ["SETUP_CUT"]);
    assert.equal(applyAction(s, { actorId: s.timing.actingPlayer, action: { kind: "CHOOSE", choiceId: s.resolution.choice!.id, optionIndices: [order.length] } }, context).ok, false);
});
test("whole-hand mulligan resolves before rival choice, exactly once, with deterministic full shuffle", () => {
    const s = mulliganState(), actor = s.timing.actingPlayer, rival = s.match.playerOrder.find(id => id !== actor)!;
    assert.equal(actor, s.timing.firstPlayer);
    const oldHand = s.players[actor].zones.HAND;
    const accepted = choose(s, 1), declined = choose(s, 0);
    assert.equal(accepted.state.timing.actingPlayer, rival);
    assert.deepEqual(accepted.state.players[rival].zones.HAND, s.players[rival].zones.HAND);
    assert.equal(accepted.state.players[actor].zones.HAND.length, 6);
    assert.deepEqual(declined.state.players[actor].zones.HAND, oldHand);
    const returned = accepted.events.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "DECK");
    assert.equal(returned.length, 6);
    assert.deepEqual(returned.map(e => e.payload.kind === "CARD_MOVED" && e.payload.cardInstanceId), oldHand);
    assert.equal(accepted.state.rng.counter - s.rng.counter, 41);
    assert.deepEqual(choose(s, 1), accepted);
    assert.equal(applyAction(accepted.state, { actorId: actor, action: { kind: "CHOOSE", choiceId: s.resolution.choice!.id, optionIndices: [1] } }, context).ok, false);
});
test("either player may decline or accept; first turn keeps two leftmost Legends spent", () => {
    for (const firstChoice of [0, 1]) for (const secondChoice of [0, 1]) {
        const s = choose(choose(mulliganState(), firstChoice).state, secondChoice).state;
        assert.equal(s.setup, undefined);
        assert.equal(s.timing.turn, 1);
        assert.equal(s.timing.step, "CHOOSE_GIG");
        for (const id of s.match.playerOrder) {
            assert.equal(s.players[id].zones.HAND.length, id === s.timing.firstPlayer ? 7 : 6);
            assert.deepEqual(s.players[id].zones.LEGENDS.map(cid => s.objects.cards[cid].readiness), id === s.timing.firstPlayer ? ["SPENT", "SPENT", "READY"] : ["READY", "READY", "READY"]);
        }
    }
});
test("setup validation rejects forged choice options, wrong turn/actor/order and early hand mutations", () => {
    const original = initial().state;
    for (const mutate of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.choice!.options.reverse(); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.turn = 1; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.actingPlayer = s.match.playerOrder.find(id => id !== s.timing.actingPlayer)!; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.setup!.completed = 1; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { delete s.setup; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { Object.values(s.objects.cards)[0].face = "UP"; }
    ]) {
        const changed = GameStateSchema.parse(original); mutate(changed);
        assert.equal(validateState(changed, context).ok, false);
    }
});
test("setup observations and model labels hide opponent hands, all face-down Legends and shuffle data", () => {
    const replay = setupReplay();
    for (const position of replay.positions) {
        const input = modelInput(position), serialized = JSON.stringify(input);
        assert.equal(serialized.includes('"rng"'), false);
        assert.equal(serialized.includes('SETUP_SHUFFLED'), false);
        const s = position.state;
        for (const id of s.match.playerOrder) {
            const observation = unwrap(observe(s, id, context));
            for (const p of observation.players) for (const card of p.cards) {
                if (card.zone === "LEGENDS") { assert.equal(card.content, undefined); assert.match(card.publicId, /^seat:/); }
                if (card.zone === "HAND") assert.equal(p.seat, s.players[id].seat);
            }
        }
        assert.ok(input.legalActions.every(a => !a.descriptor.label.includes("dev-legend") && !a.descriptor.label.includes("slice-card")));
    }
});
test("setup action IDs ignore transport counters and reject stale semantic states", () => {
    const s = initial().state, changed = GameStateSchema.parse(s);
    changed.match.version++;
    changed.match.eventSequence++;
    assert.equal(hashPosition(changed), hashPosition(s));
    assert.deepEqual(unwrap(listLegalActions(changed, s.timing.actingPlayer, context)), unwrap(listLegalActions(s, s.timing.actingPlayer, context)));
    const old = unwrap(listLegalActions(s, s.timing.actingPlayer, context))[0];
    const next = choose(s, 0).state;
    assert.equal(resolveActionId(next, next.timing.actingPlayer, old.actionId, context).ok, false);
});
test("new replay pins every intermediate hash, event, observation and action order", () => {
    const replay = setupReplay();
    assert.deepEqual(setupReplay(), replay);
    assert.deepEqual(replay, golden);
    assert.equal(hashReplayState(replay.finalState), replay.finalStateHash);
    assert.notDeepEqual(initial("different-seed").state.rng, initial().state.rng);
    assert.notDeepEqual(choose(initial("different-seed").state, 0).state.players, choose(initial().state, 0).state.players);
});
test("engine setup still rejects unsupported automatic mechanics before any hidden choices", () => {
    const base = setupContext(), cards = structuredClone(base.content.cards);
    const unit = cards.find(c => c.type === "UNIT")!;
    unit.mechanics.abilities = [{ id: "unimplemented", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }];
    const unsupported = { content: createContentBundle(base.content.ruleset, cards, base.content.manifest.engine) };
    assert.equal(createGameWithEvents(setupInput(), unsupported).ok, false);
});
