import { reducedAllowance } from "./steal-reduction";
import { nextPreventableGig, stealPreventionChoice } from "./steal-prevention";
import { validateLegendReplacement } from "./legend-defeat-replacement";
import { validFightOutcomes } from "./fight-outcome";
import { validFightFact } from "./trigger-state";
import { triggersEnabled } from "./trigger-support";
import { appliedFightPreventions, preventFightDefeats } from "./fight-prevention";
import { canonicalSerialize, failure, success, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled, getGigStealAllowance } from "./combat-resolution-policy";
import { effectivePower } from "./characteristics";
import { attackSourceValid, listAttackTargets } from "./combat-queries";
import { defeatBatch, defeatSupport } from "./defeat";
import { defeatOrderChoice, defeatsFromFightResult, evaluateFight, gigStealChoice, stealableGigsFor, unfinishedDefeatOrder } from "./combat-outcome-queries";

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
        if (c.target.kind !== "GIG_AREA" || !continuation || r.defeatContinuation || power === null || state.timing.actingPlayer !== (continuation.prevention ? c.target.playerId : c.attackingPlayerId)) return failure("INVALID_GIG_STEAL", "Gig target, attacker choice and exclusive continuation required");
        const all = stealableGigsFor(state, context, c.target.playerId, c.attackerId), selected = continuation.selected;
        // Batch V99: every Gig is selected; the answered Gigs are a prefix of the preventable ones, and the defending player answers the next.
        if (continuation.prevention) {
            const p = continuation.prevention, next = nextPreventableGig(state, c.attackerId, selected, p.answered, context);
            if (continuation.remaining !== 0 || new Set(selected).size !== selected.length || selected.some(id => !all.some(g => g.id === id)) || selected.length !== Math.min(all.length, reducedAllowance(state, c.attackerId, getGigStealAllowance(power, context)))
                || new Set(p.answered).size !== p.answered.length || p.answered.some(id => !selected.includes(id)) || p.prevented.some(id => !p.answered.includes(id)) || new Set(p.prevented).size !== p.prevented.length
                || !next || p.answered.some(id => id > next) || canonicalSerialize(r.choice) !== canonicalSerialize(stealPreventionChoice(state, next, c.attackerId, context)))
                return failure("INVALID_STEAL_PREVENTION", "A complete selection, answered Gigs in order and the exact offer for the next preventable Gig required");
            return success(null);
        }
        if (continuation.remaining <= 0) return failure("INVALID_GIG_STEAL", "A selection pause has Gigs left to choose");
        if (new Set(selected).size !== selected.length || selected.some(id => !all.some(g => g.id === id)) || selected.length + continuation.remaining !== Math.min(all.length, reducedAllowance(state, c.attackerId, getGigStealAllowance(power, context))) || continuation.remaining >= all.length - selected.length || canonicalSerialize(r.choice) !== canonicalSerialize(gigStealChoice(state, context)))
            return failure("INVALID_GIG_STEAL", "Exact remaining count, distinct still-rival selected Gigs and strategic current choices required");
    } else {
        const continuation = r.defeatContinuation;
        if (c.target.kind !== "CARD" || !continuation || r.gigStealContinuation) return failure("INVALID_DEFEAT_CONTINUATION", "Fight requires exclusive defeat ordering");
        for (const id of [c.attackerId, c.target.cardInstanceId]) {
            const support = defeatSupport(state, id, context);
            if (!support.ok) return support;
            if (effectivePower(state, id, context) === null) return failure("INVALID_FIGHT_POWER", "Numeric power required");
        }
        if (continuation.fightResult && (!triggersEnabled(context) || !validFightFact(state, continuation.fightResult))) return failure("INVALID_FIGHT_FACT", "Historical fight result must be coherent and in the reviewed scope");
        // Batch V46: next-fight-outcome effects this fight fired wait here for the owner order, then join the post-fight batch.
        if (continuation.fightOutcomes && (!continuation.fightResult || !validFightOutcomes(state, continuation.fightResult, continuation.fightOutcomes, context))) return failure("INVALID_FIGHT_OUTCOME", "Fired effects need their historical fight and must be exactly what it fired");
        const raw = continuation.fightResult ? defeatsFromFightResult(state, context, continuation.fightResult) : evaluateFight(state, context).defeats, expected = preventFightDefeats(state, raw, appliedFightPreventions(state));
        if (appliedFightPreventions(state).length && canonicalSerialize(raw) === canonicalSerialize(expected)) return failure("INVALID_APPLIED_PREVENTION", "Consumed proof is retained only for an actually prevented defeat during owner ordering");
        if (canonicalSerialize(continuation.defeats) !== canonicalSerialize(expected) || canonicalSerialize(continuation.orders.map(o => o.targetId)) !== canonicalSerialize(expected.map(d => d.targetId))) return failure("INVALID_DEFEAT_CONTINUATION", "Defeats and orders must match the current authoritative fight result");
        // Batch V100: a Legend replacement offer comes before any owner order.
        const replacement = validateLegendReplacement(state, context);
        if (!replacement.ok) return replacement;
        if (replacement.value === "OFFER") return continuation.orders.some(o => o.cardIds.length) ? failure("INVALID_DEFEAT_REPLACEMENT", "Offers precede owner orders") : success(null);
        let unfinished = false;
        for (const order of continuation.orders) {
            const batch = defeatBatch(state, order.targetId, context);
            if ((unfinished && order.cardIds.length) || new Set(order.cardIds).size !== order.cardIds.length || order.cardIds.some(id => !batch.includes(id))) return failure("INVALID_DEFEAT_ORDER", "Sequential distinct owner order prefixes required");
            unfinished ||= order.cardIds.length < batch.length;
        }
        if (!unfinishedDefeatOrder(state, context) || defeatOrderChoice(state, context).options.length < 2 || canonicalSerialize(r.choice) !== canonicalSerialize(defeatOrderChoice(state, context)) || state.timing.actingPlayer !== r.choice.actorId)
            return failure("INVALID_DEFEAT_ORDER", "Exact strategic next owner-order choice required");
    }
    return success(null);
}
