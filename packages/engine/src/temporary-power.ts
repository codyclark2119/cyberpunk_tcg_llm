import { canonicalSerialize, failure, success, type CardInstanceId, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { reactEnabled, supportsReactPlay } from "./react-support";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { supportsFieldLegend } from "./field-legend-support";
import { powerTargets } from "./react-queries";

export function applyTemporaryPower(m: TurnMutation, targetId: CardInstanceId) {
    const current = m.state.resolution.current;
    if (current?.effect.kind !== "POWER_UNTIL_END_OF_TURN" || !current.sourceId || !powerTargets(m.state, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Choose a currently eligible rival Unit");
    const modifier = { kind: "POWER" as const, sourceId: current.sourceId, targetId, amount: current.effect.amount, expires: { kind: "END_OF_TURN" as const, turn: m.state.timing.turn } };
    (m.state.temporaryModifiers ??= []).push(modifier);
    m.state.temporaryModifiers.sort((a, b) => a.sourceId < b.sourceId ? -1 : 1);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
export function expireTemporaryPower(m: TurnMutation) {
    const modifiers = m.state.temporaryModifiers;
    if (!modifiers) return;
    for (const modifier of modifiers) m.emit({ kind: "POWER_MODIFIER_EXPIRED", sourceId: modifier.sourceId, targetId: modifier.targetId, reason: "TURN_END" });
    delete m.state.temporaryModifiers;
}
/** 5.3.2.2: duration tracks the physical card until hidden entry, independent of combat. */
export function expirePowerOnHiddenEntry(m: TurnMutation, targetId: CardInstanceId) {
    if (!combatResolutionEnabled(m.context) || !m.state.temporaryModifiers) return;
    for (const x of m.state.temporaryModifiers.filter(x => x.targetId === targetId))
        m.emit({ kind: "POWER_MODIFIER_EXPIRED", sourceId: x.sourceId, targetId, reason: "HIDDEN_AREA" });
    m.state.temporaryModifiers = m.state.temporaryModifiers.filter(x => x.targetId !== targetId);
    if (!m.state.temporaryModifiers.length) delete m.state.temporaryModifiers;
}
export function validateTemporaryPower(state: GameState, context: EngineContext) {
    const modifiers = state.temporaryModifiers;
    if (!modifiers) return success(null);
    if (!reactEnabled(context) || !modifiers.length || new Set(modifiers.map(x => x.sourceId)).size !== modifiers.length || canonicalSerialize(modifiers) !== canonicalSerialize([...modifiers].sort((a, b) => a.sourceId < b.sourceId ? -1 : 1))) return failure("INVALID_TEMPORARY_POWER", "Nonempty canonical reviewed modifiers with distinct physical sources required");
    for (const x of modifiers) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context);
        // Public removal does not expire a duration (5.3.2.2). A reviewed field Legend
        // loses its effective Unit type in Removed; the existing modifier still tracks
        // that physical card until turn end. This does not make it a new Unit target.
        const removedFieldLegend = target?.face === "UP" && target.zone.zone === "REMOVED" && supportsFieldLegend(cardRevision(state, x.targetId, context), context).ok;
        if (x.expires.turn !== state.timing.turn || !source || !supportsReactPlay(r, context).ok || r?.type !== "PROGRAM" || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone) || !target || !(combatResolutionEnabled(context) ? ["BATTLEFIELD", "TRASH", "REMOVED"] : ["BATTLEFIELD"]).includes(target.zone.zone) || !(effectiveCardTypes(state, x.targetId, context).includes("UNIT") || removedFieldLegend)) return failure("INVALID_TEMPORARY_POWER", "Modifier must reference a played reviewed Program, current public Unit under the reviewed zone lifecycle and current turn");
    }
    return success(null);
}
