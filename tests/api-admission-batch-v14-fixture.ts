import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV13Context, batchV13Input, v13Source } from "./api-admission-batch-v13-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V14 (plan section 6, scope 3c): a Program that trashes the top 3 cards of its controller's deck and
// returns a Unit from among them. Source records are evidence only; mechanics are authored here and the
// card's complete shape is pinned literally in its engine gate.
export const ALL_IS_LOST = "all-is-lost";
export const V14_SLUGS = [ALL_IS_LOST] as const;
export const v14Source = v13Source; // Same raw snapshot commit as V7 to V13.
const MECHANICS = {
    [ALL_IS_LOST]: { keywords: [], modifiers: [], abilities: [{ id: `${ALL_IS_LOST}-play-trash-return@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "TRASH_THEN_RETURN_UNIT", count: 3 }] }] }
};

export const batchV14Cards = V14_SLUGS.map(slug => {
    const r = v14Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V14 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-18", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V13 chain plus the V14 revision. No new policy: it extends NONCOMBAT_PLAY_V1. */
export function batchV14Context() {
    const base = batchV13Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV14Cards], base.manifest.engine) };
}
export function batchV14Input(seed: string) { return batchV13Input(seed); }
