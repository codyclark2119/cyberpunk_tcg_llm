import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type ContinuousModifier, type DeepReadonly, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { effectiveCardTypes } from "./characteristics";

type Reduction = Extract<ContinuousModifier, { kind: "SELF_PLAY_COST_REDUCTION" }>;
export function playCostReductionEnabled(context: EngineContext) {
    const policy = context.content.ruleset.gameplay?.turnSlice;
    return turnSliceAllows(policy, "cardPlay") && turnSliceAllows(policy, "combat") && turnSliceAllows(policy, "playCostReduction");
}
/** Batch V11 exact pins: each admitted card's complete printed shape and its only modifier, literally. */
const COST_REDUCTION_SHAPES = [
    // Octant: "Play this Unit for -1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$."
    { colors: ["RED"], ram: { RED: 4 }, tags: ["Drone", "Militech", "Zetatech"], cost: 7, power: 8, sell: false, modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per: "FRIENDLY_GIG_VALUE_AT_LEAST_8", amount: 1, minimum: 1 }] },
    // Trauma Team Operatives: "Play this Unit for -1 €$ for each Unit in your trash, to a minimum of 1 €$."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Medtech", "Trauma Team"], cost: 6, power: 7, sell: false, modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per: "FRIENDLY_TRASH_UNIT", amount: 1, minimum: 1 }] },
    // MaxTac Heavy: "Play this Unit for -1 €$ for each of a Rival's Units, to a minimum of 1 €$."
    { colors: ["GREEN"], ram: { GREEN: 3 }, tags: ["NCPD"], cost: 7, power: 8, sell: false, modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per: "RIVAL_UNIT", amount: 1, minimum: 1 }] }
].map(shape => canonicalSerialize(shape));

export function hasPlayCostReductionMetadata(card: DeepReadonly<CardRevisionSnapshot>) {
    return card.execution?.scope === "PLAY_COST_REDUCTION_V1" || card.mechanics.modifiers.some(m => m.kind === "SELF_PLAY_COST_REDUCTION");
}
/** Complete reviewed vanilla Unit whose only text is a self play-cost reduction; no other mechanics. */
export function supportsPlayCostReductionUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!playCostReductionEnabled(context) || !card?.provenance.reviewed || card.execution?.scope !== "PLAY_COST_REDUCTION_V1" || card.execution.status !== "SUPPORTED" || card.type !== "UNIT" || card.printedCost.kind !== "EDDIES" || card.power === undefined || card.keywords.length || !m || m.equip || m.keywords.length || m.restrictions?.length || m.abilities.length)
        return failure("UNSUPPORTED_PLAY_COST_REDUCTION", "Complete reviewed Unit with only a pinned self play-cost reduction required");
    const actual = canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power, sell: card.sellProfile.allowed, modifiers: m.modifiers });
    return COST_REDUCTION_SHAPES.includes(actual) ? success(null) : failure("UNSUPPORTED_PLAY_COST_REDUCTION", "Card does not match a pinned Batch V11 cost-reduction shape");
}
function reductionCount(state: GameState, actor: PlayerId, modifier: DeepReadonly<Reduction>, context: EngineContext) {
    switch (modifier.per) {
        case "FRIENDLY_GIG_VALUE_AT_LEAST_8":
            return Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue >= 8).length;
        case "FRIENDLY_TRASH_UNIT":
            return state.players[actor].zones.TRASH.filter(id => context.content.cards.find(r => r.id === state.objects.cards[id].cardId && r.revision === state.objects.cards[id].revision)?.type === "UNIT").length;
        case "RIVAL_UNIT": // "a Rival": the most favorable single Rival; one Rival in two-player games.
            return Math.max(0, ...state.match.playerOrder.filter(id => id !== actor).map(rival =>
                state.players[rival].zones.BATTLEFIELD.filter(id => state.objects.cards[id].controllerId === rival && effectiveCardTypes(state, id, context).includes("UNIT")).length));
    }
}
/** 3.11.1.2: the amount `actor` pays to play `id` now. The card's cost value stays its printed cost. */
export function playPaymentAmount(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext): number | null {
    const c = state.objects.cards[id], r = context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
    if (r?.printedCost.kind !== "EDDIES") return null;
    const printed = r.printedCost.amount, reductions = r.mechanics.modifiers.filter((m): m is DeepReadonly<Reduction> => m.kind === "SELF_PLAY_COST_REDUCTION");
    if (!reductions.length || !supportsPlayCostReductionUnit(r, context).ok) return printed;
    return reductions.reduce((amount, m) => Math.max(Math.min(amount, m.minimum), amount - m.amount * reductionCount(state, actor, m, context)), printed);
}
/** Hidden sources are validated too; an external state cannot carry an unpinned reduction. */
export function validatePlayCostReductionMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasPlayCostReductionMetadata(r)) { const supported = supportsPlayCostReductionUnit(r, context); if (!supported.ok) return supported; }
    }
    return success(null);
}
