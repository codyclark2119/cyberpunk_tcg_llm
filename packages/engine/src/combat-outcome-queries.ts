import { hashCanonical, type CardInstanceId, type DefeatInstruction, type GameState, type PendingChoice, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { effectivePower } from "./characteristics";
import { referencedPower } from "./combat-resolution-policy";
import { defeatBatch } from "./defeat";

export function listStealableGigs(state: GameState, defender: PlayerId) {
    return Object.values(state.objects.gigs).filter(g => g.controllerId === defender && g.location.playerId === defender && g.location.zone === "GIGS" && g.roll.kind === "ROLLED").sort((a, b) => a.id < b.id ? -1 : 1);
}
/** Same authoritative characteristics as RulesView; usable inside validation without recursive validation. */
export function evaluateFight(state: GameState, context: EngineContext, power = (id: CardInstanceId) => effectivePower(state, id, context)) {
    const c = state.timing.combat;
    if (!("target" in c) || c.target?.kind !== "CARD") throw new Error("Expected a locked Unit target");
    const attackerId = c.attackerId, defenderId = c.target.cardInstanceId;
    const attackerPower = power(attackerId), defenderPower = power(defenderId);
    if (attackerPower === null || defenderPower === null) throw new Error("UNSUPPORTED_NULL_FIGHT_POWER");
    const a = referencedPower(attackerPower), d = referencedPower(defenderPower);
    const loserIds = [ ...(a <= d ? [attackerId] : []), ...(d <= a ? [defenderId] : []) ];
    const defeats: DefeatInstruction[] = [ ...(a <= d && d > 0 ? [{ targetId: attackerId, defeatedBy: defenderId }] : []), ...(d <= a && a > 0 ? [{ targetId: defenderId, defeatedBy: attackerId }] : []) ];
    return { event: { kind: "FIGHT_RESULT" as const, attackerId, defenderId, attackerPower, defenderPower, attackerComparisonPower: a, defenderComparisonPower: d, winnerId: a === d ? null : a > d ? attackerId : defenderId, loserIds }, defeats };
}
export function gigStealChoice(state: GameState): PendingChoice {
    const c = state.timing.combat, continuation = state.resolution.gigStealContinuation!;
    if (!("target" in c) || c.target?.kind !== "GIG_AREA") throw new Error("Expected Gig attack");
    return { id: hashCanonical({ protocol: "gig-steal@1", turn: state.timing.turn, attackerId: c.attackerId, selected: continuation.selected }), actorId: c.attackingPlayerId, kind: "STEAL_GIGS", min: 1, max: 1, ordered: false, continuationId: "gig-steal@1", options: listStealableGigs(state, c.target.playerId).filter(g => !continuation.selected.includes(g.id)).map(g => ({ kind: "GIG", gigInstanceId: g.id })) };
}
export function unfinishedDefeatOrder(state: GameState) {
    return state.resolution.defeatContinuation?.orders.find(o => o.cardIds.length < defeatBatch(state, o.targetId).length);
}
export function defeatOrderChoice(state: GameState): PendingChoice {
    const order = unfinishedDefeatOrder(state)!;
    return { id: hashCanonical({ protocol: "defeat-order@1", turn: state.timing.turn, targetId: order.targetId, selected: order.cardIds }), actorId: state.objects.cards[order.targetId].ownerId, kind: "ORDER", min: 1, max: 1, ordered: true, continuationId: "defeat-order@1", options: defeatBatch(state, order.targetId).filter(id => !order.cardIds.includes(id)).map(id => ({ kind: "CARD", cardInstanceId: id })) };
}
