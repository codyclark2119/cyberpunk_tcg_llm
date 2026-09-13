import { z } from "zod";
import { CardColorSchema, CardRevisionSnapshotSchema, CardTypeSchema, CardIdSchema, HashSchema, type CardRevisionSnapshot } from "@tcg/domain";

const FORBIDDEN_AUTHORITY_FIELDS = ["revision", "mechanics", "execution", "reviewed", "status"] as const;
const ForbiddenAuthoritySchema = z.enum(FORBIDDEN_AUTHORITY_FIELDS);
export const EngineCandidateManifestV1Schema = z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("CYBERPUNK_ENGINE_CANDIDATES_V1"),
    authority: z.literal("SOURCE_CANDIDATES_ONLY"),
    recordCount: z.number().int().nonnegative(),
    errataCount: z.number().int().nonnegative(),
    catalogSha256: HashSchema,
    forbiddenAuthority: z.array(ForbiddenAuthoritySchema).length(FORBIDDEN_AUTHORITY_FIELDS.length),
    source: z.strictObject({
        cardDatabasePath: z.string().min(1), cardDatabaseSha256: HashSchema,
        cardIndexPath: z.string().min(1), cardIndexSha256: HashSchema,
        errataPath: z.string().min(1), errataSha256: HashSchema
    })
}).superRefine((manifest, context) => {
    const expected = [...FORBIDDEN_AUTHORITY_FIELDS].sort();
    const actual = [...new Set(manifest.forbiddenAuthority)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        context.addIssue({ code: "custom", message: "forbiddenAuthority must contain the exact V1 authority boundary" });
});
export type EngineCandidateManifestV1 = z.infer<typeof EngineCandidateManifestV1Schema>;

const NullableText = z.string().nullable();
const CandidatePrintingSchema = z.strictObject({
    setCode: NullableText, setName: NullableText, collectorNumber: NullableText,
    rarity: NullableText, finish: NullableText, artist: NullableText,
    imageUrl: z.url().nullable()
});
const CandidateErratumSchema = z.strictObject({
    id: z.string().min(1), heading: z.string().min(1), variant: NullableText,
    text: z.string(), pageUpdatedAt: z.string().min(1)
});
export const EngineCardCandidateV1Schema = z.strictObject({
    schemaVersion: z.literal(1),
    sourceCardSlug: z.string().min(1),
    sourceRecordHash: HashSchema,
    identityCandidate: z.strictObject({
        cardId: CardIdSchema,
        deckbuildingIdentity: z.string().min(1),
        subtitle: z.string(),
        displayName: z.string().min(1)
    }),
    catalog: z.strictObject({
        type: CardTypeSchema,
        colors: z.array(CardColorSchema).min(1),
        cost: z.number().int().nonnegative().nullable(),
        power: z.number().int().nullable(),
        ram: z.number().int().nonnegative().nullable(),
        sellable: z.boolean().nullable(),
        classifications: z.array(z.string()),
        rarity: NullableText,
        setCode: NullableText,
        setName: NullableText,
        collectorNumber: NullableText,
        artist: NullableText,
        legality: NullableText,
        imageUrl: z.url().nullable()
    }),
    rulesSource: z.strictObject({
        markup: z.string(), rendered: z.string(),
        keywordHints: z.array(z.string()),
        referencedKeywordHints: z.array(z.string()),
        timingTriggerHints: z.array(z.string())
    }),
    printings: z.array(CandidatePrintingSchema),
    errata: z.array(CandidateErratumSchema)
}).superRefine((candidate, context) => {
    if (candidate.sourceCardSlug !== candidate.identityCandidate.cardId)
        context.addIssue({ code: "custom", message: "sourceCardSlug must equal identityCandidate.cardId" });
});
export type EngineCardCandidateV1 = z.infer<typeof EngineCardCandidateV1Schema>;

const KEYWORD_HINTS = new Set<string>(["Go Solo", "Quick", "Blocker", "Adrenaline"]);
const TIMING_HINTS = new Set<string>(["Call", "Play", "Attack", "Defeated"]);

export type CandidateReview = {
    cardId: string;
    status: "NOT_ADMITTED" | "SOURCE_MATCH" | "SOURCE_DRIFT" | "UNSUPPORTED_HINT";
    revision: number | null;
    differences: string[];
    unsupportedHints: string[];
};

function unique(values: string[]) { return [...new Set(values)].sort(); }
function candidateDifferences(candidate: EngineCardCandidateV1, card: CardRevisionSnapshot) {
    const differences: string[] = [];
    const same = (label: string, left: unknown, right: unknown) => {
        if (JSON.stringify(left) !== JSON.stringify(right)) differences.push(label);
    };
    same("deckbuildingIdentity", candidate.identityCandidate.deckbuildingIdentity, card.deckbuildingIdentity);
    same("subtitle", candidate.identityCandidate.subtitle, card.subtitle);
    same("displayName", candidate.identityCandidate.displayName, card.displayName);
    same("type", candidate.catalog.type, card.type);
    same("colors", candidate.catalog.colors, card.colors);
    same("classifications", candidate.catalog.classifications, card.tags);
    same("sellable", candidate.catalog.sellable, card.sellProfile.allowed);
    // Reviewed engine snapshots intentionally preserve the raw API markup in
    // both rulesText and sourceMarkup. The bridge's rendered form is for
    // retrieval/model display only and is not source identity.
    same("rulesText", candidate.rulesSource.markup, card.rulesText);
    same("sourceMarkup", candidate.rulesSource.markup, card.sourceMarkup);
    return differences;
}

export function reviewEngineCandidateV1(candidateInput: unknown, reviewedCards: readonly CardRevisionSnapshot[]): CandidateReview {
    const candidate = EngineCardCandidateV1Schema.parse(candidateInput);
    const unsupportedHints = unique([
        ...candidate.rulesSource.keywordHints.filter(h => !KEYWORD_HINTS.has(h)).map(h => `keyword:${h}`),
        ...candidate.rulesSource.timingTriggerHints.filter(h => !TIMING_HINTS.has(h)).map(h => `timing:${h}`)
    ]);
    const sameId = reviewedCards.filter(card => card.id === candidate.identityCandidate.cardId);
    const latest = [...sameId].sort((a, b) => b.revision - a.revision)[0];
    if (unsupportedHints.length)
        return { cardId: candidate.identityCandidate.cardId, status: "UNSUPPORTED_HINT", revision: latest?.revision ?? null, differences: [], unsupportedHints };
    if (!latest)
        return { cardId: candidate.identityCandidate.cardId, status: "NOT_ADMITTED", revision: null, differences: [], unsupportedHints: [] };
    const differences = candidateDifferences(candidate, CardRevisionSnapshotSchema.parse(latest));
    return { cardId: candidate.identityCandidate.cardId, status: differences.length ? "SOURCE_DRIFT" : "SOURCE_MATCH", revision: latest.revision, differences, unsupportedHints: [] };
}

export function reviewEngineCandidateCatalogV1(candidateInputs: readonly unknown[], reviewedCards: readonly CardRevisionSnapshot[]) {
    const candidates = candidateInputs.map(input => EngineCardCandidateV1Schema.parse(input));
    if (new Set(candidates.map(c => c.identityCandidate.cardId)).size !== candidates.length)
        throw new Error("duplicate candidate cardId");
    return candidates.map(candidate => reviewEngineCandidateV1(candidate, reviewedCards));
}
