import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { saburoContext, saburoInput } from "./saburo-fixture";
import source from "./fixtures/value-conditions-card-sources.v1.json";
export const INDUSTRIAL = "industrial-assembly", FIELD_OPERATOR = "field-operator";
export const valueCards = source.records.map(({ record: r, source: origin }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram }, setCode: r.set.code, setName: r.set.name,
    printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }), sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [], execution: { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: r.slug === INDUSTRIAL ? "increase-then-current-threshold@1" : "play-current-parity-draw@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: r.slug === INDUSTRIAL ? [
        { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 4, direction: "INCREASE" },
        { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE_AT_LEAST", minimum: 8 }, count: 1 }
    ] : [{ kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "STREET_CRED_IS_EVEN" }, count: 1 }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
    provenance: { source: origin + "; complete rules/FAQ implementation review, not human-certified gold", sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
}));
export function valueContext() {
    const base = saburoContext(), rules = RulesetSchema.parse({ ...base.content.ruleset, version: "value-conditions-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, valueConditions: "VALUE_CONDITIONS_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, ...valueCards], base.content.manifest.engine) };
}
export function valueInput(seed: string) {
    const base = saburoInput(seed);
    return { ...base, decks: base.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-0" ? INDUSTRIAL : id === "slice-card-1" ? FIELD_OPERATOR : id) })) };
}
