import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV53Context, batchV53Input, v53Source } from "./api-admission-batch-v53-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V54 (plan section 6, scope 3c): "Choose one effect. If you have less ☆ (Street Cred) than a Rival, choose both instead.
// Give all rival Units -5 power this turn. // Bottom-deck all rival Units with power 0." Source records are evidence only;
// mechanics are authored here and the card's complete shape is pinned literally in the modal Program pin table.
export const TOWERFALL = "towerfall";
export const V54_SLUGS = [TOWERFALL] as const;
export const v54Source = v53Source; // Same raw snapshot commit as V7 to V53.
const MECHANICS = {
    [TOWERFALL]: { keywords: [], modifiers: [],
        abilities: [{ id: `${TOWERFALL}-choose-one@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], choose: { count: 1, allInstead: { kind: "STREET_CRED_LESS_THAN_RIVAL" } },
            effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "ALL_RIVAL_UNITS" }, amount: -5 }, { kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL", power: 0, all: true } }] }] }
};

export const batchV54Cards = V54_SLUGS.map(slug => {
    const r = v54Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V54 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V53 chain plus the V54 revision. No new policy: the reviewed play and modal Program policies apply. */
export function batchV54Context() {
    const base = batchV53Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV54Cards], base.manifest.engine) };
}
export function batchV54Input(seed: string) { return batchV53Input(seed); }
