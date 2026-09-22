import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * Require a complete successful Node 22 TAP footer, not isolated matching lines.
 * The top-level plan can be smaller than the test total when there are subtests.
 * This checks execution evidence; the shell must ALSO preserve the test exit code.
 */
export function assertSuccessfulTap(text, minimumTests = 1) {
  assert.equal(typeof text, "string", "TAP report must be text");
  assert.ok(Number.isSafeInteger(minimumTests) && minimumTests > 0,
    "minimumTests must be a positive safe integer");
  const report = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
  const footer = report.match(
    /(?:^|\n)1\.\.(\d+)\n# tests (\d+)\n# suites (\d+)\n# pass (\d+)\n# fail (\d+)\n# cancelled (\d+)\n# skipped (\d+)\n# todo (\d+)\n# duration_ms (\d+(?:\.\d+)?)$/,
  );
  assert.ok(footer, "Missing or incomplete final Node TAP summary");
  const keys = ["plan", "tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];
  const summary = Object.fromEntries(keys.map((key, index) => [key, Number(footer[index + 1])]));
  assert.ok(Object.values(summary).every(value => Number.isSafeInteger(value) && value >= 0),
    "TAP counters must be nonnegative safe integers");
  assert.ok(summary.plan > 0 && summary.plan <= summary.tests, "Invalid or empty TAP plan");
  assert.ok(summary.tests >= minimumTests,
    `Expected at least ${minimumTests} executed tests; saw ${summary.tests}`);
  for (const key of ["fail", "cancelled", "skipped", "todo"]) {
    assert.equal(summary[key], 0, `TAP ${key} must be zero`);
  }
  assert.equal(summary.pass, summary.tests, "Every test must actually pass");
  assert.doesNotMatch(report, /^\s*(?:not ok\b|Bail out!)/im,
    "A failed test or TAP bailout cannot be hidden by a successful footer");
  // Concatenating old and new run output must not satisfy the gate accidentally.
  assert.equal([...report.matchAll(/^# tests \d+$/gm)].length, 1,
    "Expected exactly one run's top-level summary");
  return { schemaVersion: 1, result: "PASS", ...summary };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      options: { "minimum-tests": { type: "string", default: "1" } },
      allowPositionals: true,
    });
    assert.equal(positionals.length, 1,
      "Usage: node .github/scripts/assert-test-summary.mjs REPORT [--minimum-tests N]");
    const result = assertSuccessfulTap(readFileSync(positionals[0], "utf8"), Number(values["minimum-tests"]));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
