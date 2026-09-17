import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Sequential local mutation review. Never stage/commit/reset files or write golden outputs.
// Keep other tests, generators, editors and matrix jobs stopped for this command.
const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const tests = ["tests/api-admission-batch-v4.test.ts", "tests/api-admission-batch-v4-cross-mechanics.test.ts", "tests/api-admission-batch-v4-lifecycle.test.ts", "tests/api-admission-batch-v4-negative.test.ts", "tests/api-admission-batch-v4-evidence.test.ts"];
const prefix = "packages/engine/src/";
const negative = tests[3], cross = tests[1], lifetime = tests[2];
const mutants = [
    { name: "amount admission", path: `${prefix}friendly-play-power-support.ts`, old: " || a.effects[0].amount !== 2", replacement: "", file: negative, test: "V4: amount mutation cannot broaden the reviewed semantic gate", marker: "V4_AMOUNT_GATE" },
    { name: "reviewed provenance", path: `${prefix}friendly-play-power-support.ts`, old: " || !card.provenance.reviewed", replacement: "", file: negative, test: "V4: provenance mutation cannot admit an unreviewed revision", marker: "V4_PROVENANCE_GATE" },
    { name: "extra modifier admission", path: `${prefix}friendly-play-power-support.ts`, old: " || m.modifiers.length", replacement: "", file: negative, test: "V4: extra modifiers cannot slip through the friendly PLAY gate", marker: "V4_EXTRA_MECHANIC" },
    { name: "scheduler dependency", path: `${prefix}friendly-play-power-support.ts`, old: '        && policy.combatTriggers === "COMBAT_TRIGGERS_V1"\n', replacement: "", file: negative, test: "V4: the scheduler dependency is tested independently of unrelated failures", marker: "V4_SCHEDULER_DEPENDENCY" },
    { name: "friendly target relation", path: `${prefix}friendly-play-power-queries.ts`, old: 'card.controllerId === actor && card.zone.playerId === actor\n            && ', replacement: "", file: negative, test: "V4: target relation rejects an otherwise eligible rival Unit", marker: "V4_TARGET_RELATION" },
    { name: "modifier application", path: `${prefix}temporary-power.ts`, old: "    (m.state.temporaryModifiers ??= []).push(modifier);", replacement: "    if (modifier.amount === 2) return success(null);\n    (m.state.temporaryModifiers ??= []).push(modifier);", file: cross, test: "V4: paid friendly PLAY changes effective power without changing printed data", marker: "V4_POWER_APPLICATION" },
    { name: "additive occurrence storage", path: `${prefix}temporary-power.ts`, old: "    (m.state.temporaryModifiers ??= []).push(modifier);", replacement: "    m.state.temporaryModifiers = [modifier];", file: cross, test: "V4: two paid Jonins stack on one physical target", marker: "V4_STACKING" },
    { name: "duplicate occurrence rejection", path: `${prefix}temporary-power.ts`, old: '    if (m.state.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");', replacement: "    // mutation: duplicate application allowed", file: negative, test: "V4: duplicate reducer application is rejected", marker: "V4_DUPLICATE_OCCURRENCE" },
    { name: "hidden-entry wiring", path: `${prefix}card-movement.ts`, old: '    if (zone === "HAND") expirePowerOnHiddenEntry(m, id);', replacement: "    // mutation: omit hidden-entry expiry wiring", file: lifetime, test: "V4: actual target-to-Hand movement expires exactly its occurrence and preserves privacy", marker: "V4_HIDDEN_EXPIRY" },
    { name: "turn-end expiry", path: `${prefix}temporary-power.ts`, old: "    delete m.state.temporaryModifiers;\n}\n/** 5.3.2.2", replacement: "    // mutation: retain turn modifiers\n}\n/** 5.3.2.2", file: lifetime, test: "V4: real END_TURN expires +2 exactly once before the next turn", marker: "V4_TURN_EXPIRY" }
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]).sort(); }
const protectedPaths = () => ["packages/domain/src", "packages/engine/src", "packages/wire/src", "packages/wire/schemas", "tests/fixtures"].flatMap(path => files(join(root, path)))
    .concat(["scripts/engine-worker.ts", "scripts/engine-identity.ts", "package-lock.json"].map(path => join(root, path))).sort();
