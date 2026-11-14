import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { HashSchema } from "@tcg/domain";
import {
    EngineCandidateManifestV1Schema, EngineCardCandidateV1Schema,
    type CandidateReview, type EngineCandidateManifestV1, type EngineCardCandidateV1
} from "./engine-candidates";

// Card coverage inventory (plan section 6, scope 1). Joins the engine-candidate
// review (which cards have a reviewed executable revision) with the hand-authored
// mechanic-family notes (what each card's text needs). The family file is review
// notes only: it never admits a card or supplies mechanics.

function sha256(data: string | Buffer) {
    return createHash("sha256").update(data).digest("hex");
}
function readJson(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function readJsonl(path: string) {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

export type VerifiedCandidates = { manifest: EngineCandidateManifestV1; candidates: EngineCardCandidateV1[] };

/** Load the candidate catalog and fail closed unless every manifest pin matches. */
export function loadVerifiedCandidates(candidateDir: string): VerifiedCandidates {
    const aiRoot = resolve(candidateDir, "../..");
    const manifest = EngineCandidateManifestV1Schema.parse(readJson(resolve(candidateDir, "manifest.v1.json")));
    const catalogPath = resolve(candidateDir, "card-catalog.v1.jsonl");
    if (sha256(readFileSync(catalogPath)) !== manifest.catalogSha256) throw new Error("candidate catalog SHA-256 does not match manifest");
    const candidates = readJsonl(catalogPath).map(value => EngineCardCandidateV1Schema.parse(value));
    if (candidates.length !== manifest.recordCount) throw new Error(`candidate record count ${candidates.length} != manifest ${manifest.recordCount}`);
    const errataCount = candidates.reduce((n, candidate) => n + candidate.errata.length, 0);
    if (errataCount !== manifest.errataCount) throw new Error(`candidate errata count ${errataCount} != manifest ${manifest.errataCount}`);
    for (const [pathKey, hashKey] of [
        ["cardDatabasePath", "cardDatabaseSha256"],
        ["cardIndexPath", "cardIndexSha256"],
        ["errataPath", "errataSha256"]
    ] as const) {
        const actual = sha256(readFileSync(resolve(aiRoot, manifest.source[pathKey])));
        if (actual !== manifest.source[hashKey]) throw new Error(`${pathKey} SHA-256 does not match manifest`);
    }
    return { manifest, candidates };
}

export const FAMILY_STATUSES = ["COVERED", "PARTIAL", "MISSING", "OUT_OF_SCOPE"] as const;
const FamilyName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
export const MechanicFamiliesV1Schema = z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("CYBERPUNK_MECHANIC_FAMILIES_V1"),
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    authority: z.literal("REVIEW_NOTES_ONLY"),
    note: z.string(),
    snapshot: z.strictObject({ catalogSha256: HashSchema, cardCount: z.number().int().nonnegative() }),
    statusMeaning: z.record(z.enum(FAMILY_STATUSES), z.string()),
    vocabulary: z.record(FamilyName, z.strictObject({
        status: z.enum(FAMILY_STATUSES),
        summary: z.string().min(1),
        coveredBy: z.strictObject({ executionScopes: z.array(z.string()), effectKinds: z.array(z.string()) }),
        notes: z.string()
    })),
    cards: z.record(z.string().min(1), z.strictObject({ families: z.array(FamilyName).min(1), note: z.string().optional() })),
    rulesQuestions: z.array(z.strictObject({ id: z.string().min(1), cards: z.array(z.string().min(1)), question: z.string().min(1) }))
});
export type MechanicFamiliesV1 = z.infer<typeof MechanicFamiliesV1Schema>;

export type CoverageCard = {
    cardId: string; displayName: string; type: string; colors: string[];
    admission: CandidateReview["status"]; revision: number | null;
    families: string[]; blockingFamilies: string[]; note: string | null;
};
export type CoverageFamily = {
    family: string; status: (typeof FAMILY_STATUSES)[number]; summary: string; notes: string;
    cardCount: number; notAdmittedCount: number; soleBlockerCount: number;
};

/**
 * Fails closed: the family file must pin the same catalog, name exactly the
 * candidate slugs, and use only its own vocabulary.
 */
