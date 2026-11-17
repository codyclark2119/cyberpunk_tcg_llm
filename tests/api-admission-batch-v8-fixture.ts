import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV7Context, batchV7Input, v7Source, V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V8 (plan section 6, scope 3c): effect-caused spend of the source and a rival Unit in a Unit
// PLAY trigger, and own-turn end ready effects. Source records are evidence only; mechanics are
// authored here and each card's complete shape is pinned literally in its engine gate.
export const MALFINI = "offduty-malfini", MURAMASA = "modded-muramasa", SQUADRON = "maxtac-squadron";
export const V8_SLUGS = [MALFINI, MURAMASA, SQUADRON] as const;
export const v8Source = v7Source; // Same raw snapshot commit as V7.
const SCOPE = { [MALFINI]: "TARGETED_SPEND_V1", [MURAMASA]: "END_TURN_HISTORY_V1", [SQUADRON]: "END_TURN_HISTORY_V1" } as const;
const ABILITY = {
    [MALFINI]: { id: "offduty-malfini-play-spend@1", trigger: "WHEN_PLAYED", conditions: [], effects: [{ kind: "SPEND_SOURCE" }, { kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL" } }] },
    [MURAMASA]: { id: "modded-muramasa-end-ready@1", trigger: "WHEN_OWN_TURN_ENDS", conditions: [{ kind: "STREET_CRED_LESS_THAN_RIVAL" }], effects: [{ kind: "READY_UNIT", target: { kind: "SOURCE" } }] },
    [SQUADRON]: { id: "maxtac-squadron-end-ready-legend@1", trigger: "WHEN_OWN_TURN_ENDS", conditions: [{ kind: "SUBJECT_IS_SPENT" }], effects: [{ kind: "READY_UNIT", target: { kind: "FRIENDLY_FACE_UP_LEGEND" } }] }
} as const;

export const batchV8Cards = V8_SLUGS.map(slug => {
    const r = v8Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`, a = ABILITY[slug];
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: SCOPE[slug], status: "SUPPORTED" },
        mechanics: { keywords: [], modifiers: [], abilities: [{ id: a.id, trigger: a.trigger, cost: { kind: "NONE" }, conditions: a.conditions, effects: a.effects }] },
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V8 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-17", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V7 chain plus the V8 revisions and the reviewed spend policy. */
export function batchV8Context() {
    const base = batchV7Context().content;
    const ruleset = RulesetSchema.parse({ ...base.ruleset, version: "api-admission-batch-v8-1", gameplay: { ...base.ruleset.gameplay, turnSlice: { ...base.ruleset.gameplay!.turnSlice, targetedSpend: "TARGETED_SPEND_V1" } } });
    return { content: createContentBundle(ruleset, [...base.cards, ...batchV8Cards], base.manifest.engine) };
}
export function batchV8Input(seed: string) { return batchV7Input(seed); }
