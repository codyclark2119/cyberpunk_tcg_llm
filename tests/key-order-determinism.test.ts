import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ContentBundleSchema, GameActionSchema, type GameState } from "@tcg/domain";
import { CreateGameInputSchema, applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, type EngineContext } from "@tcg/engine";

// Canonical hashes ignore key order, so two states with the same hash may differ only in
// object key insertion order. Legal actions (including their order and IDs) and hashes must
// not depend on it. Each family replays its committed decisions and, at every position,
// rebuilds the state with every object's keys reversed.
const FAMILIES = ["turn", "react", "field-legends", "overtime"];

const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; errors: unknown[] }): T {
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.value;
}

function fingerprint(state: GameState, context: EngineContext) {
    return {
        stateHash: hashReplayState(state), positionHash: hashPosition(state),
        seats: state.match.playerOrder.map(actor => ({
            // JSON.stringify is order-sensitive: equal strings mean equal action order and IDs.
            legalActions: JSON.stringify(unwrap(listLegalActions(state, actor, context))),
            observationHash: hashObservation(unwrap(observe(state, actor, context)))
        }))
    };
}

for (const family of FAMILIES) {
    test(`${family} replay: reversed key insertion order keeps legal actions and hashes`, () => {
        const raw = JSON.parse(readFileSync(`tests/fixtures/${family}-replay.v1.json`, "utf8"));
        const context = { content: ContentBundleSchema.parse(raw.content) };
        let state = unwrap(createGameWithEvents(CreateGameInputSchema.parse(raw.initialization), context)).state;
        const reversed = reverseKeys(state) as GameState;
        assert.notDeepEqual(Object.keys(reversed.objects.cards), Object.keys(state.objects.cards));
        for (const [index, step] of (raw.steps as { action: unknown }[]).entries()) {
            assert.deepEqual(fingerprint(reverseKeys(state) as GameState, context), fingerprint(state, context), `${family} position ${index}`);
            state = unwrap(applyAction(state, GameActionSchema.parse(step.action), context)).state;
        }
        assert.deepEqual(fingerprint(reverseKeys(state) as GameState, context), fingerprint(state, context), `${family} final position`);
    });
}
