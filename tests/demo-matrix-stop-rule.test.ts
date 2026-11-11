import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_MATRIX_CONFIG, matrixCoordinates } from "./demo-matrix-config";
import { MatrixStopRule, unattemptedCounts } from "../scripts/lib/demo-matrix-run";
import { REPLAY_FIXTURES } from "../scripts/lib/replay-registry";

test("matrix stop rule stops at once on a non-known failure", () => {
    const rule = new MatrixStopRule();
    assert.equal(rule.afterCoordinate(null), false);
    assert.equal(rule.afterCoordinate({ classification: "ENGINE_ERROR", code: "X" }), true);
    assert.equal(rule.stopped, true);
});

test("matrix stop rule confirms the same known gap before stopping", () => {
    const rule = new MatrixStopRule(), n = DEMO_MATRIX_CONFIG.stop.sameKnownGapConfirmations;
    for (let i = 1; i < n; i++) assert.equal(rule.afterCoordinate({ classification: "KNOWN_UNSUPPORTED", code: "GAP" }), false);
    assert.equal(rule.afterCoordinate({ classification: "KNOWN_UNSUPPORTED", code: "OTHER" }), false);
    assert.equal(rule.afterCoordinate({ classification: "KNOWN_UNSUPPORTED", code: "GAP" }), true);
});

test("matrix stop rule runs variants only after a fully supported base", () => {
    assert.equal(new MatrixStopRule().afterBranch("base", ["SUPPORTED_TERMINAL", "SUPPORTED_TERMINAL"]), false);
    assert.equal(new MatrixStopRule().afterBranch("base", ["SUPPORTED_TERMINAL", "KNOWN_UNSUPPORTED"]), true);
    assert.equal(new MatrixStopRule().afterBranch("variant", ["KNOWN_UNSUPPORTED"]), false);
});

test("unattempted counts derive from the matrix coordinates", () => {
    const base = matrixCoordinates("base"), variant = matrixCoordinates("variant");
    assert.deepEqual(unattemptedCounts([], false), { base: base.length, variant: variant.length, reason: null });
    assert.deepEqual(unattemptedCounts([...base, ...variant], false), { base: 0, variant: 0, reason: null });
    assert.deepEqual(unattemptedCounts(base.slice(0, 5), true), { base: base.length - 5, variant: variant.length, reason: "STOP_RULE_REACHED; no skipped attempted coordinates" });
});

test("replay registry names and outputs are unique fixture paths", () => {
    assert.equal(new Set(REPLAY_FIXTURES.map(f => f.name)).size, REPLAY_FIXTURES.length);
    assert.equal(new Set(REPLAY_FIXTURES.map(f => f.output)).size, REPLAY_FIXTURES.length);
    for (const f of REPLAY_FIXTURES) assert.match(f.output, /^tests\/fixtures\/[a-z0-9-]+\.v1\.json$/);
});
