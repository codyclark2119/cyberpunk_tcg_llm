import { DelayedEffectSchema, canonicalSerialize, hashCanonical, failure, success, type DelayedEffect, type GameState, type TriggerBinding, type TriggerOrigin } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { delayedEffectsEnabled, supportsDelayedAttackGear } from "./delayed-effect-support";
import { supportsFieldLegend } from "./field-legend-support";
import { cardRevision } from "./characteristics";
import { triggerId } from "./trigger-queries";
export function delayedEffectId(state: GameState, d: Omit<DelayedEffect, "id">) {
    const { controllerId, kind, sourceId, source, subjectId, subject, abilityId, createdTurn, originOrdinal, originEffectId } = d;
    const semantic = { ...(d.subjectTypesAtCreation ? { subjectTypesAtCreation: d.subjectTypesAtCreation } : {}), kind, sourceId, source, subjectId, subject, abilityId, createdTurn, originOrdinal, originEffectId };
    return hashCanonical({ protocol: "end-turn-delayed@1", ...semantic, controllerSeat: state.players[controllerId].seat });
}
export function delayedBinding(d: DelayedEffect): TriggerBinding {
    return { sourceId: d.sourceId, source: d.source, subjectId: d.subjectId, controllerId: d.controllerId, abilityId: d.abilityId, kind: "DELAYED_END_TURN", delayedId: d.id };
}
export function getDelayedEffectsForTurn(state: GameState) {
    return (state.delayedEffects ?? []).filter(d => d.createdTurn === state.timing.turn && d.controllerId === state.timing.activePlayer);
}
/** Called only after the first instruction completes (including zero/no-target). */
export function registerEndTurnEffect(m: TurnMutation) {
    const e = m.state.resolution.current!, c = m.state.resolution.triggerContinuation!;
    if (c.origin.kind !== "ATTACK" || e.effect.kind !== "REGISTER_END_TURN_EFFECT" || !e.trigger || !e.sourceId || !supportsDelayedAttackGear(cardRevision(m.state, e.sourceId, m.context), m.context).ok)
        return failure("INVALID_DELAYED_REGISTRATION", "Current complete inherited ATTACK must reach its registration instruction");
    const subject = m.state.objects.cards[e.trigger.subjectId];
    const fields = { ...(supportsFieldLegend(cardRevision(m.state, subject.id, m.context), m.context).ok ? { subjectTypesAtCreation: ["LEGEND", "UNIT"] as const } : {}), kind: "END_TURN_READY_EDDIES" as const, controllerId: e.controllerId, sourceId: e.sourceId, source: e.trigger.source, subjectId: subject.id, subject: { cardId: subject.cardId, revision: subject.revision }, abilityId: e.trigger.abilityId, createdTurn: m.state.timing.turn, originOrdinal: c.ordinal, originEffectId: e.id };
    const d = DelayedEffectSchema.parse({ ...fields, id: delayedEffectId(m.state, fields) });
    if (m.state.delayedEffects?.some(x => x.id === d.id)) return failure("DUPLICATE_DELAYED_EFFECT", "An originating paragraph registers once per actual occurrence");
    m.state.delayedEffects = [...(m.state.delayedEffects ?? []), d].sort((a, b) => a.id < b.id ? -1 : 1);
    m.emit({ kind: "DELAYED_EFFECT_CREATED", delayedEffect: d });
    return success(null);
}
/** Move future work into the pending batch; retain immutable origins for validation/reload. */
export function takeEndTurnOrigin(m: TurnMutation): TriggerOrigin {
    const delayedEffects = getDelayedEffectsForTurn(m.state);
    delete m.state.delayedEffects;
    return { kind: "END_TURN", playerId: m.state.timing.activePlayer, turn: m.state.timing.turn, ...(delayedEffects.length ? { delayedEffects } : {}) };
}
/** Last-valid effective types are captured at registration, not a cached condition result.
 * Only validated delayed field-Legend records may use this after public defeat/removal. */
