import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV87Context, batchV87Input, v87Source } from "./api-admission-batch-v87-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V88 (plan section 6, bundle 13): Meredith Stout: Stone Cold Corpo, "{Blocker} This Unit has +2 power while fighting a Legend.
// When a Rival adjusts or swaps 1 or more friendly Gigs, you may add a card from your trash to your hand." Source records are evidence
// only; mechanics are authored here and the card's complete shape is pinned literally in the Rival Gig-change pin table.
export const MEREDITH = "meredith-stout-stone-cold-corpo";
export const V88_SLUGS = [MEREDITH] as const;
export const v88Source = v87Source; // Same raw snapshot commit as V7 to V87.
const MECHANICS = {
    [MEREDITH]: { keywords: ["BLOCKER"], modifiers: [{ kind: "POWER_WHILE_FIGHTING_LEGEND", amount: 2 }], abilities: [
        { id: `${MEREDITH}-rival-gig-change-trash-return@1`, trigger: "WHEN_RIVAL_CHANGES_FRIENDLY_GIGS", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "MAY_RETURN_TRASH_CARD_TO_HAND" }] }] }
};

export const batchV88Cards = V88_SLUGS.map(slug => {
    const r = v88Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V88 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V87 chain plus the V88 revision. No new policy: the reviewed trigger, combat and React policies apply. */
export function batchV88Context() {
    const base = batchV87Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV88Cards], base.manifest.engine) };
}
export function batchV88Input(seed: string) { return batchV87Input(seed); }
