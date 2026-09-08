import { preventFightDefeats } from "./fight-prevention";
import { canonicalSerialize, failure, success, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled, getGigStealAllowance } from "./combat-resolution-policy";
import { effectivePower } from "./characteristics";
import { attackSourceValid, listAttackTargets } from "./combat-queries";
import { defeatBatch, defeatSupport } from "./defeat";
import { defeatOrderChoice, evaluateFight, gigStealChoice, listStealableGigs, unfinishedDefeatOrder } from "./combat-outcome-queries";

export function validateCombatOutcome(state: GameState, context: EngineContext) {
    const c = state.timing.combat, r = state.resolution;
    if (c.stage !== "GIG_STEAL_SELECTION" && c.stage !== "DEFEAT_ORDER_SELECTION")
        return r.gigStealContinuation || r.defeatContinuation ? failure("ORPHAN_COMBAT_CONTINUATION", "Combat outcome continuation needs its matching stage") : success(null);
    if (!combatResolutionEnabled(context) || state.setup || state.match.outcome || state.timing.activePlayer !== c.attackingPlayerId || !attackSourceValid(state, c.attackingPlayerId, c.attackerId, context) || state.objects.cards[c.attackerId].readiness !== "SPENT")
        return failure("INVALID_COMBAT_OUTCOME", "Reviewed committed attacker required");
    if (state.timing.step !== c.stage || state.timing.window !== c.stage || r.stage !== "CHOICE" || !r.choice || r.current || r.pending.length || r.discovered.length || r.returnTo || r.playContinuation || r.callContinuation || r.searchContinuation || Object.values(state.objects.cards).some(x => x.zone.zone === "RESOLVING_PROGRAM"))
        return failure("INVALID_COMBAT_OUTCOME", "Exclusive stable outcome choice and matching timing required");
    if (!listAttackTargets(state, c.attackerId, c.attackingPlayerId, context).some(t => canonicalSerialize(t) === canonicalSerialize(c.target))) return failure("INVALID_COMBAT_TARGET", "Current locked target is no longer valid");
    if (c.stage === "GIG_STEAL_SELECTION") {
        const continuation = r.gigStealContinuation, power = effectivePower(state, c.attackerId, context);
        if (c.target.kind !== "GIG_AREA" || !continuation || r.defeatContinuation || power === null || state.timing.actingPlayer !== c.attackingPlayerId) return failure("INVALID_GIG_STEAL", "Gig target, attacker choice and exclusive continuation required");
        const all = listStealableGigs(state, c.target.playerId), selected = continuation.selected;
        if (new Set(selected).size !== selected.length || selected.some(id => !all.some(g => g.id === id)) || selected.length + continuation.remaining !== Math.min(all.length, getGigStealAllowance(power, context)) || continuation.remaining >= all.length - selected.length || canonicalSerialize(r.choice) !== canonicalSerialize(gigStealChoice(state)))
            return failure("INVALID_GIG_STEAL", "Exact remaining count, distinct still-rival selected Gigs and strategic current choices required");
    } else {
        const continuation = r.defeatContinuation;
        if (c.target.kind !== "CARD" || !continuation || r.gigStealContinuation) return failure("INVALID_DEFEAT_CONTINUATION", "Fight requires exclusive defeat ordering");
        for (const id of [c.attackerId, c.target.cardInstanceId]) {
            const support = defeatSupport(state, id, context);
            if (!support.ok) return support;
            if (effectivePower(state, id, context) === null) return failure("INVALID_FIGHT_POWER", "Numeric power required");
        }
        const raw = evaluateFight(state, context).defeats, expected = preventFightDefeats(state, raw, continuation.appliedPrevention);
        if (continuation.appliedPrevention && canonicalSerialize(raw) === canonicalSerialize(expected)) return failure("INVALID_APPLIED_PREVENTION", "Consumed proof is retained only for an actually prevented defeat during owner ordering");
        if (canonicalSerialize(continuation.defeats) !== canonicalSerialize(expected) || canonicalSerialize(continuation.orders.map(o => o.targetId)) !== canonicalSerialize(expected.map(d => d.targetId))) return failure("INVALID_DEFEAT_CONTINUATION", "Defeats and orders must match the current authoritative fight result");
        let unfinished = false;
        for (const order of continuation.orders) {
            const batch = defeatBatch(state, order.targetId);
            if ((unfinished && order.cardIds.length) || new Set(order.cardIds).size !== order.cardIds.length || order.cardIds.some(id => !batch.includes(id))) return failure("INVALID_DEFEAT_ORDER", "Sequential distinct owner order prefixes required");
            unfinished ||= order.cardIds.length < batch.length;
        }
        if (!unfinishedDefeatOrder(state) || defeatOrderChoice(state).options.length < 2 || canonicalSerialize(r.choice) !== canonicalSerialize(defeatOrderChoice(state)) || state.timing.actingPlayer !== r.choice.actorId)
            return failure("INVALID_DEFEAT_ORDER", "Exact strategic next owner-order choice required");
    }
    return success(null);
}
