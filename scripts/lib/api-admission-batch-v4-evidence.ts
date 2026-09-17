import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { canonicalSerialize, hashCanonical } from "@tcg/domain";
import { EngineCandidateManifestV1Schema, EngineCardCandidateV1Schema } from "./engine-candidates";
import { JONIN, JONIN_SOURCE_PIN, jonin } from "../../tests/api-admission-batch-v4-fixture";
import raw from "../../tests/fixtures/api-admission-batch-v4-jonin-source.v1.json";

export const V4_RULE_IDS = ["3.17.2", "3.17.4", "3.18.1.2.2.1", "4.2.1", "4.7", "5.3.1.1", "5.3.2.2", "5.4.2", "8.16.1", "8.16.2", "9.19.1", "9.19.1.1", "9.23.2.1", "9.23.2.2", "9.29", "10.2.1", "10.2.3", "10.4.1", "10.7", "10.10.1"] as const;
export const V4_PROCESSED_HASH = "2a6baf11cb8876d5f45deca998affd375d1c76bbc9686bd2b856470ff7d8d65c";
export const V4_RULES_PIN = { path: "data/processed/rules.jsonl", gitBlob: "5d8343c6fa8a596e354a2868a8bd511a6b04ca0e", sha256: "1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19" } as const;
export const V4_RULES_PROJECTION_HASH = "05f7dd389b919e40cca4bb00b700516ff9016c57729b94fd08d548f8f6237752";
const origin = { repository: JONIN_SOURCE_PIN.repository, commit: JONIN_SOURCE_PIN.commit };
const projection = "Exact id/text fields from the pinned processed rules records; no wording corrections.";
const root = fileURLToPath(new URL("../../", import.meta.url));
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Origin = z.strictObject({ repository: z.literal(JONIN_SOURCE_PIN.repository), commit: z.literal(JONIN_SOURCE_PIN.commit) });
const CardEvidence = z.strictObject({ schemaVersion: z.literal(1), authority: z.literal("EVIDENCE_ONLY"), source: Origin,
    rawSnapshot: z.literal("api-admission-batch-v4-jonin-source.v1.json"), rawSha256: Hash, rawRecordHash: Hash,
    manifest: EngineCandidateManifestV1Schema, processedRecordHash: Hash, processedRecord: z.record(z.string(), z.unknown()),
    candidate: EngineCardCandidateV1Schema, matchingErrata: z.array(z.unknown()).length(0) });
const RuleEvidence = z.strictObject({ schemaVersion: z.literal(1), authority: z.literal("EVIDENCE_ONLY"),
    source: Origin.extend({ path: z.literal(V4_RULES_PIN.path), gitBlob: z.literal(V4_RULES_PIN.gitBlob), sha256: z.literal(V4_RULES_PIN.sha256) }),
    projection: z.literal(projection), rules: z.array(z.strictObject({ id: z.string(), text: z.string() })), rulesHash: Hash });
export const evidenceBytes = (value: unknown) => JSON.stringify(JSON.parse(canonicalSerialize(value)), null, 2) + "\n";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const gitBlob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/** Offline verification of captured facts. Does not interpret English or grant execution authority. */
export function validateV4Evidence(cardInput: unknown, rulesInput: unknown) {
    const card = CardEvidence.parse(cardInput), rules = RuleEvidence.parse(rulesInput), c = card.candidate;
    const bytes = readFileSync(resolve(root, "tests/fixtures", card.rawSnapshot));
    assert.equal(sha256(bytes), JONIN_SOURCE_PIN.rawSha256);
    assert.equal(gitBlob(bytes), JONIN_SOURCE_PIN.gitBlob);
    assert.equal(card.rawSha256, JONIN_SOURCE_PIN.rawSha256); assert.equal(card.rawRecordHash, JONIN_SOURCE_PIN.recordHash);
    assert.equal(hashCanonical(raw), card.rawRecordHash);
    assert.equal(card.manifest.catalogSha256, JONIN_SOURCE_PIN.catalogSha256);
    assert.equal(card.manifest.source.errataSha256, JONIN_SOURCE_PIN.processedErrataSha256);
    assert.equal(card.manifest.recordCount, 151); assert.equal(card.manifest.errataCount, 4);
    assert.equal(card.processedRecordHash, V4_PROCESSED_HASH);
    assert.equal(hashCanonical(card.processedRecord), V4_PROCESSED_HASH);
    assert.equal(c.sourceRecordHash, V4_PROCESSED_HASH); assert.equal(card.processedRecord.id, JONIN);
    assert.equal(c.sourceCardSlug, JONIN); assert.deepEqual(c.errata, []);
    assert.deepEqual(c.identityCandidate, { cardId: JONIN, deckbuildingIdentity: raw.name, displayName: raw.display_name, subtitle: raw.subname ?? "" });
    assert.equal(c.catalog.type, jonin.type); assert.deepEqual(c.catalog.colors, jonin.colors);
    assert.equal(c.catalog.cost, raw.cost); assert.equal(c.catalog.power, raw.power);
    assert.equal(c.catalog.ram, raw.ram); assert.equal(c.catalog.sellable, raw.is_eddiable);
    assert.deepEqual(c.catalog.classifications, raw.classifications);
    assert.equal(c.rulesSource.markup, raw.rules_text); assert.equal(card.processedRecord.text_markup, raw.rules_text);
    assert.equal(c.rulesSource.rendered, card.processedRecord.text);
    assert.deepEqual(c.rulesSource.keywordHints, []); assert.deepEqual(c.rulesSource.referencedKeywordHints, []);
    assert.deepEqual(c.rulesSource.timingTriggerHints, ["Play"], "hint is preserved as evidence, not made executable");
    assert.deepEqual(c.printings.map(p => [p.setCode, p.collectorNumber, p.imageUrl]), raw.printings.map(p => [p.set.code, p.collector_number, p.image_url]));
    assert.deepEqual(rules.rules.map(r => r.id), [...V4_RULE_IDS]);
    assert.equal(rules.rulesHash, V4_RULES_PROJECTION_HASH); assert.equal(hashCanonical(rules.rules), rules.rulesHash);
    return { card, rules };
}

