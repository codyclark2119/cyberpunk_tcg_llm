import { canonicalSerialize, failure, success, type CardInstanceId, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { reactEnabled, supportsReactPlay } from "./react-support";
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
export function validateTemporaryPower(state: GameState, context: EngineContext) {
    const modifiers = state.temporaryModifiers;
    if (!modifiers) return success(null);
    if (!reactEnabled(context) || !modifiers.length || new Set(modifiers.map(x => x.sourceId)).size !== modifiers.length || canonicalSerialize(modifiers) !== canonicalSerialize([...modifiers].sort((a, b) => a.sourceId < b.sourceId ? -1 : 1))) return failure("INVALID_TEMPORARY_POWER", "Nonempty canonical reviewed modifiers with distinct physical sources required");
    for (const x of modifiers) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context);
        if (x.expires.turn !== state.timing.turn || !source || !supportsReactPlay(r, context).ok || r?.type !== "PROGRAM" || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone) || !target || target.zone.zone !== "BATTLEFIELD" || !effectiveCardTypes(state, x.targetId, context).includes("UNIT")) return failure("INVALID_TEMPORARY_POWER", "Modifier must reference a played reviewed Program, current field Unit and current turn");
    }
    return success(null);
}
