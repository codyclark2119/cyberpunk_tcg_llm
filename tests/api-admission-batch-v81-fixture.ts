import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV80Context, batchV80Input, v80Source } from "./api-admission-batch-v80-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V81 (plan section 6, scope 3c): Kerry Eurodyne: Axe, Attitude, Audience, "When you roll in a Gig from your fixer area, you may
// ignore the result and reroll it once. When you roll a min or max value on a Gig, draw 1. If it's a d20, draw 3 instead." Source records
// are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the Legend pin table.
export const KERRY_AXE = "kerry-eurodyne-axe-attitude-audience";
export const V81_SLUGS = [KERRY_AXE] as const;
export const v81Source = v80Source; // Same raw snapshot commit as V7 to V80.
const MECHANICS = {
    [KERRY_AXE]: { keywords: [], abilities: [], modifiers: [{ kind: "MAY_REROLL_FIXER_GIG_ONCE" }, { kind: "DRAW_ON_EXTREME_GIG_ROLL", count: 1, d20Count: 3 }] }
};

export const batchV81Cards = V81_SLUGS.map(slug => {
    const r = v81Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V81 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V80 chain plus the V81 revision. No new policy: the reviewed Legend pin policy applies. */
export function batchV81Context() {
    const base = batchV80Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV81Cards], base.manifest.engine) };
}
export function batchV81Input(seed: string) { return batchV80Input(seed); }
