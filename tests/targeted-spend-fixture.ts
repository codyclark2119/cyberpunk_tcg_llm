import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { targetedContext, targetedInput, MINOTAUR } from "./targeted-defeat-fixture";
import source from "./fixtures/targeted-spend-card-source.v1.json";
export const SURVEILLANCE = "corporate-surveillance";
const r = source.record;
export const surveillance = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "PROGRAM", colors: ["GREEN"], ram: { GREEN: r.ram }, setCode: r.set.code, setName: r.set.name,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [], execution: { scope: "TARGETED_SPEND_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: "rival-unit-cost-four-spend@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL", costAtMost: 4 } }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: source.source + "; complete rules/FAQ implementation review, not human-certified gold", sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function spendContext() {
    const base = targetedContext(), rules = RulesetSchema.parse({ ...base.content.ruleset, version: "targeted-spend-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, targetedSpend: "TARGETED_SPEND_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, surveillance], base.content.manifest.engine) };
}
export function spendInput(seed: string) {
    const base = targetedInput(seed);
    return { ...base, decks: [{ ...base.decks[0], main: base.decks[0].main.map(id => id === MINOTAUR ? SURVEILLANCE : id) }, base.decks[1]] };
}
