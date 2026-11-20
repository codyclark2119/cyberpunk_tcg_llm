import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV25Context, batchV25Input, v25Source } from "./api-admission-batch-v25-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V26 (plan section 6, scope 3c): a Unit that increases a Gig by up to 6 whenever a friendly Unit steals a d6.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// steal-trigger pin table.
export const RECRUITS = "6th-street-recruits";
export const V26_SLUGS = [RECRUITS] as const;
export const v26Source = v25Source; // Same raw snapshot commit as V7 to V25.
const MECHANICS = {
    [RECRUITS]: { keywords: [], modifiers: [],
        abilities: [{ id: `${RECRUITS}-friendly-d6-steal-increase@1`, trigger: "WHEN_FRIENDLY_UNIT_STEALS_GIG", guard: "STOLEN_GIG_IS_D6", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 6, direction: "INCREASE" }] }] }
};

export const batchV26Cards = V26_SLUGS.map(slug => {
    const r = v26Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V26 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V25 chain plus the V26 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV26Context() {
    const base = batchV25Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV26Cards], base.manifest.engine) };
}
export function batchV26Input(seed: string) { return batchV25Input(seed); }
