import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { triggersContext, triggersInput } from "./combat-triggers-fixture";
import source from "./fixtures/gear-capabilities-card-source.v1.json";
export const MANDIBULAR = "mandibular-upgrade";
const r = source.record;
export const mandibular = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "GEAR", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "GEAR_CAPABILITIES_V1", status: "SUPPORTED" },
    mechanics: { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, keywords: [], abilities: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "GRANT_KEYWORD_TO_HOST", keyword: "BLOCKER" }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: [], reviewed: true }
});
export function capabilitiesContext() {
    const base = triggersContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "gear-capabilities-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, gearCapabilities: "GEAR_CAPABILITIES_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, mandibular], base.content.manifest.engine) };
}
export function capabilitiesInput(seed: string) {
    const base = triggersInput(seed);
    // Reuse the legal Red/Blue/Yellow RAM support. Green cards remain content-only for focused composition tests.
    return { ...base, decks: base.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-2" ? MANDIBULAR : id) })) };
}
