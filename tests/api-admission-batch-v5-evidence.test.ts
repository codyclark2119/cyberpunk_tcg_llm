import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashCanonical } from "@tcg/domain";
import { validateV5Evidence, evidenceBytes, V5_RULE_IDS, V5_REVIEWED_DECISIONS, DETONATE_SOURCE_PIN } from "../scripts/lib/api-admission-batch-v5-evidence";
import raw from "./fixtures/api-admission-batch-v5-detonate-source.v1.json";
import card from "./fixtures/api-admission-batch-v5-card-sources.v1.json";
import rules from "./fixtures/api-admission-batch-v5-rules.v1.json";

test("V5 evidence: full pinned records preserve source facts, printings and empty errata join", () => {
    const checked = validateV5Evidence(card, rules);
    assert.equal(checked.card.candidate.sourceRecordHash, checked.card.processedRecordHash, "V5_EVIDENCE_SOURCE_LINK");
    assert.equal(hashCanonical(raw), DETONATE_SOURCE_PIN.recordHash);
    assert.deepEqual(raw.keywords, [], "V5_EVIDENCE_RAW_KEYWORDS_UNCHANGED");
    assert.deepEqual(card.candidate.rulesSource.keywordHints, ["Quick"]);
    assert.equal(raw.rules_text, "{Quick} Defeat a rival Gear with power 2 or less.");
    assert.deepEqual([raw.card_type, raw.color, raw.cost, raw.ram, raw.power, raw.is_eddiable, raw.classifications],
        ["Program", "Red", 1, 2, null, true, ["Quickhack"]]);
    assert.equal(card.candidate.catalog.collectorNumber, "031");
    assert.deepEqual(card.candidate.printings.map(p => [p.setCode, p.collectorNumber, p.imageUrl]),
        raw.printings.map(p => [p.set.code, p.collector_number, p.image_url]));
    assert.deepEqual(checked.card.matchingErrata, []); assert.deepEqual(checked.card.candidate.errata, []);
    for (const field of ["mechanics", "execution", "reviewed", "revision", "status"])
        assert.equal(field in checked.card.candidate, false, "V5_EVIDENCE_HAS_NO_EXECUTION_AUTHORITY");
});

test("V5 evidence: exact rules remain separate from bounded authored interpretations and destination inference", () => {
    const checked = validateV5Evidence(card, rules);
    assert.deepEqual(checked.rules.rules.map(r => r.id), [...V5_RULE_IDS]);
    assert.deepEqual(checked.rules.decisions, V5_REVIEWED_DECISIONS, "V5_EVIDENCE_DECISIONS_PINNED");
    const destination = checked.rules.decisions.find(d => d.id === "DEFEATED_GEAR_TO_OWNER_TRASH_V1");
    assert.ok(destination); assert.equal(destination.classification, "REVIEWED_INFERENCE");
    assert.deepEqual(destination.ruleIds, ["11.6.1.2", "9.19.1.1", "4.12.1"]);
    assert.ok(destination.reviewMethod.includes("Reviewer-reported"));
    assert.ok(destination.reviewMethod.includes("not an exhaustive line-by-line audit"));
    assert.equal(destination.limitation, "No rule matching that reviewed search directly covers defeated-Gear destination. This is not a quotation, publisher ruling, general defeat rule, or claim of exhaustive absence.");
    assert.equal(checked.rules.rules.find(r => r.id === "9.19.1.1")!.text, "9.19.1.1. When a Unit is defeated, its owner moves it to their trash.", "V5_EVIDENCE_UNIT_RULE_NOT_REWRITTEN");
    for (const exact of checked.rules.rules) assert.deepEqual(Object.keys(exact).sort(), ["id", "text"]);
});

test("V5 evidence: canonical projections match the checked-in bytes", () => {
    const checked = validateV5Evidence(card, rules);
    for (const [name, value] of [["api-admission-batch-v5-card-sources.v1.json", checked.card], ["api-admission-batch-v5-rules.v1.json", checked.rules]] as const) {
        const expected = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
        assert.equal(evidenceBytes(value), expected, "V5_EVIDENCE_CANONICAL_BYTES");
        assert.equal(evidenceBytes(JSON.parse(evidenceBytes(value))), expected);
    }
    // Independent cross-repository reproduction is the separate capture --check command.
});

test("V5 evidence: raw and processed drift cannot be admitted by recomputing hashes", () => {
    const source = { ...raw, cost: 2 };
    assert.throws(() => validateV5Evidence(card, rules, Buffer.from(JSON.stringify(source))), /V5_RAW_SOURCE_PIN/, "V5_EVIDENCE_RAW_DRIFT");
    const changed = structuredClone(card); changed.processedRecord.cost = 2;
    changed.processedRecordHash = hashCanonical(changed.processedRecord); changed.candidate.sourceRecordHash = changed.processedRecordHash;
    changed.candidateHash = hashCanonical(changed.candidate);
    assert.throws(() => validateV5Evidence(changed, rules), /V5_PROCESSED_PIN/, "V5_EVIDENCE_PROCESSED_DRIFT");
});

