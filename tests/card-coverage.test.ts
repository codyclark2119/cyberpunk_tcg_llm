import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CardRevisionSnapshotSchema } from "@tcg/domain";
import { demoReferenceContext } from "./demo-format-fixture";
import { reviewEngineCandidateCatalogV1 } from "../scripts/lib/engine-candidates";
import { buildCardCoverageReport, loadVerifiedCandidates } from "../scripts/lib/card-coverage";

const candidateDir = fileURLToPath(new URL("../data/engine-candidates", import.meta.url));
const verified = loadVerifiedCandidates(candidateDir);
const reviewed = demoReferenceContext().content.cards
    .filter(card => card.schemaVersion === 2 && card.provenance.reviewed)
    .map(card => CardRevisionSnapshotSchema.parse(card));
const reviews = reviewEngineCandidateCatalogV1(verified.candidates, reviewed);
const familiesText = readFileSync(`${candidateDir}/mechanic-families.v1.json`, "utf8");
const families = () => JSON.parse(familiesText);

test("the committed coverage report is what the CLI builds from committed inputs", () => {
    const report = buildCardCoverageReport(verified, reviews, families());
    const committed = readFileSync(`${candidateDir}/card-coverage.v1.json`, "utf8");
    assert.equal(JSON.stringify(report, null, 2) + "\n", committed, "run npm run coverage:cards");
    assert.equal(report.totals.cards, verified.candidates.length);
    assert.equal(report.totals.admitted + report.totals.notAdmitted, report.totals.cards);
    for (const card of report.cards) {
        if (card.admission === "SOURCE_MATCH") assert.deepEqual(card.blockingFamilies, []);
        for (const f of card.blockingFamilies) assert.notEqual(report.families.find(x => x.family === f)?.status, "COVERED");
    }
});

test("a card missing from the family notes fails closed", () => {
    const f = families();
    delete f.cards[verified.candidates[0]!.sourceCardSlug];
    assert.throws(() => buildCardCoverageReport(verified, reviews, f), /no entry for/);
});

test("an unknown slug in the family notes fails closed", () => {
    const f = families();
    f.cards["not-a-real-card"] = { families: ["VANILLA"] };
    assert.throws(() => buildCardCoverageReport(verified, reviews, f), /unknown slugs/);
});

test("a family outside the vocabulary fails closed", () => {
    const f = families();
    f.cards[verified.candidates[0]!.sourceCardSlug] = { families: ["MADE_UP_FAMILY"] };
    assert.throws(() => buildCardCoverageReport(verified, reviews, f), /outside the vocabulary/);
});

test("family notes pinned to another catalog fail closed", () => {
    const f = families();
    f.snapshot.catalogSha256 = "0".repeat(64);
    assert.throws(() => buildCardCoverageReport(verified, reviews, f), /catalogSha256/);
});

test("family notes cannot claim to be executable authority", () => {
    const f = families();
    f.authority = "ADMITTED";
    assert.throws(() => buildCardCoverageReport(verified, reviews, f));
    const g = families();
    g.cards[verified.candidates[0]!.sourceCardSlug].mechanics = {};
    assert.throws(() => buildCardCoverageReport(verified, reviews, g));
});

test("a rules question naming an unknown slug fails closed", () => {
    const f = families();
    f.rulesQuestions.push({ id: "QX", cards: ["not-a-real-card"], question: "?" });
    assert.throws(() => buildCardCoverageReport(verified, reviews, f), /QX/);
});
