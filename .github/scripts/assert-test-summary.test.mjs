import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertSuccessfulTap } from "./assert-test-summary.mjs";

const cli = fileURLToPath(new URL("./assert-test-summary.mjs", import.meta.url));
function tap(overrides = {}) {
  const counts = { plan: 12, tests: 12, suites: 0, pass: 12, fail: 0,
    cancelled: 0, skipped: 0, todo: 0, ...overrides };
  return "TAP version 13\n" + `1..${counts.plan}\n` +
    Object.entries(counts).filter(([key]) => key !== "plan")
      .map(([key, value]) => `# ${key} ${value}\n`).join("") + "# duration_ms 12.34\n";
}

test("complete nonempty Node TAP report passes at the integration floor", () => {
  assert.deepEqual(assertSuccessfulTap(tap(), 12), {
    schemaVersion: 1, result: "PASS", plan: 12, tests: 12, suites: 0,
    pass: 12, fail: 0, cancelled: 0, skipped: 0, todo: 0,
  });
});

test("subtests can make the test total larger than the top-level plan", () => {
  assert.equal(assertSuccessfulTap(tap({ plan: 56, tests: 78, pass: 78 })).tests, 78);
});

test("npm preamble, BOM and CRLF do not hide a valid report", () => {
  const report = "\uFEFF> package test\n> node --test\n\n" + tap().replace(/\n/g, "\r\n");
  assert.equal(assertSuccessfulTap(report).result, "PASS");
});

