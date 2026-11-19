import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V19: exact per-card pin table (Cody, 2026-11-15) for an [Attack] Gear search. Each admitted card's
 * complete printed shape is literal here; the search reuses the reviewed Call search primitive and its
 * private-look, reveal and shuffled bottom-deck behavior. */
const ATTACK_SEARCH_SHAPES = [
    // Sketchy Ripper: "[Attack] Search the top 3 cards of your deck. Reveal a Gear and add it to your hand. Bottom-deck the rest."
    { type: "UNIT", colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Ganger", "Ripperdoc", "Scavenger"], cost: 2, power: 0, sell: false, keywords: [],
        equip: null, modifiers: [], restrictions: [],
        abilities: [{ trigger: "WHEN_ATTACKING", inherited: null, guard: null, activation: null, conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "SEARCH_GEAR", count: 3, maxTake: 1 }] }] }
].map(shape => canonicalSerialize(shape));
export function supportsAttackSearchUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "callEffects") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length || !m)
        return failure("UNSUPPORTED_ATTACK_SEARCH", "Reviewed attack-trigger scope, combat, trigger and search policies required");
    const actual = canonicalSerialize({ type: card.type, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, sell: card.sellProfile.allowed,
        keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
        abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, cost: a.cost, effects: a.effects })) });
    return ATTACK_SEARCH_SHAPES.includes(actual) ? success(null) : failure("UNSUPPORTED_ATTACK_SEARCH", "Entire reviewed printed shape and attack search required");
}
