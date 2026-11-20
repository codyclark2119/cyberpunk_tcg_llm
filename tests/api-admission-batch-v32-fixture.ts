import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV31Context, batchV31Input, v31Source } from "./api-admission-batch-v31-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V32 (plan section 6, scope 3c): a Unit whose {Play} and {Attack} each let its controller discard 1 Program from hand and, if
// they do, bottom-deck a rival Unit.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Program-discard pin table.
export const PLACIDE = "placide-voodoo-sentinel";
export const V32_SLUGS = [PLACIDE] as const;
export const v32Source = v31Source; // Same raw snapshot commit as V7 to V31.
const EFFECT = { kind: "DISCARD_PROGRAMS_THEN_BOTTOM_DECK", count: 1, then: { relation: "RIVAL" } };
const MECHANICS = {
    [PLACIDE]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${PLACIDE}-play-discard-program-bottom-deck@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [EFFECT] },
            { id: `${PLACIDE}-attack-discard-program-bottom-deck@1`, trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [], effects: [EFFECT] }] }
};

export const batchV32Cards = V32_SLUGS.map(slug => {
    const r = v32Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V32 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V31 chain plus the V32 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV32Context() {
    const base = batchV31Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV32Cards], base.manifest.engine) };
}
export function batchV32Input(seed: string) { return batchV31Input(seed); }
