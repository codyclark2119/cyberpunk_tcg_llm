import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV54Context, batchV54Input, v54Source } from "./api-admission-batch-v54-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V55 (plan section 6, scope 3c): "{Play} You may defeat a friendly Gear. If you do, defeat a rival Unit with cost 3 or
// less." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in
// the Gear-defeat Unit pin table.
export const MATON = "gilded-mato-n";
export const V55_SLUGS = [MATON] as const;
export const v55Source = v54Source; // Same raw snapshot commit as V7 to V54.
const MECHANICS = {
    [MATON]: { keywords: [], modifiers: [],
        abilities: [{ id: `${MATON}-play-gear-defeat@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DEFEAT_UNIT", target: { kind: "GEAR", relation: "FRIENDLY" }, optional: true, then: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, cost: { kind: "AT_MOST", value: 3 } } }] }] }
};

export const batchV55Cards = V55_SLUGS.map(slug => {
    const r = v55Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "TARGETED_GEAR_DEFEAT_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V55 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V54 chain plus the V55 revision. No new policy: the reviewed play, trigger and Gear-defeat policies apply. */
export function batchV55Context() {
    const base = batchV54Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV55Cards], base.manifest.engine) };
}
export function batchV55Input(seed: string) { return batchV54Input(seed); }
