import { failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";

export function reactEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.react === "COMBAT_REACT_V1"; }
/** React is a defender decision, never a priority exchange or an interruptible continuation. */
export function isReactDecision(state: GameState, actor: PlayerId, context: EngineContext) {
    const c = state.timing.combat, r = state.resolution;
    return reactEnabled(context) && c.stage === "RIVAL_REACT" && state.timing.step === "RIVAL_REACT" && state.timing.window === "RIVAL_REACT" && state.timing.actingPlayer === actor && actor !== c.attackingPlayerId && !state.match.outcome && r.stage === "DECISION" && !r.current && !r.pending.length && !r.discovered.length && !r.choice && !r.playContinuation && !r.callContinuation && !r.searchContinuation && !r.returnTo;
}
/** Full reviewed executable shapes. Keyword presence alone never certifies a card. */
export function supportsReactPlay(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (!reactEnabled(context) || !card || card.mechanics.abilities.some(a => a.inherited || a.guard) || card.execution?.scope !== "COMBAT_REACT_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.mechanics.restrictions?.length || card.mechanics.equip || card.mechanics.modifiers.length)
        return failure("UNSUPPORTED_REACT_CARD", "Reviewed React execution scope, cost and complete mechanics required");
    const m = card.mechanics;
    if (card.type === "UNIT" && card.power === 0 && card.printedCost.amount === 2 && m.keywords.length === 1 && m.keywords[0] === "BLOCKER" && !m.abilities.length) return success(null);
    const a = m.abilities[0], power = a?.effects[0], draw = a?.effects[1];
    if (card.type === "PROGRAM" && card.power === undefined && card.printedCost.amount === 1 && m.keywords.length === 1 && m.keywords[0] === "QUICK" && m.abilities.length === 1 && a.trigger === "WHEN_PLAYED" && !a.activation && a.cost.kind === "NONE" && !a.conditions.length && a.effects.length === 2 && power.kind === "POWER_UNTIL_END_OF_TURN" && power.target.kind === "RIVAL_UNIT" && power.amount === -1 && draw.kind === "DRAW" && draw.count === 1) return success(null);
    return failure("UNSUPPORTED_REACT_CARD", "Only complete reviewed Floor It and Secondhand Bombus shapes are implemented");
}