/** Rebuild both projections from an independently hash-checked AI checkout, never from the snapshots being checked. */
export function captureV4Evidence(aiRoot: string) {
    const ai = realpathSync(resolve(aiRoot));
    function read(path: string) {
        const resolved = realpathSync(resolve(ai, path)), rel = relative(ai, resolved);
        if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) throw new Error("Evidence path escapes the AI checkout");
        return readFileSync(resolved);
    }
    function jsonl(path: string) { return read(path).toString("utf8").split(/\r?\n/).filter(Boolean).map(line => z.record(z.string(), z.unknown()).parse(JSON.parse(line))); }
    // This existing verifier independently checks source files, manifest path/hash pins,
    // raw bytes, full 151-card/4-errata counts and the selected candidate's complete facts.
    execFileSync(process.execPath, ["--import", "tsx", resolve(root, "scripts/verify-api-admission-batch-v4-source.ts"), "--ai-root", ai], { cwd: root, stdio: "pipe" });
    const manifest = EngineCandidateManifestV1Schema.parse(JSON.parse(read("data/engine-candidates/manifest.v1.json").toString("utf8")));
    const processed = jsonl(manifest.source.cardDatabasePath).filter(r => r.id === JONIN);
    const candidates = jsonl("data/engine-candidates/card-catalog.v1.jsonl").map(c => EngineCardCandidateV1Schema.parse(c)).filter(c => c.sourceCardSlug === JONIN);
    assert.equal(processed.length, 1); assert.equal(candidates.length, 1);
    const rawBytes = read(JONIN_SOURCE_PIN.path), ruleBytes = read(V4_RULES_PIN.path);
    assert.equal(sha256(rawBytes), JONIN_SOURCE_PIN.rawSha256);
    assert.equal(gitBlob(ruleBytes), V4_RULES_PIN.gitBlob); assert.equal(sha256(ruleBytes), V4_RULES_PIN.sha256);
    const sourceRules = jsonl(V4_RULES_PIN.path);
    const selectedRules = V4_RULE_IDS.map(id => {
        const matches = sourceRules.filter(r => r.id === id); assert.equal(matches.length, 1, `Missing/duplicate rule ${id}`);
        return { id, text: z.string().parse(matches[0].text) };
    });
    const card = { schemaVersion: 1, authority: "EVIDENCE_ONLY", source: origin, rawSnapshot: "api-admission-batch-v4-jonin-source.v1.json",
        rawSha256: sha256(rawBytes), rawRecordHash: hashCanonical(JSON.parse(rawBytes.toString("utf8"))), manifest,
        processedRecordHash: hashCanonical(processed[0]), processedRecord: processed[0], candidate: candidates[0],
        matchingErrata: jsonl(manifest.source.errataPath).filter(e => e.card_id === JONIN) };
    const rules = { schemaVersion: 1, authority: "EVIDENCE_ONLY", source: { ...origin, ...V4_RULES_PIN }, projection, rules: selectedRules, rulesHash: hashCanonical(selectedRules) };
    return validateV4Evidence(card, rules);
}
