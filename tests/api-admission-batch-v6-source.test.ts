import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hashCanonical } from "../packages/domain/src/canonical";
import { assertV6Snapshot, gitBlobSha, sha256, verifyV6Source, V6_EVIDENCE_HASH, V6_RAW_SHA256, V6_SOURCE_COMMIT } from "../scripts/lib/api-admission-batch-v6-source";
import evidence from "./fixtures/api-admission-batch-v6-source-evidence.v1.json";
import rawRecord from "./fixtures/api-admission-batch-v6-trust-no-one-source.v1.json";

const bytes = readFileSync("tests/fixtures/api-admission-batch-v6-trust-no-one-source.v1.json");
const ruleText = "Decrease a Gig by up to 3. Then, if you control a min Gig, draw 1.";

test("V6 source: exact raw bytes retain the upstream Git blob and SHA-256", () => {
    assertV6Snapshot(bytes, evidence);
    assert.equal(gitBlobSha(bytes), "24383b5e7cd8c559dab493f7a9c19e4263ab83c4");
    assert.equal(sha256(bytes), V6_RAW_SHA256);
    assert.equal(hashCanonical(evidence), V6_EVIDENCE_HASH);
});
test("V6 source: Trust No One's printed facts do not imply Quick or Program power", () => {
    assert.deepEqual({ slug: rawRecord.slug, type: rawRecord.card_type, color: rawRecord.color,
        cost: rawRecord.cost, ram: rawRecord.ram, power: rawRecord.power, sell: rawRecord.is_eddiable,
        tags: rawRecord.classifications, keywords: rawRecord.keywords }, {
        slug: "trust-no-one", type: "Program", color: "Blue", cost: 1, ram: 1,
        power: null, sell: true, tags: ["Braindance"], keywords: []
    });
    assert.equal(rawRecord.rules_text, ruleText);
});
test("V6 source: all three pinned printings are retained without a live corpus refresh", () => {
    assert.deepEqual(rawRecord.printings.map(p => p.collector_number), ["139", "β139", "007"]);
    assert.deepEqual(evidence.candidate.printings.map(p => p.collectorNumber), ["139", "β139", "007"]);
    assert.equal(rawRecord.selected_printing_id, rawRecord.printings[0].id);
    assert.equal(new Set(rawRecord.printings.map(p => p.id)).size, 3);
});
test("V6 source: processed record and candidate independently reproduce their canonical pins", () => {
    assert.equal(hashCanonical(evidence.processedRecord), "c734132576aca6b7a8137aa88df781c5e4baa03e95b55af08556862c2209545e");
    assert.equal(hashCanonical(evidence.candidate), "3aaf043440c319a9347659bfc910e96e7eb11dedc29979d891e65c3ce38c3571");
    assert.equal(evidence.candidate.sourceRecordHash, hashCanonical(evidence.processedRecord));
    assert.equal(hashCanonical(rawRecord), evidence.rawRecordHash);
});
test("V6 source: raw, processed and candidate wording agree without synthesizing mechanics", () => {
    assert.equal(evidence.processedRecord.text_markup, ruleText);
    assert.equal(evidence.candidate.rulesSource.markup, ruleText);
    assert.equal(evidence.candidate.rulesSource.rendered, ruleText);
    assert.deepEqual(evidence.candidate.rulesSource.keywordHints, []);
    assert.deepEqual(evidence.candidate.rulesSource.timingTriggerHints, []);
    for (const key of ["mechanics", "execution", "revision", "reviewed", "status"]) {
        assert.equal(Object.hasOwn(evidence.candidate, key), false, key);
    }
    assert.equal(evidence.authority, "SOURCE_EVIDENCE_ONLY");
    assert.equal(evidence.manifest.authority, "SOURCE_CANDIDATES_ONLY");
});
test("V6 source: manifest pins the full corpus and records an empty card-specific errata join", () => {
    assert.equal(evidence.manifest.recordCount, 151);
    assert.equal(evidence.manifest.errataCount, 4);
    assert.equal(evidence.manifest.catalogSha256, "b96ca8d583ab087148c9ed3563379e6c42fd9e729188a042215bb503a8879c3d");
    assert.deepEqual(evidence.matchingErrata, []);
    assert.deepEqual(evidence.candidate.errata, []);
});
test("V6 source: nine exact rule excerpts distinguish current control, min value and legal adjustment", () => {
    assert.deepEqual(evidence.rules.map(r => r.id), ["1.7.2", "1.14", "6.1.4", "6.3", "6.3.1", "6.3.3", "6.4.2", "6.4.4", "6.4.5"]);
    assert.equal(hashCanonical(evidence.rules), evidence.rulesProjectionHash);
    const min = evidence.rules.find(r => r.id === "6.3.3");
    assert.ok(min);
    assert.match(min.text, /lowest value on a die is always 1/);
    assert.match(min.text, /the 0 represents “10”/);
});
test("V6 source: raw byte changes cannot be hidden by equivalent parsed JSON", () => {
    assert.throws(() => assertV6Snapshot(Buffer.from(JSON.stringify(rawRecord)), evidence), /V6_RAW_BYTES/);
});
test("V6 source: changed printed cost is rejected even with replacement per-record hashes", () => {
    const changed = structuredClone(evidence);
    changed.processedRecord.cost = 2;
    changed.processedRecordHash = hashCanonical(changed.processedRecord);
    changed.candidate.sourceRecordHash = changed.processedRecordHash;
    assert.throws(() => assertV6Snapshot(bytes, changed), /V6_EVIDENCE_PIN/);
});
test("V6 source: altered candidate mechanics cannot become admission through a rehash", () => {
    const changed = { ...structuredClone(evidence), candidate: { ...evidence.candidate, mechanics: { abilities: [] } } };
    changed.candidateRecordHash = hashCanonical(changed.candidate);
    assert.throws(() => assertV6Snapshot(bytes, changed), /V6_EVIDENCE_PIN/);
});
test("V6 source: altered rules remain drift even when their projection is rehashed", () => {
    const changed = structuredClone(evidence);
    changed.rules[0].text = "Owners and controllers are interchangeable.";
    changed.rulesProjectionHash = hashCanonical(changed.rules);
    assert.throws(() => assertV6Snapshot(bytes, changed), /V6_EVIDENCE_PIN/);
});
test("V6 source: missing or duplicated rule records cannot silently shrink the evidence", () => {
    for (const rules of [evidence.rules.slice(1), [...evidence.rules, evidence.rules[0]]]) {
        assert.throws(() => assertV6Snapshot(bytes, { ...evidence, rules, rulesProjectionHash: hashCanonical(rules) }), /V6_EVIDENCE_PIN/);
    }
});
test("V6 source: a new printing or erratum requires a separate reviewed source change", () => {
    const printing = structuredClone(evidence);
    printing.candidate.printings.push({ ...printing.candidate.printings[0], collectorNumber: "011" });
    printing.candidateRecordHash = hashCanonical(printing.candidate);
    assert.throws(() => assertV6Snapshot(bytes, printing), /V6_EVIDENCE_PIN/);
    assert.throws(() => assertV6Snapshot(bytes, { ...evidence, matchingErrata: [{ card_id: "trust-no-one" }] }), /V6_EVIDENCE_PIN/);
});
test("V6 source: object key order is immaterial, but rule and printing array order stays pinned", () => {
    assertV6Snapshot(bytes, Object.fromEntries(Object.entries(evidence).reverse()));
    assert.throws(() => assertV6Snapshot(bytes, { ...evidence, rules: [...evidence.rules].reverse() }), /V6_EVIDENCE_PIN/);
});

test("V6 source: imported monorepo data exactly matches the preserved AI source commit", () => {
    const result = verifyV6Source(".", bytes, evidence);
    assert.equal(result.result, "SOURCE_MATCH");
    assert.equal(result.sourceCommit, V6_SOURCE_COMMIT);
    assert.equal(result.admissionReady, false);
    assert.equal(result.revisionAssigned, false);
    assert.match(result.monorepoHead, /^[a-f0-9]{40}$/);
});
