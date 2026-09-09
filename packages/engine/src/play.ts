import { recordPlayedCard } from "./trigger-resolution";
import { triggersEnabled } from "./trigger-support";
import { actionReturnContext, finishAction } from "./action-return";
import { applyTemporaryPower } from "./temporary-power";
import { attachPlayedGear, moveCardLocation } from "./card-movement";
import { EffectSchema, failure, success, type CardInstanceId, type PlayerId, type PaymentSource, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { revisionOf } from "./play-support";
import { playChoice, playEffectId, adjustmentTargets } from "./play-state";
import { forcedPaymentSources, paymentValue, validatePayment } from "./payment";
import { HandlerRegistry } from "./effects";
import { changeGigValue, gigAdjustmentDelta } from "./gig-value";
import { testCondition } from "./conditions";

export function offerPlayChoice(m: TurnMutation) {
    const choice = playChoice(m.state, m.context);
    m.state.resolution.choice = choice;
    const effect = m.state.resolution.current?.effect;
    // Only new directional effects adopt forced target/zero-magnitude resolution; preserve old replay protocols.
    if (effect?.kind === "ADJUST_GIG_UP_TO" && effect.direction === "INCREASE" && choice.options.length === 1) return continuePlay(m, 0);
    m.state.resolution.stage = "CHOICE";
    const step = choice.kind === "PAYMENT" ? "PAYMENT_SELECTION" : choice.kind === "TARGET" ? "TARGET_SELECTION" : "AMOUNT_SELECTION";
    m.state.timing.step = step;
    m.state.timing.window = step;
    m.emit({ kind: "PHASE_CHANGED", step });
    return success(null);
}
function finishPlay(m: TurnMutation, sourceId: CardInstanceId) {
    if (m.state.objects.cards[sourceId].zone.zone === "RESOLVING_PROGRAM") moveCardLocation(m, sourceId, "TRASH");
    if (!m.state.match.outcome && triggersEnabled(m.context) && m.state.resolution.playContinuation?.kind === "PLAY" && ["UNIT", "GEAR"].includes(revisionOf(m.state, sourceId, m.context)!.type)) return recordPlayedCard(m, sourceId);
    if (!m.state.match.outcome) return finishAction(m);
    return success(null);
}
/** Resolves an ordered finite list. Choices pause the current primitive, never create model positions mid-chain. */
function resolveChain(m: TurnMutation): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, sourceId = c.sourceId;
    const registry = new HandlerRegistry();
    while (s.resolution.current) {
        const current = s.resolution.current;
        s.resolution.stage = "RESOLVE_EFFECT";
        const result = registry.resolve(m, current.effect);
        if (!result.ok) return result;
        // A forced target/amount may have resumed and finished the chain synchronously.
        if (current.effect.kind === "ADJUST_GIG_UP_TO" && current.effect.direction === "INCREASE" && s.resolution.current !== current) return success(null);
        if (s.resolution.choice) return success(null);
        m.emit({ kind: "EFFECT_RESOLVED", effectId: current.id });
        if (s.match.outcome) return finishPlay(m, sourceId);
        c.effectIndex++;
        s.resolution.current = s.resolution.pending.shift() ?? null;
    }
    return finishPlay(m, sourceId);
}
function beginEffects(m: TurnMutation): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, r = revisionOf(s, c.sourceId, m.context)!, a = r.mechanics.abilities[0];
    c.phase = "EFFECT";
    s.resolution.choice = null;
    if (c.kind === "PLAY" && r.type === "UNIT") return finishPlay(m, c.sourceId); // Spend is not an ON_PLAY trigger.
    m.phase("CARD_EFFECT");
    const causedBySequence = s.match.eventSequence;
    s.resolution.stage = "DISCOVER_TRIGGERS";
    s.resolution.pending = a.effects.map((effect, index) => ({ id: playEffectId(s, index), sourceId: c.sourceId, controllerId: c.actorId, causedBySequence, effect: EffectSchema.parse(effect) }));
    for (const effect of s.resolution.pending) m.emit({ kind: "EFFECT_PENDING", effectId: effect.id, sourceId: c.sourceId });
    s.resolution.current = s.resolution.pending.shift() ?? null;
    return resolveChain(m);
}
function completePayment(m: TurnMutation, sources: PaymentSource[]): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, r = revisionOf(s, c.sourceId, m.context)!;
    const payment = validatePayment(s, c.actorId, m.context, sources, r.printedCost);
    return payment.ok ? payValidated(m, payment.value) : payment;
}

