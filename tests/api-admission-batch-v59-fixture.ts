import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV58Context, batchV58Input, v58Source } from "./api-admission-batch-v58-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V59 (plan section 6, scope 3c): a Legend with "{Spend} Swap a friendly Gig with a rival Gig." and "At the start of your
// turn, draw 1 for each friendly value-pair of Gigs." Source records are evidence only; mechanics are authored here and the card's
// complete shape is pinned literally in the Legend {Spend} pin table.
export const HANAKO = "hanako-arasaka-daughter-of-the-emperor";
export const V59_SLUGS = [HANAKO] as const;
export const v59Source = v58Source; // Same raw snapshot commit as V7 to V58.
const MECHANICS = {
    [HANAKO]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${HANAKO}-spend-swap@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }, cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "SWAP_GIGS" }] },
            { id: `${HANAKO}-start-value-pair-draw@1`, trigger: "WHEN_OWN_TURN_STARTS", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "DRAW_PER_FRIENDLY_VALUE_PAIR", count: 1 }] }] }
};

export const batchV59Cards = V59_SLUGS.map(slug => {
    const r = v59Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V59 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V58 chain plus the V59 revision. No new policy: the reviewed play, Call and value policies apply. */
export function batchV59Context() {
    const base = batchV58Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV59Cards], base.manifest.engine) };
}
export function batchV59Input(seed: string) { return batchV58Input(seed); }
