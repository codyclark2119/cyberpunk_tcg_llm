import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV19Context, batchV19Input, v19Source } from "./api-admission-batch-v19-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V20 (plan section 6, scope 3c): two single-primitive {Play} Units, a trash-3 Program pick and an Adrenaline grant.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in its attack-search gate.
export const HACKED = "hacked-corpo";
export const RACER = "valentino-street-racer";
export const V20_SLUGS = [HACKED, RACER] as const;
export const v20Source = v19Source; // Same raw snapshot commit as V7 to V19.
const MECHANICS = {
    [HACKED]: { keywords: [], modifiers: [],
        abilities: [{ id: `${HACKED}-play-trash-program@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "TRASH_THEN_RETURN_PROGRAM", count: 3 }] }] },
    [RACER]: { keywords: [], modifiers: [],
        abilities: [{ id: `${RACER}-play-adrenaline@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "GRANT_KEYWORD_UNTIL_END_OF_TURN", keyword: "ADRENALINE", target: { kind: "ANOTHER_FRIENDLY_UNIT", costAtMost: 5 } }] }] }
};

export const batchV20Cards = V20_SLUGS.map(slug => {
    const r = v20Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, power: r.power,
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V20 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V19 chain plus the V20 revisions. No new policy: the reviewed trigger, card-play and Adrenaline policies apply. */
export function batchV20Context() {
    const base = batchV19Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV20Cards], base.manifest.engine) };
}
export function batchV20Input(seed: string) { return batchV19Input(seed); }
