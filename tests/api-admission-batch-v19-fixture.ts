import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV18Context, batchV18Input, v18Source } from "./api-admission-batch-v18-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V19 (plan section 6, scope 3c): an [Attack] search of the top 3 cards for a Gear.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in its attack-search gate.
export const RIPPER = "sketchy-ripper";
export const V19_SLUGS = [RIPPER] as const;
export const v19Source = v18Source; // Same raw snapshot commit as V7 to V18.
const MECHANICS = {
    [RIPPER]: { keywords: [], modifiers: [],
        abilities: [{ id: `${RIPPER}-attack-search@1`, trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "SEARCH_GEAR", count: 3, maxTake: 1 }] }] }
};

export const batchV19Cards = V19_SLUGS.map(slug => {
    const r = v19Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, power: r.power,
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V19 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V18 chain plus the V19 revision. No new policy: the reviewed combat, trigger and Call-search policies apply. */
export function batchV19Context() {
    const base = batchV18Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV19Cards], base.manifest.engine) };
}
export function batchV19Input(seed: string) { return batchV18Input(seed); }
