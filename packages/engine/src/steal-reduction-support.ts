import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V57+: Quick Programs that make a rival Unit steal fewer Gigs this turn, each pinned whole. */
const STEAL_REDUCTION_SHAPES = [
    // Batch V57: Take Control. "{Quick} A rival Unit steals 1 fewer Gig this turn. If that Unit is an AI, DRONE, or VEHICLE, draw 1."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Quickhack"], cost: 2, abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
        effects: [{ kind: "STEAL_FEWER_THIS_TURN", target: { kind: "RIVAL_UNIT" }, amount: 1, draw: { classifications: ["AI", "Drone", "Vehicle"], count: 1 } }] }] }
].map(shape => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: ["QUICK"], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasStealReduction(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "STEAL_FEWER_THIS_TURN")));
}
export function supportsStealReductionProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "react") || !turnSliceAllows(g?.turnSlice, "combatResolution") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_REACT_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !STEAL_REDUCTION_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_STEAL_REDUCTION", "Complete reviewed Quick Program with an exact steal reduction required");
    return success(null);
}
