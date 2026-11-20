import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A cost-matching search ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V35+: printed Units whose {Play} searches for cards costing a friendly Gig's value, each pinned whole. The search reuses
 * the reviewed V19 primitive: a private look, reveal on taking, and a shuffled bottom-deck of the rest. */
const GIG_SEARCH_SHAPES = [
    // Batch V35: Hanako Arasaka: In a Gilded Cage. "{Play} Search the top 4 cards of your deck. Reveal any number of cards with cost equal
    // to any friendly Gig values and add them to your hand. Bottom-deck the rest."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Arasaka", "Corpo", "Netrunner"], cost: 4, power: 1, abilities: [
        ability({ trigger: "WHEN_PLAYED", effects: [{ kind: "SEARCH_COST_MATCHING_GIGS", count: 4 }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasGigSearchEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "SEARCH_COST_MATCHING_GIGS")));
}
export function supportsGigSearchUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "callEffects") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !GIG_SEARCH_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_GIG_SEARCH", "Complete reviewed printed Unit with an exact {Play} cost-matching search required");
    return success(null);
}
