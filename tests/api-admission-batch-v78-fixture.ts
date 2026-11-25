import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV77Context, batchV77Input, v77Source } from "./api-admission-batch-v77-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V78 (plan section 6, scope 3c): Shattered Memories, "Each player discards their hand and may draw 5. If the total number of
// discarded cards equals the value of a friendly Gig, draw 2." Source records are evidence only; mechanics are authored here and the
// card's complete shape is pinned literally in the hand reset Program pin table.
export const SHATTERED = "shattered-memories";
export const V78_SLUGS = [SHATTERED] as const;
export const v78Source = v77Source; // Same raw snapshot commit as V7 to V77.
const MECHANICS = {
    [SHATTERED]: { keywords: [], modifiers: [],
        abilities: [{ id: `${SHATTERED}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW", draw: 5, drawIfTotalMatchesFriendlyGig: 2 }] }] }
};

export const batchV78Cards = V78_SLUGS.map(slug => {
    const r = v78Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V78 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V77 chain plus the V78 revision. No new policy: the reviewed noncombat play policy applies. */
export function batchV78Context() {
    const base = batchV77Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV78Cards], base.manifest.engine) };
}
export function batchV78Input(seed: string) { return batchV77Input(seed); }
