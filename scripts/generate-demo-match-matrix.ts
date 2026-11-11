// Run the Demo match matrix and write (or --check) its committed artifacts.
//
// DEMO_MATRIX_CONCURRENCY (1-8, default 1) runs coordinates in that many child
// processes; DEMO_MATRIX_TRACE_DIR moves the full traces (default
// /tmp/tcg-reboot-model-a-traces). Both paths feed coordinates, in matrix
// order, through the same stop rule and result assembly, and both assemble
// from the trace as stored on disk, so their output is identical.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { hashCanonical } from "@tcg/domain";
import { DEMO_MATRIX_CONFIG, matrixCoordinates, coordinateId, type MatrixCoordinate } from "../tests/demo-matrix-config";
import { demoMatrixReplay } from "../tests/demo-matrix-replay";
import { summarizeMatrixTrace, aggregateMatrix, type MatrixSummary, type MatrixTrace } from "../tests/demo-matrix-metrics";
import { demoStarterContext } from "../tests/demo-starter-fixture";
import { compactArtifactWriter, matrixTraceDir, matrixTracePath, repoPath } from "./lib/generated-artifacts";
import { MATRIX_BRANCHES, MatrixStopRule, unattemptedCounts } from "./lib/demo-matrix-run";

const directory = matrixTraceDir({ create: true });
const check = process.argv.includes("--check");
const artifact = compactArtifactWriter(check);
const policyHash = hashCanonical(["tests/demo-match-policy.ts", "tests/demo-matrix-policy.ts"].map(p => readFileSync(repoPath(p), "utf8")));
const concurrency = Math.max(1, Math.min(8, Number.parseInt(process.env.DEMO_MATRIX_CONCURRENCY ?? "1", 10) || 1));
const context = demoStarterContext(), bundleBefore = hashCanonical(context.content);

type CoordinateRun = { trace: MatrixTrace; elapsedMs: number; rssBytes: number };
/** Produces coordinate runs by index, in any order the consumer asks; `close` abandons the rest. */
interface CoordinateSource { run(index: number): Promise<CoordinateRun>; close(): Promise<void> }

const readTrace = (coordinate: MatrixCoordinate) => JSON.parse(readFileSync(matrixTracePath(coordinateId(coordinate)), "utf8")) as MatrixTrace;

function serialSource(coordinates: readonly MatrixCoordinate[]): CoordinateSource {
    return {
        async run(index) {
            const coordinate = coordinates[index], start = performance.now();
            const trace = demoMatrixReplay(coordinate, { context }), elapsedMs = performance.now() - start;
            writeFileSync(matrixTracePath(coordinateId(coordinate)), JSON.stringify(trace));
            // Assemble from the stored trace, exactly as the parallel path does.
            return { trace: readTrace(coordinate), elapsedMs, rssBytes: process.memoryUsage().rss };
        },
        async close() {}
    };
}

