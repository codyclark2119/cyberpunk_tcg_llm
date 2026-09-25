import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests exercise shell orchestration only. The actual engine tests,
// generators and full acceptance suite remain mandatory in hosted CI.
const source = readFileSync(new URL("./api-admission-batch-v6-complete.sh", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../workflows/api-admission-batch-v6-complete.yml", import.meta.url), "utf8");
const head = "9644590cb94fb66049e65400280a74eff367916f";
const identity = JSON.stringify({ version: "0.4.0-api-admission-6", artifactHash: "abc123" });
const marker = "docs/api-admission-batch-v6-verification.md";
const stub = `#!/usr/bin/env bash
set -euo pipefail
tool="$(basename "$0")"
printf '%s %s\\n' "$tool" "$*" >> "$CALL_LOG"
case "$tool" in
  git)
    case "$1" in
      rev-parse) printf '%s\\n' "$TEST_HEAD" ;;
      archive) tar -cf - --files-from /dev/null ;;
      status) printf ' M tests/fixtures/replay.json\\n' ;;
      ls-remote) printf '%s\\trefs/heads/test-branch\\n' "$REMOTE_HEAD" ;;
      diff) if [[ "$*" == *--quiet* ]]; then exit 1; fi ;;
      push) exit "\${PUSH_STATUS:-0}" ;;
    esac ;;
  node)
    if [[ "$*" == *engineIdentity* ]]; then printf '%s\\n' "$TEST_IDENTITY"; fi ;;
  npm)
    if [[ "$*" == 'run contracts:export' ]]; then exit "\${WRITER_STATUS:-0}"; fi ;;
  gh)
    [[ -n "\${GH_TOKEN:-}" ]] || exit 91
    exit "\${DISPATCH_STATUS:-0}" ;;
esac
`;

function run(t, overrides = {}, existingMarker = false) {
    const root = mkdtempSync(join(tmpdir(), "v6-workflow-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const dir of ["bin", "docs", ".github/scripts", ".github/workflows", "tests/fixtures", "packages/wire/schemas", "runner-temp"])
        mkdirSync(join(root, dir), { recursive: true });
    for (const tool of ["git", "node", "npm", "gh"])
        writeFileSync(join(root, "bin", tool), stub, { mode: 0o755 });
    writeFileSync(join(root, ".github/scripts/api-admission-batch-v6-complete.sh"), source);
    writeFileSync(join(root, ".github/workflows/api-admission-batch-v6-complete.yml"), workflow);
    writeFileSync(join(root, "tests/fixtures/replay.json"), "{}\n");
    writeFileSync(join(root, "packages/wire/schemas/schema.json"), "{}\n");
    if (existingMarker) writeFileSync(join(root, marker), "Retained verification record\n");
    const log = join(root, "calls.log");
    const result = spawnSync("bash", [".github/scripts/api-admission-batch-v6-complete.sh"], {
        cwd: root, encoding: "utf8", timeout: 15000,
        env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`,
            GH_TOKEN: "synthetic-test-token", CALL_LOG: log, TEST_HEAD: head,
            REMOTE_HEAD: head, TEST_IDENTITY: identity, BRANCH: "test-branch",
            BASELINE_SHA: "1aaba357f46e83296419c1871fac3c28ea70dcff",
            RUNNER_TEMP: join(root, "runner-temp"), ...overrides }
    });
    assert.equal(result.error, undefined);
    return { ...result, root, calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

test("V6 completion binds CLI authentication in its workflow", () => {
    assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
    assert.match(workflow, /actions:\s*write/);
});

test("V6 completion preserves literal Markdown evidence and stages only generated output", t => {
    const result = run(t);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "", "Markdown must not be executed as shell commands");
    const report = readFileSync(join(result.root, marker), "utf8");
    assert.ok(report.includes(`Runtime candidate: \`${head}\``));
    assert.ok(report.includes(`Engine identity after V6 runtime change: \`${identity}\``));
    assert.ok(report.includes("Generated fixture/schema paths changed before commit: `1`"));
    assert.ok(report.includes("V6 source commit remains: `af9e0e1dd93b7eb77db5883bdd18809c8446d856`"));
    assert.match(result.calls, /git add -- tests\/fixtures packages\/wire\/schemas docs\/api-admission-batch-v6-verification\.md/);
    assert.doesNotMatch(result.calls, /git add -A/);
    assert.ok(existsSync(join(result.root, ".github/workflows/api-admission-batch-v6-complete.yml")));
    assert.ok(existsSync(join(result.root, ".github/scripts/api-admission-batch-v6-complete.sh")));
    assert.ok(result.calls.indexOf("git push ") < result.calls.indexOf("gh workflow run "));
    assert.match(result.calls, /gh workflow run pr-validation\.yml --ref test-branch/);
});

test("V6 completion rejects missing authentication before generation", t => {
    const result = run(t, { GH_TOKEN: "" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GH_TOKEN must be provided/);
    assert.equal(result.calls, "");
});

test("V6 completion retries validation without regenerating an existing baseline", t => {
    const result = run(t, {}, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls, "gh workflow run pr-validation.yml --ref test-branch\n");
    assert.equal(readFileSync(join(result.root, marker), "utf8"), "Retained verification record\n");
});

test("V6 completion fails closed when the branch moved", t => {
    const result = run(t, { REMOTE_HEAD: "ffffffffffffffffffffffffffffffffffffffff" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to overwrite newer work/);
    assert.doesNotMatch(result.calls, /git (commit|push) |gh workflow run/);
});

test("V6 completion never commits or dispatches after a generator fails", t => {
    const result = run(t, { WRITER_STATUS: "42" });
    assert.equal(result.status, 42);
    assert.equal(existsSync(join(result.root, marker)), false);
    assert.doesNotMatch(result.calls, /git (commit|push) |gh workflow run/);
});

test("V6 completion never dispatches after a failed push", t => {
    const result = run(t, { PUSH_STATUS: "43" });
    assert.equal(result.status, 43);
    assert.doesNotMatch(result.calls, /gh workflow run/);
});

test("V6 completion reports dispatch failure rather than a false green result", t => {
    const result = run(t, { DISPATCH_STATUS: "44" }, true);
    assert.equal(result.status, 44);
    assert.equal(result.calls, "gh workflow run pr-validation.yml --ref test-branch\n");
});
