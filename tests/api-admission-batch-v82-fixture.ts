import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV81Context, batchV81Input, v81Source } from "./api-admission-batch-v81-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V82 (plan section 6, scope 3c): Panam Palmer: Nomad Cavalry, "2 €$, {Spend} Move a Gear from this Legend to an unequipped friendly
// Unit. If you do, ready that Unit. At the end of your turn, if 5 or more friendly Units and/or Legends are equipped, ready them." Source
// records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the Legend pin table.
export const PANAM_CAVALRY = "panam-palmer-nomad-cavalry";
export const V82_SLUGS = [PANAM_CAVALRY] as const;
export const v82Source = v81Source; // Same raw snapshot commit as V7 to V81.
const MECHANICS = {
    [PANAM_CAVALRY]: { keywords: [], modifiers: [], abilities: [
        { id: `${PANAM_CAVALRY}-spend-move-gear@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION",
            costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 2 } }, { kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "MOVE_SOURCE_GEAR_TO_UNEQUIPPED_UNIT_THEN_READY" }] },
        { id: `${PANAM_CAVALRY}-end-turn-ready-equipped@1`, trigger: "WHEN_OWN_TURN_ENDS", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "READY_EQUIPPED_FRIENDLY_IF_AT_LEAST", minimum: 5 }] }] }
};

export const batchV82Cards = V82_SLUGS.map(slug => {
    const r = v82Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V82 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V81 chain plus the V82 revision. No new policy: the reviewed Legend pin policy applies. */
export function batchV82Context() {
    const base = batchV81Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV82Cards], base.manifest.engine) };
}
export function batchV82Input(seed: string) { return batchV81Input(seed); }
