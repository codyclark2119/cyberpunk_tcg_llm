import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; guard: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: a.guard, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V40+: printed Go Solo Legends with "When a friendly Legend steals a Gig", each pinned whole. */
const LEGEND_STEAL_SHAPES = [
    // Batch V40: Rogue Amendiares: Preem Solo. "[Go Solo] When a friendly Legend steals a Gig, if its value is even, draw 1. If its
    // value is odd, a Rival discards 1."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Merc"], cost: 7, power: 7,
        abilities: [ability({ trigger: "WHEN_FRIENDLY_UNIT_STEALS_GIG", guard: "STEALER_IS_LEGEND", effects: [{ kind: "STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD", count: 1 }] })] }
].map(shape => canonicalSerialize({ type: "LEGEND", sell: true, keywords: ["GO_SOLO"], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasLegendStealTrigger(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.guard === "STEALER_IS_LEGEND" || a.effects.some(e => e.kind === "STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD")));
}
export function supportsLegendStealTrigger(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "fieldLegends") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "combatResolution") || !turnSliceAllows(p, "gear") || !turnSliceAllows(p, "react")
        || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !LEGEND_STEAL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_LEGEND_STEAL_TRIGGER", "Complete reviewed printed Go Solo Legend with an exact friendly-Legend steal trigger required");
    return success(null);
}
