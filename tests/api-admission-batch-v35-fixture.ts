import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV34Context, batchV34Input, v34Source } from "./api-admission-batch-v34-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V35 (plan section 6, scope 3c): a Unit whose {Play} searches the top 4 cards of its controller's deck and adds any number
// whose cost equals a friendly Gig's value, bottom-decking the rest.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// cost-matching search pin table.
export const HANAKO_CAGE = "hanako-arasaka-in-a-gilded-cage";
export const V35_SLUGS = [HANAKO_CAGE] as const;
export const v35Source = v34Source; // Same raw snapshot commit as V7 to V34.
const MECHANICS = {
    [HANAKO_CAGE]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${HANAKO_CAGE}-play-search-cost-matching-gigs@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "SEARCH_COST_MATCHING_GIGS", count: 4 }] }] }
};

export const batchV35Cards = V35_SLUGS.map(slug => {
    const r = v35Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V35 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V34 chain plus the V35 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV35Context() {
    const base = batchV34Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV35Cards], base.manifest.engine) };
}
export function batchV35Input(seed: string) { return batchV34Input(seed); }
