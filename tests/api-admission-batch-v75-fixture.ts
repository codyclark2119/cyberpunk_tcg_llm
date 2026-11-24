import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV74Context, batchV74Input, v74Source } from "./api-admission-batch-v74-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V75 (plan section 6, scope 3c): Dum Dum: Maelstrom Triggerman, "{Call} You may defeat a friendly Gear. If you do, draw 2.
// Otherwise, draw 1." and "{Quick} 1 €$, {Spend} Give a friendly Unit +1 power this turn for each of its equipped Gear." Source records
// are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the Legend {Spend} pin table.
export const DUM_DUM = "dum-dum-maelstrom-triggerman";
export const V75_SLUGS = [DUM_DUM] as const;
export const v75Source = v74Source; // Same raw snapshot commit as V7 to V74.
const MECHANICS = {
    [DUM_DUM]: { keywords: [], modifiers: [], abilities: [
        { id: `${DUM_DUM}-call-gear-defeat-draw@1`, trigger: "WHEN_CALLED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "MAY_DEFEAT_FRIENDLY_GEAR_THEN_DRAW", ifDefeated: 2, otherwise: 1 }] },
        { id: `${DUM_DUM}-quick-gear-power@1`, activation: { timing: "QUICK", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "POWER_PER_EQUIPPED_GEAR_THIS_TURN", target: { kind: "FRIENDLY_UNIT" }, amount: 1 }] }] }
};

export const batchV75Cards = V75_SLUGS.map(slug => {
    const r = v75Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V75 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V74 chain plus the V75 revision. No new policy: the reviewed Legend {Spend}, React and Gear policies apply. */
export function batchV75Context() {
    const base = batchV74Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV75Cards], base.manifest.engine) };
}
export function batchV75Input(seed: string) { return batchV74Input(seed); }
