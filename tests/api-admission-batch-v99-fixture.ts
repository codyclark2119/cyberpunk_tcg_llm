import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV98Context, batchV98Input, v98Source } from "./api-admission-batch-v98-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V99 (plan section 6, bundle 15): Alt Cunningham: Mother of Daemons, "When a friendly equipped Unit or Legend is spent, draw 1.
// When a rival Unit would steal a Gig, you may discard 1 with cost equal to that Gig's value. If you do, the Gig isn't stolen." Source
// records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the spend-trigger pin table.
export const ALT = "alt-cunningham-mother-of-daemons";
export const V99_SLUGS = [ALT] as const;
export const v99Source = v98Source; // Same raw snapshot commit as V7 to V98.
const MECHANICS = {
    [ALT]: { keywords: [], modifiers: [{ kind: "MAY_DISCARD_GIG_VALUE_COST_TO_PREVENT_RIVAL_STEAL" }], abilities: [
        { id: `${ALT}-equipped-spend-draw@1`, trigger: "WHEN_SPENT", guard: "FRIENDLY_EQUIPPED_UNIT_OR_LEGEND_SPENT", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }] }
};

export const batchV99Cards = V99_SLUGS.map(slug => {
    const r = v99Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V99 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-26", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V98 chain plus the V99 revision. No new policy: the reviewed play, trigger and combat policies apply. */
export function batchV99Context() {
    const base = batchV98Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV99Cards], base.manifest.engine) };
}
export function batchV99Input(seed: string) { return batchV98Input(seed); }
