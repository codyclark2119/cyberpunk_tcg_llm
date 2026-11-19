import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A value-pair ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V29+: printed Units with "If you control a value-pair of Gigs" (6.6), each pinned whole. */
const VALUE_PAIR_SHAPES = [
    // Batch V29: Pepe Najarro: Working Doubles. "{Attack} If you control a value-pair of Gigs, ready up to 2 MERC Legends in your Legends area."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Valentino"], cost: 4, power: 6, abilities: [
        ability({ trigger: "WHEN_ATTACKING", effects: [{ kind: "READY_LEGENDS_UP_TO", tag: "Merc", maximum: 2, when: { timing: "RESOLUTION", condition: { kind: "CONTROLS_VALUE_PAIR" } } }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasValuePairMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.conditions.some(c => c.kind === "CONTROLS_VALUE_PAIR")
        || a.effects.some(e => e.kind === "READY_LEGENDS_UP_TO" || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "CONTROLS_VALUE_PAIR" || "when" in e && e.when?.condition.kind === "CONTROLS_VALUE_PAIR")));
}
export function supportsValuePairUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !VALUE_PAIR_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_VALUE_PAIR", "Complete reviewed printed Unit with exact value-pair abilities required");
    return success(null);
}
