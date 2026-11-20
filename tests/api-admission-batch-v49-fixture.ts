import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV48Context, batchV48Input, v48Source } from "./api-admission-batch-v48-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V49 (plan section 6, scope 3c): a Unit with "The first time another friendly Unit steals a Gig with value less than its
// power each turn, ready 2 Eddies." and "{Quick} 2 €$, {Spend} A rival Unit loses power equal to this Unit's power this turn."
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Quick-activation pin table.
export const QUEEN = "rogue-amendiares-queen-of-the-afterlife";
export const V49_SLUGS = [QUEEN] as const;
export const v49Source = v48Source; // Same raw snapshot commit as V7 to V48.
const MECHANICS = {
    [QUEEN]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${QUEEN}-first-steal-ready@1`, trigger: "WHEN_FRIENDLY_UNIT_STEALS_GIG", guard: "FIRST_OTHER_FRIENDLY_STEAL_BELOW_POWER_PER_TURN", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "READY_EDDIES", player: "CONTROLLER", count: 2 }] },
            { id: `${QUEEN}-quick-power-loss@1`, activation: { timing: "QUICK", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 2 } }, { kind: "SPEND_SOURCE" }] },
                cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -1, scale: "SOURCE_POWER" }] }] }
};

export const batchV49Cards = V49_SLUGS.map(slug => {
    const r = v49Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V49 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V48 chain plus the V49 revision. No new policy: the reviewed play, react, trigger and combat policies apply. */
export function batchV49Context() {
    const base = batchV48Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV49Cards], base.manifest.engine) };
}
export function batchV49Input(seed: string) { return batchV48Input(seed); }
