import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV14Context, batchV14Input, v14Source } from "./api-admission-batch-v14-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V15 (plan section 6, scope 3c): two Programs that bottom-deck Units: a Rival's lowest-power Unit, and a
// ready friendly Unit followed, if it was, by a spent rival Unit. Source records are evidence only; mechanics are
// authored here and each card's complete shape is pinned literally in its engine gate.
export const LES_E_LE_MENS = "les-e-le-mens", UNLIKELY_BOND = "unlikely-bond";
export const V15_SLUGS = [LES_E_LE_MENS, UNLIKELY_BOND] as const;
export const v15Source = v14Source; // Same raw snapshot commit as V7 to V14.
const play = (slug: string, effect: object) => ({ keywords: [], modifiers: [],
    abilities: [{ id: `${slug}-play-bottom-deck@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [effect] }] });
const MECHANICS = {
    [LES_E_LE_MENS]: play(LES_E_LE_MENS, { kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL", lowestPower: true } }),
    [UNLIKELY_BOND]: play(UNLIKELY_BOND, { kind: "BOTTOM_DECK_UNIT", target: { relation: "CONTROLLED", readiness: "READY" }, then: { relation: "RIVAL", readiness: "SPENT" } })
};

export const batchV15Cards = V15_SLUGS.map(slug => {
    const r = v15Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V15 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-18", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V14 chain plus the V15 revisions. No new policy: both extend NONCOMBAT_PLAY_V1. */
export function batchV15Context() {
    const base = batchV14Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV15Cards], base.manifest.engine) };
}
export function batchV15Input(seed: string) { return batchV14Input(seed); }
