import { withoutImmuneFightDefeats } from "./fight-immunity";
import { whileFightingBonus } from "./fight-power-grant";
import { forcedFightWinner } from "./fight-win-support";
import { hashCanonical, type FightResult, type CardInstanceId, type DefeatInstruction, type GameState, type PendingChoice, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { effectivePower } from "./characteristics";
import { referencedPower } from "./combat-resolution-policy";
import { defeatBatch } from "./defeat";
import { permittedStealGigs } from "./play-pin-effects";

export function listStealableGigs(state: GameState, defender: PlayerId) {
    return Object.values(state.objects.gigs).filter(g => g.controllerId === defender && g.location.playerId === defender && g.location.zone === "GIGS" && g.roll.kind === "ROLLED").sort((a, b) => a.id < b.id ? -1 : 1);
}
/** The Gigs this attacker may select after reviewed steal restrictions (11.5.1.3). */
export function stealableGigsFor(state: GameState, context: EngineContext, defender: PlayerId, attackerId: CardInstanceId) {
    return permittedStealGigs(state, context, defender, attackerId, listStealableGigs(state, defender));
}
/** Same authoritative characteristics as RulesView; usable inside validation without recursive validation. */
export function evaluateFight(state: GameState, context: EngineContext, power = (id: CardInstanceId) => effectivePower(state, id, context)) {
    const c = state.timing.combat;
    if (!("target" in c) || c.target?.kind !== "CARD") throw new Error("Expected a locked Unit target");
    const attackerId = c.attackerId, defenderId = c.target.cardInstanceId;
    // Batch V58 (11.4.2.1): "while fighting" power applies before the comparison.
    const fighting = (id: CardInstanceId) => { const p = power(id); return p === null ? null : p + whileFightingBonus(state, id, context); };
    const attackerPower = fighting(attackerId), defenderPower = fighting(defenderId);
    if (attackerPower === null || defenderPower === null) throw new Error("UNSUPPORTED_NULL_FIGHT_POWER");
    const a = referencedPower(attackerPower), d = referencedPower(defenderPower), forced = forcedFightWinner(state, attackerId, defenderId, context);
    // Batch V52 (11.4.1.4): a card that says this Unit wins supersedes the comparison; the opposing Unit always loses (11.4.1.1.1).
    const attackerLoses = forced ? forced === defenderId : a <= d, defenderLoses = forced ? forced === attackerId : d <= a;
    const loserIds = [ ...(attackerLoses ? [attackerId] : []), ...(defenderLoses ? [defenderId] : []) ];
    const defeats: DefeatInstruction[] = withoutImmuneFightDefeats(state, [ ...(attackerLoses && d > 0 ? [{ targetId: attackerId, defeatedBy: defenderId }] : []), ...(defenderLoses && a > 0 ? [{ targetId: defenderId, defeatedBy: attackerId }] : []) ]);
    return { event: { kind: "FIGHT_RESULT" as const, attackerId, defenderId, attackerPower, defenderPower, attackerComparisonPower: a, defenderComparisonPower: d, winnerId: forced ?? (a === d ? null : a > d ? attackerId : defenderId), loserIds, ...(forced ? { forcedWinnerId: forced } : {}) }, defeats };
}
export function gigStealChoice(state: GameState, context: EngineContext): PendingChoice {
    const c = state.timing.combat, continuation = state.resolution.gigStealContinuation!;
    if (!("target" in c) || c.target?.kind !== "GIG_AREA") throw new Error("Expected Gig attack");
    return { id: hashCanonical({ protocol: "gig-steal@1", turn: state.timing.turn, attackerId: c.attackerId, selected: continuation.selected }), actorId: c.attackingPlayerId, kind: "STEAL_GIGS", min: 1, max: 1, ordered: false, continuationId: "gig-steal@1", options: stealableGigsFor(state, context, c.target.playerId, c.attackerId).filter(g => !continuation.selected.includes(g.id)).map(g => ({ kind: "GIG", gigInstanceId: g.id })) };
}
export function unfinishedDefeatOrder(state: GameState) {
    return state.resolution.defeatContinuation?.orders.find(o => o.cardIds.length < defeatBatch(state, o.targetId).length);
}
export function defeatOrderChoice(state: GameState): PendingChoice {
    const order = unfinishedDefeatOrder(state)!;
    return { id: hashCanonical({ protocol: "defeat-order@1", turn: state.timing.turn, targetId: order.targetId, selected: order.cardIds }), actorId: state.objects.cards[order.targetId].ownerId, kind: "ORDER", min: 1, max: 1, ordered: true, continuationId: "defeat-order@1", options: defeatBatch(state, order.targetId).filter(id => !order.cardIds.includes(id)).map(id => ({ kind: "CARD", cardInstanceId: id })) };
}

/** Winners/losers are historical facts; zero-power defeat permission uses the current post-trigger characteristic. */
export function defeatsFromFightResult(state: GameState, context: EngineContext, result: FightResult): DefeatInstruction[] {
    // Batch V61: a fight-defeat immunity also holds here. Batch V58 follow-up: "while fighting" power counts toward this fight's defeat permission.
    return withoutImmuneFightDefeats(state, result.loserIds.flatMap(targetId => {
        const defeatedBy = targetId === result.attackerId ? result.defenderId : result.attackerId;
        const power = effectivePower(state, defeatedBy, context);
        return power !== null && referencedPower(power + whileFightingBonus(state, defeatedBy, context)) > 0 ? [{ targetId, defeatedBy }] : [];
    }));
}
