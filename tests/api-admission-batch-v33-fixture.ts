import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV32Context, batchV32Input, v32Source } from "./api-admission-batch-v32-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V33 (plan section 6, scope 3c): a Unit whose {Play} lets its controller discard 2 Programs from hand and, if they do,
// bottom-deck a rival Unit with no Gear attached.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Program-discard pin table.
export const MAMAN = "maman-brigitte-spirit-of-death";
export const V33_SLUGS = [MAMAN] as const;
export const v33Source = v32Source; // Same raw snapshot commit as V7 to V32.
const MECHANICS = {
    [MAMAN]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${MAMAN}-play-discard-two-programs-bottom-deck@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "DISCARD_PROGRAMS_THEN_BOTTOM_DECK", count: 2, then: { relation: "RIVAL", unequipped: true } }] }] }
};

export const batchV33Cards = V33_SLUGS.map(slug => {
    const r = v33Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V33 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V32 chain plus the V33 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV33Context() {
    const base = batchV32Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV33Cards], base.manifest.engine) };
}
export function batchV33Input(seed: string) { return batchV32Input(seed); }
