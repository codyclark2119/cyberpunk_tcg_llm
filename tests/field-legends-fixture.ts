import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { delayedContext, delayedInput } from "./delayed-effects-fixture";
import { EVELYN } from "./attack-ordered-effects-fixture";
import { FLATHEAD } from "./combat-restrictions-fixture";
import source from "./fixtures/field-legends-card-source.v1.json";
export const V = "v-corporate-exile";
const r = source.record;
export const fieldLegend = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "LEGEND", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" },
    mechanics: { keywords: ["GO_SOLO"], modifiers: [], abilities: [] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source}; official Go Solo/V FAQs (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function fieldLegendContext() {
    const base = delayedContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "field-legends-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, fieldLegends: "FIELD_LEGENDS_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, fieldLegend], base.content.manifest.engine) };
}
export function fieldLegendInput(seed: string) {
    const base = delayedInput(seed);
    // V supplies Blue RAM2. Reuse existing synthetic filler instead of RAM3 cards; constructed rules stay intact.
    return { ...base, decks: base.decks.map(d => ({ legends: d.legends.map(id => id === "restriction-blue-support" ? V : id), main: d.main.map(id => id === FLATHEAD ? "slice-card-8" : id === EVELYN ? "slice-card-6" : id) })) };
}
