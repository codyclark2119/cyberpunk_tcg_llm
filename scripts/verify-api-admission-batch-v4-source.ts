import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { hashCanonical } from "@tcg/domain";
import { EngineCandidateManifestV1Schema, EngineCardCandidateV1Schema } from "./lib/engine-candidates";
import { JONIN, JONIN_SOURCE_PIN, jonin } from "../tests/api-admission-batch-v4-fixture";
import raw from "../tests/fixtures/api-admission-batch-v4-jonin-source.v1.json";

// Read-only cross-repository evidence check. Never assigns mechanics or writes either repository.
const index = process.argv.indexOf("--ai-root"), argument = index < 0 ? undefined : process.argv[index + 1];
if (!argument || argument.startsWith("--")) throw new Error("Usage: node --import tsx scripts/verify-api-admission-batch-v4-source.ts --ai-root /path/to/cyberpunk_tcg_ai");
const root = resolve(argument);
function sourcePath(path: string) {
    const absolute = resolve(root, path), local = relative(root, absolute);
    if (local === ".." || local.startsWith("../") || local.startsWith("..\\") || isAbsolute(local))
        throw new Error("Manifest path escapes --ai-root");
    return absolute;
}
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
function readJsonl(path: string): Record<string, unknown>[] {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
        .map(line => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
}

const manifest = EngineCandidateManifestV1Schema.parse(readJson(sourcePath("data/engine-candidates/manifest.v1.json")));
assert.equal(manifest.catalogSha256, JONIN_SOURCE_PIN.catalogSha256, "use the reviewed catalog snapshot, not a silently refreshed corpus");
assert.equal(manifest.source.errataSha256, JONIN_SOURCE_PIN.processedErrataSha256);
const catalogPath = sourcePath("data/engine-candidates/card-catalog.v1.jsonl");
assert.equal(sha256(readFileSync(catalogPath)), manifest.catalogSha256);
for (const [pathKey, hashKey] of [
    ["cardDatabasePath", "cardDatabaseSha256"],
    ["cardIndexPath", "cardIndexSha256"],
    ["errataPath", "errataSha256"]
] as const) assert.equal(sha256(readFileSync(sourcePath(manifest.source[pathKey]))), manifest.source[hashKey], pathKey);

const rawBytes = readFileSync(sourcePath(JONIN_SOURCE_PIN.path));
assert.equal(sha256(rawBytes), JONIN_SOURCE_PIN.rawSha256);
assert.equal(createHash("sha1").update(`blob ${rawBytes.length}\0`).update(rawBytes).digest("hex"), JONIN_SOURCE_PIN.gitBlob);
assert.deepEqual(JSON.parse(rawBytes.toString("utf8")), raw);
assert.equal(hashCanonical(raw), JONIN_SOURCE_PIN.recordHash);
const candidates = readJsonl(catalogPath).map(c => EngineCardCandidateV1Schema.parse(c));
assert.equal(candidates.length, manifest.recordCount);
assert.equal(candidates.reduce((count, c) => count + c.errata.length, 0), manifest.errataCount);
const matches = candidates.filter(c => c.sourceCardSlug === JONIN);
assert.equal(matches.length, 1, "exactly one Jonin candidate");
const candidate = matches[0];
const processedMatches = readJsonl(sourcePath(manifest.source.cardDatabasePath)).filter(r => r.id === JONIN);
assert.equal(processedMatches.length, 1, "exactly one processed Jonin record");
const processed = processedMatches[0];
assert.equal(candidate.sourceRecordHash, hashCanonical(processed));
assert.equal(processed.text_markup, raw.rules_text);
assert.equal(candidate.rulesSource.markup, raw.rules_text);
assert.deepEqual(candidate.identityCandidate, { cardId: JONIN, deckbuildingIdentity: jonin.deckbuildingIdentity, subtitle: jonin.subtitle, displayName: jonin.displayName });
assert.equal(candidate.catalog.type, jonin.type); assert.deepEqual(candidate.catalog.colors, jonin.colors);
assert.equal(candidate.catalog.cost, raw.cost); assert.equal(candidate.catalog.power, raw.power);
assert.equal(candidate.catalog.ram, raw.ram); assert.equal(candidate.catalog.sellable, raw.is_eddiable);
assert.deepEqual(candidate.catalog.classifications, raw.classifications);
assert.equal(candidate.catalog.collectorNumber, raw.print_number);
assert.equal(candidate.catalog.setCode, raw.set.code); assert.equal(candidate.catalog.setName, raw.set.name);
assert.deepEqual(candidate.printings.map(p => [p.setCode, p.collectorNumber, p.imageUrl]), raw.printings.map(p => [p.set.code, p.collector_number, p.image_url]));
const errata = readJsonl(sourcePath(manifest.source.errataPath));
assert.equal(errata.length, manifest.errataCount);
assert.deepEqual(errata.filter(e => e.card_id === JONIN), []);
assert.deepEqual(candidate.errata, []); assert.deepEqual(jonin.provenance.errata, []);
console.log(JSON.stringify({
    schemaVersion: 1, sourceCardSlug: JONIN, sourceCommit: JONIN_SOURCE_PIN.commit,
    rawSha256: sha256(rawBytes), rawRecordHash: hashCanonical(raw),
    processedRecordHash: hashCanonical(processed), catalogSha256: manifest.catalogSha256,
    matchingErrata: [], result: "SOURCE_MATCH",
    note: "Read-only source verification. Parser hints remain diagnostics; no mechanics, revision or execution decision is inferred."
}, null, 2));
