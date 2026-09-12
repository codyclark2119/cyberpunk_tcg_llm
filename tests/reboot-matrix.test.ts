import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { hashCanonical } from "@tcg/domain";
import { DEMO_MATRIX_CONFIG, matrixCoordinates } from "./demo-matrix-config";
import { engineIdentity } from "../scripts/engine-identity";
import acceptance from "./fixtures/reboot-multiplicity-acceptance.v1.json";
const matrix = z.object({ schemaVersion: z.literal(1), matrixHash: z.string(), config: z.unknown(), policyHash: z.string(), records: z.array(z.object({ coordinate: z.object({ seed: z.string(), seats: z.enum(["A", "B"]), branch: z.enum(["base", "variant"]), chooseFirstOrSecond: z.enum(["FIRST", "SECOND"]), mulligan: z.tuple([z.boolean(), z.boolean()]) }), status: z.string(), finalHash: z.string(), actions: z.number(), pins: z.object({ engine: z.object({ version: z.string(), artifactHash: z.string() }) }).passthrough() }).passthrough()), setupAudit: z.array(z.unknown()), unattempted: z.object({ base: z.number(), variant: z.number() }).passthrough() }).passthrough().parse(JSON.parse(readFileSync("tests/fixtures/demo-match-matrix-reboot.v1.json", "utf8")));
const review = z.object({ matrixHash: z.string(), reviewHash: z.string(), base: z.object({ games: z.number(), gamesWithOverlap: z.number(), multiConsumptionFights: z.number(), multiExpiryBoundaries: z.number() }).passthrough() }).passthrough().parse(JSON.parse(readFileSync("tests/fixtures/reboot-multiplicity-matrix-review.v1.json", "utf8")));

test("successor matrix pins the unchanged schedule/policy and separates base, variants and setup audits", () => {
    const { matrixHash, ...identity } = matrix;
    assert.equal(hashCanonical(identity), matrixHash);
    assert.deepEqual(matrix.config, DEMO_MATRIX_CONFIG);
    assert.equal(matrix.policyHash, hashCanonical(["tests/demo-match-policy.ts", "tests/demo-matrix-policy.ts"].map(p => readFileSync(p, "utf8"))));
    const base = matrix.records.filter(r => r.coordinate.branch === "base"), variants = matrix.records.filter(r => r.coordinate.branch === "variant");
    assert.equal(base.length, 64); assert.ok(base.every(r => r.status === "SUPPORTED_TERMINAL"));
    assert.deepEqual(base.map(r => r.coordinate), matrixCoordinates("base"));
    assert.deepEqual(variants.map(r => r.coordinate), matrixCoordinates("variant").slice(0, variants.length));
    assert.equal(matrix.unattempted.base, 0); assert.equal(matrix.unattempted.variant, 128 - variants.length);
    assert.equal(matrix.setupAudit.length, 16);
    const engine = engineIdentity();
    for (const record of matrix.records) assert.deepEqual(record.pins.engine, engine);
    if (variants.length < 128) assert.notEqual(variants.at(-1)!.status, "SUPPORTED_TERMINAL", "A partial branch must end at its reported stop condition");
});

test("all three original coordinates match their positive continuations and matrix multiplicity audit", () => {
    for (const record of acceptance.records) {
        const actual = matrix.records.find(r => r.coordinate.branch === record.coordinate.branch && r.coordinate.seed === record.coordinate.seed && r.coordinate.seats === record.coordinate.seats && r.coordinate.chooseFirstOrSecond === record.coordinate.chooseFirstOrSecond && hashCanonical(r.coordinate.mulligan) === hashCanonical(record.coordinate.mulligan))!;
        assert.ok(actual); assert.equal(actual.status, "SUPPORTED_TERMINAL");
        assert.equal(actual.finalHash, record.summary.finalHash); assert.equal(actual.actions, record.summary.actions);
    }
    const { reviewHash, ...identity } = review;
    assert.equal(hashCanonical(identity), reviewHash); assert.equal(review.matrixHash, matrix.matrixHash);
    assert.equal(review.base.games, 64); assert.ok(review.base.gamesWithOverlap >= 3);
    assert.ok(review.base.multiConsumptionFights > 0); assert.ok(review.base.multiExpiryBoundaries > 0);
});
