import test from "node:test";
import assert from "node:assert/strict";
import { CardRevisionSnapshotSchema, GameStateSchema, createContentBundle, hashCanonical, type GameState, type CardInstanceId } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, resolveActionId, observe, validateState, RulesView, hashReplayState, hashPosition } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { reviewedCards, reviewedContext, reviewedInput } from "./reviewed-card-fixture";
import { reviewedReplay } from "./reviewed-replay";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/reviewed-card-sources.v1.json";
import golden from "./fixtures/reviewed-replay.v1.json";
const context = reviewedContext();
function mainState() {
    let state = unwrap(createGameWithEvents(reviewedInput(), context)).state;
    while (state.setup) state = unwrap(applyAction(state, { actorId: state.timing.actingPlayer, action: { kind: "CHOOSE", choiceId: state.resolution.choice!.id, optionIndices: [0] } }, context)).state;
    const selected = unwrap(listLegalActions(state, state.timing.actingPlayer, context))[0];
    return unwrap(applyAction(state, { actorId: selected.actorId, action: selected.action }, context)).state;
}
function call(state: GameState, cardId = "viktor-vektor-sit-down-and-relax", ctx = context) {
    const action = unwrap(listLegalActions(state, state.timing.actingPlayer, ctx)).find(a => a.action.kind === "CALL_LEGEND" && state.objects.cards[a.action.cardInstanceId].cardId === cardId)!;
    return unwrap(applyAction(state, { actorId: action.actorId, action: action.action }, ctx));
}
function choose(state: GameState, index: number) {
    return unwrap(applyAction(state, { actorId: state.timing.actingPlayer, action: { kind: "CHOOSE", choiceId: state.resolution.choice!.id, optionIndices: [index] } }, context));
}
test("reviewed revisions retain exact captured text and source hashes; Rebecca promo is not admitted", () => {
    for (const card of reviewedCards) {
        const source = sources.records.find(c => c.id === card.id)!;
        assert.equal(card.revision, 1);
        assert.equal(card.rulesText, source.text);
        assert.equal(card.sourceMarkup, source.text_markup);
        assert.equal(card.provenance.sourceHash, hashCanonical(source));
    }
    const input = reviewedInput(); input.decks[0].legends[0] = "rebecca-having-a-moment";
    const result = createGameWithEvents(input, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors[0].code, "UNREVIEWED_EXECUTION");
});
test("Viktor CALL opens current eligible Gear choices with explicit take-none option", () => {
    const before = mainState(), result = call(before), s = result.state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.equal(s.resolution.current?.effect.kind, "SEARCH_GEAR");
    assert.equal(s.resolution.choice?.kind, "TARGET");
    assert.equal(s.resolution.choice?.options.filter(o => o.kind === "CARD").length, 5);
    assert.deepEqual(s.players[s.timing.actingPlayer].zones.HAND, before.players[s.timing.actingPlayer].zones.HAND);
    assert.deepEqual(result.events.map(e => e.payload.kind), ["PAYMENT_MADE", "LEGEND_CALLED", "PHASE_CHANGED", "EFFECT_PENDING", "PHASE_CHANGED"]);
    assert.ok(!result.events.some(e => e.payload.kind === "EFFECT_RESOLVED"));
});
test("Viktor no eligible targets resolves without a fabricated decision; one target remains optional", () => {
    for (const count of [0, 1]) {
        const s = GameStateSchema.parse(mainState()), actor = s.timing.actingPlayer;
        const eligible = s.players[actor].zones.DECK.slice(0, count);
        const allowedIds = new Set(eligible.map(cid => s.objects.cards[cid].cardId));
        // Keep exactly count eligible instances at the top; other instances may share revisions.
        const wanted = [...s.players[actor].zones.DECK.filter(cid => allowedIds.has(s.objects.cards[cid].cardId)).slice(0, count), ...s.players[actor].zones.DECK.filter(cid => !allowedIds.has(s.objects.cards[cid].cardId)).slice(0, 5 - count)];
        s.players[actor].zones.DECK = [...wanted, ...s.players[actor].zones.DECK.filter(cid => !wanted.includes(cid))];
        const cards = context.content.cards.map(c => c.type === "GEAR" && !allowedIds.has(c.id) ? CardRevisionSnapshotSchema.parse({ ...c, cost: 3, printedCost: { kind: "EDDIES", amount: 3 } }) : c);
        const ctx = { content: createContentBundle(context.content.ruleset, cards, context.content.manifest.engine) };
        s.match.contentManifestHash = ctx.content.manifestHash;
        const result = call(unwrap(validateState(s, ctx)), undefined, ctx);
        assert.equal(result.state.timing.step, count ? "TARGET_SELECTION" : "MAIN");
        if (count) assert.equal(result.state.resolution.choice!.options.length, 2);
        else {
            assert.ok(result.events.some(e => e.payload.kind === "EFFECT_RESOLVED"));
            assert.equal(result.state.players[actor].zones.HAND.length, s.players[actor].zones.HAND.length);
        }
    }
});
test("Viktor can decline all or stop after one, or select two; remaining cards go to random bottom", () => {
    for (const count of [0, 1, 2]) {
        const pending = call(mainState()).state, actor = pending.timing.actingPlayer;
        const top = [...pending.resolution.searchContinuation!.looked], beforeDeck = pending.players[actor].zones.DECK;
        let state = pending;
        const selected: CardInstanceId[] = [], events = [];
        for (let i = 0; i < count; i++) {
            const option = state.resolution.choice!.options[1];
            assert.equal(option.kind, "CARD");
            if (option.kind === "CARD") selected.push(option.cardInstanceId);
            const next = choose(state, 1); state = next.state; events.push(...next.events);
        }
        if (state.resolution.searchContinuation) { const next = choose(state, 0); state = next.state; events.push(...next.events); }
        assert.equal(state.timing.step, "MAIN");
        assert.equal(state.resolution.current, null);
        assert.deepEqual(state.players[actor].zones.HAND.slice(pending.players[actor].zones.HAND.length), selected);
        assert.deepEqual(state.players[actor].zones.DECK.slice(0, beforeDeck.length - top.length), beforeDeck.slice(top.length));
        assert.deepEqual([...state.players[actor].zones.DECK.slice(beforeDeck.length - top.length)].sort(), top.filter(id => !selected.includes(id)).sort());
        assert.equal(events.filter(e => e.payload.kind === "CARD_REVEALED").length, count);
        assert.equal(events.filter(e => e.payload.kind === "EFFECT_RESOLVED").length, 1);
        for (const id of selected) assert.equal(state.objects.cards[id].face, "DOWN");
    }
});
test("target selection rejects forged, stale and duplicate choices, and source/target invalidation", () => {
    const s = call(mainState()).state, actor = s.timing.actingPlayer, old = unwrap(listLegalActions(s, actor, context))[0];
    const selected = choose(s, 1).state;
    assert.equal(resolveActionId(selected, actor, old.actionId, context).ok, false);
    assert.equal(applyAction(s, { actorId: actor, action: { kind: "CHOOSE", choiceId: s.resolution.choice!.id, optionIndices: [1, 1] } }, context).ok, false);
    for (const variant of ["top", "selected", "source", "options"] as const) {
        const changed = GameStateSchema.parse(s);
        if (variant === "top") changed.players[actor].zones.DECK.reverse();
        if (variant === "selected") changed.resolution.searchContinuation!.selected = [changed.players[actor].zones.HAND[0]];
        if (variant === "source") changed.objects.cards[changed.resolution.current!.sourceId!].face = "DOWN";
        if (variant === "options") changed.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: changed.players[actor].zones.HAND[0] });
        assert.equal(validateState(changed, context).ok, false);
    }
});
test("search inspection is actor-only; reveals emit facts but face-down hands become hidden again (11.14.4)", () => {
    const s = call(mainState()).state, actor = s.timing.actingPlayer, rival = s.match.playerOrder.find(id => id !== actor)!;
    assert.equal(unwrap(observe(s, actor, context)).inspectedCards?.length, 5);
    assert.equal(unwrap(observe(s, rival, context)).inspectedCards, undefined);
    assert.deepEqual(unwrap(listLegalActions(s, rival, context)), []);
    const input = modelInput(unwrap(generatePosition(s, actor, context, "real-search")));
    assert.equal(JSON.stringify(input).includes('"rng"'), false);
    const one = choose(s, 1).state, finished = choose(one, 0).state;
    const observed = unwrap(observe(finished, rival, context));
    const rivalViewOfHand = observed.players.find(p => p.seat === s.players[actor].seat)!.cards.filter(c => c.zone === "HAND");
    assert.equal(rivalViewOfHand.length, 0);
    assert.equal(unwrap(observe(finished, actor, context)).inspectedCards, undefined);
});
test("Royce power is base plus two per equipped Gear, only face-up in Legends during own turn", () => {
    const before = mainState(), actor = before.timing.actingPlayer, id = Object.values(before.objects.cards).find(c => c.controllerId === actor && c.cardId === "royce-psycho-on-the-edge")!.id;
    assert.equal(new RulesView(before, context).getEffectivePower(id), 6);
    const called = call(before, "royce-psycho-on-the-edge").state;
    assert.equal(called.objects.cards[id].face, "UP");
    const s = GameStateSchema.parse(called), base = JSON.stringify(context.content);
    for (const expected of [8, 10]) {
        const gearId = s.players[actor].zones.HAND.shift()!;
        s.players[actor].zones.BATTLEFIELD.push(gearId);
        s.objects.cards[gearId].zone.zone = "BATTLEFIELD";
        s.objects.cards[gearId].face = "UP";
        s.objects.cards[id].attachments.push(gearId);
        assert.equal(new RulesView(unwrap(validateState(s, context)), context).getEffectivePower(id), expected);
    }
    const end = unwrap(listLegalActions(s, actor, context)).find(a => a.action.kind === "END_TURN")!;
    const rivalTurn = unwrap(applyAction(s, { actorId: end.actorId, action: end.action }, context)).state;
    assert.equal(new RulesView(rivalTurn, context).getEffectivePower(id), 6);
    s.objects.cards[id].attachments = [];
    s.players[actor].zones.LEGENDS.splice(s.players[actor].zones.LEGENDS.indexOf(id), 1);
    s.players[actor].zones.REMOVED.push(id);
    s.objects.cards[id].zone.zone = "REMOVED";
    assert.equal(new RulesView(unwrap(validateState(s, context)), context).getEffectivePower(id), 6);
    assert.equal(JSON.stringify(context.content), base);
});
test("real setup/CALL replay reproduces all events, positions, choices, hashes and final state", () => {
    const replay = reviewedReplay();
    assert.deepEqual(reviewedReplay(), replay);
    assert.deepEqual(replay, golden);
    assert.equal(hashReplayState(replay.finalState), replay.finalStateHash);
    assert.equal(replay.finalState.timing.step, "MAIN");
    assert.ok(replay.steps.some(s => s.step === "TARGET_SELECTION"));
    assert.ok(replay.steps.flatMap(s => s.events).some(e => e.payload.kind === "MULLIGAN_RESOLVED"));
});

