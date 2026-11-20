import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V41+: printed Go Solo Legends whose {Attack} reveals the top card into hand for power, each pinned whole. */
const LEGEND_REVEAL_SHAPES = [
    // Batch V41: Sasha Yakovleva: Won't Let You Down. "[Go Solo] {Attack} Reveal the top card of your deck and add it to your hand.
    // This Unit gains power equal to that card's cost this turn. {Defeated} A Rival discards 1."
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Maine's Crew", "Merc", "Netrunner"], cost: 5, power: 0, abilities: [
        ability({ trigger: "WHEN_ATTACKING", effects: [{ kind: "REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST", count: 1 }] }),
        ability({ trigger: "WHEN_DEFEATED", effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER" }] })] }
].map(shape => canonicalSerialize({ type: "LEGEND", sell: true, keywords: ["GO_SOLO"], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasLegendRevealEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST")));
}
export function supportsLegendReveal(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "fieldLegends") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "combatResolution") || !turnSliceAllows(p, "gear") || !turnSliceAllows(p, "react")
        || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !LEGEND_REVEAL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_LEGEND_REVEAL", "Complete reviewed printed Go Solo Legend with an exact {Attack} reveal and {Defeated} rival discard required");
    return success(null);
}
