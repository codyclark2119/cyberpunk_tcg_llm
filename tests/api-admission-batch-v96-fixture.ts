import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV95Context, batchV95Input, v95Source } from "./api-admission-batch-v95-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V96 (plan section 6, bundle 15): We Gotta Live Together, "If a Rival controls at least 2 more Gigs than you, play this Program
// for 3 €$. Play up to 2 Units with cost 3 or less from your trash for free." Source records are evidence only; mechanics are authored
// here and the card's complete shape is pinned literally in the trash-Unit Program pin table.
export const LIVE_TOGETHER = "we-gotta-live-together";
export const V96_SLUGS = [LIVE_TOGETHER] as const;
export const v96Source = v95Source; // Same raw snapshot commit as V7 to V95.
const MECHANICS = {
    [LIVE_TOGETHER]: { keywords: [], modifiers: [{ kind: "ALTERNATIVE_PLAY_COST_IF_RIVAL_GIG_LEAD", minimum: 2, amount: 3 }], abilities: [
        { id: `${LIVE_TOGETHER}-play-trash-units@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "PLAY_TRASH_UNITS_FREE", count: 2, maxCost: 3 }] }] }
};

export const batchV96Cards = V96_SLUGS.map(slug => {
    const r = v96Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V96 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-26", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V95 chain plus the V96 revision. No new policy: the reviewed play and trigger policies apply. */
export function batchV96Context() {
    const base = batchV95Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV96Cards], base.manifest.engine) };
}
export function batchV96Input(seed: string) { return batchV95Input(seed); }
