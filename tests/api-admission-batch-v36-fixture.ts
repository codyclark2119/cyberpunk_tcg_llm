import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV35Context, batchV35Input, v35Source } from "./api-admission-batch-v35-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V36 (plan section 6, scope 3c): a Program that searches the top 3 cards of its controller's deck, adds 1 to hand, may add 1
// more for each friendly min Gig, and bottom-decks the rest.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Program search pin table.
export const THREE_MOUTHS = "three-mouths-one-desire";
export const V36_SLUGS = [THREE_MOUTHS] as const;
export const v36Source = v35Source; // Same raw snapshot commit as V7 to V35.
const MECHANICS = {
    [THREE_MOUTHS]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${THREE_MOUTHS}-search-take-one-plus-per-min-gig@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG", count: 3 }] }] }
};

export const batchV36Cards = V36_SLUGS.map(slug => {
    const r = v36Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V36 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V35 chain plus the V36 revision. No new policy: the reviewed card-play policy applies. */
export function batchV36Context() {
    const base = batchV35Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV36Cards], base.manifest.engine) };
}
export function batchV36Input(seed: string) { return batchV35Input(seed); }
