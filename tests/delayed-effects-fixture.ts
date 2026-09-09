import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { endTurnContext, endTurnInput } from "./end-turn-history-fixture";
import { MANTIS } from "./gear-fixture";
import source from "./fixtures/delayed-effects-card-source.v1.json";
export const DYING_NIGHT = "dying-night-v-s-pistol";
const r = source.record;
export const dyingNight = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "GEAR", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "GEAR_DELAYED_ATTACK_V1", status: "SUPPORTED" },
    mechanics: { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }],
        abilities: [{ id: "inherited-attack-delayed-ready@1", trigger: "WHEN_ATTACKING", inherited: "EQUIPPED_HOST", conditions: [], cost: { kind: "NONE" }, effects: [
            { kind: "DECREASE_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2 },
            { kind: "REGISTER_END_TURN_EFFECT", effect: { kind: "READY_EDDIES", player: "CONTROLLER", count: 2, when: { timing: "RESOLUTION", condition: { kind: "SUBJECT_IS_UNIT_NAMED", identity: "V" } } } }
        ] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: source.source })),
    provenance: { source: `${source.source}; official Dying Night FAQ (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-09", errata: source.errata.filter(e => e.card_id === r.slug).map(e => e.text), reviewed: true }
});
export function delayedContext() {
    const base = endTurnContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "delayed-effects-1" });
    return { content: createContentBundle(rules, [...base.content.cards, dyingNight], base.content.manifest.engine) };
}
export function delayedInput(seed: string) {
    const base = endTurnInput(seed);
    return { ...base, decks: base.decks.map(d => { let copies = 0; return { ...d, main: d.main.map(id => id === MANTIS && copies++ < 2 ? DYING_NIGHT : id) }; }) };
}
