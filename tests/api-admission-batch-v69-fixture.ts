import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV68Context, batchV68Input, v68Source } from "./api-admission-batch-v68-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V69 (plan section 6, scope 3c): NetWatch Netdriver, a Gear whose host inherits "When this Unit or Legend is spent, draw 1."
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the spend-trigger
// pin table.
export const NETDRIVER = "netwatch-netdriver";
export const V69_SLUGS = [NETDRIVER] as const;
export const v69Source = v68Source; // Same raw snapshot commit as V7 to V68.
const MECHANICS = {
    [NETDRIVER]: { keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, abilities: [
        { id: `${NETDRIVER}-spent-draw@1`, trigger: "WHEN_SPENT", inherited: "EQUIPPED_HOST", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }] }
};

export const batchV69Cards = V69_SLUGS.map(slug => {
    const r = v69Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V69 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V68 chain plus the V69 revision. No new policy: the reviewed Gear and trigger policies apply. */
export function batchV69Context() {
    const base = batchV68Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV69Cards], base.manifest.engine) };
}
export function batchV69Input(seed: string) { return batchV68Input(seed); }
