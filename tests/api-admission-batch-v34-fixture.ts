import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV33Context, batchV33Input, v33Source } from "./api-admission-batch-v33-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V34 (plan section 6, scope 3b): a Unit whose {Play} may defeat any Gear, then draws 1 if that Gear's cost equals the
// value of a friendly Gig.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Gear-defeat pin table.
export const HEYWOOD = "heywood-ripperdoc";
export const V34_SLUGS = [HEYWOOD] as const;
export const v34Source = v33Source; // Same raw snapshot commit as V7 to V33.
const MECHANICS = {
    [HEYWOOD]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${HEYWOOD}-play-defeat-gear-draw@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "DEFEAT_UNIT", target: { kind: "GEAR", relation: "ANY" }, optional: true, draw: { condition: { kind: "DEFEATED_COST_EQUALS_FRIENDLY_GIG_VALUE" }, count: 1 } }] }] }
};

export const batchV34Cards = V34_SLUGS.map(slug => {
    const r = v34Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "TARGETED_GEAR_DEFEAT_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V34 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V33 chain plus the V34 revision, with the reviewed Gear-defeat policy (batch V5) switched on. */
export function batchV34Context() {
    const base = batchV33Context().content, gameplay = base.ruleset.gameplay!;
    const ruleset = RulesetSchema.parse({ ...base.ruleset, gameplay: { ...gameplay, turnSlice: { ...gameplay.turnSlice!, targetedGearDefeat: "TARGETED_GEAR_DEFEAT_V1" } } });
    return { content: createContentBundle(ruleset, [...base.cards, ...batchV34Cards], base.manifest.engine) };
}
export function batchV34Input(seed: string) { return batchV33Input(seed); }
