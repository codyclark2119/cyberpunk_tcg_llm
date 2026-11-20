import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV44Context, batchV44Input, v44Source } from "./api-admission-batch-v44-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V45 (plan section 6, scope 3c): a Program that sells the top card of its controller's deck, then draws 2 when the
// controller's Gigs show both an even and an odd value. Source records are evidence only; mechanics are authored here and the
// card's complete shape is pinned literally in the effect-sell Program pin table.
export const BOOTLEG = "bootleg-black-sapphire-show";
export const V45_SLUGS = [BOOTLEG] as const;
export const v45Source = v44Source; // Same raw snapshot commit as V7 to V44.
const MECHANICS = {
    [BOOTLEG]: { keywords: [], modifiers: [],
        abilities: [{ id: `${BOOTLEG}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "SELL_TOP_OF_DECK", count: 1 }, { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "FRIENDLY_GIGS_EVEN_AND_ODD" }, count: 2 }] }] }
};

export const batchV45Cards = V45_SLUGS.map(slug => {
    const r = v45Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V45 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V44 chain plus the V45 revision. No new policy: the reviewed play policy applies. */
export function batchV45Context() {
    const base = batchV44Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV45Cards], base.manifest.engine) };
}
export function batchV45Input(seed: string) { return batchV44Input(seed); }
