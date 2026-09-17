import assert from "node:assert/strict";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { captureV4Evidence, evidenceBytes } from "./lib/api-admission-batch-v4-evidence";

const { values } = parseArgs({ options: { "ai-root": { type: "string" }, check: { type: "boolean" }, write: { type: "boolean" } } });
if (!values["ai-root"] || values.check && values.write) throw new Error("Usage: node --import tsx scripts/capture-api-admission-batch-v4-evidence.ts --ai-root PATH [--check | --write]");
const first = captureV4Evidence(values["ai-root"]), second = captureV4Evidence(values["ai-root"]);
const dir = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));
const outputs = [
    ["api-admission-batch-v4-card-sources.v1.json", evidenceBytes(first.card), evidenceBytes(second.card)],
    ["api-admission-batch-v4-rules.v1.json", evidenceBytes(first.rules), evidenceBytes(second.rules)]
] as const;
// No output is touched until both captures, all pins and the repeated byte comparison pass.
for (const [name, bytes, repeated] of outputs) assert.equal(bytes, repeated, `${name}: capture is not deterministic`);
for (const [name, bytes] of outputs) {
    const path = resolve(dir, name);
    if (!values.write) assert.equal(readFileSync(path, "utf8"), bytes, `${name}: committed evidence differs`);
    else {
        const temporary = `${path}.${process.pid}.tmp`;
        try { writeFileSync(temporary, bytes, { flag: "wx" }); renameSync(temporary, path); }
        finally { rmSync(temporary, { force: true }); }
    }
}
console.log(JSON.stringify({ result: values.write ? "EVIDENCE_WRITTEN" : "EVIDENCE_MATCH", files: outputs.map(([name]) => name), rules: first.rules.rules.length,
    repeatedCaptureIdentical: true, note: "Source evidence only; no runtime, revision, catalog, wire schema or existing replay fixture is changed." }, null, 2));
