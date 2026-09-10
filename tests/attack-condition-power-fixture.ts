import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { spendContext } from "./targeted-spend-fixture";
import { saburoInput } from "./saburo-fixture";
import source from "./fixtures/attack-condition-power-card-source.v1.json";
export const LOSING = "goro-takemura-losing-his-way";
const r = source.record;
export const losing = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname, displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "UNIT", colors: ["GREEN"], ram: { GREEN: r.ram }, setCode: r.set.code, setName: r.set.name,
    printedCost: { kind: "EDDIES", amount: r.cost }, power: r.power, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [], execution: { scope: "ATTACK_CONDITION_POWER_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: "attack-all-friendly-legends-up-self-power@1", trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [{ kind: "ALL_FRIENDLY_LEGENDS_FACE_UP" }], effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "SOURCE_SUBJECT" }, amount: 5 }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: source.source + "; complete rules/FAQ implementation review, not human-certified gold", sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function attackPowerContext() {
    const base = spendContext(), rules = RulesetSchema.parse({ ...base.content.ruleset, version: "attack-condition-power-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, attackConditionPower: "ATTACK_CONDITION_POWER_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, losing], base.content.manifest.engine) };
}
export function attackPowerInput(seed: string) {
    const base = saburoInput(seed);
    return { ...base, decks: base.decks.map(d => ({ ...d, main: d.main.map(id => id === "swordwise-huscle" ? LOSING : id) })) };
}
