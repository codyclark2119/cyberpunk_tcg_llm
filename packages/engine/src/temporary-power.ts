import { supportsAttackConditionPowerCard } from "./attack-condition-power-support";
import { triggerId } from "./trigger-queries";
import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { reactEnabled, supportsReactPlay } from "./react-support";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { supportsFieldLegend } from "./field-legend-support";
import { powerTargets } from "./react-queries";

export function compareTemporaryPower(a: TemporaryPowerModifier, b: TemporaryPowerModifier) {
    if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
    const occurrence = (x: TemporaryPowerModifier) => x.amount === 5 ? x.origin.effectId : "";
    return occurrence(a) < occurrence(b) ? -1 : occurrence(a) > occurrence(b) ? 1 : 0;
}
export function applyTemporaryPower(m: TurnMutation, targetId: CardInstanceId) {
    const current = m.state.resolution.current;
    if (current?.effect.kind !== "POWER_UNTIL_END_OF_TURN" || !current.sourceId) return failure("INVALID_POWER_TARGET", "Current power effect source required");
    const base = { kind: "POWER" as const, sourceId: current.sourceId, targetId, expires: { kind: "END_OF_TURN" as const, turn: m.state.timing.turn } };
    let modifier: TemporaryPowerModifier;
    if (current.effect.target.kind === "SOURCE_SUBJECT") {
        const t = current.trigger, c = m.state.resolution.triggerContinuation, subject = m.state.objects.cards[targetId];
        if (current.effect.amount !== 5 || !t || t.kind !== "WHEN_ATTACKING" || t.subjectId !== targetId || current.sourceId !== targetId || !c || c.origin.kind !== "ATTACK" || c.origin.subjectId !== targetId || !subject || subject.face !== "UP" || subject.zone.zone !== "BATTLEFIELD" || !supportsAttackConditionPowerCard(cardRevision(m.state, targetId, m.context), m.context).ok) return failure("INVALID_POWER_SOURCE", "Reviewed self ATTACK source, subject and occurrence required");
        modifier = { ...base, amount: 5, origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    } else {
        if (current.effect.amount !== -1 || !powerTargets(m.state, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Choose a currently eligible rival Unit");
        modifier = { ...base, amount: -1 };
    }
    if (m.state.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (m.state.temporaryModifiers ??= []).push(modifier);
    m.state.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
export function expireTemporaryPower(m: TurnMutation) {
    const modifiers = m.state.temporaryModifiers;
    if (!modifiers) return;
    for (const modifier of modifiers) m.emit({ kind: "POWER_MODIFIER_EXPIRED", sourceId: modifier.sourceId, targetId: modifier.targetId, reason: "TURN_END", ...(modifier.amount === 5 ? { effectId: modifier.origin.effectId } : {}) });
    delete m.state.temporaryModifiers;
}
/** 5.3.2.2: duration tracks the physical card until hidden entry, independent of combat. */
export function expirePowerOnHiddenEntry(m: TurnMutation, targetId: CardInstanceId) {
    if (!combatResolutionEnabled(m.context) || !m.state.temporaryModifiers) return;
    for (const x of m.state.temporaryModifiers.filter(x => x.targetId === targetId))
        m.emit({ kind: "POWER_MODIFIER_EXPIRED", sourceId: x.sourceId, targetId, reason: "HIDDEN_AREA", ...(x.amount === 5 ? { effectId: x.origin.effectId } : {}) });
    m.state.temporaryModifiers = m.state.temporaryModifiers.filter(x => x.targetId !== targetId);
    if (!m.state.temporaryModifiers.length) delete m.state.temporaryModifiers;
}
export function validateTemporaryPower(state: GameState, context: EngineContext) {
    const modifiers = state.temporaryModifiers;
    if (!modifiers) return success(null);
    if (!reactEnabled(context) || !modifiers.length || new Set(modifiers.map(x => canonicalSerialize([x.sourceId, x.amount === 5 ? x.origin.effectId : null]))).size !== modifiers.length || canonicalSerialize(modifiers) !== canonicalSerialize([...modifiers].sort(compareTemporaryPower))) return failure("INVALID_TEMPORARY_POWER", "Nonempty canonical reviewed modifiers with distinct source/occurrences required");
    for (const x of modifiers) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context);
        if (x.amount === 5) {
            const origin = x.origin, a = r?.mechanics.abilities.find(a => a.id === origin.abilityId), continuation = state.resolution.triggerContinuation;
            if (!source || !target || x.sourceId !== x.targetId || !supportsAttackConditionPowerCard(r, context).ok || !a || !r || source.face !== "UP" || !["BATTLEFIELD", "TRASH"].includes(source.zone.zone) || x.expires.turn !== state.timing.turn || origin.ordinal > (state.turnHistory?.triggeredBatches ?? 0) || origin.effectId !== triggerId(state, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: source.controllerId, abilityId: a.id, kind: "WHEN_ATTACKING" }, origin.ordinal) || continuation?.ordinal === origin.ordinal && !continuation.resolvedIds.includes(origin.effectId)) return failure("INVALID_TEMPORARY_POWER", "Self+5 needs a reviewed public Unit and resolved current-turn ATTACK occurrence");
            continue;
        }
        // Public removal does not expire a duration (5.3.2.2). A reviewed field Legend
        // loses its effective Unit type in Removed; the existing modifier still tracks
        // that physical card until turn end. This does not make it a new Unit target.
        const removedFieldLegend = target?.face === "UP" && target.zone.zone === "REMOVED" && supportsFieldLegend(cardRevision(state, x.targetId, context), context).ok;
        if (x.expires.turn !== state.timing.turn || !source || !supportsReactPlay(r, context).ok || r?.type !== "PROGRAM" || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone) || !target || !(combatResolutionEnabled(context) ? ["BATTLEFIELD", "TRASH", "REMOVED"] : ["BATTLEFIELD"]).includes(target.zone.zone) || !(effectiveCardTypes(state, x.targetId, context).includes("UNIT") || removedFieldLegend)) return failure("INVALID_TEMPORARY_POWER", "Modifier must reference a played reviewed Program, current public Unit under the reviewed zone lifecycle and current turn");
    }
    return success(null);
}