test("CALL search position/action IDs exclude transport event provenance", () => {
    const before = mainState(), changed = GameStateSchema.parse({ ...before, match: { ...before.match, eventSequence: before.match.eventSequence + 20, version: before.match.version + 5 } });
    const a = call(before).state, b = call(changed).state;
    assert.notEqual(hashReplayState(a), hashReplayState(b));
    assert.equal(hashPosition(a), hashPosition(b));
    assert.deepEqual(unwrap(listLegalActions(a, a.timing.actingPlayer, context)), unwrap(listLegalActions(b, b.timing.actingPlayer, context)));
});

test("reviewed mode rejects display-only revisions and unsupported multi-trigger metadata", () => {
    for (const change of ["unreviewed", "multi-trigger"] as const) {
        const cards = structuredClone(context.content.cards), viktor = cards.find(c => c.id === "viktor-vektor-sit-down-and-relax")!;
        if (change === "unreviewed") delete viktor.execution;
        else viktor.mechanics.abilities.push({ ...viktor.mechanics.abilities[0], id: "second-trigger" });
        const ctx = { content: createContentBundle(context.content.ruleset, cards, context.content.manifest.engine) };
        assert.equal(createGameWithEvents(reviewedInput(), ctx).ok, false);
    }
});

test("searching fewer than five, including an empty deck, is not an empty-draw loss", () => {
    for (const remaining of [0, 2]) {
        const s = GameStateSchema.parse(mainState()), actor = s.timing.actingPlayer;
        for (const id of s.players[actor].zones.DECK.splice(remaining)) {
            s.players[actor].zones.TRASH.push(id);
            s.objects.cards[id].zone.zone = "TRASH";
            s.objects.cards[id].face = "UP";
        }
        const called = call(unwrap(validateState(s, context)));
        let state = called.state;
        if (remaining) { state = choose(state, 1).state; state = choose(state, 1).state; }
        assert.equal(state.timing.step, "MAIN");
        assert.equal(state.match.outcome, undefined);
        assert.equal(state.players[actor].zones.HAND.length, s.players[actor].zones.HAND.length + remaining);
    }
});
