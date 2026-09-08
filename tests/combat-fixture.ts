import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { gearContext, gearInput } from "./gear-fixture";
import source from "./fixtures/combat-card-source.v1.json";
import rules from "./fixtures/combat-rules.v1.json";
export const SWORDWISE = "swordwise-huscle";
const r = source.record;
export const swordwise = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "UNIT", colors: ["RED"], ram: { RED: r.ram }, setCode: r.set.code, setName: r.set.name,
    power: r.power, printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "COMBAT_ATTACK_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{ id: "swordwise-attack-draw@1", trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "SOURCE_POWER_AT_LEAST", minimum: 5 }, count: 1 }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: [], reviewed: true }
});
export function combatContext() {
    const base = gearContext();
    const policy = RulesetSchema.parse({ ...base.content.ruleset, version: "combat-attack-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, combat: "COMBAT_ATTACK_V1", rulesSourceHash: rules.sha256 } } });
    return { content: createContentBundle(policy, [...base.content.cards, swordwise], base.content.manifest.engine) };
}
export function combatInput(seed = "combat-attack-1") {
    const input = gearInput(seed);
    return { ...input, decks: input.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-3" ? SWORDWISE : id) })) };
}
