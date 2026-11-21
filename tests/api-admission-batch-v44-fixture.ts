import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV43Context, batchV43Input, v43Source } from "./api-admission-batch-v43-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V44 (plan section 6, scope 3c): a modal Program, "Choose one effect. If a friendly d4 is a min Gig, choose both instead."
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// modal Program pin table.
export const PYRAMID = "pyramid-song";
export const V44_SLUGS = [PYRAMID] as const;
export const v44Source = v43Source; // Same raw snapshot commit as V7 to V43.
const MECHANICS = {
    [PYRAMID]: { keywords: [], modifiers: [],
        abilities: [{ id: `${PYRAMID}-modal@1`, trigger: "WHEN_PLAYED", choose: { count: 1, allInstead: { kind: "FRIENDLY_GIG_IS_MIN", dieType: "D4" } }, cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -5 }, { kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL", power: 0 } }] }] }
};

export const batchV44Cards = V44_SLUGS.map(slug => {
    const r = v44Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V44 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V43 chain plus the V44 revision. No new policy: the reviewed play and React policies apply. */
export function batchV44Context() {
    const base = batchV43Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV44Cards], base.manifest.engine) };
}
export function batchV44Input(seed: string) { return batchV43Input(seed); }
