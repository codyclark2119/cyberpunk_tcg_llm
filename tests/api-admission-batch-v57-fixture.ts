import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV56Context, batchV56Input, v56Source } from "./api-admission-batch-v56-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V57 (plan section 6, scope 3c): "{Quick} A rival Unit steals 1 fewer Gig this turn. If that Unit is an AI, DRONE, or
// VEHICLE, draw 1." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in the steal-reduction pin table.
export const TAKE = "take-control";
export const V57_SLUGS = [TAKE] as const;
export const v57Source = v56Source; // Same raw snapshot commit as V7 to V56.
const MECHANICS = {
    [TAKE]: { keywords: ["QUICK"], modifiers: [],
        abilities: [{ id: `${TAKE}-steal-fewer@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "STEAL_FEWER_THIS_TURN", target: { kind: "RIVAL_UNIT" }, amount: 1, draw: { classifications: ["AI", "Drone", "Vehicle"], count: 1 } }] }] }
};

export const batchV57Cards = V57_SLUGS.map(slug => {
    const r = v57Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V57 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V56 chain plus the V57 revision. No new policy: the reviewed play, React and combat policies apply. */
export function batchV57Context() {
    const base = batchV56Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV57Cards], base.manifest.engine) };
}
export function batchV57Input(seed: string) { return batchV56Input(seed); }
