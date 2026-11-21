import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
const SPEND = { trigger: null, inherited: null, guard: null, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }, conditions: [], abilityCost: { kind: "NONE" }, choose: null };
const CALL_CHOOSE_ONE = { trigger: "WHEN_CALLED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: { count: 1 } };
/** Batch V59+: Legends with a "{Spend} effect" ability used from the Legends area, a "{Call} Choose one effect." ability, or an "at the
 * start of your turn" trigger, each pinned whole. */
const LEGEND_SPEND_SHAPES = [
    // Batch V59: Hanako Arasaka: Daughter of the Emperor. "{Spend} Swap a friendly Gig with a rival Gig. At the start of your turn, draw 1
    // for each friendly value-pair of Gigs."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Arasaka", "Corpo", "Netrunner"], sell: true,
        abilities: [
            { trigger: null, inherited: null, guard: null, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "SWAP_GIGS" }] },
            { trigger: "WHEN_OWN_TURN_STARTS", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "DRAW_PER_FRIENDLY_VALUE_PAIR", count: 1 }] }] },
    // Batch V60: Wakako Okada: Peace and Harmony. "{Call} Choose one effect. Give a rival Unit -2 power this turn. // Draw 1.
    // {Spend}: Decrease a Gig by up to 2."
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Fixer", "Tyger Claws"], sell: true,
        abilities: [{ ...CALL_CHOOSE_ONE, effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -2 }, { kind: "DRAW", count: 1 }] },
            { ...SPEND, effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2, direction: "DECREASE" }] }] },
    // Batch V60: Dexter DeShawn: Off the Grid. "{Call} Choose one effect. Give a friendly Unit +2 power this turn. // Draw 1.
    // {Spend}: Increase a Gig by up to 2."
    { colors: ["RED"], ram: { RED: 2 }, tags: ["Fixer"], sell: true,
        abilities: [{ ...CALL_CHOOSE_ONE, effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "FRIENDLY_UNIT" }, amount: 2 }, { kind: "DRAW", count: 1 }] },
            { ...SPEND, effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2, direction: "INCREASE" }] }] },
    // Batch V61: Muamar Reyes: El Capitán. "{Call} Choose one effect. A friendly Unit can't be defeated in a fight this turn. // Draw 1.
    // {Spend} Adjust a Gig by 1."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Fixer"], sell: true,
        abilities: [{ ...CALL_CHOOSE_ONE, effects: [{ kind: "FIGHT_DEFEAT_IMMUNITY_THIS_TURN", target: { kind: "FRIENDLY_UNIT" } }, { kind: "DRAW", count: 1 }] },
            { ...SPEND, effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 }] }] },
    // Batch V62: Padre: Man of the Cross. "{Call} Choose one effect. Spend a rival Unit. // Draw 1. {Spend} Set a player's Gig to the same
    // value as another player's Gig."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Fixer", "Ganger", "Valentino"], sell: true,
        abilities: [{ ...CALL_CHOOSE_ONE, effects: [{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL" } }, { kind: "DRAW", count: 1 }] },
            { ...SPEND, effects: [{ kind: "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE" }] }] }
].map(shape => canonicalSerialize({ type: "LEGEND", power: null, cost: "DASH", keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
/** Any Legend activation, start-of-turn trigger, value-pair draw or mandatory swap routes here first. */
export function hasLegendSpendMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => card.type === "LEGEND" && (a.activation || a.choose) || a.trigger === "WHEN_OWN_TURN_STARTS" || a.effects.some(e => e.kind === "DRAW_PER_FRIENDLY_VALUE_PAIR" || e.kind === "FIGHT_DEFEAT_IMMUNITY_THIS_TURN" || e.kind === "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE" || e.kind === "SWAP_GIGS" && !e.optional)));
}
export function supportsLegendSpendCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "callEffects") || !turnSliceAllows(g?.turnSlice, "react") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "VALUE_CONDITIONS_V1" || card.execution.status !== "SUPPORTED"
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
