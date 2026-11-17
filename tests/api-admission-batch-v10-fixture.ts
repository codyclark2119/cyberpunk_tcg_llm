import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV9Context, batchV9Input, v9Source } from "./api-admission-batch-v9-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V10 (plan section 6, scope 3c): a Unit PLAY mass defeat of every other Unit, and a Unit whose
// only text is an attack ban lifted by playing a Program this turn. Source records are evidence only;
// mechanics are authored here and each card's complete shape is pinned literally in its engine gate.
export const SMASHER = "adam-smasher-metal-over-meat", VOODOO = "jacked-in-voodoo-boy";
export const V10_SLUGS = [SMASHER, VOODOO] as const;
export const v10Source = v9Source; // Same raw snapshot commit as V7 to V9.
const SCOPE = { [SMASHER]: "TARGETED_DEFEAT_V1", [VOODOO]: "COMBAT_RESTRICTIONS_V1" } as const;
const MECHANICS = {
    [SMASHER]: { keywords: [], modifiers: [],
        abilities: [{ id: "adam-smasher-metal-over-meat-play@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" }, all: "OTHER_THAN_SOURCE" } }] }] },
    [VOODOO]: { keywords: [], modifiers: [], abilities: [], restrictions: [{ kind: "CANNOT_ATTACK_UNLESS_PROGRAM_PLAYED_THIS_TURN" }] }
} as const;

export const batchV10Cards = V10_SLUGS.map(slug => {
    const r = v10Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: SCOPE[slug], status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V10 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-17", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V9 chain plus the V10 revisions and the reviewed Program-play history policy. */
export function batchV10Context() {
    const base = batchV9Context().content;
    const ruleset = RulesetSchema.parse({ ...base.ruleset, version: "api-admission-batch-v10-1", gameplay: { ...base.ruleset.gameplay, turnSlice: { ...base.ruleset.gameplay!.turnSlice, programPlayHistory: "PROGRAM_PLAY_HISTORY_V1" } } });
    return { content: createContentBundle(ruleset, [...base.cards, ...batchV10Cards], base.manifest.engine) };
}
export function batchV10Input(seed: string) { return batchV9Input(seed); }
