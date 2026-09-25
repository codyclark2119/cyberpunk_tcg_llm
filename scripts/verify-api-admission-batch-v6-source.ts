import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { verifyV6Source } from "./lib/api-admission-batch-v6-source";

const { values } = parseArgs({ options: { "repo-root": { type: "string", default: "." } }, allowPositionals: false, strict: true });
const fixtureRoot = resolve("tests/fixtures");
const raw = readFileSync(resolve(fixtureRoot, "api-admission-batch-v6-trust-no-one-source.v1.json"));
const evidence: unknown = JSON.parse(readFileSync(resolve(fixtureRoot, "api-admission-batch-v6-source-evidence.v1.json"), "utf8"));
console.log(JSON.stringify(verifyV6Source(values["repo-root"]!, raw, evidence), null, 2));
