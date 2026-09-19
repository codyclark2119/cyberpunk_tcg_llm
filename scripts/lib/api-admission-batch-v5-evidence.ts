import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { canonicalSerialize, hashCanonical } from "@tcg/domain";
import { EngineCandidateManifestV1Schema, EngineCardCandidateV1Schema } from "./engine-candidates";

// Immutable source pins only. This module must not import an executable revision.
export const DETONATE_SOURCE_PIN = {
    repository: "codyclark2119/cyberpunk_tcg_ai",
    commit: "af9e0e1dd93b7eb77db5883bdd18809c8446d856",
    path: "data/raw/cards/detonate.json",
    gitBlob: "cce28a602b8c645e62d637d70f6fa717499df646",
    rawSha256: "23b8734ca36627e9ec88ee00c06bf7a6f24154ebf8d3d6e5fa72f4c7424eba8b",
    recordHash: "6d9353061811cacef33e1082cc46fdf0cf827b62d930043284f9924784007418",
    catalogSha256: "b96ca8d583ab087148c9ed3563379e6c42fd9e729188a042215bb503a8879c3d",
    processedErrataSha256: "16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340"
} as const;
export const V5_PROCESSED_HASH = "aeaf918462702fb4d4a84ae8939607472b008fb388e6b0e5fe15911dd33f8582";
export const V5_CANDIDATE_HASH = "3c03e9f500602742f8a71531983b589e4220f5a7b9372115173d60fd0c54be60";
export const V5_MANIFEST_HASH = "fbb291603ee64738a4aa6869a9f5814fbefb65f9bdf631d22ab7811307389e2a";
export const V5_RULES_PIN = { path: "data/processed/rules.jsonl", gitBlob: "5d8343c6fa8a596e354a2868a8bd511a6b04ca0e", sha256: "1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19" } as const;
export const V5_RULE_IDS = ["1.7.2", "1.7.2.1", "1.7.2.2", "3.17.2", "3.17.3", "3.17.3.1", "3.17.3.2", "3.17.3.3", "3.17.4", "4.10", "4.10.1", "4.10.2", "4.11.1", "4.11.2", "4.11.3", "4.11.3.1", "4.12", "4.12.1", "4.12.2", "5.7.4", "5.7.4.1", "9.10", "9.10.1", "9.19.1", "9.19.1.1", "9.19.3", "11.6.1", "11.6.1.2", "11.6.4", "11.6.5", "11.19.1", "11.19.2", "11.26.1", "11.26.1.1", "11.26.1.2", "11.26.2"] as const;
export const V5_RULES_PROJECTION_HASH = "5331d2e400f10a119a1065e9e7ac9747c806e783a030d3437a6fa468de805755";
export const V5_REVIEWED_DECISIONS = [
    {
        id: "GEAR_OWN_EFFECTIVE_POWER_V1", classification: "REVIEWED_RULE_INTERPRETATION",
        ruleIds: ["3.17.3.2", "3.17.3.3", "3.17.2", "3.17.3.1", "11.6.5"],
        decision: "For this admitted effect, reference the target Gear instance's own effective power and require referencedPower(power) <= 2; never substitute the host's power or bypass the authoritative query with revision.power.",
        reviewMethod: "Review of the pinned Gear power rules: Gear contributes power to its host, while only an effect specifically targeting the Gear may modify the Gear's power.",
        limitation: "The current reviewed Gear powers are nonnegative, so the reference clamp is a no-op. This decision does not admit general Gear modifiers or treat a null power reference as zero."
    },
    {
        id: "LEGENDS_AREA_GEAR_TARGET_V1", classification: "REVIEWED_RULE_INTERPRETATION",
        ruleIds: ["4.10.2", "1.7.2", "11.6.1.2", "5.7.4", "5.7.4.1"],
        decision: "For this admitted effect, rival face-up Gear attached to a face-up Legend in LEGENDS is eligible when its own referenced effective power is at most 2, as is eligible Gear attached to a battlefield host.",
        reviewMethod: "Combined review of the pinned equip areas, controller relation, Gear defeat and public Legends-area rules, together with Detonate's unqualified rival-Gear text; not equip legality alone.",
        limitation: "This decision targets the Gear, not its host Legend. Hidden, face-down, unattached, invalid, Trash and Removed arrangements remain excluded."
    },
    {
        id: "DEFEATED_GEAR_TO_OWNER_TRASH_V1", classification: "REVIEWED_INFERENCE",
        ruleIds: ["11.6.1.2", "9.19.1.1", "4.12.1"],
        decision: "For this admitted effect, move the defeated Gear alone to its owner's Trash and detach it; keep its host and sibling Gear in place.",
        reviewMethod: "Reviewer-reported regex/subtree search over 713 processed rules nodes; defeat matches outside 9.19, full 5.7 and 11.6, and 4.10–4.12; not an exhaustive line-by-line audit.",
        limitation: "No rule matching that reviewed search directly covers defeated-Gear destination. This is not a quotation, publisher ruling, general defeat rule, or claim of exhaustive absence."
    }
] as const;
const origin = { repository: DETONATE_SOURCE_PIN.repository, commit: DETONATE_SOURCE_PIN.commit };
const projection = "Exact id/text fields from the pinned processed rules records; no wording corrections. Authored decisions are separate from these excerpts.";
const root = fileURLToPath(new URL("../../", import.meta.url));
const rawSnapshot = "api-admission-batch-v5-detonate-source.v1.json";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Origin = z.strictObject({ repository: z.literal(DETONATE_SOURCE_PIN.repository), commit: z.literal(DETONATE_SOURCE_PIN.commit) });
const CardEvidence = z.strictObject({ schemaVersion: z.literal(1), authority: z.literal("EVIDENCE_ONLY"), source: Origin,
    rawSnapshot: z.literal(rawSnapshot), rawSha256: Hash, rawRecordHash: Hash,
    manifest: EngineCandidateManifestV1Schema, processedRecordHash: Hash, processedRecord: z.record(z.string(), z.unknown()),
    candidateHash: Hash, candidate: EngineCardCandidateV1Schema, matchingErrata: z.array(z.unknown()).length(0) });
