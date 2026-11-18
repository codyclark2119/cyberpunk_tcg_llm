import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV10Context, batchV10Input, v10Source } from "./api-admission-batch-v10-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V11 (plan section 6, scope 3c): three Units whose only text reduces the amount paid to play them,
// counted when the play starts, to a printed minimum of 1. Source records are evidence only; mechanics
// are authored here and each card's complete shape is pinned literally in its engine gate.
export const OCTANT = "octant", TRAUMA = "trauma-team-operatives", HEAVY = "maxtac-heavy";
export const V11_SLUGS = [OCTANT, TRAUMA, HEAVY] as const;
export const v11Source = v10Source; // Same raw snapshot commit as V7 to V10.
const reduction = (per: string) => ({ keywords: [], abilities: [], modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per, amount: 1, minimum: 1 }] });
const MECHANICS = { [OCTANT]: reduction("FRIENDLY_GIG_VALUE_AT_LEAST_8"), [TRAUMA]: reduction("FRIENDLY_TRASH_UNIT"), [HEAVY]: reduction("RIVAL_UNIT") };

export const batchV11Cards = V11_SLUGS.map(slug => {
    const r = v11Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "PLAY_COST_REDUCTION_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V11 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-18", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V10 chain plus the V11 revisions and the reviewed play-cost reduction policy. */
export function batchV11Context() {
    const base = batchV10Context().content;
    const ruleset = RulesetSchema.parse({ ...base.ruleset, version: "api-admission-batch-v11-1", gameplay: { ...base.ruleset.gameplay, turnSlice: { ...base.ruleset.gameplay!.turnSlice, playCostReduction: "PLAY_COST_REDUCTION_V1" } } });
    return { content: createContentBundle(ruleset, [...base.cards, ...batchV11Cards], base.manifest.engine) };
}
export function batchV11Input(seed: string) { return batchV10Input(seed); }
