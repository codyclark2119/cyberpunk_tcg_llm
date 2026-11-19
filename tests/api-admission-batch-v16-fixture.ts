import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV15Context, batchV15Input, v15Source } from "./api-admission-batch-v15-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V16 (plan section 6, scope 3c): self play-cost reduction beyond plain Units. A Program that defeats a
// rival Unit with less power than a friendly Unit, and a Gear counting friendly face-up Legends. Source records
// are evidence only; mechanics are authored here and each card's complete shape is pinned literally in its gates.
export const CARNAGE = "carnage-at-the-colosseum", BERSERK = "zetatech-berserk";
export const V16_SLUGS = [CARNAGE, BERSERK] as const;
export const v16Source = v15Source; // Same raw snapshot commit as V7 to V15.
const reduction = (per: string) => ({ kind: "SELF_PLAY_COST_REDUCTION", per, amount: 1, minimum: 1 });
const MECHANICS = {
    [CARNAGE]: { keywords: [], modifiers: [reduction("FRIENDLY_GIG_VALUE_AT_LEAST_8")],
        abilities: [{ id: `${CARNAGE}-play-defeat@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "LESS_THAN_FRIENDLY_UNIT" } } }] }] },
    [BERSERK]: { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, keywords: [], abilities: [],
        modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, reduction("FRIENDLY_FACE_UP_LEGEND")] }
};
const SCOPE = { [CARNAGE]: "TARGETED_DEFEAT_V1", [BERSERK]: "PLAY_COST_REDUCTION_V1" };

export const batchV16Cards = V16_SLUGS.map(slug => {
    const r = v16Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: SCOPE[slug], status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V16 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-18", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V15 chain plus the V16 revisions. No new policy: both use reviewed V11/targeted-defeat policies. */
export function batchV16Context() {
    const base = batchV15Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV16Cards], base.manifest.engine) };
}
export function batchV16Input(seed: string) { return batchV15Input(seed); }
