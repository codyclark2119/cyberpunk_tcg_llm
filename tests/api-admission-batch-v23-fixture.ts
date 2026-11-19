import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV22Context, batchV22Input, v22Source } from "./api-admission-batch-v22-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V23 (plan section 6, scope 3c): a {Play} Unit that may swap a friendly Gig with a rival Gig (6.7).
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// {Play} pin table.
export const MAXTAC_AV = "maxtac-av";
export const V23_SLUGS = [MAXTAC_AV] as const;
export const v23Source = v22Source; // Same raw snapshot commit as V7 to V22.
const MECHANICS = {
    [MAXTAC_AV]: { keywords: [], modifiers: [],
        abilities: [{ id: `${MAXTAC_AV}-play-gig-swap@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "SWAP_GIGS", optional: true }] }] }
};

export const batchV23Cards = V23_SLUGS.map(slug => {
    const r = v23Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V23 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V22 chain plus the V23 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV23Context() {
    const base = batchV22Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV23Cards], base.manifest.engine) };
}
export function batchV23Input(seed: string) { return batchV22Input(seed); }
