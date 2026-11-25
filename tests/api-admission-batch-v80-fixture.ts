import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV79Context, batchV79Input, v79Source } from "./api-admission-batch-v79-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V80 (plan section 6, scope 3c): Johnny Silverhand: Rocking Renegade, "2 €$, {Spend} A friendly Unit can attack spent rival Units
// the turn it's played. If it's a ROCKER Unit, also give it +2 power this turn. This effect costs -1 €$ for each friendly Gig with 8+
// value." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the Legend
// {Spend} pin table.
export const JOHNNY_RENEGADE = "johnny-silverhand-rocking-renegade";
export const V80_SLUGS = [JOHNNY_RENEGADE] as const;
export const v80Source = v79Source; // Same raw snapshot commit as V7 to V79.
const MECHANICS = {
    [JOHNNY_RENEGADE]: { keywords: [], modifiers: [], abilities: [
        { id: `${JOHNNY_RENEGADE}-spend-attack-grant@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION",
            costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 2 } }, { kind: "SPEND_SOURCE" }], costReduction: { per: "FRIENDLY_GIG_VALUE_AT_LEAST_8", amount: 1 } },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED", alsoPowerIfTag: "Rocker", amount: 2 }] }] }
};

export const batchV80Cards = V80_SLUGS.map(slug => {
    const r = v80Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V80 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V79 chain plus the V80 revision. No new policy: the reviewed Legend {Spend} policy applies. */
export function batchV80Context() {
    const base = batchV79Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV80Cards], base.manifest.engine) };
}
export function batchV80Input(seed: string) { return batchV79Input(seed); }
