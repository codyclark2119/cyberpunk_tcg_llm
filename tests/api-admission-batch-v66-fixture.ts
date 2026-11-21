import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV65Context, batchV65Input, v65Source } from "./api-admission-batch-v65-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V66 (plan section 6, scope 3c): Panam Palmer: Strength Through Family, "During your turn, you may Call a Legend for free."
// and "{Attack} Discard 1. If you do, draw 1 for each friendly face-up Legend." Source records are evidence only; mechanics are
// authored here and the card's complete shape is pinned literally in the free-Call pin table.
export const PANAM = "panam-palmer-strength-through-family";
export const V66_SLUGS = [PANAM] as const;
export const v66Source = v65Source; // Same raw snapshot commit as V7 to V65.
const MECHANICS = {
    [PANAM]: { keywords: [], modifiers: [{ kind: "FREE_CALL_DURING_OWN_TURN" }], abilities: [
        { id: `${PANAM}-attack-discard-draw@1`, trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", thenDraw: "PER_FRIENDLY_FACE_UP_LEGEND" }] }] }
};

export const batchV66Cards = V66_SLUGS.map(slug => {
    const r = v66Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V66 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V65 chain plus the V66 revision. No new policy: the reviewed play, Call and trigger policies apply. */
export function batchV66Context() {
    const base = batchV65Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV66Cards], base.manifest.engine) };
}
export function batchV66Input(seed: string) { return batchV65Input(seed); }
