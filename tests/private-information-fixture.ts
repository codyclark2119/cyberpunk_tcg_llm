import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { capabilitiesContext, capabilitiesInput } from "./gear-capabilities-fixture";
import source from "./fixtures/private-information-card-source.v1.json";
export const KIROSHI = "kiroshi-optics";
const r = source.record;
export const kiroshi = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "GEAR", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "GEAR_PRIVATE_LOOK_V1", status: "SUPPORTED" },
    mechanics: { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, keywords: [], abilities: [{ id: "inherited-attack-look@1", trigger: "WHEN_ATTACKING", inherited: "EQUIPPED_HOST", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND" }] }], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function privateContext() {
    const base = capabilitiesContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "private-information-1" });
    return { content: createContentBundle(rules, [...base.content.cards, kiroshi], base.content.manifest.engine) };
}
export function privateInput(seed: string) {
    const base = capabilitiesInput(seed);
    return { ...base, decks: base.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-4" ? KIROSHI : id) })) };
}