for (const [name, report] of [
  ["zero tests", tap({ plan: 0, tests: 0, pass: 0 })],
  ["all skipped with exit zero", tap({ pass: 0, skipped: 12 })],
  ["one skipped", tap({ pass: 11, skipped: 1 })],
  ["one failure", tap({ pass: 11, fail: 1 })],
  ["one cancellation", tap({ pass: 11, cancelled: 1 })],
  ["one todo", tap({ pass: 11, todo: 1 })],
  ["inconsistent pass count", tap({ pass: 11 })],
  ["plan larger than test count", tap({ plan: 13 })],
  ["unsafe integer", tap({ tests: "9007199254740993", pass: "9007199254740993" })],
  ["negative count", tap({ skipped: -1 })],
  ["truncated before final duration", tap().replace(/# duration_ms[^\n]*\n$/, "")],
  ["missing skipped counter", tap().replace("# skipped 0\n", "")],
  ["isolated grep-friendly lines", "# tests 12\n# fail 0\n# skipped 0\n"],
  ["failed test before good footer", "not ok 1 - broken\n" + tap()],
  ["nested failed test before good footer", "    not ok 1 - broken child\n" + tap()],
  ["bailout before good footer", "Bail out! crashed\n" + tap()],
  ["old successful run followed by partial run", tap() + "TAP version 13\nok 1 - incomplete\n"],
  ["two concatenated complete runs", tap() + tap()],
]) {
  test(`rejects ${name}`, () => assert.throws(() => assertSuccessfulTap(report)));
}

test("integration floor rejects a partial suite even when everything selected passed", () => {
  assert.throws(() => assertSuccessfulTap(tap({ plan: 6, tests: 6, pass: 6 }), 12), /at least 12/);
});

for (const minimum of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid minimum ${minimum} fails closed`, () => {
    assert.throws(() => assertSuccessfulTap(tap(), minimum), /positive safe integer/);
  });
}

test("CLI returns the correct exit status for good, skipped and missing input", () => {
  const dir = mkdtempSync(join(tmpdir(), "tcg-ci-summary-"));
  try {
    const path = join(dir, "report.tap");
    writeFileSync(path, tap());
    const good = spawnSync(process.execPath, [cli, path, "--minimum-tests", "12"], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).tests, 12);
    writeFileSync(path, tap({ pass: 0, skipped: 12 }));
    const skipped = spawnSync(process.execPath, [cli, path], { encoding: "utf8" });
    assert.equal(skipped.status, 1);
    assert.match(skipped.stderr, /skipped must be zero/);
    assert.equal(spawnSync(process.execPath, [cli, join(dir, "missing.tap")]).status, 1);
    assert.equal(spawnSync(process.execPath, [cli]).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard accepts actual Node output and rejects an actual exit-zero skipped run", () => {
  const dir = mkdtempSync(join(tmpdir(), "tcg-ci-node-"));
  try {
    const path = join(dir, "probe.test.mjs");
    // A nested Node runner must not inherit the parent runner's IPC mode.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    writeFileSync(path, 'import test from "node:test"; test("parent", async t => { await t.test("child", () => {}); });\n');
    const passing = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path], { encoding: "utf8", env });
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(assertSuccessfulTap(passing.stdout).tests, 2);
    writeFileSync(path, 'import test from "node:test"; test("skipped", { skip: true }, () => {});\n');
    const skipping = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path], { encoding: "utf8", env });
    assert.equal(skipping.status, 0, skipping.stderr);
    assert.throws(() => assertSuccessfulTap(skipping.stdout), /skipped must be zero/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pipefail rejects a nonzero test process even if it printed a passing footer", () => {
  const dir = mkdtempSync(join(tmpdir(), "tcg-ci-pipefail-"));
  try {
    const result = spawnSync("bash", ["-c", `set -euo pipefail
"$NODE" -e 'process.stdout.write(process.env.REPORT); process.exit(7)' | tee "$REPORT_FILE"
"$NODE" "$GUARD" "$REPORT_FILE"`], {
      encoding: "utf8",
      env: { ...process.env, NODE: process.execPath, REPORT: tap(),
        REPORT_FILE: join(dir, "report.tap"), GUARD: cli },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.doesNotMatch(result.stdout, /"result": "PASS"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// This is a policy regression guard, not a replacement for a YAML/action linter.
// Pin the unconditional execution boundary and reject the old selector machinery.
const workflow = readFileSync(new URL("../workflows/pr-validation.yml", import.meta.url), "utf8");
function assertFullWorkflow(source) {
  assert.match(source, /^on:\n  pull_request:\n  push:\n    branches: \[master\]\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(source, /^\s*(?:paths|paths-ignore|branches-ignore|continue-on-error):/m);
  assert.doesNotMatch(source, /baseline_regex|needs\.scope|mapfile -t tests|No changed top-level test files/);
  const jobs = source.split(/^jobs:\n/m)[1];
  assert.ok(jobs, "jobs must exist");
  assert.deepEqual([...jobs.matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]), ["validate", "integration", "ai"]);
  assert.doesNotMatch(jobs, /^    (?:if|needs|continue-on-error|strategy|uses):/m,
    "Full jobs must not depend on scope, another job, or a conditional");
  for (const name of ["Full unit suite with execution evidence", "Run integration tests with zero skips"]) {
    const marker = `      - name: ${name}\n`;
    const start = jobs.indexOf(marker);
    assert.ok(start >= 0, `${name} must exist`);
    const step = jobs.slice(start + marker.length).split(/^      - name:/m)[0];
    assert.doesNotMatch(step, /^\s*(?:if|continue-on-error):/m);
    assert.doesNotMatch(step, /\|\|\s*true/);
    assert.match(step, /set -euo pipefail/);
    assert.match(step, /node \.github\/scripts\/assert-test-summary\.mjs/);
  }
  assert.match(jobs, /^          npm test 2>&1 \| tee "\$RUNNER_TEMP\/pr-validation-unit\.tap"$/m);
  assert.match(jobs, /^          npm run test:integration 2>&1 \| tee "\$RUNNER_TEMP\/pr-validation-integration\.tap"$/m);
  assert.match(jobs, /assert-test-summary\.mjs "\$RUNNER_TEMP\/pr-validation-integration\.tap" --minimum-tests 12/);
  assert.match(jobs, /TEST_DATABASE_URL: postgresql:/);
  assert.match(jobs, /TEST_MONGODB_URI: mongodb:/);
  for (const command of [
    "python scripts/test_cyberpunk.py",
    "python scripts/test_harness_core.py",
    "python scripts/test_engine_candidates.py",
    "python scripts/check_deck_rules.py --negative-control",
    "python scripts/test_engine_adapter.py --app-root .",
  ]) assert.ok(jobs.includes(command), `${command} must remain in full CI`);
}

test("workflow executes complete suites without any changed-path selector", () => assertFullWorkflow(workflow));

for (const [name, transform] of [
  ["runtime/helper-only skip via scope", source => source.replace("  integration:\n", "  integration:\n    if: needs.scope.outputs.baseline == 'true'\n")],
  ["schema-only skip via path filter", source => source.replace("  pull_request:\n", "  pull_request:\n    paths: ['tests/fixtures/**']\n")],
  ["conditional full-unit step", source => source.replace("      - name: Full unit suite with execution evidence\n", "      - name: Full unit suite with execution evidence\n        if: false\n")],
  ["weakened integration minimum", source => source.replace("--minimum-tests 12", "--minimum-tests 1")],
  ["loss of pipefail", source => source.replaceAll("set -euo pipefail", "set -eu")],
  ["suppressed unit failure", source => source.replace('npm test 2>&1', 'npm test || true 2>&1')],
]) {
  test(`workflow guard detects ${name}`, () => assert.throws(() => assertFullWorkflow(transform(workflow))));
}
