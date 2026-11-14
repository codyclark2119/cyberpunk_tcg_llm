import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CardRevisionSnapshotSchema } from "@tcg/domain";
import { demoReferenceContext } from "../tests/demo-format-fixture";
import { reviewEngineCandidateCatalogV1 } from "./lib/engine-candidates";
import { buildCardCoverageReport, loadVerifiedCandidates } from "./lib/card-coverage";

// Why: admitting every card needs an exact to-do list, not a guess. This joins the
// engine-candidate review (which cards have reviewed executable revisions) with the
// hand-authored mechanic families each card's text needs, and fails closed when the
// family notes drift from the candidate catalog.
// Usage: npm run coverage:cards -- [--candidate-dir data/engine-candidates] [--out <path>] [--check]
function arg(name: string) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const candidateDir = resolve(arg("--candidate-dir") ?? fileURLToPath(new URL("../data/engine-candidates", import.meta.url)));
const familiesPath = resolve(candidateDir, "mechanic-families.v1.json");
const outPath = resolve(arg("--out") ?? resolve(candidateDir, "card-coverage.v1.json"));

const verified = loadVerifiedCandidates(candidateDir);
const reviewedCards = demoReferenceContext().content.cards
    .filter(card => card.schemaVersion === 2 && card.provenance.reviewed)
    .map(card => CardRevisionSnapshotSchema.parse(card));
const reviews = reviewEngineCandidateCatalogV1(verified.candidates, reviewedCards);
const report = buildCardCoverageReport(verified, reviews, JSON.parse(readFileSync(familiesPath, "utf8")));
const text = JSON.stringify(report, null, 2) + "\n";

if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(outPath, "utf8"); } catch { /* missing counts as stale */ }
    if (current !== text) {
        console.error(`${outPath} is stale; run npm run coverage:cards`);
        process.exitCode = 1;
    } else console.log(`coverage report is current: ${report.totals.admitted}/${report.totals.cards} admitted`);
} else {
    writeFileSync(outPath, text);
    console.log(JSON.stringify({ out: outPath, totals: report.totals }, null, 2));
}
