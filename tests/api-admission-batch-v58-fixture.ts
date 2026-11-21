import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV57Context, batchV57Input, v57Source } from "./api-admission-batch-v57-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V58 (plan section 6, scope 3c): "{Quick} A friendly Unit has +1 power for each friendly face-up Legend while fighting
// rival Units this turn." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in the fight-power pin table.
export const SYNAPSE = "synapse-burnout";
export const V58_SLUGS = [SYNAPSE] as const;
export const v58Source = v57Source; // Same raw snapshot commit as V7 to V57.
const MECHANICS = {
    [SYNAPSE]: { keywords: ["QUICK"], modifiers: [],
        abilities: [{ id: `${SYNAPSE}-fight-power@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN", target: { kind: "FRIENDLY_UNIT" }, amount: 1 }] }] }
};

export const batchV58Cards = V58_SLUGS.map(slug => {
    const r = v58Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_REACT_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V58 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V57 chain plus the V58 revision. No new policy: the reviewed play, React and combat policies apply. */
export function batchV58Context() {
    const base = batchV57Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV58Cards], base.manifest.engine) };
}
export function batchV58Input(seed: string) { return batchV57Input(seed); }
