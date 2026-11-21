import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V59+: Legends with a "{Spend} effect" ability used from the Legends area, or an "at the start of your turn" trigger, each pinned whole. */
const LEGEND_SPEND_SHAPES = [
    // Batch V59: Hanako Arasaka: Daughter of the Emperor. "{Spend} Swap a friendly Gig with a rival Gig. At the start of your turn, draw 1
    // for each friendly value-pair of Gigs."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Arasaka", "Corpo", "Netrunner"], sell: true,
        abilities: [
            { trigger: null, inherited: null, guard: null, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "SWAP_GIGS" }] },
            { trigger: "WHEN_OWN_TURN_STARTS", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "DRAW_PER_FRIENDLY_VALUE_PAIR", count: 1 }] }] }
].map(shape => canonicalSerialize({ type: "LEGEND", power: null, cost: "DASH", keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
/** Any Legend activation, start-of-turn trigger, value-pair draw or mandatory swap routes here first. */
export function hasLegendSpendMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => card.type === "LEGEND" && a.activation || a.trigger === "WHEN_OWN_TURN_STARTS" || a.effects.some(e => e.kind === "DRAW_PER_FRIENDLY_VALUE_PAIR" || e.kind === "SWAP_GIGS" && !e.optional)));
}
export function supportsLegendSpendCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "callEffects") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "VALUE_CONDITIONS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || !m || !LEGEND_SPEND_SHAPES.includes(canonicalSerialize({ type: card.type, power: card.power ?? null, cost: card.printedCost.kind === "DASH" ? "DASH" : card.printedCost, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, sell: card.sellProfile.allowed,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_LEGEND_SPEND", "Complete reviewed Legend with an exact {Spend} ability and start-of-turn trigger required");
    return success(null);
}
/** 6.6, 6.6.1: the most disjoint same-value pairs among the player's rolled Gigs. */
export function friendlyValuePairs(state: GameState, player: PlayerId) {
    const counts = new Map<number, number>();
    for (const id of state.players[player].gigs.GIGS) { const g = state.objects.gigs[id]; if (g.roll.kind === "ROLLED") counts.set(g.roll.currentValue, (counts.get(g.roll.currentValue) ?? 0) + 1); }
    return [...counts.values()].reduce((n, c) => n + Math.floor(c / 2), 0);
}
export function validateLegendSpendMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasLegendSpendMetadata(r)) { const valid = supportsLegendSpendCard(r, context); if (!valid.ok) return valid; }
    }
    return success(null);
}
