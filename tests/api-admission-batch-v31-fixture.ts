import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV30Context, batchV30Input, v30Source } from "./api-admission-batch-v30-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V31 (plan section 6, scope 3b): a Unit whose {Play} defeats a rival Unit with cost 2 or less, and whose {Defeated} makes a
// Rival discard 1, then 1 more if the discarded card's cost equals the value of a friendly Gig.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// targeted-defeat pin table.
export const CALIBER = "caliber-totentanz-s-top-dog";
export const V31_SLUGS = [CALIBER] as const;
export const v31Source = v30Source; // Same raw snapshot commit as V7 to V30.
const MECHANICS = {
    [CALIBER]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${CALIBER}-play-defeat-cost-2@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, cost: { kind: "AT_MOST", value: 2 } } }] },
            { id: `${CALIBER}-defeated-rival-discard@1`, trigger: "WHEN_DEFEATED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", more: { condition: { kind: "DISCARDED_COST_EQUALS_FRIENDLY_GIG_VALUE" }, count: 1 } }] }] }
};

export const batchV31Cards = V31_SLUGS.map(slug => {
    const r = v31Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "TARGETED_DEFEAT_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V31 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V30 chain plus the V31 revision. No new policy: the reviewed targeted-defeat, trigger and card-play policies apply. */
export function batchV31Context() {
    const base = batchV30Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV31Cards], base.manifest.engine) };
}
export function batchV31Input(seed: string) { return batchV30Input(seed); }
