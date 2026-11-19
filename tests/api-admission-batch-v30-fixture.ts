import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV29Context, batchV29Input, v29Source } from "./api-admission-batch-v29-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V30 (plan section 6, scope 3c): a Unit whose {Play} spends a rival Unit for each friendly value-pair of Gigs, and which can
// attack rival Units (only) the turn it's played.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// value-pair pin table.
export const SANDAYU = "sandayu-oda-hanako-s-guardian";
export const V30_SLUGS = [SANDAYU] as const;
export const v30Source = v29Source; // Same raw snapshot commit as V7 to V29.
const MECHANICS = {
    [SANDAYU]: { keywords: [], modifiers: [{ kind: "CAN_ATTACK_RIVAL_UNITS_WHILE_LAGGING" }],
        abilities: [
            { id: `${SANDAYU}-play-spend-per-value-pair@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "SPEND_UNITS_PER_VALUE_PAIR", target: { kind: "UNITS", relation: "RIVAL" } }] }] }
};

export const batchV30Cards = V30_SLUGS.map(slug => {
    const r = v30Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V30 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V29 chain plus the V30 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV30Context() {
    const base = batchV29Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV30Cards], base.manifest.engine) };
}
export function batchV30Input(seed: string) { return batchV29Input(seed); }
