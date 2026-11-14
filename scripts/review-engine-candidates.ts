import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CardRevisionSnapshotSchema } from "@tcg/domain";
import { demoReferenceContext } from "../tests/demo-format-fixture";
import { reviewEngineCandidateCatalogV1 } from "./lib/engine-candidates";
import { loadVerifiedCandidates } from "./lib/card-coverage";

function arg(name: string) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

// Usage: npm run review:engine-candidates -- [--candidate-dir data/engine-candidates] [--strict-reviewed]
const candidateDir = resolve(arg("--candidate-dir") ?? fileURLToPath(new URL("../data/engine-candidates", import.meta.url)));
const { manifest, candidates } = loadVerifiedCandidates(candidateDir);

const reviewedCards = demoReferenceContext().content.cards
    .filter(card => card.schemaVersion === 2 && card.provenance.reviewed)
    .map(card => CardRevisionSnapshotSchema.parse(card));
const reviews = reviewEngineCandidateCatalogV1(candidates, reviewedCards);
const counts = reviews.reduce<Record<string, number>>((out, review) => {
    out[review.status] = (out[review.status] ?? 0) + 1;
    return out;
}, {});
const reviewedIds = new Set<string>(reviewedCards.map(card => card.id));
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