const Decision = z.strictObject({ id: z.string(), classification: z.enum(["REVIEWED_RULE_INTERPRETATION", "REVIEWED_INFERENCE"]),
    ruleIds: z.array(z.string()), decision: z.string(), reviewMethod: z.string(), limitation: z.string() });
const RuleEvidence = z.strictObject({ schemaVersion: z.literal(1), authority: z.literal("EVIDENCE_ONLY"),
    source: Origin.extend({ path: z.literal(V5_RULES_PIN.path), gitBlob: z.literal(V5_RULES_PIN.gitBlob), sha256: z.literal(V5_RULES_PIN.sha256) }),
    projection: z.literal(projection), rules: z.array(z.strictObject({ id: z.string(), text: z.string() })), rulesHash: Hash,
    decisions: z.array(Decision), decisionsHash: Hash });
export const evidenceBytes = (value: unknown) => JSON.stringify(JSON.parse(canonicalSerialize(value)), null, 2) + "\n";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const gitBlob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const parseJson = (bytes: Buffer): unknown => JSON.parse(bytes.toString("utf8"));
const jsonl = (bytes: Buffer) => bytes.toString("utf8").split(/\r?\n/).filter(Boolean).map(line => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));

/** Offline verification only: no source hint or authored evidence decision grants execution. */
export function validateV5Evidence(cardInput: unknown, rulesInput: unknown,
    rawBytes = readFileSync(resolve(root, "tests/fixtures", rawSnapshot))) {
    const card = CardEvidence.parse(cardInput), rules = RuleEvidence.parse(rulesInput), c = card.candidate;
    assert.equal(sha256(rawBytes), DETONATE_SOURCE_PIN.rawSha256, "V5_RAW_SOURCE_PIN");
    assert.equal(gitBlob(rawBytes), DETONATE_SOURCE_PIN.gitBlob, "V5_RAW_GIT_BLOB");
    assert.equal(hashCanonical(parseJson(rawBytes)), DETONATE_SOURCE_PIN.recordHash, "V5_RAW_RECORD_PIN");
    assert.equal(card.rawSha256, DETONATE_SOURCE_PIN.rawSha256); assert.equal(card.rawRecordHash, DETONATE_SOURCE_PIN.recordHash);
    // Pin complete records, including printing metadata and source hints, rather than selected convenient fields.
    assert.equal(hashCanonical(card.manifest), V5_MANIFEST_HASH, "V5_MANIFEST_PIN");
    assert.equal(card.processedRecordHash, V5_PROCESSED_HASH, "V5_PROCESSED_PIN");
    assert.equal(hashCanonical(card.processedRecord), V5_PROCESSED_HASH, "V5_PROCESSED_RECORD");
    assert.equal(card.candidateHash, V5_CANDIDATE_HASH, "V5_CANDIDATE_PIN");
    assert.equal(hashCanonical(c), V5_CANDIDATE_HASH, "V5_CANDIDATE_RECORD");
    assert.equal(c.sourceRecordHash, V5_PROCESSED_HASH); assert.equal(card.processedRecord.id, "detonate");
    assert.equal(c.sourceCardSlug, "detonate"); assert.deepEqual(c.errata, []);
    assert.deepEqual(c.rulesSource.keywordHints, ["Quick"], "parser hints remain evidence only");
    assert.deepEqual(rules.rules.map(r => r.id), [...V5_RULE_IDS], "V5_EXACT_RULE_SET");
    assert.equal(rules.rulesHash, V5_RULES_PROJECTION_HASH, "V5_RULES_PIN");
    assert.equal(hashCanonical(rules.rules), V5_RULES_PROJECTION_HASH, "V5_EXACT_RULE_TEXT");
    assert.deepEqual(rules.decisions, V5_REVIEWED_DECISIONS, "V5_REVIEWED_DECISIONS");
    assert.equal(rules.decisionsHash, hashCanonical(V5_REVIEWED_DECISIONS), "V5_DECISION_HASH");
    for (const decision of rules.decisions)
        for (const id of decision.ruleIds) assert.ok(rules.rules.some(rule => rule.id === id), `Missing decision basis ${id}`);
    return { card, rules };
}

