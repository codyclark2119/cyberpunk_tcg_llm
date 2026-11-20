import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV28Context, batchV28Input, v28Source } from "./api-admission-batch-v28-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V29 (plan section 6, scope 3c): a Unit whose {Attack} readies up to 2 MERC Legends in its controller's Legends area
// when they control a value-pair of Gigs, checked when the effect resolves.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// value-pair pin table.
export const PEPE = "pepe-najarro-working-doubles";
export const V29_SLUGS = [PEPE] as const;
export const v29Source = v28Source; // Same raw snapshot commit as V7 to V28.
const MECHANICS = {
    [PEPE]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${PEPE}-attack-ready-merc-legends@1`, trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "READY_LEGENDS_UP_TO", tag: "Merc", maximum: 2, when: { timing: "RESOLUTION", condition: { kind: "CONTROLS_VALUE_PAIR" } } }] }] }
};

export const batchV29Cards = V29_SLUGS.map(slug => {
    const r = v29Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V29 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V28 chain plus the V29 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV29Context() {
    const base = batchV28Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV29Cards], base.manifest.engine) };
}
export function batchV29Input(seed: string) { return batchV28Input(seed); }
