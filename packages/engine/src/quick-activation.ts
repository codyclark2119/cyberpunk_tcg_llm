import { canonicalSerialize, failure, success, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { revisionOf } from "./play-support";
import { activationPaymentAmount, supportsQuickActivationCard } from "./quick-activation-support";
import { paymentSources, paymentValue, forcedPaymentSources } from "./payment";
import { powerTargets } from "./react-queries";
import { activationEffectId, playChoice } from "./play-state";

/** Batch V49: a paid Quick activation pauses only to choose Eddie payment, then to choose among 2 or more rival Units. */
export function validateActivationState(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, r = state.resolution, source = state.objects.cards[c.sourceId], revision = revisionOf(state, c.sourceId, context);
    const ability = revision?.mechanics.abilities.find(a => a.id === c.abilityId), amount = activationPaymentAmount(ability), combat = state.timing.combat;
    const window = combat.stage === "NONE" ? c.actorId === state.timing.activePlayer && r.returnTo?.kind === "MAIN" : combat.stage === "RIVAL_REACT" && c.actorId !== combat.attackingPlayerId && r.returnTo?.kind === "RIVAL_REACT";
    if (!supportsQuickActivationCard(revision, context).ok || !source || !ability || ability.activation?.timing !== "QUICK" || !amount || !window || c.actorId !== state.timing.actingPlayer || source.controllerId !== c.actorId || source.zone.playerId !== c.actorId
        || source.zone.zone !== "BATTLEFIELD" || source.face !== "UP" || source.readiness !== "SPENT" || state.setup || state.match.outcome || r.stage !== "CHOICE" || r.searchContinuation || r.callContinuation || r.triggerContinuation || r.legendEntryContinuation
        || r.targetedDefeatContinuation || r.defeatContinuation || r.gigStealContinuation || r.discovered.length || c.targetGigId || c.chosenEffect !== undefined || c.trashedIds || c.bottomDecked || c.effectIndex !== 0
        || Object.values(state.objects.cards).some(x => x.zone.zone === "RESOLVING_PROGRAM"))
        return failure("INVALID_ACTIVATION_CONTINUATION", "A paused activation needs its reviewed spent field source, its window and no other work");
    if (new Set(c.selectedSources.map(p => p.cardInstanceId)).size !== c.selectedSources.length || c.selectedSources.reduce((n, p) => n + paymentValue(state, context, p), 0) + c.remainingCost !== amount)
        return failure("INVALID_PLAY_PAYMENT", "Exact activation cost and unique selected sources required");
    if (c.phase === "PAYMENT") {
        const available = paymentSources(state, c.actorId, context).map(canonicalSerialize);
        if (state.timing.step !== "PAYMENT_SELECTION" || c.remainingCost <= 0 || r.current || r.pending.length || forcedPaymentSources(state, c.actorId, context, c.remainingCost, c.selectedSources) || c.selectedSources.some(p => !available.includes(canonicalSerialize(p))))
            return failure("INVALID_PLAY_PAYMENT", "Activation payment must keep eligible unspent selections");
    } else if (c.phase === "EFFECT") {
        const current = r.current;
        if (c.remainingCost !== 0 || !current || current.id !== activationEffectId(state, c.actorId, c.sourceId, ability.id, 0) || current.sourceId !== c.sourceId || current.controllerId !== c.actorId || current.trigger || current.primitiveIndex !== undefined
            || canonicalSerialize(current.effect) !== canonicalSerialize(ability.effects[0]) || r.pending.length !== ability.effects.length - 1 || current.effect.kind !== "POWER_UNTIL_END_OF_TURN"
            || state.timing.step !== "TARGET_SELECTION" || powerTargets(state, c.actorId, context).length < 2)
            return failure("INVALID_ACTIVATION_EFFECT", "Only a strategic rival-Unit choice pauses the activation's power effect");
        for (const p of c.selectedSources) {
            const paid = state.objects.cards[p.cardInstanceId];
            if (!paid || paid.controllerId !== c.actorId || paid.zone.playerId !== c.actorId || paid.readiness !== "SPENT") return failure("INVALID_PLAY_PAYMENT", "Paid sources must remain spent");
        }
    } else return failure("INVALID_ACTIVATION_CONTINUATION", "An activation pauses only for payment or its effect");
    if (canonicalSerialize(playChoice(state, context)) !== canonicalSerialize(r.choice)) return failure("INVALID_PLAY_CHOICE", "Choice must exactly match current engine payment sources or targets");
    return success(null);
}
