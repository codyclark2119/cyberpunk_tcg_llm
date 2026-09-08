import { canonicalSerialize, failure, hashCanonical, success, type DefeatInstruction, type FightPrevention, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { createsFightPrevention, restrictionsEnabled, supportsRestrictedPlay } from "./restriction-support";

export function preventionId(state: GameState, sourceId: FightPrevention["sourceId"], controller: PlayerId, turn: number) {
    return hashCanonical({ protocol: "next-rival-fight-prevention@1", sourceId, controllerSeat: state.players[controller].seat, turn });
}
export function validatePrevention(effect: FightPrevention, state: GameState, context: EngineContext) {
    const source = state.objects.cards[effect.sourceId], r = cardRevision(state, effect.sourceId, context);
    if (!restrictionsEnabled(context) || !source || !state.players[effect.controllerId] || !supportsRestrictedPlay(r, context).ok || !createsFightPrevention(r) || effect.createdTurn !== state.timing.turn || effect.expires.turn !== effect.createdTurn || effect.id !== preventionId(state, effect.sourceId, effect.controllerId, effect.createdTurn))
        return failure("INVALID_FIGHT_PREVENTION", "Reviewed source, controller, deterministic identity and current turn duration required");
    // An activated Program's independent effect is not cancelled by later source movement (10.21).
    return success(null);
}
export function validateFightPreventions(state: GameState, context: EngineContext) {
    const active = state.fightPreventions, applied = state.resolution.defeatContinuation?.appliedPrevention;
    if (active && active.length !== 1) return failure("UNSUPPORTED_MULTIPLE_FIGHT_PREVENTIONS", "Only one outstanding next-fight prevention is reviewed; empty arrays and ambiguous overlap are not canonical");
    for (const effect of [...(active ?? []), ...(applied ? [applied] : [])]) {
        const valid = validatePrevention(effect, state, context);
        if (!valid.ok) return valid;
    }
    if (applied && (active || state.timing.combat.stage !== "DEFEAT_ORDER_SELECTION")) return failure("INVALID_APPLIED_PREVENTION", "Consumed proof belongs only to the current unfinished defeat order, never the active effects");
    if (active && state.resolution.playContinuation && createsFightPrevention(cardRevision(state, state.resolution.playContinuation.sourceId, context))) return failure("UNSUPPORTED_MULTIPLE_FIGHT_PREVENTIONS", "Another prevention cannot be played while one remains outstanding in this bounded policy");
    return success(null);
}
export function createFightPrevention(m: TurnMutation) {
    const current = m.state.resolution.current;
    if (!restrictionsEnabled(m.context) || !current?.sourceId || current.effect.kind !== "CREATE_NEXT_RIVAL_FIGHT_PREVENTION" || m.state.objects.cards[current.sourceId]?.zone.zone !== "RESOLVING_PROGRAM") return failure("INVALID_FIGHT_PREVENTION", "Expected the reviewed resolving Program primitive");
    if (m.state.fightPreventions?.length) return failure("UNSUPPORTED_MULTIPLE_FIGHT_PREVENTIONS", "Overlapping next-fight preventions need a separate interaction review");
    const effect: FightPrevention = { kind: "PREVENT_NEXT_RIVAL_FIGHT_DEFEAT", id: preventionId(m.state, current.sourceId, current.controllerId, m.state.timing.turn), sourceId: current.sourceId, controllerId: current.controllerId, createdTurn: m.state.timing.turn, expires: { kind: "END_OF_TURN", turn: m.state.timing.turn } };
    m.state.fightPreventions = [effect];
    m.emit({ kind: "FIGHT_PREVENTION_CREATED", effect });
    return success(null);
}
export function applicableFightPreventions(state: GameState) {
    const c = state.timing.combat;
    if (!("target" in c) || c.target?.kind !== "CARD") return [];
    const a = state.objects.cards[c.attackerId], d = state.objects.cards[c.target.cardInstanceId];
    return (state.fightPreventions ?? []).filter(e => a && d && a.controllerId !== d.controllerId && [a.controllerId, d.controllerId].includes(e.controllerId));
}
/** Pure semantic filter reused by resolution and continuation validation. Fight result/power stay intact. */
export function preventFightDefeats(state: GameState, defeats: readonly DefeatInstruction[], effect?: FightPrevention) {
    return defeats.filter(d => !effect || state.objects.cards[d.targetId].controllerId !== effect.controllerId || state.objects.cards[d.defeatedBy].controllerId === effect.controllerId);
}
/** Mandatory, once per next qualifying FIGHT, even if the friendly Unit already wins or no defeat is possible. */
export function applyFightPreventions(m: TurnMutation, defeats: readonly DefeatInstruction[]) {
    const effects = applicableFightPreventions(m.state), c = m.state.timing.combat;
    if (!effects.length || !("target" in c) || c.target?.kind !== "CARD") return { defeats: [...defeats] };
    const effect = effects[0]; // validateState/creation reject overlap; never choose by array order.
    const remaining = preventFightDefeats(m.state, defeats, effect);
    delete m.state.fightPreventions;
    m.emit({ kind: "FIGHT_PREVENTION_CONSUMED", effectId: effect.id, sourceId: effect.sourceId, controllerId: effect.controllerId, attackerId: c.attackerId, defenderId: c.target.cardInstanceId });
    for (const d of defeats) if (!remaining.includes(d)) m.emit({ kind: "FIGHT_DEFEAT_PREVENTED", effectId: effect.id, sourceId: effect.sourceId, cardInstanceId: d.targetId, defeatedBy: d.defeatedBy });
    // Retain proof only when needed to validate a filtered tie result during subsequent owner ordering.
    return { defeats: remaining, ...(canonicalSerialize(remaining) !== canonicalSerialize(defeats) ? { appliedPrevention: effect } : {}) };
}
export function expireFightPreventions(m: TurnMutation) {
    for (const e of m.state.fightPreventions ?? []) m.emit({ kind: "FIGHT_PREVENTION_EXPIRED", effectId: e.id, sourceId: e.sourceId, reason: "TURN_END" });
    delete m.state.fightPreventions;
}
