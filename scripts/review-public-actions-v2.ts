import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalSerialize, hashCanonical } from "@tcg/domain";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { coordinateId, type MatrixCoordinate } from "../tests/demo-matrix-config";
import { distribution, type MatrixTrace } from "../tests/demo-matrix-metrics";

const matrix: { matrixHash: string; records: { coordinate: MatrixCoordinate; finalHash: string }[] } = JSON.parse(
    readFileSync("tests/fixtures/demo-match-matrix-reboot.v1.json", "utf8")
);
const TRACE_DIR = "/tmp/tcg-reboot-model-a-traces";
const LEGACY_EXPECTED = { positions: 5956, groups: 7463 } as const;
const forbiddenKeys = new Set(["actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"]);
const withoutLabel = (descriptor: unknown) => {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return descriptor;
    const { label: _label, ...rest } = descriptor as Record<string, unknown>;
    return rest;
};
function containsForbiddenKey(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(containsForbiddenKey);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (forbiddenKeys.has(key) || containsForbiddenKey(child)) return true;
    }
    return false;
}

let positionsReviewed = 0, actionsReviewed = 0;
let legacyDuplicatePositions = 0, legacyDuplicateGroups = 0;
let v2DuplicatePositions = 0, v2DuplicateGroups = 0;
let unprojectableActions = 0, actionSetMismatches = 0, privacyFailures = 0;
const v1Bytes: number[] = [], v2Bytes: number[] = [], examples: unknown[] = [];

for (const record of matrix.records) {
    const trace: MatrixTrace = JSON.parse(readFileSync(`${TRACE_DIR}/${coordinateId(record.coordinate)}.json`, "utf8"));
    assert.equal(trace.finalStateHash, record.finalHash);
    const context = { content: trace.content };
    for (const position of trace.positions) {
        positionsReviewed++;
        actionsReviewed += position.legalActions.length;
        const legacyGroups = new Map<string, number>();
        for (const action of position.legalActions) {
            const key = canonicalSerialize(action.descriptor);
            legacyGroups.set(key, (legacyGroups.get(key) ?? 0) + 1);
        }
        const legacyDuplicates = [...legacyGroups.values()].filter(count => count > 1);
        if (legacyDuplicates.length) {
            legacyDuplicatePositions++;
            legacyDuplicateGroups += legacyDuplicates.length;
        }
        const actor = position.state.match.playerOrder[position.actingSeat];
        const input = buildModelInputV2(position.state, actor, context);
        if (!input.ok) {
            unprojectableActions += position.legalActions.length;
            if (examples.length < 5) examples.push({ coordinate: coordinateId(record.coordinate), positionId: position.positionId, errors: input.errors });
            continue;
        }
        const trustedIds = position.legalActions.map(action => action.actionId);
        const publicIds = input.value.legalActions.map(action => action.actionId);
        if (canonicalSerialize(trustedIds) !== canonicalSerialize(publicIds)) actionSetMismatches++;
        const v2Groups = new Map<string, number>();
        for (const action of input.value.legalActions) {
            const key = canonicalSerialize(withoutLabel(action.descriptor));
            v2Groups.set(key, (v2Groups.get(key) ?? 0) + 1);
        }
        const v2Duplicates = [...v2Groups.values()].filter(count => count > 1);
        if (v2Duplicates.length) {
            v2DuplicatePositions++;
            v2DuplicateGroups += v2Duplicates.length;
            if (examples.length < 5) examples.push({ coordinate: coordinateId(record.coordinate), positionId: position.positionId, duplicates: v2Duplicates.length });
        }
        if (containsForbiddenKey(input.value.legalActions)) privacyFailures++;
        v1Bytes.push(Buffer.byteLength(JSON.stringify({ observation: position.observation, legalActions: position.legalActions.map(a => ({ actionId: a.actionId, descriptor: a.descriptor })) })));
        v2Bytes.push(Buffer.byteLength(JSON.stringify(input.value)));
    }
}

assert.equal(legacyDuplicatePositions, LEGACY_EXPECTED.positions);
assert.equal(legacyDuplicateGroups, LEGACY_EXPECTED.groups);
assert.equal(v2DuplicatePositions, 0);
assert.equal(v2DuplicateGroups, 0);
assert.equal(unprojectableActions, 0);
assert.equal(actionSetMismatches, 0);
assert.equal(privacyFailures, 0);

const result = {
    matrixHash: matrix.matrixHash,
    positionsReviewed,
    actionsReviewed,
    legacyDuplicatePositions,
    legacyDuplicateGroups,
    v2DuplicatePositions,
    v2DuplicateGroups,
    unprojectableActions,
    actionSetMismatches,
    privacyFailures,
    modelInputBytes: { v1: distribution(v1Bytes), v2: distribution(v2Bytes) },
    examples
};
const artifact = { ...result, reviewHash: hashCanonical(result) };
const serialized = JSON.stringify(artifact) + "\n";
const path = "tests/fixtures/demo-matrix-public-action-review.v2.json";
if (process.argv.includes("--check")) assert.equal(readFileSync(path, "utf8"), serialized);
else writeFileSync(path, serialized);
console.log(JSON.stringify(artifact));
