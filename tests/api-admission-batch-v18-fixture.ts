import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV17Context, batchV17Input, v17Source } from "./api-admission-batch-v17-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V18 (plan section 6, scope 3c): a printed Go Solo Legend whose {Play} ability defeats a rival Unit.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in its targeted-defeat gate.
export const ENDER = "adam-smasher-ender-of-legends";
export const V18_SLUGS = [ENDER] as const;
export const v18Source = v17Source; // Same raw snapshot commit as V7 to V17.
const MECHANICS = {
    [ENDER]: { keywords: ["GO_SOLO"], modifiers: [],
        abilities: [{ id: `${ENDER}-play-defeat@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" } } }] }] }
};

export const batchV18Cards = V18_SLUGS.map(slug => {
    const r = v18Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, power: r.power,
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "TARGETED_DEFEAT_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V18 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V17 chain plus the V18 revision. No new policy: the reviewed field-Legend, trigger and defeat policies apply. */
export function batchV18Context() {
    const base = batchV17Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV18Cards], base.manifest.engine) };
}
export function batchV18Input(seed: string) { return batchV17Input(seed); }
