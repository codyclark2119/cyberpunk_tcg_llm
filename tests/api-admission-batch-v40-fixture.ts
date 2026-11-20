import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV39Context, batchV39Input, v39Source } from "./api-admission-batch-v39-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V40 (plan section 6, scope 3c): a Go Solo Legend that draws 1 when a friendly Legend steals an even Gig, and makes a
// Rival discard 1 when it steals an odd one.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// friendly-Legend steal pin table.
export const ROGUE = "rogue-amendiares-preem-solo";
export const V40_SLUGS = [ROGUE] as const;
export const v40Source = v39Source; // Same raw snapshot commit as V7 to V39.
const MECHANICS = {
    [ROGUE]: { keywords: ["GO_SOLO"], modifiers: [],
        abilities: [{ id: `${ROGUE}-friendly-legend-steal@1`, trigger: "WHEN_FRIENDLY_UNIT_STEALS_GIG", guard: "STEALER_IS_LEGEND", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD", count: 1 }] }] }
};

export const batchV40Cards = V40_SLUGS.map(slug => {
    const r = v40Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V40 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V39 chain plus the V40 revision. No new policy: the reviewed trigger and field-Legend policies apply. */
export function batchV40Context() {
    const base = batchV39Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV40Cards], base.manifest.engine) };
}
export function batchV40Input(seed: string) { return batchV39Input(seed); }
