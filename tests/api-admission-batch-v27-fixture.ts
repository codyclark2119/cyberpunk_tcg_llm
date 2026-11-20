import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV26Context, batchV26Input, v26Source } from "./api-admission-batch-v26-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V27 (plan section 6, scope 3c): a Unit that increases each Gig it steals by up to 5, and draws at the end of its controller's
// turn when they control 2 or more Gigs with 8+ value.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// steal-trigger pin table.
export const ROAMER = "v-roamer-of-the-badlands";
export const V27_SLUGS = [ROAMER] as const;
export const v27Source = v26Source; // Same raw snapshot commit as V7 to V26.
const MECHANICS = {
    [ROAMER]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${ROAMER}-steal-increase-it@1`, trigger: "WHEN_GIG_STOLEN", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "STOLEN_GIG" }, maximum: 5, direction: "INCREASE" }] },
            { id: `${ROAMER}-end-turn-draw@1`, trigger: "WHEN_OWN_TURN_ENDS", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_COUNT_WITH_VALUE_AT_LEAST", minimum: 8, count: 2 }, count: 1 }] }] }
};

export const batchV27Cards = V27_SLUGS.map(slug => {
    const r = v27Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V27 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V26 chain plus the V27 revision. No new policy: the reviewed trigger, end-turn and card-play policies apply. */
export function batchV27Context() {
    const base = batchV26Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV27Cards], base.manifest.engine) };
}
export function batchV27Input(seed: string) { return batchV26Input(seed); }
