import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV52Context, batchV52Input, v52Source } from "./api-admission-batch-v52-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V53 (plan section 6, scope 3c): "Play your first CYBERWARE Gear each turn for -3 €$, to a minimum of 1 €$." Source
// records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the play-cost
// reduction pin table.
export const VIKTOR = "viktor-vektor-drop-your-illusions";
export const V53_SLUGS = [VIKTOR] as const;
export const v53Source = v52Source; // Same raw snapshot commit as V7 to V52.
const MECHANICS = {
    [VIKTOR]: { keywords: [], abilities: [], modifiers: [{ kind: "FIRST_GEAR_PLAY_COST_REDUCTION", classification: "Cyberware", amount: 3, minimum: 1 }] }
};

export const batchV53Cards = V53_SLUGS.map(slug => {
    const r = v53Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "PLAY_COST_REDUCTION_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V53 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V52 chain plus the V53 revision. No new policy: the reviewed play, cost-reduction and trigger policies apply. */
export function batchV53Context() {
    const base = batchV52Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV53Cards], base.manifest.engine) };
}
export function batchV53Input(seed: string) { return batchV52Input(seed); }
