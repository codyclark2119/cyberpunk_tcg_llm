import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { hashCanonical } from "../../packages/domain/src/canonical";
import type snapshot from "../../tests/fixtures/api-admission-batch-v6-source-evidence.v1.json";

type SourceEvidence = typeof snapshot;
type JsonRecord = Record<string, unknown>;
export const V6_SOURCE_COMMIT = "af9e0e1dd93b7eb77db5883bdd18809c8446d856";
export const V6_SLUG = "trust-no-one";
export const V6_EVIDENCE_HASH = "b323d9f99193178990423d439357c059c8eb4a946a5e3357336310f939135499";
export const V6_RAW_SHA256 = "4c09d3def515cc4eddcfea91dbd87f7121fefb4d00255b0dccdf1d859ea7a0e5";
export function sha256(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
export function gitBlobSha(bytes: Buffer) {
    return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Checks retained evidence only. This never creates mechanics, revisions or execution admission. */
export function assertV6Snapshot(rawBytes: Buffer, evidence: unknown): asserts evidence is SourceEvidence {
    assert.equal(sha256(rawBytes), V6_RAW_SHA256, "V6_RAW_BYTES");
    assert.equal(hashCanonical(evidence), V6_EVIDENCE_HASH, "V6_EVIDENCE_PIN");
    const e = evidence as SourceEvidence; // The complete finite JSON object has just matched its reviewed pin.
    assert.equal(e.sourceCommit, V6_SOURCE_COMMIT);
    assert.equal(e.authority, "SOURCE_EVIDENCE_ONLY");
    assert.equal(gitBlobSha(rawBytes), e.rawGitBlob);
    assert.equal(hashCanonical(JSON.parse(rawBytes.toString("utf8"))), e.rawRecordHash);
    assert.equal(hashCanonical(e.processedRecord), e.processedRecordHash);
    assert.equal(hashCanonical(e.candidate), e.candidateRecordHash);
    assert.equal(e.candidate.sourceRecordHash, e.processedRecordHash);
    assert.equal(hashCanonical(e.rules), e.rulesProjectionHash);
    assert.deepEqual(e.candidate.errata, e.matchingErrata);
}

function records(bytes: Buffer): JsonRecord[] {
    return bytes.toString("utf8").split(/\r?\n/).filter(line => line.trim()).map(line => {
        const value: unknown = JSON.parse(line);
        assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "Expected a JSONL record");
        return value as JsonRecord;
    });
}
function one(rows: JsonRecord[], key: string, value: string): JsonRecord {
    const matching = rows.filter(row => row[key] === value);
    assert.equal(matching.length, 1, `Expected exactly one ${key}=${value}`);
    return matching[0];
}

/** Read-only independent check of the imported AI snapshot in this monorepo. */
export function verifyV6Source(repoRoot: string, rawBytes: Buffer, evidence: unknown) {
    assertV6Snapshot(rawBytes, evidence);
    const root = realpathSync(repoRoot);
    const head = () => execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.doesNotThrow(() => execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", V6_SOURCE_COMMIT, "HEAD"]),
        { message: "V6_SOURCE_HISTORY: imported AI source commit must remain an ancestor of this monorepo checkout" });
    const readPinned = (path: string, digest?: string) => {
        const committed = execFileSync("git", ["-C", root, "show", `${V6_SOURCE_COMMIT}:${path}`], { maxBuffer: 16 * 1024 * 1024 });
        const local = readFileSync(resolve(root, path));
        assert.ok(committed.equals(local), `V6_SOURCE_DIRTY: ${path}`);
        if (digest) assert.equal(sha256(local), digest, `V6_SOURCE_HASH: ${path}`);
        return local;
    };
    assert.ok(readPinned(evidence.rawPath, evidence.rawSha256).equals(rawBytes), "V6_SOURCE_RAW_MATCH");
    const m = evidence.manifest;
    assert.deepEqual(JSON.parse(readPinned("data/engine-candidates/manifest.v1.json").toString("utf8")), m);
    readPinned(m.source.cardIndexPath, m.source.cardIndexSha256);
    const processed = records(readPinned(m.source.cardDatabasePath, m.source.cardDatabaseSha256));
    const candidates = records(readPinned("data/engine-candidates/card-catalog.v1.jsonl", m.catalogSha256));
    const errata = records(readPinned(m.source.errataPath, m.source.errataSha256));
    const rules = records(readPinned(evidence.rulesPath, evidence.rulesSha256));
    assert.equal(processed.length, m.recordCount);
    assert.equal(candidates.length, m.recordCount);
    assert.equal(errata.length, m.errataCount);
    assert.equal(rules.length, 713);
    assert.deepEqual(one(processed, "id", V6_SLUG), evidence.processedRecord, "V6_PROCESSED_SOURCE");
    assert.deepEqual(one(candidates, "sourceCardSlug", V6_SLUG), evidence.candidate, "V6_CANDIDATE_SOURCE");
    const ruleIds = evidence.rules.map(rule => rule.id);
    assert.equal(new Set(ruleIds).size, ruleIds.length);
    for (const id of ruleIds) one(rules, "id", id);
    assert.deepEqual(rules.filter(rule => ruleIds.includes(String(rule.id))), evidence.rules, "V6_RULES_SOURCE");
    assert.deepEqual(errata.filter(item => item.card_id === V6_SLUG), evidence.matchingErrata, "V6_ERRATA_JOIN");
    const verifiedHead = head();
    assert.ok(verifiedHead.length === 40, "V6_MONOREPO_HEAD");
    return {
        schemaVersion: 1, result: "SOURCE_MATCH", sourceCommit: V6_SOURCE_COMMIT, monorepoHead: verifiedHead,
        sourceCardSlug: V6_SLUG, rawSha256: evidence.rawSha256,
        processedRecordHash: evidence.processedRecordHash, candidateRecordHash: evidence.candidateRecordHash,
        rules: ruleIds.length, matchingErrata: evidence.matchingErrata,
        admissionReady: false, revisionAssigned: false,
        note: "Source foundation only. Captured hints and rules are evidence, not executable card admission."
    };
}
