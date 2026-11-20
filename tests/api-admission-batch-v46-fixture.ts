import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV45Context, batchV45Input, v45Source } from "./api-admission-batch-v45-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V46 (plan section 6, scope 3c): a Quick Program, "The next time a friendly Unit loses a fight this turn, defeat the
// opposing rival Unit." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in the targeted-defeat pin table.
export const SAFETY = "safety-override";
export const V46_SLUGS = [SAFETY] as const;
export const v46Source = v45Source; // Same raw snapshot commit as V7 to V45.
const MECHANICS = {
    [SAFETY]: { keywords: ["QUICK"], modifiers: [],
        abilities: [{ id: `${SAFETY}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "REGISTER_NEXT_FIGHT_OUTCOME", on: "FRIENDLY_UNIT_LOSES", effect: { kind: "DEFEAT_UNIT", target: { kind: "OPPOSING_UNIT" } } }] }] }
};

export const batchV46Cards = V46_SLUGS.map(slug => {
    const r = v46Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V46 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V44 chain plus the V46 revision. No new policy: the reviewed play, React, trigger and defeat policies apply. */
export function batchV46Context() {
    const base = batchV45Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV46Cards], base.manifest.engine) };
}
export function batchV46Input(seed: string) { return batchV45Input(seed); }
