import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV73Context, batchV73Input, v73Source } from "./api-admission-batch-v73-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V74 (plan section 6, scope 3c): Goro Takemura: Vengeful Bodyguard, "{Quick} 1 €$, {Spend} Give a friendly Unit with cost 4 or
// less {Blocker} this turn. If you control a value-pair of Gigs, also give it +1 power this turn." and "When a friendly Unit uses {Blocker},
// you may discard 1. If you do, draw 1." Source records are evidence only; mechanics are authored here and the card's complete shape is
// pinned literally in the Legend {Spend} pin table.
export const GORO = "goro-takemura-vengeful-bodyguard";
export const V74_SLUGS = [GORO] as const;
export const v74Source = v73Source; // Same raw snapshot commit as V7 to V73.
const MECHANICS = {
    [GORO]: { keywords: [], modifiers: [], abilities: [
        { id: `${GORO}-quick-blocker-grant@1`, activation: { timing: "QUICK", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "GRANT_BLOCKER_THIS_TURN", target: { kind: "FRIENDLY_UNIT", costAtMost: 4 }, alsoPowerIf: { condition: { kind: "CONTROLS_VALUE_PAIR" }, amount: 1 } }] },
        { id: `${GORO}-blocker-used-may-discard-draw@1`, trigger: "WHEN_FRIENDLY_UNIT_USES_BLOCKER", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", optional: true, thenDrawOne: true }] }] }
};

export const batchV74Cards = V74_SLUGS.map(slug => {
    const r = v74Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V74 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V73 chain plus the V74 revision. No new policy: the reviewed Legend {Spend}, React and trigger policies apply. */
export function batchV74Context() {
    const base = batchV73Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV74Cards], base.manifest.engine) };
}
export function batchV74Input(seed: string) { return batchV73Input(seed); }
