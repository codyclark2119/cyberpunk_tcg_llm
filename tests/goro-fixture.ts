import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { fieldLegendContext } from "./field-legends-fixture";
import { restrictionsInput } from "./combat-restrictions-fixture";
import source from "./fixtures/goro-card-source.v1.json";
export const GORO = "goro-takemura-hands-unclean";
const r = source.record;
export const goro = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "LEGEND", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" },
    mechanics: { keywords: ["GO_SOLO", "BLOCKER"], modifiers: [], abilities: [] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source}; official Go Solo/Hands Unclean Blocker FAQs (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function goroContext() {
    const base = fieldLegendContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "field-legends-2" });
    // New explicit synthetic support, never a changed real revision or a padded teaching list.
    const support = CardRevisionSnapshotSchema.parse({ ...base.content.cards.find(c => c.id === "dev-legend-red")!,
        id: "goro-fixture-red-yellow-support", name: "Synthetic Red Yellow Support", displayName: "Synthetic Red Yellow Support", deckbuildingIdentity: "goro-fixture-red-yellow-support",
        colors: ["RED", "YELLOW"], ram: { RED: 2, YELLOW: 2 },
        printings: [{ id: "goro-fixture-support-print", setCode: "DEV", collectorNumber: "G01", source: "Synthetic constructed test support" }],
        provenance: { source: "Synthetic Red/Yellow RAM2 Legend for four-color Gear composition tests; not a real card or human gold", sourceHash: hashCanonical({ fixture: "goro-fixture-red-yellow-support", ram: { RED: 2, YELLOW: 2 } }), effectiveAt: "2026-09-09", errata: [], reviewed: true }
    });
    return { content: createContentBundle(rules, [...base.content.cards, goro, support], base.content.manifest.engine) };
}
export function goroInput(seed: string) {
    const base = restrictionsInput(seed);
    const main = ["mantis-blades", "satori-sword-of-saburo", "mandibular-upgrade", "kiroshi-optics", "dying-night-v-s-pistol", "psycho-squad", "corpo-security", "emergency-atlus", "reboot-optics", "slice-card-2", "slice-card-4", "slice-card-6", "slice-card-7", "slice-card-8"].flatMap(id => [id, id, id]);
    return { ...base, decks: [
        { legends: [GORO, "dev-legend-blue", "goro-fixture-red-yellow-support"], main },
        { legends: ["v-corporate-exile", "dev-legend-green", "goro-fixture-red-yellow-support"], main }
    ] };
}
