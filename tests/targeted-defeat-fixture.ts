import { triggersInput } from "./combat-triggers-fixture";
import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { valueContext, valueInput } from "./value-conditions-fixture";
import source from "./fixtures/targeted-defeat-card-sources.v1.json";
export const MINOTAUR = "minotaur", OVER_THE_EDGE = "over-the-edge";
export const targetedCards = source.records.map(({ record: r, source: origin }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram }, setCode: r.set.code, setName: r.set.name,
    printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }), sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [], execution: { scope: "TARGETED_DEFEAT_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: r.slug === MINOTAUR ? "play-conditional-rival-defeat@1" : "controlled-d20-any-unit-defeat@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: r.slug === MINOTAUR ? [
        { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 5 } }, when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" } } }
    ] : [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "CONTROLLED_GIG_VALUE", dieType: "D20" } } }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
    provenance: { source: origin + "; complete rules/FAQ implementation review, not human-certified gold", sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
}));
export function targetedContext() {
    const base = valueContext(), rules = RulesetSchema.parse({ ...base.content.ruleset, version: "targeted-defeat-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, targetedDefeat: "TARGETED_DEFEAT_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, ...targetedCards], base.content.manifest.engine) };
}
export function targetedInput(seed: string) {
    const base = valueInput(seed), rivalBase = triggersInput(seed).decks[1], rival = { ...rivalBase, main: rivalBase.main.map(id => id === "slice-card-2" ? "mandibular-upgrade" : id) };
    return { ...base, decks: [{ ...base.decks[0], main: base.decks[0].main.map(id => id === "slice-card-2" ? MINOTAUR : id === "slice-card-3" ? OVER_THE_EDGE : id) }, rival] };
}
