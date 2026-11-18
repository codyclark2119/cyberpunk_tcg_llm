import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV16Context, batchV16Input, v16Source } from "./api-admission-batch-v16-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V17 (plan section 6, scope 3c): "When this Unit uses [Blocker]" triggers on printed Blocker Units.
// Source records are evidence only; mechanics are authored here and each card's complete shape is pinned
// literally in its trigger gate.
export const LLORONA = "la-llorona-ghost-of-the-past", NEGOTIATORS = "augmented-negotiators";
export const V17_SLUGS = [LLORONA, NEGOTIATORS] as const;
export const v17Source = v16Source; // Same raw snapshot commit as V7 to V16.
const blocked = (slug: string, effect: unknown) => ({ keywords: ["BLOCKER"], modifiers: [],
    abilities: [{ id: `${slug}-blocker-used@1`, trigger: "WHEN_BLOCKER_USED", cost: { kind: "NONE" }, conditions: [], effects: [effect] }] });
const MECHANICS = {
    [LLORONA]: blocked(LLORONA, { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 3, direction: "INCREASE" }),
    [NEGOTIATORS]: blocked(NEGOTIATORS, { kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER" })
};

export const batchV17Cards = V17_SLUGS.map(slug => {
    const r = v17Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V17 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-18", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V16 chain plus the V17 revisions. No new policy: the reviewed trigger and React policies apply. */
export function batchV17Context() {
    const base = batchV16Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV17Cards], base.manifest.engine) };
}
export function batchV17Input(seed: string) { return batchV16Input(seed); }
