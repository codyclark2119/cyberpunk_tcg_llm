import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { revisionOf } from "./play-support";
import { activationPaymentAmount, supportsQuickActivationCard } from "./quick-activation-support";
import { attachmentHost } from "./attachments";
import { moveCardLocation } from "./card-movement";
import { forcedPaymentSources, paymentSources, paymentValue } from "./payment";
import { activationEffectId, playChoice } from "./play-state";

/** Batch V98: an equipped Gear's inherited {Quick} ability (11.23.3: "as if printed on" its host). The activation names the Gear (its
 * revision holds the ability), and its {Spend} spends the host. */
export function inheritedActivationHost(state: GameState, sourceId: CardInstanceId, abilityId: string, context: EngineContext) {
    const r = revisionOf(state, sourceId, context), a = r?.mechanics.abilities.find(x => x.id === abilityId);
    return r?.type === "GEAR" && a?.inherited === "EQUIPPED_HOST" && supportsQuickActivationCard(r, context).ok ? attachmentHost(state, sourceId) : null;
}
/** "Discard 1": every card in the controller's hand, in id order. */
export function discardCostTargets(state: GameState, actor: PlayerId) {
    return [...state.players[actor].zones.HAND].sort();
}
export function discardForDefeatCost(m: TurnMutation, cardInstanceId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current, c = s.resolution.playContinuation;
    if (current?.effect.kind !== "DISCARD_ONE_FOR_DEFEAT_COST" || !current.sourceId || c?.kind !== "ACTIVATE" || c.discardedCostId || !discardCostTargets(s, current.controllerId).includes(cardInstanceId))
        return failure("INVALID_DISCARD", "Choose a card in your own hand");
    s.resolution.choice = null;
    moveCardLocation(m, cardInstanceId, "TRASH");
    m.emit({ kind: "CARD_DISCARDED", cardInstanceId, playerId: current.controllerId, sourceId: current.sourceId, effectId: current.id, forced });
    c.discardedCostId = cardInstanceId;
    return success(null);
}
/** A lone hand card is discarded at once; an empty hand discards nothing (and so leaves the defeat without a bound). */
export function resolveDiscardForDefeatCost(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const targets = discardCostTargets(m.state, m.state.resolution.current!.controllerId);
    return targets.length > 1 ? offer(m) : targets.length === 1 ? discardForDefeatCost(m, targets[0], true) : success(null);
}
const KEYS = ["kind", "actorId", "sourceId", "abilityId", "phase", "remainingCost", "selectedSources", "effectIndex", "discardedCostId"];
/** A paused inherited Gear activation: its Eddie payment, its discard among 2+ hand cards, or (with the discard held) its defeat,
 * whose target and owner-order pauses the targeted-defeat validator checks. Main Phase or the controller's React Step only. */
