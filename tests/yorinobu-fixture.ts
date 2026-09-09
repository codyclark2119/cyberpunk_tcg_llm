import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { goroContext, goroInput, GORO } from "./goro-fixture";
import source from "./fixtures/yorinobu-card-source.v1.json";
export const YORINOBU = "yorinobu-arasaka-embracing-destruction";
export const TRUSTED_ARASAKA = "yorinobu-fixture-arasaka-unit";
const r = source.record;
export const yorinobu = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname, displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "LEGEND", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, printedCost: { kind: "DASH" },
    sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 }, rulesText: r.rules_text, sourceMarkup: r.rules_text,
    tags: r.classifications, keywords: [], execution: { scope: "FIRST_ATTACK_HISTORY_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: "first-arasaka-attack", trigger: "WHEN_UNIT_ATTACKS", guard: "FIRST_FRIENDLY_ARASAKA_UNIT_ATTACK_PER_TURN", cost: { kind: "NONE" }, conditions: [], effects: [
        { kind: "DRAW", count: 1 }, { kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_LESS_THAN_VALUE", value: 20 } } }
    ] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: source.source + "; official first-before-reveal FAQ (implementation review, not human-certified gold)", sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function yorinobuContext() {
    const base = goroContext(), rules = RulesetSchema.parse({ ...base.content.ruleset, version: "first-attack-history-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, firstAttackHistory: "FIRST_ATTACK_HISTORY_V1" } } });
    const synthetic = (id: string, detail: string) => ({ printings: [{ id: id + "-print", setCode: "DEV", collectorNumber: "Y01", source: "Synthetic test fixture" }], provenance: { source: detail + "; not a real card admission or human gold", sourceHash: hashCanonical({ fixture: id, detail }), effectiveAt: "2026-09-09", errata: [], reviewed: true } });
    const supportId = "yorinobu-fixture-blue-yellow-support";
    const support = CardRevisionSnapshotSchema.parse({ ...base.content.cards.find(c => c.id === "dev-legend-blue")!, id: supportId, name: "Synthetic Blue Yellow Support", displayName: "Synthetic Blue Yellow Support", deckbuildingIdentity: supportId, colors: ["BLUE", "YELLOW"], ram: { BLUE: 2, YELLOW: 2 }, ...synthetic(supportId, "Constructed Blue/Yellow RAM2 support") });
    // No admitted printed demo Unit has Arasaka. This is a separate immutable synthetic revision, not altered Psycho Squad.
    const unit = CardRevisionSnapshotSchema.parse({ ...base.content.cards.find(c => c.id === "psycho-squad")!, id: TRUSTED_ARASAKA, name: "Synthetic Classification Unit", displayName: "Synthetic Classification Unit", deckbuildingIdentity: TRUSTED_ARASAKA, tags: ["Arasaka"], rulesText: "", sourceMarkup: "", ...synthetic(TRUSTED_ARASAKA, "Printed Arasaka Unit qualification fixture") });
    return { content: createContentBundle(rules, [...base.content.cards, yorinobu, support, unit], base.content.manifest.engine) };
}
export function yorinobuInput(seed: string) {
    const base = goroInput(seed);
    return { ...base, decks: base.decks.map(d => ({ main: d.main, legends: [YORINOBU, GORO, "yorinobu-fixture-blue-yellow-support"] })) };
}