export function buildCardCoverageReport(verified: VerifiedCandidates, reviews: readonly CandidateReview[], familiesInput: unknown) {
    const families = MechanicFamiliesV1Schema.parse(familiesInput);
    const { manifest, candidates } = verified;
    if (families.snapshot.catalogSha256 !== manifest.catalogSha256)
        throw new Error("mechanic-families snapshot.catalogSha256 does not match the candidate manifest");
    if (families.snapshot.cardCount !== candidates.length)
        throw new Error(`mechanic-families snapshot.cardCount ${families.snapshot.cardCount} != ${candidates.length} candidates`);
    const slugs = new Set(candidates.map(c => c.sourceCardSlug));
    const missing = [...slugs].filter(slug => !(slug in families.cards)).sort();
    if (missing.length) throw new Error(`mechanic-families has no entry for: ${missing.join(", ")}`);
    const unknown = Object.keys(families.cards).filter(slug => !slugs.has(slug)).sort();
    if (unknown.length) throw new Error(`mechanic-families names unknown slugs: ${unknown.join(", ")}`);
    for (const [slug, entry] of Object.entries(families.cards)) {
        const outside = entry.families.filter(f => !(f in families.vocabulary));
        if (outside.length) throw new Error(`${slug} uses families outside the vocabulary: ${outside.join(", ")}`);
        if (new Set(entry.families).size !== entry.families.length) throw new Error(`${slug} repeats a family`);
    }
    for (const q of families.rulesQuestions) {
        const bad = q.cards.filter(slug => !slugs.has(slug));
        if (bad.length) throw new Error(`rules question ${q.id} names unknown slugs: ${bad.join(", ")}`);
    }
    const reviewById = new Map(reviews.map(r => [r.cardId, r]));
    if (reviewById.size !== candidates.length) throw new Error("candidate review does not cover every candidate exactly once");

    const cards: CoverageCard[] = candidates.map(candidate => {
        const review = reviewById.get(candidate.sourceCardSlug);
        if (!review) throw new Error(`no candidate review for ${candidate.sourceCardSlug}`);
        const entry = families.cards[candidate.sourceCardSlug]!;
        const admitted = review.status === "SOURCE_MATCH";
        return {
            cardId: candidate.sourceCardSlug,
            displayName: candidate.identityCandidate.displayName,
            type: candidate.catalog.type,
            colors: [...candidate.catalog.colors],
            admission: review.status,
            revision: review.revision,
            families: [...entry.families].sort(),
            blockingFamilies: admitted ? [] : entry.families.filter(f => families.vocabulary[f]!.status !== "COVERED").sort(),
            note: entry.note ?? null
        };
    }).sort((a, b) => a.cardId.localeCompare(b.cardId));

    const familyRows: CoverageFamily[] = Object.entries(families.vocabulary).map(([family, v]) => {
        const using = cards.filter(c => c.families.includes(family));
        const notAdmitted = using.filter(c => c.admission !== "SOURCE_MATCH");
        return {
            family, status: v.status, summary: v.summary, notes: v.notes,
            cardCount: using.length,
            notAdmittedCount: notAdmitted.length,
            soleBlockerCount: notAdmitted.filter(c => c.blockingFamilies.length === 1 && c.blockingFamilies[0] === family).length
        };
    }).sort((a, b) => b.notAdmittedCount - a.notAdmittedCount || a.family.localeCompare(b.family));

    const count = (pred: (c: CoverageCard) => boolean) => cards.filter(pred).length;
    return {
        schemaVersion: 1 as const,
        kind: "CYBERPUNK_CARD_COVERAGE_V1" as const,
        note: "Planning report only. Families are review notes; admission still needs a reviewed CardRevisionSnapshot.",
        snapshot: { catalogSha256: manifest.catalogSha256, cardCount: cards.length, familiesReviewedAt: families.reviewedAt },
        totals: {
            cards: cards.length,
            admitted: count(c => c.admission === "SOURCE_MATCH"),
            notAdmitted: count(c => c.admission !== "SOURCE_MATCH"),
            notAdmittedOnlyCoveredFamilies: count(c => c.admission !== "SOURCE_MATCH" && c.blockingFamilies.length === 0),
            byAdmission: Object.fromEntries([...new Set(cards.map(c => c.admission))].sort().map(s => [s, count(c => c.admission === s)]))
        },
        families: familyRows,
        cards,
        rulesQuestions: families.rulesQuestions
    };
}
export type CardCoverageReport = ReturnType<typeof buildCardCoverageReport>;
