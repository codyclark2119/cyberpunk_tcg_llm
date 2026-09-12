import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { hashCanonical } from "@tcg/domain";
import { applicableFightPreventions } from "../packages/engine/src/fight-prevention";
import { coordinateId, type MatrixCoordinate } from "../tests/demo-matrix-config";
import type { MatrixTrace } from "../tests/demo-matrix-metrics";
// Trusted post-run coverage audit. No new simulation, policy selection or model input.
const matrix: { matrixHash: string; records: { coordinate: MatrixCoordinate; finalHash: string }[] } = JSON.parse(readFileSync("tests/fixtures/demo-match-matrix-reboot.v1.json", "utf8"));
const records = matrix.records.map(record => {
    const coordinate = coordinateId(record.coordinate);
    const trace: MatrixTrace = JSON.parse(readFileSync(`/tmp/tcg-reboot-model-a-traces/${coordinate}.json`, "utf8"));
    assert.equal(trace.finalStateHash, record.finalHash);
    let state = trace.initialized.state, additionalRegistrations = 0, multiConsumptionFights = 0, redundantConsumptionFights = 0, multiExpiryBoundaries = 0, pluralProofStates = 0, maxOutstanding = 0;
    for (const [i, step] of trace.steps.entries()) {
        const before = state.fightPreventions ?? [], after = step.state.fightPreventions ?? [];
        const consumed = step.events.flatMap(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED" ? [e.payload] : []);
        const expired = step.events.flatMap(e => e.payload.kind === "FIGHT_PREVENTION_EXPIRED" ? [e.payload] : []);
        const prevented = step.events.flatMap(e => e.payload.kind === "FIGHT_DEFEAT_PREVENTED" ? [e.payload.cardInstanceId] : []);
        if (before.length && step.events.some(e => e.payload.kind === "FIGHT_PREVENTION_CREATED")) additionalRegistrations++;
        maxOutstanding = Math.max(maxOutstanding, before.length, after.length);
        if (consumed.length) {
            assert.deepEqual(consumed.map(e => e.effectId), applicableFightPreventions(state).map(e => e.id).sort(), `${coordinate} consumption ${i}`);
            assert.ok(consumed.every(e => !after.some(a => a.id === e.effectId)), `${coordinate} consumed occurrence retained ${i}`);
            assert.equal(new Set(prevented).size, prevented.length, `${coordinate} duplicate prevented defeat ${i}`);
            if (consumed.length > 1) { multiConsumptionFights++; if (!prevented.length) redundantConsumptionFights++; }
        }
        if (expired.length > 1) {
            assert.deepEqual(expired.map(e => e.effectId), before.map(e => e.id).sort());
            assert.ok(expired.every(e => !after.some(a => a.id === e.effectId)));
            multiExpiryBoundaries++;
        }
        if (step.state.resolution.defeatContinuation?.appliedPreventions) pluralProofStates++;
        state = step.state;
    }
    return { coordinate, branch: record.coordinate.branch, additionalRegistrations, multiConsumptionFights, redundantConsumptionFights, multiExpiryBoundaries, pluralProofStates, maxOutstanding };
});
function totals(branch: "base" | "variant") {
    const selected = records.filter(r => r.branch === branch);
    const sum = (key: "additionalRegistrations" | "multiConsumptionFights" | "redundantConsumptionFights" | "multiExpiryBoundaries" | "pluralProofStates") => selected.reduce((n, r) => n + r[key], 0);
    return { games: selected.length, gamesWithOverlap: selected.filter(r => r.maxOutstanding > 1).length, additionalRegistrations: sum("additionalRegistrations"), multiConsumptionFights: sum("multiConsumptionFights"), redundantConsumptionFights: sum("redundantConsumptionFights"), multiExpiryBoundaries: sum("multiExpiryBoundaries"), pluralProofStates: sum("pluralProofStates"), maxOutstanding: Math.max(0, ...selected.map(r => r.maxOutstanding)) };
}
assert.ok(records.find(r => r.coordinate === "base-demo-matrix-003-A-FIRST-KK")!.multiConsumptionFights > 0, "Exact primary overlap fight must be included");
const identity = { schemaVersion: 1, matrixHash: matrix.matrixHash, base: totals("base"), variant: totals("variant"), records };
const result = { ...identity, reviewHash: hashCanonical(identity) }, path = "tests/fixtures/reboot-multiplicity-matrix-review.v1.json", serialized = JSON.stringify(result) + "\n";
if (process.argv.includes("--check")) assert.equal(readFileSync(path, "utf8"), serialized); else writeFileSync(path, serialized);
console.log(JSON.stringify({ base: result.base, variant: result.variant, reviewHash: result.reviewHash }));
