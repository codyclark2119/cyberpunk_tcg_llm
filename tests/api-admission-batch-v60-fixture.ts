import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV59Context, batchV59Input, v59Source } from "./api-admission-batch-v59-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V60 (plan section 6, scope 3c): two Legends with "{Call} Choose one effect." and a {Spend} Gig adjustment: Wakako Okada
// ("Give a rival Unit -2 power this turn. // Draw 1." and "Decrease a Gig by up to 2.") and Dexter DeShawn ("Give a friendly Unit +2
// power this turn. // Draw 1." and "Increase a Gig by up to 2."). Source records are evidence only; mechanics are authored here and
// each card's complete shape is pinned literally in the Legend {Spend} pin table.
export const WAKAKO = "wakako-okada-peace-and-harmony", DEXTER = "dexter-deshawn-off-the-grid";
export const V60_SLUGS = [WAKAKO, DEXTER] as const;
export const v60Source = v59Source; // Same raw snapshot commit as V7 to V59.
const spend = (slug: string, direction: "INCREASE" | "DECREASE") => ({ id: `${slug}-spend-adjust@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] },
    cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2, direction }] });
const call = (slug: string, power: object) => ({ id: `${slug}-call-choose-one@1`, trigger: "WHEN_CALLED", choose: { count: 1 }, cost: { kind: "NONE" }, conditions: [], effects: [power, { kind: "DRAW", count: 1 }] });
const MECHANICS = {
    [WAKAKO]: { keywords: [], modifiers: [], abilities: [call(WAKAKO, { kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -2 }), spend(WAKAKO, "DECREASE")] },
    [DEXTER]: { keywords: [], modifiers: [], abilities: [call(DEXTER, { kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "FRIENDLY_UNIT" }, amount: 2 }), spend(DEXTER, "INCREASE")] }
};

export const batchV60Cards = V60_SLUGS.map(slug => {
    const r = v60Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V60 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V59 chain plus the V60 revisions. No new policy: the reviewed play, Call, React and value policies apply. */
export function batchV60Context() {
    const base = batchV59Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV60Cards], base.manifest.engine) };
}
export function batchV60Input(seed: string) { return batchV59Input(seed); }
