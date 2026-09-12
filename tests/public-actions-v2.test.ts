import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSerialize } from "@tcg/domain";
import { listLegalActions, resolveActionId } from "@tcg/engine";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { modelInputV2 } from "@tcg/training-harness";
import { demoStarterContext } from "./demo-starter-fixture";
import { demoMatchReplay } from "./demo-match-replay";
import { unwrap } from "./turn-replay";

const trace = demoMatchReplay(), context = demoStarterContext();
function withoutLabel(descriptor: Record<string, unknown>) {
    const { label: _label, ...structured } = descriptor;
    return canonicalSerialize(structured);
}

test("public descriptor v2 preserves every exact-match actionId and resolves back to the trusted action", () => {
    for (const position of trace.positions) {
        const actor = position.state.match.playerOrder[position.actingSeat];
        const trusted = unwrap(listLegalActions(position.state, actor, context));
        const input = unwrap(buildModelInputV2(position.state, actor, context));
        assert.deepEqual(input.observation, position.observation);
        assert.deepEqual(input.legalActions.map(action => action.actionId), trusted.map(action => action.actionId));
        assert.equal(new Set(input.legalActions.map(action => withoutLabel(action.descriptor as unknown as Record<string, unknown>))).size, input.legalActions.length);
        for (const action of input.legalActions) assert.ok(resolveActionId(position.state, actor, action.actionId, context).ok);
        const publicJson = JSON.stringify(input.legalActions);
        for (const forbidden of ["actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"]) assert.equal(publicJson.includes(`\"${forbidden}\"`), false, forbidden);
    }
});

test("v2 structurally disambiguates a legacy duplicate descriptor without parsing presentation labels", () => {
    const position = trace.positions.find(position => {
        const groups = new Map<string, number>();
        for (const action of position.legalActions) groups.set(canonicalSerialize(action.descriptor), (groups.get(canonicalSerialize(action.descriptor)) ?? 0) + 1);
        return [...groups.values()].some(count => count > 1);
    });
    assert.ok(position, "Expected at least one duplicate legacy descriptor in the exact match");
    const actor = position.state.match.playerOrder[position.actingSeat], input = unwrap(buildModelInputV2(position.state, actor, context));
    assert.equal(new Set(input.legalActions.map(action => withoutLabel(action.descriptor as unknown as Record<string, unknown>))).size, input.legalActions.length);
});

test("hidden Legend and Eddie choices use public slots while training delegates to the same engine projection", () => {
    let sawLegendSlot = false, sawEddieSlot = false;
    for (const position of trace.positions) {
        const actor = position.state.match.playerOrder[position.actingSeat], direct = unwrap(buildModelInputV2(position.state, actor, context)), viaTraining = unwrap(modelInputV2(position, context));
        assert.deepEqual(viaTraining, direct);
        for (const action of direct.legalActions) {
            if (action.descriptor.kind === "CALL_LEGEND") {
                assert.equal(action.descriptor.source.kind, "ZONE_SLOT");
                assert.equal(action.descriptor.source.zone, "LEGENDS");
                sawLegendSlot = true;
            }
            if (action.descriptor.kind === "CHOOSE" && action.descriptor.option.kind === "ZONE_SLOT" && action.descriptor.option.zone === "EDDIES") sawEddieSlot = true;
        }
    }
    assert.equal(sawLegendSlot, true);
    assert.equal(sawEddieSlot, true);
});