export function delayedSubjectTypes(state: GameState) {
    const origin = state.resolution.triggerContinuation?.origin, id = state.resolution.current?.trigger?.delayedId;
    return origin?.kind === "END_TURN" ? origin.delayedEffects?.find(d => d.id === id)?.subjectTypesAtCreation : undefined;
}
export function validateDelayedState(state: GameState, context: EngineContext) {
    const origin = state.resolution.triggerContinuation?.origin;
    const captured = origin?.kind === "END_TURN" ? origin.delayedEffects : undefined;
    const records = state.delayedEffects ?? captured;
    if (state.delayedEffects && captured) return failure("INVALID_DELAYED_TRANSFER", "Future work cannot also remain registered once transferred to the end-turn batch");
    if (!records) return success(null);
    if (!delayedEffectsEnabled(context) || state.setup || state.match.outcome || !state.turnHistory || !records.length)
        return failure("UNSUPPORTED_DELAYED_STATE", "Reviewed active-turn delayed support required");
    const ids = records.map(d => d.id);
    if (new Set(ids).size !== ids.length || canonicalSerialize(ids) !== canonicalSerialize([...ids].sort())) return failure("INVALID_DELAYED_ORDER", "Unique deterministic delayed records must be canonically ordered");
    for (const d of records) {
        const source = state.objects.cards[d.sourceId], subject = state.objects.cards[d.subjectId], r = cardRevision(state, d.sourceId, context);
        const fieldLegend = supportsFieldLegend(cardRevision(state, d.subjectId, context), context).ok;
        if (fieldLegend !== Boolean(d.subjectTypesAtCreation)) return failure("INVALID_DELAYED_SUBJECT_TYPES", "Only reviewed field-Legend origins retain last-valid LEGEND + UNIT types");
        if (!source || !subject || d.controllerId !== state.timing.activePlayer || d.controllerId !== source.controllerId || d.controllerId !== subject.controllerId || d.createdTurn !== state.timing.turn || d.originOrdinal > state.turnHistory.triggeredBatches || captured && d.originOrdinal >= state.resolution.triggerContinuation!.ordinal || !supportsDelayedAttackGear(r, context).ok || r?.mechanics.abilities[0].id !== d.abilityId || canonicalSerialize(d.source) !== canonicalSerialize({ cardId: source.cardId, revision: source.revision }) || canonicalSerialize(d.subject) !== canonicalSerialize({ cardId: subject.cardId, revision: subject.revision }) || (cardRevision(state, subject.id, context)?.type !== "UNIT" && !fieldLegend))
            return failure("INVALID_DELAYED_SOURCE", "Exact immutable source/subject, creation controller, current turn and ATTACK occurrence required; control changes unsupported");
        if (source.face !== "UP" || subject.face !== "UP" || !["BATTLEFIELD", "TRASH"].includes(source.zone.zone) || !(fieldLegend ? ["BATTLEFIELD", "REMOVED"] : ["BATTLEFIELD", "TRASH"]).includes(subject.zone.zone))
            return failure("UNSUPPORTED_DELAYED_DEPARTURE", "Reviewed public field/Trash Gear lifetime and field/Removed Legend lifetime only; hidden-zone and control changes require separate review");
        const b: TriggerBinding = { sourceId: d.sourceId, source: d.source, subjectId: d.subjectId, controllerId: d.controllerId, abilityId: d.abilityId, kind: "WHEN_ATTACKING" };
        if (d.originEffectId !== triggerId(state, b, d.originOrdinal) || d.id !== delayedEffectId(state, d)) return failure("INVALID_DELAYED_ID", "Delayed identity derives from its semantic ATTACK occurrence, never transport counters");
    }
    if (captured) {
        const bindings = state.resolution.triggerContinuation!.bindings.filter(b => b.delayedId);
        if (canonicalSerialize(bindings.map(b => b.delayedId).sort()) !== canonicalSerialize(ids) || bindings.some(b => canonicalSerialize(b) !== canonicalSerialize(delayedBinding(captured.find(d => d.id === b.delayedId)!))))
            return failure("INVALID_DELAYED_BATCH", "Every captured future instruction must appear once in the end-turn batch");
    }
    return success(null);
}