export function validateGearActivationState(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, r = state.resolution, combat = state.timing.combat, source = state.objects.cards[c.sourceId], revision = revisionOf(state, c.sourceId, context);
    const ability = revision?.mechanics.abilities.find(a => a.id === c.abilityId), host = c.abilityId ? inheritedActivationHost(state, c.sourceId, c.abilityId, context) : null, amount = activationPaymentAmount(ability, state, c.actorId);
    const window = combat.stage === "NONE" ? c.actorId === state.timing.activePlayer && r.returnTo?.kind === "MAIN" : combat.stage === "RIVAL_REACT" && c.actorId !== combat.attackingPlayerId && r.returnTo?.kind === "RIVAL_REACT";
    const defeat = r.current?.effect.kind === "DEFEAT_UNIT", ordering = defeat && r.targetedDefeatContinuation?.phase === "ORDER";
    if (!source || !ability || !host || ability.activation?.timing !== "QUICK" || !amount || !window || (ordering ? false : c.actorId !== state.timing.actingPlayer) || Object.keys(c).some(k => !KEYS.includes(k))
        || source.controllerId !== c.actorId || source.zone.playerId !== c.actorId || source.face !== "UP" || host.controllerId !== c.actorId || host.zone.playerId !== c.actorId || host.face !== "UP" || host.readiness !== "SPENT"
        || state.setup || state.match.outcome || r.stage !== "CHOICE" || r.searchContinuation || r.callContinuation || r.triggerContinuation || r.legendEntryContinuation || r.gigStealContinuation || r.discovered.length
        || !defeat && (r.targetedDefeatContinuation || r.defeatContinuation) || Object.values(state.objects.cards).some(x => x.zone.zone === "RESOLVING_PROGRAM"))
        return failure("INVALID_ACTIVATION_CONTINUATION", "A paused inherited Gear activation needs its equipped Gear, its spent host, its window and no other work");
    if (new Set(c.selectedSources.map(p => p.cardInstanceId)).size !== c.selectedSources.length || c.selectedSources.reduce((n, p) => n + paymentValue(state, context, p), 0) + c.remainingCost !== amount)
        return failure("INVALID_PLAY_PAYMENT", "Exact activation cost and unique selected sources required");
    if (c.phase === "PAYMENT") {
        const available = paymentSources(state, c.actorId, context).map(canonicalSerialize);
        if (state.timing.step !== "PAYMENT_SELECTION" || c.remainingCost <= 0 || c.effectIndex !== 0 || c.discardedCostId || r.current || r.pending.length || forcedPaymentSources(state, c.actorId, context, c.remainingCost, c.selectedSources) || c.selectedSources.some(p => !available.includes(canonicalSerialize(p))))
            return failure("INVALID_PLAY_PAYMENT", "Activation payment must keep eligible unspent selections");
        if (canonicalSerialize(playChoice(state, context)) !== canonicalSerialize(r.choice)) return failure("INVALID_PLAY_CHOICE", "Choice must exactly match current engine payment sources");
        return success(null);
    }
    const index = c.effectIndex, current = r.current, discarded = c.discardedCostId ? state.objects.cards[c.discardedCostId] : undefined;
    if (c.phase !== "EFFECT" || c.remainingCost !== 0 || !current || current.id !== activationEffectId(state, c.actorId, c.sourceId, ability.id, index) || current.sourceId !== c.sourceId || current.controllerId !== c.actorId || current.trigger || current.primitiveIndex !== undefined
        || canonicalSerialize(current.effect) !== canonicalSerialize(ability.effects[index]) || canonicalSerialize(r.pending.map(e => [e.id, e.effect])) !== canonicalSerialize(ability.effects.slice(index + 1).map((e, i) => [activationEffectId(state, c.actorId, c.sourceId, ability.id, index + 1 + i), e])))
        return failure("INVALID_ACTIVATION_EFFECT", "A paused inherited activation must be at its current printed effect");
    for (const p of c.selectedSources) {
        const paid = state.objects.cards[p.cardInstanceId];
        if (!paid || paid.controllerId !== c.actorId || paid.zone.playerId !== c.actorId || paid.readiness !== "SPENT") return failure("INVALID_PLAY_PAYMENT", "Paid sources must remain spent");
    }
    if (current.effect.kind === "DISCARD_ONE_FOR_DEFEAT_COST") {
        if (c.discardedCostId || state.timing.step !== "TARGET_SELECTION" || discardCostTargets(state, c.actorId).length < 2 || canonicalSerialize(playChoice(state, context)) !== canonicalSerialize(r.choice))
            return failure("INVALID_DISCARD", "The discard pauses only for a choice among 2 or more hand cards");
    } else if (!defeat || !r.targetedDefeatContinuation || !discarded || discarded.ownerId !== c.actorId || discarded.zone.zone !== "TRASH" || discarded.zone.playerId !== c.actorId || discarded.face !== "UP")
        return failure("INVALID_ACTIVATION_EFFECT", "The defeat pauses only with the discarded card in its owner's trash");
    return success(null);
}