export function startPlay(m: TurnMutation, actorId: PlayerId, sourceId: CardInstanceId): Result<null> {
    const s = m.state, r = revisionOf(s, sourceId, m.context)!;
    if (r.printedCost.kind !== "EDDIES") return failure("UNSUPPORTED_CARD_PLAY", "Reviewed printed payment required");
    s.resolution.returnTo = actionReturnContext(s);
    s.objects.cards[sourceId].face = "UP";
    m.emit({ kind: "CARD_REVEALED", cardInstanceId: sourceId });
    s.resolution.playContinuation = { kind: "PLAY", actorId, sourceId, ...(r.type !== "GEAR" && r.mechanics.abilities[0] ? { abilityId: r.mechanics.abilities[0].id } : {}), phase: "PAYMENT", remainingCost: r.printedCost.amount, selectedSources: [], effectIndex: 0 };
    const forced = forcedPaymentSources(s, actorId, m.context, r.printedCost.amount, []);
    if (forced) return completePayment(m, forced);
    return offerPlayChoice(m);
}
// Used after validation of a forced payment or completion of an enumerated payment continuation.
function payValidated(m: TurnMutation, sources: PaymentSource[]): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, r = revisionOf(s, c.sourceId, m.context)!;
    c.selectedSources = sources; c.remainingCost = 0;
    for (const p of sources) s.objects.cards[p.cardInstanceId].readiness = "SPENT";
    m.emit({ kind: "PAYMENT_MADE", sources });
    if (r.type === "GEAR") {
        c.phase = "EQUIP";
        s.objects.cards[c.sourceId].readiness = "READY";
        return offerPlayChoice(m);
    }
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: c.sourceId });
    moveCardLocation(m, c.sourceId, r.type === "PROGRAM" ? "RESOLVING_PROGRAM" : "BATTLEFIELD");
    if (r.type === "UNIT") { s.objects.cards[c.sourceId].readiness = "READY"; s.objects.cards[c.sourceId].statuses.push("LAG"); }
    return beginEffects(m);
}
export function continuePlay(m: TurnMutation, index: number): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, option = s.resolution.choice!.options[index];
    if (c.phase === "PAYMENT") {
        if (option.kind !== "PAYMENT") return failure("INVALID_PAYMENT", "Expected payment source");
        const sources = [...c.selectedSources, option.source], remaining = c.remainingCost - paymentValue(s, m.context, option.source);
        const forced = forcedPaymentSources(s, c.actorId, m.context, remaining, sources);
        if (forced) return completePayment(m, [...sources, ...forced]);
        c.selectedSources = sources; c.remainingCost = remaining;
        return offerPlayChoice(m);
    }
    if (c.phase === "EQUIP") {
        if (option.kind !== "CARD") return failure("INVALID_EQUIP_TARGET", "Choose an enumerated host");
        const equipped = attachPlayedGear(m, c.sourceId, option.cardInstanceId);
        if (!equipped.ok) return equipped;
        // 11.20.2: play requirements are fulfilled only after equipping, not merely after payment.
        m.emit({ kind: "CARD_PLAYED", cardInstanceId: c.sourceId });
        return finishPlay(m, c.sourceId);
    }
    if (s.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN") {
        if (option.kind !== "CARD") return failure("INVALID_POWER_TARGET", "Choose an enumerated rival Unit");
        const applied = applyTemporaryPower(m, option.cardInstanceId);
        if (!applied.ok) return applied;
        m.emit({ kind: "EFFECT_RESOLVED", effectId: s.resolution.current.id });
        c.effectIndex++; s.resolution.choice = null;
        s.resolution.current = s.resolution.pending.shift() ?? null;
        return resolveChain(m);
    }
    if (!c.targetGigId) {
        if (option.kind !== "GIG" || !adjustmentTargets(s).includes(option.gigInstanceId)) return failure("INVALID_GIG_TARGET", "Target is no longer eligible");
        c.targetGigId = option.gigInstanceId;
        m.emit({ kind: "GIG_TARGET_SELECTED", effectId: s.resolution.current!.id, gigInstanceId: c.targetGigId });
        return offerPlayChoice(m);
    }
    const effect = s.resolution.current?.effect, delta = effect?.kind === "ADJUST_GIG_UP_TO" ? gigAdjustmentDelta(effect, option) : null;
    if (delta === null) return failure("INVALID_GIG_AMOUNT", "Choose an enumerated adjustment");
    if (delta === 0) m.emit({ kind: "GIG_ADJUSTMENT_DECLINED", gigInstanceId: c.targetGigId });
    else {
        const changed = changeGigValue(s, c.targetGigId, delta, m.context);
        if (!changed.ok) return changed;
        m.emit(changed.value);
    }
    m.emit({ kind: "EFFECT_RESOLVED", effectId: s.resolution.current!.id });
    delete c.targetGigId; c.effectIndex++;
    s.resolution.choice = null;
    s.resolution.current = s.resolution.pending.shift() ?? null;
    return resolveChain(m);
}
export function activateAbility(m: TurnMutation, actorId: PlayerId, sourceId: CardInstanceId, abilityId: string): Result<null> {
    const s = m.state, ability = revisionOf(s, sourceId, m.context)!.mechanics.abilities.find(a => a.id === abilityId)!;
    s.objects.cards[sourceId].readiness = "SPENT";
    m.emit({ kind: "CARD_SPENT", cardInstanceId: sourceId });
    m.emit({ kind: "ABILITY_ACTIVATED", sourceInstanceId: sourceId, abilityId });
    s.resolution.returnTo = { kind: "MAIN" };
    s.resolution.playContinuation = { kind: "ACTIVATE", sourceId, actorId, abilityId, phase: "EFFECT", remainingCost: 0, selectedSources: [], effectIndex: 0 };
    // 11.15.3.1: distinct activation and resolution checks, even though no reaction window intervenes here.
    if (!ability.conditions.every(condition => testCondition(s, actorId, condition))) return finishPlay(m, sourceId);
    return beginEffects(m);
}