/** Rebuild evidence from an independently pinned AI checkout, never from the fixtures being checked. */
export function captureV5Evidence(aiRoot: string) {
    const ai = realpathSync(resolve(aiRoot));
    const git = (...args: string[]) => execFileSync("git", ["-C", ai, ...args], { maxBuffer: 16 * 1024 * 1024 });
    assert.equal(git("rev-parse", "HEAD").toString("utf8").trim(), DETONATE_SOURCE_PIN.commit, "V5_AI_CHECKOUT_COMMIT");
    function read(path: string) {
        const resolved = realpathSync(resolve(ai, path)), rel = relative(ai, resolved);
        if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) throw new Error("Evidence path escapes the AI checkout");
        const bytes = readFileSync(resolved);
        assert.deepEqual(bytes, git("show", `${DETONATE_SOURCE_PIN.commit}:${path}`), `V5_PINNED_FILE_BYTES: ${path}`);
        return bytes;
    }
    const manifest = EngineCandidateManifestV1Schema.parse(parseJson(read("data/engine-candidates/manifest.v1.json")));
    assert.equal(hashCanonical(manifest), V5_MANIFEST_HASH, "V5_MANIFEST_PIN");
    const catalogBytes = read("data/engine-candidates/card-catalog.v1.jsonl");
    assert.equal(sha256(catalogBytes), DETONATE_SOURCE_PIN.catalogSha256);
    assert.equal(manifest.catalogSha256, DETONATE_SOURCE_PIN.catalogSha256);
    for (const [pathKey, hashKey] of [["cardDatabasePath", "cardDatabaseSha256"], ["cardIndexPath", "cardIndexSha256"], ["errataPath", "errataSha256"]] as const)
        assert.equal(sha256(read(manifest.source[pathKey])), manifest.source[hashKey], pathKey);
    const candidates = jsonl(catalogBytes).map(c => EngineCardCandidateV1Schema.parse(c));
    const processed = jsonl(read(manifest.source.cardDatabasePath));
    const errata = jsonl(read(manifest.source.errataPath));
    assert.equal(candidates.length, 151); assert.equal(processed.length, 151); assert.equal(errata.length, 4);
    assert.equal(candidates.reduce((count, c) => count + c.errata.length, 0), 4);
    const selectedCandidates = candidates.filter(c => c.sourceCardSlug === "detonate"), selectedProcessed = processed.filter(r => r.id === "detonate");
    assert.equal(selectedCandidates.length, 1); assert.equal(selectedProcessed.length, 1);
    const rawBytes = read(DETONATE_SOURCE_PIN.path), ruleBytes = read(V5_RULES_PIN.path);
    assert.equal(gitBlob(ruleBytes), V5_RULES_PIN.gitBlob); assert.equal(sha256(ruleBytes), V5_RULES_PIN.sha256);
    const sourceRules = jsonl(ruleBytes); assert.equal(sourceRules.length, 713);
    const selectedRules = V5_RULE_IDS.map(id => {
        const matches = sourceRules.filter(r => r.id === id); assert.equal(matches.length, 1, `Missing/duplicate rule ${id}`);
        return { id, text: z.string().parse(matches[0].text) };
    });
    const card = { schemaVersion: 1, authority: "EVIDENCE_ONLY", source: origin, rawSnapshot,
        rawSha256: sha256(rawBytes), rawRecordHash: hashCanonical(parseJson(rawBytes)), manifest,
        processedRecordHash: hashCanonical(selectedProcessed[0]), processedRecord: selectedProcessed[0],
        candidateHash: hashCanonical(selectedCandidates[0]), candidate: selectedCandidates[0], matchingErrata: errata.filter(e => e.card_id === "detonate") };
    const rules = { schemaVersion: 1, authority: "EVIDENCE_ONLY", source: { ...origin, ...V5_RULES_PIN }, projection,
        rules: selectedRules, rulesHash: hashCanonical(selectedRules), decisions: V5_REVIEWED_DECISIONS, decisionsHash: hashCanonical(V5_REVIEWED_DECISIONS) };
    return { ...validateV5Evidence(card, rules, rawBytes), rawBytes };
}
