import test from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema, canonicalSerialize, type GameState, type PlayerId } from "@tcg/domain";
import { listLegalActions, resolveActionId, validateState, type EngineContext } from "@tcg/engine";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { handleRequest } from "@tcg/wire";
import { batchV5Context, DETONATE } from "./api-admission-batch-v5-fixture";
import { batchV5Replay } from "./api-admission-batch-v5-replay";
import { arrange, castProgram } from "./api-admission-batch-v5-scenarios";
import { unwrap } from "./turn-replay";

const context = batchV5Context();
const traces = new Map<string, ReturnType<typeof batchV5Replay>>();
function trace(mode: "MAIN" | "REACT") {
    let found = traces.get(mode);
    if (!found) { found = batchV5Replay(mode); traces.set(mode, found); }
    return found;
}
function publicInput(state: GameState, actor: PlayerId, ctx: EngineContext = context) {
    const input = unwrap(buildModelInputV2(state, actor, ctx));
    const trusted = unwrap(listLegalActions(state, actor, ctx));
    assert.deepEqual(input.legalActions.map(a => a.actionId), trusted.map(a => a.actionId), "V5_V2_ACTION_SET_EQUAL");
    const descriptors = input.legalActions.map(a => canonicalSerialize(Object.fromEntries(Object.entries(a.descriptor).filter(([key]) => key !== "label"))));
    assert.equal(new Set(descriptors).size, descriptors.length, "V5_V2_NO_DUPLICATES");
    for (const action of input.legalActions) {
        const original = trusted.find(a => a.actionId === action.actionId)!;
        assert.deepEqual(unwrap(resolveActionId(state, actor, action.actionId, ctx)), { actorId: original.actorId, action: original.action }, "V5_V2_EXACT_ROUNDTRIP");
    }
    const publicActions = JSON.stringify(input.legalActions);
    for (const field of ["actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"])
        assert.equal(publicActions.includes(`"${field}"`), false, `V5_V2_NO_INTERNAL_${field}`);
    const outbound = JSON.stringify(input);
    // Token boundaries catch IDs embedded in presentation labels without confusing p1-c1 with p1-c10.
    const outboundTokens = new Set(outbound.match(/[A-Za-z0-9_-]+/g) ?? []);
    for (const owner of state.match.playerOrder) {
        for (const id of state.players[owner].zones.DECK)
            assert.equal(outboundTokens.has(id), false, "V5_V2_NO_DECK_INSTANCE");
        if (owner !== actor) for (const id of state.players[owner].zones.HAND) {
            const declaredSource = state.resolution.playContinuation?.sourceId;
            if (id !== declaredSource) assert.equal(outboundTokens.has(id), false, "V5_V2_NO_RIVAL_HAND_INSTANCE");
        }
    }
    return input;
}
function assertGearChoices(state: GameState, ctx: EngineContext = context) {
    const choice = state.resolution.choice;
    assert.ok(choice && choice.kind === "TARGET" && choice.options.length === 2, "V5_V2_TWO_GEAR_CHOICES");
    const expected = choice.options.map(option => {
        assert.equal(option.kind, "CARD"); assert.ok(option.kind === "CARD");
        assert.equal(ctx.content.cards.find(c => c.id === state.objects.cards[option.cardInstanceId].cardId)?.type, "GEAR");
        return option.cardInstanceId;
    }).sort();
    const input = publicInput(state, state.timing.actingPlayer, ctx);
    assert.deepEqual(input.legalActions.map(action => {
        const d = action.descriptor;
        assert.ok(d.kind === "CHOOSE" && d.choiceKind === "TARGET" && d.option.kind === "CARD", "V5_V2_PUBLIC_GEAR_REFERENCE");
        const publicId = d.option.publicId;
        assert.ok(input.observation.players.flatMap(p => p.cards).some(c => c.publicId === publicId));
        return publicId;
    }).sort(), expected, "V5_V2_EXACT_GEAR_TARGETS");
    return input;
}

for (const mode of ["MAIN", "REACT"] as const) {
    test(`V5 ${mode} legal trajectory projects every decision and keeps each viewer's hidden identities private`, () => {
        const replay = trace(mode);
        assert.ok(replay.steps.length > 0);
        for (const step of replay.steps) for (const viewer of step.before.match.playerOrder) {
            const input = publicInput(step.before, viewer);
            if (viewer !== step.before.timing.actingPlayer) assert.deepEqual(input.legalActions, []);
        }
        const target = replay.steps.find(step => step.before.resolution.targetedDefeatContinuation && step.before.resolution.choice?.kind === "TARGET");
        assert.ok(target, "V5_V2_REACHED_TARGET_PAUSE");
        assertGearChoices(target.before);
        assert.equal(resolveActionId(target.after, target.action.actorId, target.actionId, context).ok, false, "V5_V2_STALE_ACTION_REJECTED");
        const other = target.before.match.playerOrder.find(p => p !== target.action.actorId)!;
        assert.equal(resolveActionId(target.before, other, target.actionId, context).ok, false, "V5_V2_OTHER_ACTOR_REJECTED");
    });

    test(`V5 ${mode} paused public input survives reload, ignores hidden deck order, and matches the wire boundary`, () => {
        const target = trace(mode).steps.find(step => step.before.resolution.targetedDefeatContinuation && step.before.resolution.choice?.kind === "TARGET");
        assert.ok(target, "V5_V2_PERSISTED_TARGET_REQUIRED");
        const state = GameStateSchema.parse(JSON.parse(JSON.stringify(target.before))), actor = state.timing.actingPlayer;
        unwrap(validateState(state, context));
        const input = assertGearChoices(state);
        assert.deepEqual(input, unwrap(buildModelInputV2(target.before, actor, context)), "V5_V2_RELOAD_IDENTICAL");
        const shuffled = GameStateSchema.parse(state);
        for (const player of shuffled.match.playerOrder) {
            const deck = shuffled.players[player].zones.DECK;
            assert.ok(deck.length >= 2);
            [deck[0], deck[1]] = [deck[1], deck[0]];
        }
        unwrap(validateState(shuffled, context));
        assert.deepEqual(unwrap(buildModelInputV2(shuffled, actor, context)), input, "V5_V2_HIDDEN_DECK_ORDER_PRIVATE");
        const response = handleRequest({ schemaVersion: 1, requestId: `v5-${mode}`, op: "modelInput", content: context.content, state, actorId: actor });
        assert.ok(response.ok); assert.ok(response.value.kind === "modelInput");
        assert.deepEqual(response.value.modelInput, input, "V5_WIRE_USES_ENGINE_PROJECTION");
    });
}

test("V5 Legends-area Gear target actions use visible public card references", () => {
    const a = arrange({ context, sourceCard: DETONATE, onLegend: true }), cast = castProgram(a);
    const input = assertGearChoices(cast.state);
    const visible = input.observation.players.flatMap(p => p.cards);
    for (const id of a.gearIds) assert.equal(visible.find(c => c.publicId === id)?.zone, "LEGENDS");
});
