import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV50Context, batchV50Input, v50Source } from "./api-admission-batch-v50-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V51 (plan section 6, scope 3c): a power-0 Unit with "When this Unit loses a fight, defeat the opposing rival Unit." Source
// records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the targeted-defeat
// pin table.
export const ZEALOTS = "maelstrom-zealots";
export const V51_SLUGS = [ZEALOTS] as const;
export const v51Source = v50Source; // Same raw snapshot commit as V7 to V50.
const MECHANICS = {
    [ZEALOTS]: { keywords: [], modifiers: [],
        abilities: [{ id: `${ZEALOTS}-fight-lost-defeat@1`, trigger: "WHEN_FIGHT_LOST", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DEFEAT_UNIT", target: { kind: "OPPOSING_UNIT" } }] }] }
};

export const batchV51Cards = V51_SLUGS.map(slug => {
    const r = v51Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V51 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V50 chain plus the V51 revision. No new policy: the reviewed play, targeted-defeat, trigger and combat policies apply. */
export function batchV51Context() {
    const base = batchV50Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV51Cards], base.manifest.engine) };
}
export function batchV51Input(seed: string) { return batchV50Input(seed); }