test("V5 evidence: every candidate fact remains pinned, including printing metadata and hints", () => {
    for (const mutate of [
        (c: typeof card.candidate) => { c.catalog.sellable = false; },
        (c: typeof card.candidate) => { c.printings[0].artist = "altered artist"; },
        (c: typeof card.candidate) => { c.rulesSource.keywordHints = []; }
    ]) {
        const changed = structuredClone(card); mutate(changed.candidate);
        assert.throws(() => validateV5Evidence(changed, rules), /V5_CANDIDATE_RECORD/, "V5_EVIDENCE_CANDIDATE_DRIFT");
        changed.candidateHash = hashCanonical(changed.candidate);
        assert.throws(() => validateV5Evidence(changed, rules), /V5_CANDIDATE_PIN/, "V5_EVIDENCE_CANDIDATE_REHASH");
    }
    assert.throws(() => validateV5Evidence({ ...card, candidate: { ...card.candidate, mechanics: {} } }, rules), "V5_EVIDENCE_SOURCE_AUTHORITY_REJECTED");
    assert.throws(() => validateV5Evidence({ ...card, matchingErrata: [{ card_id: "detonate", text: "invented" }] }, rules), "V5_EVIDENCE_ERRATA_DRIFT");
});

test("V5 evidence: manifest pins include source paths, hashes and catalog counts", () => {
    for (const mutate of [
        (m: typeof card.manifest) => { m.source.cardDatabasePath = "data/processed/changed.jsonl"; },
        (m: typeof card.manifest) => { m.source.cardIndexSha256 = "0".repeat(64); },
        (m: typeof card.manifest) => { m.recordCount -= 1; }
    ]) {
        const changed = structuredClone(card); mutate(changed.manifest);
        assert.throws(() => validateV5Evidence(changed, rules), /V5_MANIFEST_PIN/, "V5_EVIDENCE_MANIFEST_DRIFT");
    }
});

test("V5 evidence: rule wording, missing records and ordering cannot be silently refreshed", () => {
    const text = structuredClone(rules); text.rules[0].text += " altered";
    assert.throws(() => validateV5Evidence(card, text), /V5_EXACT_RULE_TEXT/, "V5_EVIDENCE_RULE_TEXT_DRIFT");
    text.rulesHash = hashCanonical(text.rules);
    assert.throws(() => validateV5Evidence(card, text), /V5_RULES_PIN/, "V5_EVIDENCE_RULE_REHASH");
    const absent = structuredClone(rules); absent.rules.pop(); absent.rulesHash = hashCanonical(absent.rules);
    assert.throws(() => validateV5Evidence(card, absent), /V5_EXACT_RULE_SET/, "V5_EVIDENCE_RULE_REMOVED");
    const reversed = structuredClone(rules); reversed.rules.reverse(); reversed.rulesHash = hashCanonical(reversed.rules);
    assert.throws(() => validateV5Evidence(card, reversed), /V5_EXACT_RULE_SET/, "V5_EVIDENCE_RULE_ORDER");
});

test("V5 evidence: rehashing altered authored decisions does not turn them into reviewed decisions", () => {
    for (const field of ["decision", "reviewMethod", "limitation", "classification"] as const) {
        const changed = structuredClone(rules);
        const destination = changed.decisions.find(d => d.id === "DEFEATED_GEAR_TO_OWNER_TRASH_V1")!;
        destination[field] = field === "classification" ? "REVIEWED_RULE_INTERPRETATION" : "altered";
        changed.decisionsHash = hashCanonical(changed.decisions);
        assert.throws(() => validateV5Evidence(card, changed), /V5_REVIEWED_DECISIONS/, "V5_EVIDENCE_DECISION_DRIFT");
    }
    const missing = structuredClone(rules); missing.decisions.pop(); missing.decisionsHash = hashCanonical(missing.decisions);
    assert.throws(() => validateV5Evidence(card, missing), /V5_REVIEWED_DECISIONS/, "V5_EVIDENCE_DECISION_REMOVED");
    const basis = structuredClone(rules); basis.decisions[0].ruleIds = ["9.19.1.1"]; basis.decisionsHash = hashCanonical(basis.decisions);
    assert.throws(() => validateV5Evidence(card, basis), /V5_REVIEWED_DECISIONS/, "V5_EVIDENCE_DECISION_BASIS");
});
