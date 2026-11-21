import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V58+: Quick Programs that give a friendly Unit power while fighting this turn, each pinned whole. */
const FIGHT_POWER_SHAPES = [
    // Batch V58: Synapse Burnout. "{Quick} A friendly Unit has +1 power for each friendly face-up Legend while fighting rival Units this turn."
    { colors: ["GREEN"], ram: { GREEN: 1 }, tags: ["Quickhack"], cost: 1, abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
        effects: [{ kind: "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN", target: { kind: "FRIENDLY_UNIT" }, amount: 1 }] }] }
].map(shape => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: ["QUICK"], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasFightPowerGrant(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN")));
}
export function supportsFightPowerProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "react") || !turnSliceAllows(g?.turnSlice, "combatResolution") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_REACT_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !FIGHT_POWER_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_FIGHT_POWER", "Complete reviewed Quick Program with an exact while-fighting power required");
    return success(null);
}
