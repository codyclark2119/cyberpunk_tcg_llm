import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV8Context, batchV8Input, v8Source } from "./api-admission-batch-v8-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V9 (plan section 6, scope 3c): own-turn end effects on a Gear host and a returning Unit, and a
// Program mass spend followed by the reviewed spent-Unit defeat. Source records are evidence only;
// mechanics are authored here and each card's complete shape is pinned literally in its engine gate.
export const SANDEVISTAN = "sandevistan", KUSANAGI = "modded-kusanagi", REAPER = "don-t-fear-the-reaper";
export const V9_SLUGS = [SANDEVISTAN, KUSANAGI, REAPER] as const;
export const v9Source = v8Source; // Same raw snapshot commit as V7 and V8.
const SCOPE = { [SANDEVISTAN]: "END_TURN_HISTORY_V1", [KUSANAGI]: "END_TURN_HISTORY_V1", [REAPER]: "TARGETED_DEFEAT_V1" } as const;
const MECHANICS = {
    [SANDEVISTAN]: { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }],
        abilities: [{ id: "sandevistan-end-ready-host@1", trigger: "WHEN_OWN_TURN_ENDS", inherited: "EQUIPPED_HOST", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "READY_UNIT", target: { kind: "SOURCE" } }] }] },
    [KUSANAGI]: { keywords: ["ADRENALINE"], modifiers: [],
        abilities: [{ id: "modded-kusanagi-end-return@1", trigger: "WHEN_OWN_TURN_ENDS", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "RETURN_TO_HAND", target: { kind: "SOURCE" } }] }] },
    [REAPER]: { keywords: [], modifiers: [],
        abilities: [{ id: "don-t-fear-the-reaper-play@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "SPEND_ALL_UNITS", relation: "RIVAL" }, { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" }, readiness: "SPENT" } }] }] }
} as const;

export const batchV9Cards = V9_SLUGS.map(slug => {
    const r = v9Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V9 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-17", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V8 chain plus the V9 revisions and the reviewed ADRENALINE_V1 policy (as in V2). */
export function batchV9Context() {
    const base = batchV8Context().content;
    const ruleset = RulesetSchema.parse({ ...base.ruleset, version: "api-admission-batch-v9-1", gameplay: { ...base.ruleset.gameplay, turnSlice: { ...base.ruleset.gameplay!.turnSlice, adrenaline: "ADRENALINE_V1" } } });
    return { content: createContentBundle(ruleset, [...base.cards, ...batchV9Cards], base.manifest.engine) };
}
export function batchV9Input(seed: string) { return batchV8Input(seed); }
