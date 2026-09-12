import test from "node:test";
import { readFileSync } from "node:fs";
import { turnReplay } from "./turn-replay";
import assert from "node:assert/strict";
import { GameStateSchema, GameStateVersionSchema, CardInstanceIdSchema, GigInstanceIdSchema, createContentBundle, type GameState, type GameAction, type LegalAction } from "@tcg/domain";
import { createGameWithEvents, createGame, listLegalActions, applyAction, observe, hashReplayState, hashPosition, validateState, RulesView, modifyGigValue, transferGigControl, resolveActionId } from "@tcg/engine";
import { generatePosition, validateTrainingPosition, modelInput } from "@tcg/training-harness";
import { turnContext, turnInput } from "./turn-fixture";
import { player, rival } from "./contract-fixture";
const context = turnContext(), input = turnInput();
function unwrap<T>(r: {
    ok: true;
    value: T;
} | {
    ok: false;
    errors: unknown;
}): T { if (!r.ok)
    throw new Error(JSON.stringify(r.errors)); return r.value; }
function legal(s: GameState) { return unwrap(listLegalActions(s, s.timing.actingPlayer, context)); }
function choose(s: GameState, kind: GameAction["action"]["kind"], predicate = (a: LegalAction) => Boolean(a)) { const action = legal(s).find(a => a.action.kind === kind && predicate(a)); assert.ok(action, `Missing ${kind}`); return unwrap(applyAction(s, { actorId: action.actorId, action: action.action }, context)); }
function main(s: GameState) { return choose(s, "ROLL_GIG", a => a.action.kind === "ROLL_GIG" && s.objects.gigs[a.action.gigInstanceId].dieType === "D8").state; }
test("initialization validates decks and explicit setup; shuffle, draw and first-turn exception are deterministic", () => {
    const a = unwrap(createGameWithEvents(input, context)), b = unwrap(createGameWithEvents(input, context));
    assert.deepEqual(a, b);
    assert.equal(a.state.timing.step, "CHOOSE_GIG");
    assert.equal(a.state.players[player].zones.HAND.length, 7);
    assert.equal(a.state.players[rival].zones.HAND.length, 6);
    assert.equal(Object.keys(a.state.objects.cards).length, 90);
    assert.equal(Object.keys(a.state.objects.gigs).length, 12);
    assert.equal(a.state.players[player].zones.LEGENDS.filter(id => a.state.objects.cards[id].readiness === "SPENT").length, 2);
    assert.ok(a.state.players[player].zones.LEGENDS.every(id => a.state.objects.cards[id].face === "DOWN"));
    assert.deepEqual(a.events.filter(e => e.payload.kind === "PHASE_CHANGED").map(e => e.payload.kind === "PHASE_CHANGED" ? e.payload.step : ""), ["TURN_START", "READY", "DRAW", "CHOOSE_GIG"]);
    const different = unwrap(createGame(turnInput("another-seed"), context));
    assert.notDeepEqual(a.state.players[player].zones.DECK, different.players[player].zones.DECK);
    assert.deepEqual(Object.keys(a.state.objects.cards).sort(), Object.keys(different.objects.cards).sort());
    assert.deepEqual(a.state.objects.gigs, different.objects.gigs);
    assert.equal(createGame({ ...input, setup: undefined }, context).ok, false);
    assert.equal(createGame({ ...input, decks: input.decks.map(d => ({ ...d, main: d.main.slice(0, 3) })) }, context).ok, false);
    const second = unwrap(createGame({ ...input, setup: { ...input.setup, firstPlayerSeat: 1 } }, context));
    assert.equal(second.timing.activePlayer, rival);
    assert.equal(second.players[rival].zones.HAND.length, 7);
});
test("headline multi-turn semantic replay reproduces every action list, event, roll and state hash", () => {
    const initialized = unwrap(createGameWithEvents(input, context));
    let state = initialized.state;
    const steps: GameAction[] = [], history: {
        state: GameState;
        events: unknown;
        actions: LegalAction[];
        hash: string;
    }[] = [];
    function step(kind: GameAction["action"]["kind"], predicate?: (a: LegalAction) => boolean) {
        const actions = legal(state), action = actions.find(a => a.action.kind === kind && (!predicate || predicate(a)));
        assert.ok(action);
        steps.push({ actorId: action.actorId, action: action.action });
        const r = unwrap(applyAction(state, steps.at(-1)!, context));
        state = r.state;
        history.push({ state, events: r.events, actions, hash: hashReplayState(state) });
    }
    step("ROLL_GIG", a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith("D8"));
    step("SELL_CARD");
    step("CALL_LEGEND");
    assert.equal(state.timing.step, "PAYMENT_SELECTION");
    step("CHOOSE");
    step("END_TURN");
    assert.equal(state.timing.activePlayer, rival);
    step("ROLL_GIG");
    step("END_TURN");
    assert.equal(state.timing.turn, 3);
    assert.equal(state.timing.activePlayer, player);
    assert.equal(state.players[player].economy.callsThisTurn, 0);
    assert.equal(state.players[player].economy.sellsThisTurn, 0);
    assert.ok(state.players[player].zones.LEGENDS.every(id => state.objects.cards[id].readiness === "READY"));
    let replay = unwrap(createGameWithEvents(input, context));
    assert.deepEqual(replay, initialized);
    steps.forEach((action, i) => { assert.deepEqual(legal(replay.state), history[i].actions); replay = unwrap(applyAction(replay.state, action, context)); assert.deepEqual(replay.events, history[i].events); assert.deepEqual(replay.state, history[i].state); assert.equal(hashReplayState(replay.state), history[i].hash); });
    assert.deepEqual(replay.state, state);
    assert.equal(hashReplayState(replay.state), hashReplayState(state));
    const transported = GameStateSchema.parse(state);
    transported.match.version = GameStateVersionSchema.parse(transported.match.version + 10);
    assert.equal(hashPosition(transported), hashPosition(state));
    assert.deepEqual(legal(transported), legal(state));
});
test("Gig decision exposes five choices then rolls selected identity into controlled Gigs; D20 waits for original dice", () => {
    let s = unwrap(createGame(input, context));
    assert.equal(legal(s).length, 5);
    assert.ok(legal(s).every(a => a.action.kind === "ROLL_GIG" && !a.descriptor.label.includes("D20")));
    const id = GigInstanceIdSchema.parse("p0-D8");
    s = main(s);
    const gig = s.objects.gigs[id];
    assert.equal(gig.location.zone, "GIGS");
    assert.equal(gig.roll.kind, "ROLLED");
    if (gig.roll.kind !== "ROLLED")
        return;
    assert.equal(gig.roll.initialValue, gig.roll.currentValue);
    assert.equal(new RulesView(s, context).getStreetCred(player), gig.roll.currentValue);
    const modified = unwrap(modifyGigValue(s, id, 1, context));
    assert.equal(new RulesView(modified.state, context).getStreetCred(player), gig.roll.currentValue + 1);
    const transferred = unwrap(transferGigControl(modified.state, id, rival, context));
    assert.equal(new RulesView(transferred.state, context).getStreetCred(player), 0);
    assert.equal(new RulesView(transferred.state, context).getStreetCred(rival), gig.roll.currentValue + 1);
    s = choose(s, "END_TURN").state;
    while (!(s.timing.activePlayer === player && s.players[player].gigs.FIXER.length === 1)) {
        s = choose(s, "ROLL_GIG").state;
        s = choose(s, "END_TURN").state;
    }
    assert.deepEqual(legal(s).map(a => a.descriptor.label), ["Roll D20"]);
});
test("SELL/CALL/payment use instances, enforce turn limits, preserve orientation and resolve one CALL/DRAW", () => {
    let s = main(unwrap(createGame(input, context)));
    assert.deepEqual([...new Set(legal(s).map(a => a.action.kind))].sort(), ["CALL_LEGEND", "END_TURN", "SELL_CARD"]);
    for (const a of legal(s))
        if (a.action.kind === "SELL_CARD") {
            const cardId = s.objects.cards[a.action.cardInstanceId].cardId;
            assert.equal(context.content.cards.find(c => c.id === cardId)?.sellProfile.allowed, true);
        }
    const before = s, sell = legal(s).find(a => a.action.kind === "SELL_CARD")!;
    assert.equal(sell.action.kind, "SELL_CARD");
    if (sell.action.kind !== "SELL_CARD")
        return;
    s = choose(s, "SELL_CARD").state;
    const sold = s.objects.cards[sell.action.cardInstanceId];
    assert.equal(sold.id, before.objects.cards[sold.id].id);
    assert.equal(sold.face, "DOWN");
    assert.equal(sold.readiness, "READY");
    assert.equal(sold.zone.zone, "EDDIES");
    assert.equal(s.players[player].economy.sellsThisTurn, 1);
    assert.ok(!legal(s).some(a => a.action.kind === "SELL_CARD"));
    assert.equal(resolveActionId(s, player, sell.actionId, context).ok, false);
    const target = s.players[player].zones.LEGENDS[0], orientation = s.objects.cards[target].readiness, hand = s.players[player].zones.HAND.length;
    const call = choose(s, "CALL_LEGEND", a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === target);
    assert.equal(call.state.timing.step, "PAYMENT_SELECTION");
    assert.ok(legal(call.state).every(a => a.action.kind === "CHOOSE"));
    const choice = call.state.resolution.choice!, index = choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
    assert.ok(index >= 0);
    const paid = choose(call.state, "CHOOSE", a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    s = paid.state;
    assert.equal(s.objects.cards[sold.id].readiness, "SPENT");
    assert.equal(s.objects.cards[sold.id].zone.zone, "EDDIES");
    assert.equal(s.objects.cards[target].face, "UP");
    assert.equal(s.objects.cards[target].readiness, orientation);
    assert.equal(s.players[player].zones.HAND.length, hand + 1);
    assert.equal(s.players[player].economy.callsThisTurn, 1);
    assert.ok(!legal(s).some(a => a.action.kind === "CALL_LEGEND"));
    assert.deepEqual(paid.events.filter(e => ["LEGEND_CALLED", "EFFECT_PENDING", "EFFECT_RESOLVED"].includes(e.payload.kind)).map(e => e.payload.kind), ["LEGEND_CALLED", "EFFECT_PENDING", "EFFECT_RESOLVED"]);
    assert.equal(s.resolution.current, null);
    assert.deepEqual(s.resolution.pending, []);
    const noFunds = GameStateSchema.parse(before);
    for (const id of noFunds.players[player].zones.LEGENDS)
        noFunds.objects.cards[id].readiness = "SPENT";
    assert.ok(!legal(noFunds).some(a => a.action.kind === "CALL_LEGEND"));
});
test("state validation rejects stale usage and forged payment options without repair", () => {
    const s = main(unwrap(createGame(input, context))), bad = GameStateSchema.parse(s);
    bad.players[player].economy.usageTurn = 0;
    assert.equal(validateState(bad, context).ok, false);
    const selected = choose(choose(s, "SELL_CARD").state, "CALL_LEGEND").state, forged = GameStateSchema.parse(selected);
    forged.resolution.choice!.options.push({ kind: "PAYMENT", source: { kind: "EDDIE", cardInstanceId: CardInstanceIdSchema.parse("p1-c3") } });
    assert.equal(validateState(forged, context).ok, false);
    const unsupported = structuredClone(context.content.cards);
    unsupported[0].mechanics.abilities[0].effects = [{ kind: "CUSTOM", handlerId: "unsupported@1" }];
    const c = { content: createContentBundle(context.content.ruleset, unsupported, context.content.manifest.engine) };
    const init = createGame(input, c);
    assert.equal(init.ok, false);
    if (!init.ok)
        assert.equal(init.errors[0].code, "UNSUPPORTED_CALL_EFFECT");
});
test("both observations and model inputs hide Legends, sold identities and future RNG at all decisions", () => {
    let s = unwrap(createGame(input, context));
    const gigPosition = unwrap(generatePosition(s, player, context, "gig"));
    assert.equal(validateTrainingPosition(gigPosition, context).ok, true);
    s = main(s);
    const mainPosition = unwrap(generatePosition(s, player, context, "main"));
    assert.equal(mainPosition.stateHash, hashReplayState(s));
    s = choose(s, "SELL_CARD").state;
    const sold = s.players[player].zones.EDDIES[0];
    s = choose(s, "CALL_LEGEND").state;
    const p = unwrap(generatePosition(s, player, context, "payment"));
    assert.equal(p.observation.step, "PAYMENT_SELECTION");
    assert.ok(!JSON.stringify(modelInput(p)).includes("fixture-seed"));
    for (const viewer of [player, rival]) {
        const o = unwrap(observe(s, viewer, context));
        assert.ok(o.players.every(p => p.cards.filter(c => c.zone === "LEGENDS" || c.zone === "EDDIES").every(c => c.content === undefined)));
        assert.equal(o.players.find(p => p.seat !== s.players[viewer].seat)!.cards.filter(c => c.zone === "HAND").length, 0);
        assert.ok(!JSON.stringify(o).includes(input.seed));
        assert.equal(o.players[0].streetCred, new RulesView(s, context).getStreetCred(player));
    }
    s = choose(s, "CHOOSE").state;
    const o = unwrap(observe(s, player, context));
    assert.equal(o.players[0].cards.filter(c => c.zone === "LEGENDS" && c.content).length, 1);
    assert.equal(o.players[0].cards.find(c => c.zone === "EDDIES")!.content, undefined);
    assert.equal(s.objects.cards[sold].zone.zone, "EDDIES");
});
test("empty draw loses through the outcome boundary without publishing half-resolved work", () => {
    const s = main(unwrap(createGame(input, context))), empty = GameStateSchema.parse(s);
    for (const id of empty.players[rival].zones.DECK) {
        empty.players[rival].zones.TRASH.push(id);
        empty.objects.cards[id].zone.zone = "TRASH";
        empty.objects.cards[id].face = "UP";
    }
    empty.players[rival].zones.DECK = [];
    const result = choose(empty, "END_TURN");
    assert.equal(result.state.match.outcome?.loserId, rival);
    assert.equal(result.state.timing.step, "FINISHED");
    assert.equal(legal(result.state).length, 0);
    assert.equal(generatePosition(result.state, player, context, "finished").ok, false);
});
test("single-source CALL spends the same Legend, while face-up unsellable Legends cannot pay", () => {
    const state = main(unwrap(createGame(input, context))), view = new RulesView(state, context), source = view.listPaymentSources(player)[0];
    assert.equal(view.listPaymentSources(player).length, 1);
    assert.equal(source.kind, "LEGEND");
    const result = choose(state, "CALL_LEGEND", a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === source.cardInstanceId);
    assert.equal(result.state.timing.step, "MAIN");
    const c = result.state.objects.cards[source.cardInstanceId];
    assert.equal(c.id, source.cardInstanceId);
    assert.equal(c.face, "UP");
    assert.equal(c.readiness, "SPENT");
    assert.equal(c.zone.zone, "LEGENDS");
    const readied = GameStateSchema.parse(result.state);
    readied.objects.cards[c.id].readiness = "READY";
    assert.ok(!new RulesView(readied, context).listPaymentSources(player).some(p => p.cardInstanceId === c.id));
    let next = choose(result.state, "END_TURN").state;
    next = choose(next, "ROLL_GIG").state;
    next = choose(next, "END_TURN").state;
    next = choose(next, "ROLL_GIG").state;
    assert.ok(!legal(next).some(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === c.id));
    assert.ok(legal(next).some(a => a.action.kind === "SELL_CARD"));
});
test("turn-start Gig victory is checked before ready and before an empty-deck draw", () => {
    const draft = GameStateSchema.parse(main(unwrap(createGame(input, context))));
    for (const id of [...draft.players[rival].gigs.FIXER]) {
        const g = draft.objects.gigs[id];
        g.roll = { kind: "ROLLED", initialValue: 1, currentValue: 1 };
        g.location.zone = "GIGS";
        draft.players[rival].gigs.GIGS.push(id);
    }
    draft.players[rival].gigs.FIXER = [];
    const transferred = unwrap(transferGigControl(draft, GigInstanceIdSchema.parse("p0-D8"), rival, context));
    const empty = GameStateSchema.parse(transferred.state);
    for (const id of empty.players[rival].zones.DECK) {
        empty.players[rival].zones.TRASH.push(id);
        empty.objects.cards[id].zone.zone = "TRASH";
    }
    empty.players[rival].zones.DECK = [];
    const ended = choose(empty, "END_TURN");
    assert.equal(ended.state.match.outcome?.winnerId, rival);
    assert.equal(ended.state.match.outcome?.reason, "START_TURN_GIGS");
    assert.ok(!ended.events.some(e => e.payload.kind === "CARD_MOVED" || e.payload.kind === "CARD_READIED"));
});
test("unsupported draw policy rejects atomically instead of guessing a transition", () => {
    const rules = structuredClone(context.content.ruleset);
    rules.gameplay!.turnSlice!.emptyDraw = "UNSUPPORTED";
    const unsupportedContext = { content: createContentBundle(rules, context.content.cards, context.content.manifest.engine) };
    let s = unwrap(createGame(input, unsupportedContext));
    const roll = unwrap(listLegalActions(s, player, unsupportedContext))[0];
    s = unwrap(applyAction(s, { actorId: player, action: roll.action }, unsupportedContext)).state;
    const empty = GameStateSchema.parse(s);
    for (const id of empty.players[rival].zones.DECK) {
        empty.players[rival].zones.TRASH.push(id);
        empty.objects.cards[id].zone.zone = "TRASH";
    }
    empty.players[rival].zones.DECK = [];
    const before = JSON.stringify(empty), result = applyAction(empty, { actorId: player, action: { kind: "END_TURN" } }, unsupportedContext);
    assert.equal(result.ok, false);
    if (!result.ok)
        assert.equal(result.errors[0].code, "UNSUPPORTED_EMPTY_DRAW");
    assert.equal(JSON.stringify(empty), before);
});
test("legacy UNSUPPORTED policy: empty Fixers skip Gig choice and stop after two consecutive starts", () => {
    let state = unwrap(createGame(input, context));
    let emptyTurns = 0;
    for (let n = 0; n < 20; n++) {
        if (state.timing.step === "CHOOSE_GIG")
            state = choose(state, "ROLL_GIG").state;
        else {
            assert.equal(state.timing.step, "MAIN");
            emptyTurns++;
        }
        const ended = applyAction(state, { actorId: state.timing.activePlayer, action: { kind: "END_TURN" } }, context);
        if (!ended.ok) {
            assert.equal(ended.errors[0].code, "UNSUPPORTED_OVERTIME");
            assert.equal(state.timing.emptyFixerStarts, 2);
            assert.equal(emptyTurns, 2);
            return;
        }
        state = ended.value.state;
    }
    assert.fail("Overtime boundary was never reached");
});
test("non-sellable hand cards and wrong-zone cards cannot bypass legal enumeration", () => {
    const draft = GameStateSchema.parse(main(unwrap(createGame(input, context))));
    const id = draft.players[player].zones.DECK.find(id => draft.objects.cards[id].cardId === "slice-card-13")!;
    assert.ok(id);
    draft.players[player].zones.DECK.splice(draft.players[player].zones.DECK.indexOf(id), 1);
    draft.players[player].zones.HAND.push(id);
    draft.objects.cards[id].zone.zone = "HAND";
    assert.ok(!legal(draft).some(a => a.action.kind === "SELL_CARD" && a.action.cardInstanceId === id));
    assert.equal(applyAction(draft, { actorId: player, action: { kind: "SELL_CARD", cardInstanceId: id } }, context).ok, false);
    const deckId = draft.players[player].zones.DECK[0];
    assert.equal(applyAction(draft, { actorId: player, action: { kind: "SELL_CARD", cardInstanceId: deckId } }, context).ok, false);
    const wrongActor = rival;
    assert.equal(applyAction(draft, { actorId: wrongActor, action: { kind: "END_TURN" } }, context).ok, false);
});
test("payment continuation identities are independent of transport version counters", () => {
    const state = choose(main(unwrap(createGame(input, context))), "SELL_CARD").state;
    const transported = GameStateSchema.parse(state);
    transported.match.version = GameStateVersionSchema.parse(100);
    const first = choose(state, "CALL_LEGEND").state, second = choose(transported, "CALL_LEGEND").state;
    assert.equal(hashPosition(first), hashPosition(second));
    assert.deepEqual(legal(first), legal(second));
});
test("checked-in gameplay replay and three training decisions match current engine artifact", () => {
    const expected = JSON.parse(readFileSync("tests/fixtures/turn-replay.v1.json", "utf8"));
    assert.deepEqual(turnReplay(), expected);
    assert.deepEqual(expected.positions.map((p: {
        observation: {
            step: string;
        };
    }) => p.observation.step), ["CHOOSE_GIG", "MAIN", "PAYMENT_SELECTION"]);
});
