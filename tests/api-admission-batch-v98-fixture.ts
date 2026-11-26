import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV97Context, batchV97Input, v97Source } from "./api-admission-batch-v97-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V98 (plan section 6, bundle 15): Overwatch: Panam's Gift, "{Quick} 1 €$, {Spend} Discard 1. Defeat a spent rival Unit with
// cost equal to or less than the discarded card's cost." A Gear: its host inherits the ability (11.23.3), so {Spend} spends the host.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the Quick
// activation pin table.
export const OVERWATCH = "overwatch-panam-s-gift";
export const V98_SLUGS = [OVERWATCH] as const;
export const v98Source = v97Source; // Same raw snapshot commit as V7 to V97.
const MECHANICS = {
    [OVERWATCH]: { keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, abilities: [
        { id: `${OVERWATCH}-quick-discard-defeat@1`, inherited: "EQUIPPED_HOST", cost: { kind: "NONE" }, conditions: [],
            activation: { timing: "QUICK", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }] },
            effects: [{ kind: "DISCARD_ONE_FOR_DEFEAT_COST" }, { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, readiness: "SPENT", cost: { kind: "AT_MOST_DISCARDED" } } }] }] }
};

export const batchV98Cards = V98_SLUGS.map(slug => {
    const r = v98Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V98 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-26", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V97 chain plus the V98 revision. No new policy: the reviewed play, trigger, React and defeat policies apply. */
export function batchV98Context() {
    const base = batchV97Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV98Cards], base.manifest.engine) };
}
export function batchV98Input(seed: string) { return batchV97Input(seed); }
