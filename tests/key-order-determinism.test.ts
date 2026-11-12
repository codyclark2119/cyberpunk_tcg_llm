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

// End-of-turn cleanup with several LAG cards: the events an action emits (and the state it
// reaches) must not depend on key insertion order either. These replays end turns with
// two or more LAG cards whose insertion order differs from card-id order.
for (const family of ["exact-demo-match", "demo-matrix-overtime"]) {
    test(`${family} replay: reversed key insertion order keeps emitted events and next state`, () => {
        const raw = JSON.parse(readFileSync(`tests/fixtures/${family}-replay.v1.json`, "utf8"));
        const context = { content: ContentBundleSchema.parse(raw.content) };
        let state = unwrap(createGameWithEvents(CreateGameInputSchema.parse(raw.initialization), context)).state;
        let multiLag = 0;
        for (const [index, step] of (raw.steps as { action: unknown }[]).entries()) {
            const action = GameActionSchema.parse(step.action);
            const applied = unwrap(applyAction(state, action, context));
            const reversed = unwrap(applyAction(reverseKeys(state) as GameState, action, context));
            if (applied.events.filter(e => e.payload.kind === "LAG_REMOVED").length >= 2) multiLag++;
            // JSON.stringify is order-sensitive: equal strings mean equal event order and payloads.
            assert.equal(JSON.stringify(reversed.events), JSON.stringify(applied.events), `${family} events at step ${index}`);
            assert.equal(hashReplayState(reversed.state), hashReplayState(applied.state), `${family} next state at step ${index}`);
            state = applied.state;
        }
        assert.ok(multiLag > 0, `${family} must exercise an end of turn that removes several LAG statuses`);
    });
}
