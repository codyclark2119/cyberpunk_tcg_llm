import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { yorinobuContext, yorinobuInput, YORINOBU } from "./yorinobu-fixture";
import { GORO } from "./goro-fixture";
import source from "./fixtures/saburo-card-source.v1.json";
export const SABURO = "saburo-arasaka-stubborn-patriarch";
const r = source.record;
export const saburo = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname, displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "LEGEND", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, printedCost: { kind: "DASH" }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "ATTACKING_AURA_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], abilities: [], modifiers: [{ kind: "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount: 1 }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: source.source + "; persistent/attacking rules and official Fight/Steal FAQ (implementation review, not human-certified gold)", sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function saburoContext() {
    const base = yorinobuContext(), rules = RulesetSchema.parse({ ...base.content.ruleset, version: "attacking-aura-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, attackingAura: "ATTACKING_AURA_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, saburo], base.content.manifest.engine) };
}
export function saburoInput(seed: string) {
    const base = yorinobuInput(seed);
    // Three actual Arasaka Legends; reuse eight existing synthetic Gear revisions for constructed size.
    // This is not either physical 27+3 teaching list, and no new synthetic card revision is introduced.
    const main = ["mantis-blades", "satori-sword-of-saburo", "swordwise-huscle", "kerry-eurodyne-the-last-rockerboy", "corpo-security", "emergency-atlus", ...Array.from({ length: 8 }, (_, i) => "slice-card-" + i)].flatMap(id => [id, id, id]);
    return { ...base, decks: base.decks.map(() => ({ legends: [SABURO, GORO, YORINOBU], main })) };
}
