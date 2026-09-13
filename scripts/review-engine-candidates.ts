import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CardRevisionSnapshotSchema } from "@tcg/domain";
import { demoReferenceContext } from "../tests/demo-format-fixture";
import { EngineCandidateManifestV1Schema, EngineCardCandidateV1Schema, reviewEngineCandidateCatalogV1 } from "./lib/engine-candidates";

function arg(name: string) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
function sha256(data: string | Buffer) {
    return createHash("sha256").update(data).digest("hex");
}
function readJson(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function readJsonl(path: string) {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

const candidateDirArg = arg("--candidate-dir");
if (!candidateDirArg) throw new Error("Usage: npm run review:engine-candidates -- --candidate-dir /path/to/cyberpunk_tcg_ai/data/engine-candidates [--strict-reviewed]");
const candidateDir = resolve(candidateDirArg);
const aiRoot = resolve(candidateDir, "../..");
const manifestPath = resolve(candidateDir, "manifest.v1.json");
const catalogPath = resolve(candidateDir, "card-catalog.v1.jsonl");
const manifest = EngineCandidateManifestV1Schema.parse(readJson(manifestPath));
const catalogBytes = readFileSync(catalogPath);
if (sha256(catalogBytes) !== manifest.catalogSha256) throw new Error("candidate catalog SHA-256 does not match manifest");
const candidates = readJsonl(catalogPath).map(value => EngineCardCandidateV1Schema.parse(value));
if (candidates.length !== manifest.recordCount) throw new Error(`candidate record count ${candidates.length} != manifest ${manifest.recordCount}`);
const errataCount = candidates.reduce((n, candidate) => n + candidate.errata.length, 0);
if (errataCount !== manifest.errataCount) throw new Error(`candidate errata count ${errataCount} != manifest ${manifest.errataCount}`);
for (const [pathKey, hashKey] of [
    ["cardDatabasePath", "cardDatabaseSha256"],
    ["cardIndexPath", "cardIndexSha256"],
    ["errataPath", "errataSha256"]
] as const) {
    const sourcePath = resolve(aiRoot, manifest.source[pathKey]);
    const actual = sha256(readFileSync(sourcePath));
    if (actual !== manifest.source[hashKey]) throw new Error(`${pathKey} SHA-256 does not match manifest`);
}

const reviewedCards = demoReferenceContext().content.cards
    .filter(card => card.schemaVersion === 2 && card.provenance.reviewed)
    .map(card => CardRevisionSnapshotSchema.parse(card));
const reviews = reviewEngineCandidateCatalogV1(candidates, reviewedCards);
const counts = reviews.reduce<Record<string, number>>((out, review) => {
    out[review.status] = (out[review.status] ?? 0) + 1;
    return out;
}, {});
const reviewedIds = new Set(reviewedCards.map(card => card.id));
const reviewedProblems = reviews.filter(review => reviewedIds.has(review.cardId) && ["SOURCE_DRIFT", "UNSUPPORTED_HINT"].includes(review.status));
const result = {
    schemaVersion: 1,
    manifest: { recordCount: manifest.recordCount, errataCount: manifest.errataCount, catalogSha256: manifest.catalogSha256 },
    reviewedRevisionCount: reviewedCards.length,
    counts,
    reviewedProblems,
    admissionReady: 0,
    note: "Candidate review only. No candidate is admitted or assigned a revision by this tool."
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes("--strict-reviewed") && reviewedProblems.length) process.exitCode = 2;
