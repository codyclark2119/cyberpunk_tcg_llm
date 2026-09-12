import { canonicalSerialize, failure, hashCanonical, success, type DefeatInstruction, type FightPrevention, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { createsFightPrevention, restrictionsEnabled, supportsRestrictedPlay } from "./restriction-support";

// Reviewed Programs cannot return from Trash and resolve again in the same turn.
// Distinct physical sources therefore identify distinct plays; no speculative ordinal.
export function preventionId(state: GameState, sourceId: FightPrevention["sourceId"], controller: PlayerId, turn: number) {
    return hashCanonical({ protocol: "next-rival-fight-prevention@1", sourceId, controllerSeat: state.players[controller].seat, turn });
}
const byId = (a: FightPrevention, b: FightPrevention) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
/** Keep the legacy single-occurrence proof byte-compatible; multiple consumption retains the complete set. */
export function appliedFightPreventions(state: GameState): readonly FightPrevention[] {
    const c = state.resolution.defeatContinuation;
    return c?.appliedPreventions ?? (c?.appliedPrevention ? [c.appliedPrevention] : []);
}
export function validatePrevention(effect: FightPrevention, state: GameState, context: EngineContext) {
    const source = state.objects.cards[effect.sourceId], r = cardRevision(state, effect.sourceId, context);
    if (!restrictionsEnabled(context) || !source || !state.players[effect.controllerId] || !supportsRestrictedPlay(r, context).ok || !createsFightPrevention(r) || effect.createdTurn !== state.timing.turn || effect.expires.turn !== effect.createdTurn || effect.id !== preventionId(state, effect.sourceId, effect.controllerId, effect.createdTurn))
        return failure("INVALID_FIGHT_PREVENTION", "Reviewed source, controller, deterministic identity and current turn duration required");
    // An independent Program effect is not cancelled by later source movement.
    return success(null);
}
export function validateFightPreventions(state: GameState, context: EngineContext) {
    const active = state.fightPreventions, continuation = state.resolution.defeatContinuation, applied = appliedFightPreventions(state);
    if (continuation?.appliedPrevention && continuation.appliedPreventions) return failure("INVALID_APPLIED_PREVENTION", "Use one canonical single or multiple consumed proof, never both");
    for (const effects of [active, applied.length ? applied : undefined]) {
        if (!effects) continue;
        if (!effects.length || new Set(effects.map(e => e.sourceId)).size !== effects.length || effects.some((e, i) => i > 0 && byId(effects[i - 1], e) >= 0))
            return failure("INVALID_FIGHT_PREVENTION", "Nonempty canonical occurrence order and distinct physical plays required");
        for (const effect of effects) { const valid = validatePrevention(effect, state, context); if (!valid.ok) return valid; }
    }
    if (applied.length && (state.timing.combat.stage !== "DEFEAT_ORDER_SELECTION" || active?.some(e => applied.some(p => p.id === e.id || p.sourceId === e.sourceId)) || applicableFightPreventions(state).length))
        return failure("INVALID_APPLIED_PREVENTION", "Consumed proof belongs to this unfinished fight; no matching occurrence may remain active");
    const source = state.resolution.playContinuation?.sourceId;
    if (source && active?.some(e => e.sourceId === source)) return failure("DUPLICATE_FIGHT_PREVENTION", "One physical Program play cannot register twice");
    return success(null);
}
export function createFightPrevention(m: TurnMutation) {
    const current = m.state.resolution.current;
    if (!restrictionsEnabled(m.context) || !current?.sourceId || current.effect.kind !== "CREATE_NEXT_RIVAL_FIGHT_PREVENTION" || m.state.objects.cards[current.sourceId]?.zone.zone !== "RESOLVING_PROGRAM") return failure("INVALID_FIGHT_PREVENTION", "Expected the reviewed resolving Program primitive");
    if (m.state.fightPreventions?.some(e => e.sourceId === current.sourceId)) return failure("DUPLICATE_FIGHT_PREVENTION", "One physical Program play cannot register twice");
    const effect: FightPrevention = { kind: "PREVENT_NEXT_RIVAL_FIGHT_DEFEAT", id: preventionId(m.state, current.sourceId, current.controllerId, m.state.timing.turn), sourceId: current.sourceId, controllerId: current.controllerId, createdTurn: m.state.timing.turn, expires: { kind: "END_OF_TURN", turn: m.state.timing.turn } };
    m.state.fightPreventions = [...(m.state.fightPreventions ?? []), effect].sort(byId);
    m.emit({ kind: "FIGHT_PREVENTION_CREATED", effect });
    return success(null);
}
export function applicableFightPreventions(state: GameState) {
    const c = state.timing.combat;
    if (!("target" in c) || c.target?.kind !== "CARD") return [];
    const a = state.objects.cards[c.attackerId], d = state.objects.cards[c.target.cardInstanceId];
    return (state.fightPreventions ?? []).filter(e => a && d && a.controllerId !== d.controllerId && [a.controllerId, d.controllerId].includes(e.controllerId));
}
function protects(state: GameState, defeat: DefeatInstruction, effect: FightPrevention) {
    return state.objects.cards[defeat.targetId].controllerId === effect.controllerId && state.objects.cards[defeat.defeatedBy].controllerId !== effect.controllerId;
}
/** Filter each real defeat once, regardless of the number of redundant matching occurrences. */
export function preventFightDefeats(state: GameState, defeats: readonly DefeatInstruction[], effects: readonly FightPrevention[] = []) {
    return defeats.filter(d => !effects.some(e => protects(state, d, e)));
}
/** All matching next-fight occurrences consume on this FIGHT, even without an attempted defeat. */
export function applyFightPreventions(m: TurnMutation, defeats: readonly DefeatInstruction[]) {
    const effects = [...applicableFightPreventions(m.state)].sort(byId), c = m.state.timing.combat;
    if (!effects.length || !("target" in c) || c.target?.kind !== "CARD") return { defeats: [...defeats] };
    const remaining = preventFightDefeats(m.state, defeats, effects), consumed = new Set(effects.map(e => e.id));
    const active = (m.state.fightPreventions ?? []).filter(e => !consumed.has(e.id));
    if (active.length) m.state.fightPreventions = active; else delete m.state.fightPreventions;
    for (const effect of effects) m.emit({ kind: "FIGHT_PREVENTION_CONSUMED", effectId: effect.id, sourceId: effect.sourceId, controllerId: effect.controllerId, attackerId: c.attackerId, defenderId: c.target.cardInstanceId });
    for (const d of defeats) if (!remaining.includes(d)) {
        // One semantic prevention fact, attributed to a canonical representative.
        // Every contributing occurrence has its own consumption fact and remains in the continuation proof.
        const effect = effects.find(e => protects(m.state, d, e))!;
        m.emit({ kind: "FIGHT_DEFEAT_PREVENTED", effectId: effect.id, sourceId: effect.sourceId, cardInstanceId: d.targetId, defeatedBy: d.defeatedBy });
    }
    const proof = effects.length === 1 ? { appliedPrevention: effects[0] } : { appliedPreventions: effects };
    return { defeats: remaining, ...(canonicalSerialize(remaining) !== canonicalSerialize(defeats) ? proof : {}) };
}
export function expireFightPreventions(m: TurnMutation) {
    for (const e of [...(m.state.fightPreventions ?? [])].sort(byId)) m.emit({ kind: "FIGHT_PREVENTION_EXPIRED", effectId: e.id, sourceId: e.sourceId, reason: "TURN_END" });
    delete m.state.fightPreventions;
}
