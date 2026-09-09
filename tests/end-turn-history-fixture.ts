import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { orderedContext, orderedInput } from "./attack-ordered-effects-fixture";
import sources from "./fixtures/end-turn-history-card-sources.v1.json";
const source = sources.records.find(r => r.record.slug === "delamain-cab")!;
export const DELAMAIN = "delamain-cab";
const r = source.record;
export const delamain = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "UNIT", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "END_TURN_HISTORY_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: "own-turn-end-ready@1", trigger: "WHEN_OWN_TURN_ENDS", conditions: [{ kind: "SUBJECT_STOLE_GIG_THIS_TURN" }], cost: { kind: "NONE" }, effects: [{ kind: "READY_EDDIES", player: "CONTROLLER", count: 1 }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: sources.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function endTurnContext() {
    const base = orderedContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "end-turn-history-1" });
    return { content: createContentBundle(rules, [...base.content.cards, delamain], base.content.manifest.engine) };
}
export function endTurnInput(seed: string) {
    const base = orderedInput(seed);
    return { ...base, decks: base.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-7" ? DELAMAIN : id) })) };
}
