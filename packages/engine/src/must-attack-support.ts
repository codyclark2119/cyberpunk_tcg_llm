import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V43+: printed Units whose {Play} obliges a rival Unit to attack next turn, each pinned whole. */
const MUST_ATTACK_SHAPES = [
    // Batch V43: Mox Inciters. "{Play} A rival Unit must attack next turn if it can. [Blocker]"
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Ganger", "Mox"], cost: 3, power: 2, keywords: ["BLOCKER"],
        abilities: [ability({ trigger: "WHEN_PLAYED", effects: [{ kind: "FORCE_RIVAL_UNIT_ATTACK", duration: "NEXT_TURN" }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasMustAttackEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "FORCE_RIVAL_UNIT_ATTACK")));
}
export function supportsMustAttackUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "react") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !MUST_ATTACK_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_MUST_ATTACK", "Complete reviewed printed Blocker Unit with an exact {Play} must-attack obligation required");
    return success(null);
}
