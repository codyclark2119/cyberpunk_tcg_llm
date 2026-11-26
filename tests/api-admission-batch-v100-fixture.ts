import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV99Context, batchV99Input, v99Source } from "./api-admission-batch-v99-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V100 (plan section 6, bundle 16): Jackie Welles: Mama's Favorite, "[Go Solo] If a friendly Unit would be defeated, you may
// spend 1 €$ to defeat this Legend instead. (Remove it from the game.)" Source records are evidence only; mechanics are authored here and
// the card's complete shape is pinned literally in the defeat-replacement pin table.
export const JACKIE = "jackie-welles-mama-s-favorite";
export const V100_SLUGS = [JACKIE] as const;
export const v100Source = v99Source; // Same raw snapshot commit as V7 to V99.
const MECHANICS = {
    [JACKIE]: { keywords: ["GO_SOLO"], modifiers: [{ kind: "MAY_SPEND_TO_DEFEAT_THIS_LEGEND_INSTEAD_OF_FRIENDLY_UNIT", cost: 1 }], abilities: [] }
};

export const batchV100Cards = V100_SLUGS.map(slug => {
    const r = v100Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V100 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-26", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V99 chain plus the V100 revision. No new policy: the reviewed play, trigger, field-Legend and combat policies
 * apply. */
export function batchV100Context() {
    const base = batchV99Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV100Cards], base.manifest.engine) };
}
export function batchV100Input(seed: string) { return batchV99Input(seed); }
