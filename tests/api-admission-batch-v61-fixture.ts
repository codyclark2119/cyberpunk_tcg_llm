import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV60Context, batchV60Input, v60Source } from "./api-admission-batch-v60-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V61 (plan section 6, scope 3c): Muamar Reyes: El Capitán, "{Call} Choose one effect. A friendly Unit can't be defeated in a
// fight this turn. // Draw 1." and "{Spend} Adjust a Gig by 1." Source records are evidence only; mechanics are authored here and the
// card's complete shape is pinned literally in the Legend {Spend} pin table.
export const MUAMAR = "muamar-reyes-el-capita-n";
export const V61_SLUGS = [MUAMAR] as const;
export const v61Source = v60Source; // Same raw snapshot commit as V7 to V60.
const MECHANICS = {
    [MUAMAR]: { keywords: [], modifiers: [], abilities: [
        { id: `${MUAMAR}-call-choose-one@1`, trigger: "WHEN_CALLED", choose: { count: 1 }, cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "FIGHT_DEFEAT_IMMUNITY_THIS_TURN", target: { kind: "FRIENDLY_UNIT" } }, { kind: "DRAW", count: 1 }] },
        { id: `${MUAMAR}-spend-adjust@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }, cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 }] }] }
};

export const batchV61Cards = V61_SLUGS.map(slug => {
    const r = v61Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V61 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V60 chain plus the V61 revision. No new policy: the reviewed play, Call, React and combat policies apply. */
export function batchV61Context() {
    const base = batchV60Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV61Cards], base.manifest.engine) };
}
export function batchV61Input(seed: string) { return batchV60Input(seed); }