const fingerprint = () => hash(JSON.stringify(protectedPaths().map(path => [relative(root, path), hash(readFileSync(path))])));
const lock = join(tmpdir(), `tcg-v4-mutations-${hash(Buffer.from(root)).slice(0, 20)}.lock`);
try { mkdirSync(lock); }
catch (error) { throw new Error(`Mutation lock exists or cannot be acquired: ${lock}. Inspect any interrupted run before removing it.`, { cause: error }); }
const output = mkdtempSync(join(tmpdir(), "tcg-v4-mutation-results-"));
const originals = new Map();
const report = { schemaVersion: 1, head: null, result: "INCOMPLETE", baseline: null, mutants: [], restored: false, protectedFilesUnchanged: false };
let active, interrupted = false;
const stop = () => { interrupted = true; active?.kill("SIGTERM"); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
function restore() {
    for (const [path, bytes] of originals) writeFileSync(join(root, path), bytes);
    for (const [path, bytes] of originals) assert.ok(readFileSync(join(root, path)).equals(bytes), `Could not restore ${path}`);
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function run(files, pattern, name) {
    if (interrupted) throw new Error("Mutation run interrupted");
    const args = ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...(pattern ? [`--test-name-pattern=^${escape(pattern)}$`] : []), ...files];
    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        active = child;
        const chunks = []; let size = 0, infrastructure = null;
        const timer = setTimeout(() => { infrastructure = "test timeout"; child.kill("SIGKILL"); }, 120_000);
        const collect = chunk => { size += chunk.length; if (size > 64 * 1024 * 1024) { infrastructure = "test output limit"; child.kill("SIGKILL"); } else chunks.push(chunk); };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        child.on("error", error => { clearTimeout(timer); active = undefined; reject(error); });
        child.on("close", (code, signal) => { clearTimeout(timer); active = undefined; resolve({ code, signal, infrastructure, text: Buffer.concat(chunks).toString("utf8") }); });
    });
    writeFileSync(join(output, `${name}.tap`), result.text);
    assert.equal(result.infrastructure, null, `${name}: infrastructure failure (not a caught mutant)`);
    assert.equal(result.signal, null, `${name}: signal failure (not a caught mutant)`);
    assert.equal(interrupted, false, "Mutation run interrupted");
    return result;
}
let before;
try {
    for (const path of new Set(mutants.map(m => m.path))) {
        const bytes = readFileSync(join(root, path)); originals.set(path, bytes);
        const backup = join(output, "originals", path); mkdirSync(join(backup, ".."), { recursive: true }); writeFileSync(backup, bytes);
    }
    before = fingerprint();
    if (existsSync(join(root, ".git"))) report.head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const baseline = await run(tests, null, "baseline");
    assert.equal(baseline.code, 0, "Baseline must pass before applying any mutation");
    assert.match(baseline.text, /# skipped 0/); assert.match(baseline.text, /# todo 0/);
    report.baseline = { result: "PASS", tests: Number(baseline.text.match(/# tests (\d+)/)?.[1]) };
    for (const [index, mutant] of mutants.entries()) {
        restore();
        const original = originals.get(mutant.path).toString("utf8");
        assert.equal(original.split(mutant.old).length - 1, 1, `${mutant.name}: exact unique source anchor required`);
        try {
            writeFileSync(join(root, mutant.path), original.replace(mutant.old, mutant.replacement));
            const result = await run([mutant.file], mutant.test, `mutant-${index + 1}`);
            const caught = result.code === 1 && new RegExp(`^not ok \\d+ - ${escape(mutant.test)}\\s*$`, "m").test(result.text)
                && result.text.includes("ERR_ASSERTION") && result.text.includes(mutant.marker);
            report.mutants.push({ name: mutant.name, expectedTest: mutant.test, assertionMarker: mutant.marker, result: caught ? "CAUGHT" : "NOT_PROVEN" });
            assert.ok(caught, `${mutant.name}: must fail the named behavioral assertion, not setup/import/hash/timeout`);
            console.log(`CAUGHT ${mutant.name}`);
        } finally { restore(); }
    }
    assert.equal(fingerprint(), before, "Runtime/schema/fixture files changed during mutation tests");
    const final = await run(tests, null, "restored-baseline");
    assert.equal(final.code, 0, "Restored baseline must be green");
    report.result = "PASS";
} catch (error) {
    report.result = "FAIL"; report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    try {
        restore(); report.restored = true;
        report.protectedFilesUnchanged = before !== undefined && fingerprint() === before;
        if (!report.protectedFilesUnchanged) { report.result = "FAIL"; process.exitCode = 1; }
    } catch (error) { report.result = "RESTORE_FAILED"; report.restoreError = String(error); process.exitCode = 1; }
    writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    rmSync(lock, { recursive: true }); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
}
console.log(JSON.stringify({ ...report, reportDirectory: output }, null, 2));
// SIGKILL/power loss cannot execute finally. Byte backups remain under reportDirectory/originals;
// a leftover lock requires inspection and explicit restoration, never an automatic git reset.