function parallelSource(coordinates: readonly MatrixCoordinate[]): CoordinateSource {
    const settled = coordinates.map(() => {
        let resolve!: () => void, reject!: (error: unknown) => void;
        const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
        promise.catch(() => {}); // Observed by run(); an abandoned index must not become an unhandled rejection.
        return { promise, resolve, reject };
    });
    let next = 0, closed = false;
    const runChild = (coordinate: MatrixCoordinate) => new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", repoPath("scripts/generate-demo-match-matrix-coordinate.ts"), JSON.stringify(coordinate)], {
            cwd: repoPath("."), env: { ...process.env, DEMO_MATRIX_TRACE_DIR: directory }, stdio: ["ignore", "ignore", "inherit"]
        });
        child.once("error", reject);
        child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Matrix coordinate ${coordinateId(coordinate)} exited ${code}`)));
    });
    async function worker() {
        // Indices are claimed in matrix order, so the consumer's next index is always running or done.
        while (!closed && next < coordinates.length) {
            const index = next++;
            try { await runChild(coordinates[index]); settled[index].resolve(); }
            catch (error) { closed = true; settled[index].reject(error); }
        }
    }
    const workers = Promise.all(Array.from({ length: Math.min(concurrency, coordinates.length) }, () => worker()));
    return {
        async run(index) {
            await settled[index].promise;
            const coordinate = coordinates[index];
            const runtime = JSON.parse(readFileSync(`${directory}/${coordinateId(coordinate)}.runtime.json`, "utf8")) as { elapsedMs: number; rssBytes: number };
            return { trace: readTrace(coordinate), elapsedMs: runtime.elapsedMs, rssBytes: runtime.rssBytes };
        },
        async close() { closed = true; await workers; }
    };
}

async function main() {
    const summaries: MatrixSummary[] = [], runtimeMetrics: { coordinate: string; elapsedMs: number; actionsPerSecond: number; rssBytes: number }[] = [];
    const promotions: { family: string; coordinate: string; purpose: string; actions: number; bytes: number }[] = [];
    const stopRule = new MatrixStopRule();
    function promote(family: string, trace: MatrixTrace, purpose: string) {
        if (promotions.some(p => p.family === family)) return;
        const bytes = artifact(`tests/fixtures/${family}.v1.json`, trace);
        promotions.push({ family, coordinate: coordinateId(trace.coordinate), purpose, actions: trace.steps.length, bytes });
    }

    for (const branch of MATRIX_BRANCHES) {
        if (stopRule.stopped) break;
        const coordinates = matrixCoordinates(branch);
        const source = concurrency > 1 ? parallelSource(coordinates) : serialSource(coordinates);
        try {
            for (const [index, coordinate] of coordinates.entries()) {
                const { trace, elapsedMs, rssBytes } = await source.run(index);
                assert.deepEqual(trace.coordinate, coordinate, `trace for ${coordinateId(coordinate)}`);
                const summary = summarizeMatrixTrace(trace); summaries.push(summary);
                runtimeMetrics.push({ coordinate: coordinateId(coordinate), elapsedMs, actionsPerSecond: trace.steps.length / (elapsedMs / 1000), rssBytes });
                assert.equal(hashCanonical(trace.content), bundleBefore);
                console.log(JSON.stringify({ coordinate: coordinateId(coordinate), status: summary.status, actions: summary.actions, positions: summary.positions, turn: summary.turns, terminal: summary.terminal?.reason, failure: summary.failure?.code, elapsedMs }));
                if (summary.terminal?.reason === "EMPTY_DRAW") promote("demo-matrix-empty-draw-replay", trace, "First exact matrix empty-draw terminal");
                if (summary.terminal?.reason === "OVERTIME_GIGS") promote("demo-matrix-overtime-replay", trace, "First exact matrix overtime terminal; also reversed seats");
                if (summary.failure) promote("demo-matrix-successor-gap-replay", trace, "First successor matrix gap; preserve diagnostic prefix without bypassing it");
                if (stopRule.afterCoordinate(trace.failure)) break;
            }
        } finally {
            await source.close();
        }
        stopRule.afterBranch(branch, summaries.map(s => s.status));
    }
    assert.equal(hashCanonical(context.content), bundleBefore);
    // Bounded setup contract checks are separate from match completion statistics. They do not continue beyond setup when expansion is blocked.
    const setupAudit = matrixCoordinates("variant").filter(c => c.seed === DEMO_MATRIX_CONFIG.setupAudit.seed).map(coordinate => {
        const trace = demoMatrixReplay(coordinate, { setupOnly: true, context }); assert.equal(trace.failure, null); assert.equal(trace.finalState.setup, undefined);
        const summary = summarizeMatrixTrace(trace); assert.equal(summary.setup.actualFirstSeat, coordinate.chooseFirstOrSecond === "FIRST" ? summary.setup.chooserSeat : 1 - summary.setup.chooserSeat!);
        for (const e of summary.setup.mulligans) if (e.kind === "MULLIGAN_DECLARED") assert.equal(e.accepted, coordinate.mulligan[trace.finalState.players[e.playerId].seat]);
        if (coordinate.seats === "B" && coordinate.chooseFirstOrSecond === "SECOND" && coordinate.mulligan.every(Boolean)) promote("demo-matrix-second-setup-replay", trace, "SECOND chooser, reversed seats, both mulligan; bounded setup-only contract audit");
        return { coordinate, setup: summary.setup, actions: summary.actions, finalHash: summary.finalHash };
    });
    const records = summaries.map(({ samples, ...summary }) => { void samples; return { ...summary, policyHash }; });
    const coverage = aggregateMatrix(summaries);
    const identity = { schemaVersion: 1, config: DEMO_MATRIX_CONFIG, policyHash, records, setupAudit, promotions, unattempted: unattemptedCounts(summaries.map(s => s.coordinate), stopRule.stopped) };
    const matrix = { ...identity, matrixHash: hashCanonical(identity) };
    artifact("tests/fixtures/demo-match-matrix-reboot.v1.json", matrix); artifact("tests/fixtures/demo-match-coverage-reboot.v1.json", coverage);
    // Nondeterministic measurements stay separate from canonical identities and exact regeneration gates.
    writeFileSync(`${directory}/runtime.json`, JSON.stringify(runtimeMetrics, null, 2) + "\n");
    console.log(JSON.stringify({ attempted: coverage.attempted, completed: coverage.completed, classifications: coverage.classifications, matrixHash: matrix.matrixHash, setupAudits: setupAudit.length, promotions, concurrency }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
