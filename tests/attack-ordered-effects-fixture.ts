import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { privateContext, privateInput } from "./private-information-fixture";
import source from "./fixtures/attack-ordered-effects-card-source.v1.json";
export const EVELYN = "evelyn-parker-scheming-siren";
const r = source.record;
export const evelyn = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "UNIT", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "ATTACK_ORDERED_EFFECTS_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: "attack-draw-conditional-discard@1", trigger: "WHEN_ATTACKING", conditions: [], cost: { kind: "NONE" }, effects: [
        { kind: "DRAW", count: 1 }, { kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" } } }
    ] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function orderedContext() {
    const base = privateContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "attack-ordered-effects-1" });
    return { content: createContentBundle(rules, [...base.content.cards, evelyn], base.content.manifest.engine) };
}
export function orderedInput(seed: string) {
    const base = privateInput(seed);
    return { ...base, decks: base.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-6" ? EVELYN : id) })) };
}
