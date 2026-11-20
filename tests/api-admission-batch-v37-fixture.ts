import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV36Context, batchV36Input, v36Source } from "./api-admission-batch-v36-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V37 (plan section 6, scope 3c): a Program that may set a Gig's value to another Gig's value, then draws 1 if its
// controller has a value-pair.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Program Gig-set pin table.
export const PEACE_OFFERING = "peace-offering";
export const V37_SLUGS = [PEACE_OFFERING] as const;
export const v37Source = v36Source; // Same raw snapshot commit as V7 to V36.
const MECHANICS = {
    [PEACE_OFFERING]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${PEACE_OFFERING}-set-gig-then-value-pair-draw@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [
                    { kind: "SET_GIG_TO_ANOTHER_GIG_VALUE", optional: true },
                    { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "CONTROLS_VALUE_PAIR" }, count: 1 }] }] }
};

export const batchV37Cards = V37_SLUGS.map(slug => {
    const r = v37Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V37 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V36 chain plus the V37 revision. No new policy: the reviewed card-play policy applies. */
export function batchV37Context() {
    const base = batchV36Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV37Cards], base.manifest.engine) };
}
export function batchV37Input(seed: string) { return batchV36Input(seed); }
