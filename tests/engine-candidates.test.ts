import test from "node:test";
import assert from "node:assert/strict";
import { CardIdSchema, CardRevisionSnapshotSchema } from "@tcg/domain";
import { demoReferenceContext } from "./demo-format-fixture";
import { EngineCandidateManifestV1Schema, EngineCardCandidateV1Schema, reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";

const reviewed = demoReferenceContext().content.cards
    .filter(card => card.schemaVersion === 2 && card.provenance.reviewed)
    .map(card => CardRevisionSnapshotSchema.parse(card));
const card = reviewed[0];
assert.ok(card);

function candidateFromReviewed() {
    return EngineCardCandidateV1Schema.parse({
        schemaVersion: 1,
        sourceCardSlug: card.id,
        sourceRecordHash: "1".repeat(64),
        identityCandidate: {
            cardId: card.id,
            deckbuildingIdentity: card.deckbuildingIdentity,
            subtitle: card.subtitle,
            displayName: card.displayName
        },
        catalog: {
            type: card.type,
            colors: card.colors,
            cost: card.printedCost.kind === "EDDIES" ? card.printedCost.amount : null,
            power: card.power ?? null,
            ram: card.ram ? Object.values(card.ram)[0] ?? null : null,
            sellable: card.sellProfile.allowed,
            classifications: card.tags,
            rarity: card.rarity ?? null,
            setCode: card.setCode,
            setName: card.setName,
            collectorNumber: card.cardNumber,
            artist: null,
            legality: "legal",
            imageUrl: card.imageUrl ?? null
        },
        rulesSource: {
            markup: card.sourceMarkup,
            rendered: card.rulesText.replaceAll("{", "[").replaceAll("}", "]"),
            keywordHints: [],
            referencedKeywordHints: [],
            timingTriggerHints: []
        },
        printings: card.printings.map(printing => ({
            setCode: printing.setCode,
            setName: null,
            collectorNumber: printing.collectorNumber,
            rarity: null,
            finish: null,
            artist: null,
            imageUrl: null
        })),
        errata: []
    });
}

test("candidate manifest pins source-only authority boundary independent of field order", () => {
    const manifest = EngineCandidateManifestV1Schema.parse({
        schemaVersion: 1,
        kind: "CYBERPUNK_ENGINE_CANDIDATES_V1",
        authority: "SOURCE_CANDIDATES_ONLY",
        recordCount: 151,
        errataCount: 4,
        catalogSha256: "2".repeat(64),
        forbiddenAuthority: ["status", "reviewed", "execution", "mechanics", "revision"],
        source: {
            cardDatabasePath: "data/processed/card_database.jsonl", cardDatabaseSha256: "3".repeat(64),
            cardIndexPath: "data/raw/cards/_index.json", cardIndexSha256: "4".repeat(64),
            errataPath: "data/processed/errata.jsonl", errataSha256: "5".repeat(64)
        }
    });
    assert.equal(manifest.authority, "SOURCE_CANDIDATES_ONLY");
});

test("rendered retrieval text does not create source drift, but raw markup changes do", () => {
    const exact = candidateFromReviewed();
    assert.equal(reviewEngineCandidateV1(exact, reviewed).status, "SOURCE_MATCH");

    const displayOnly = structuredClone(exact);
    displayOnly.rulesSource.rendered += " display-only change";
    assert.equal(reviewEngineCandidateV1(displayOnly, reviewed).status, "SOURCE_MATCH");

    const drifted = structuredClone(exact);
    drifted.rulesSource.markup += " changed";
    const drift = reviewEngineCandidateV1(drifted, reviewed);
    assert.equal(drift.status, "SOURCE_DRIFT");
    assert.deepEqual(drift.differences, ["sourceMarkup"]);

    const fresh = structuredClone(exact);
    fresh.sourceCardSlug = "not-yet-reviewed";
    fresh.identityCandidate.cardId = CardIdSchema.parse("not-yet-reviewed");
    assert.equal(reviewEngineCandidateV1(fresh, reviewed).status, "NOT_ADMITTED");
});

test("unknown source mechanics hints fail closed and never synthesize engine mechanics", () => {
    const candidate = candidateFromReviewed();
    candidate.rulesSource.keywordHints.push("Future Keyword");
    const review = reviewEngineCandidateV1(candidate, reviewed);
    assert.equal(review.status, "UNSUPPORTED_HINT");
    assert.deepEqual(review.unsupportedHints, ["keyword:Future Keyword"]);
    assert.equal("mechanics" in candidate, false);
    assert.equal("revision" in candidate, false);
});
