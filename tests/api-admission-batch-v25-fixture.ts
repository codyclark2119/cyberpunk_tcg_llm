import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV24Context, batchV24Input, v24Source } from "./api-admission-batch-v24-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V25 (plan section 6, scope 3c): a Unit whose "When this Unit steals a Gig" trigger readies another friendly Unit with power
// equal to the stolen Gig's value.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// steal-trigger pin table.
export const WRAITH = "wraith-marauders";
export const V25_SLUGS = [WRAITH] as const;
export const v25Source = v24Source; // Same raw snapshot commit as V7 to V24.
const MECHANICS = {
    [WRAITH]: { keywords: [], modifiers: [],
        abilities: [{ id: `${WRAITH}-steal-ready-unit@1`, trigger: "WHEN_GIG_STOLEN", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "READY_UNIT", target: { kind: "ANOTHER_FRIENDLY_UNIT", power: "EQUALS_STOLEN_GIG_VALUE" } }] }] }
};

export const batchV25Cards = V25_SLUGS.map(slug => {
    const r = v25Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V25 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V24 chain plus the V25 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV25Context() {
    const base = batchV24Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV25Cards], base.manifest.engine) };
}
export function batchV25Input(seed: string) { return batchV24Input(seed); }
