import { canonicalSerialize, failure, success, type AttackLock, type CardInstanceId, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { supportsModalProgram } from "./modal-program-support";
import { supportsFreeCallUnit } from "./free-call-support";

/** Batch V83: "A Unit can't attack until your next turn." Any face-up field Unit, friendly or rival, in id order (Batch V85: only a
 * rival's, for "a rival Unit", when `rivalOf` names the locking player). */
export function attackLockTargets(state: GameState, context: EngineContext, rivalOf?: PlayerId) {
    return Object.values(state.objects.cards).filter(c => c.zone.zone === "BATTLEFIELD" && c.face === "UP" && c.zone.playerId === c.controllerId && c.controllerId !== rivalOf && effectiveCardTypes(state, c.id, context).includes("UNIT")).map(c => c.id).sort();
}
/** The current lock effect's targets. */
export function currentLockTargets(state: GameState, context: EngineContext) {
    const current = state.resolution.current;
    return current?.effect.kind === "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN" ? attackLockTargets(state, context, current.effect.target ? current.controllerId : undefined) : [];
}
export function attackLocked(state: GameState, id: CardInstanceId) { return Boolean(state.attackLocks?.some(x => x.targetId === id)); }
function compareLocks(a: AttackLock, b: AttackLock) { return a.origin.effectId < b.origin.effectId ? -1 : a.origin.effectId > b.origin.effectId ? 1 : 0; }
/** Locks the chosen Unit for the current resolving Program mode. A lone Unit is taken without a choice. */
export function applyAttackLock(m: TurnMutation, targetId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current, c = s.resolution.playContinuation;
    if (current?.effect.kind !== "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN" || !current.sourceId || c?.kind !== "PLAY" || !currentLockTargets(s, m.context).includes(targetId))
        return failure("INVALID_ATTACK_LOCK", "A current reviewed attack lock and a face-up field Unit are required");
    if (s.attackLocks?.some(x => x.origin.effectId === current.id)) return failure("DUPLICATE_ATTACK_LOCK", "A resolved lock occurrence cannot be applied twice");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    const lock: AttackLock = { kind: "ATTACK_LOCK", targetId, sourceId: current.sourceId, lockingPlayerId: current.controllerId, createdTurn: s.timing.turn,
        origin: { effectId: current.id, abilityId: cardRevision(s, current.sourceId, m.context)!.mechanics.abilities[0].id } };
    (s.attackLocks ??= []).push(lock);
    s.attackLocks.sort(compareLocks);
    m.emit({ kind: "ATTACK_LOCKED", lock });
    return success(null);
}
function removeLocks(m: TurnMutation, keep: (x: AttackLock) => boolean, reason: "NEXT_TURN" | "LEFT_FIELD") {
    const all = m.state.attackLocks;
    if (!all?.some(x => !keep(x))) return;
    for (const x of all.filter(x => !keep(x))) m.emit({ kind: "ATTACK_LOCK_EXPIRED", targetId: x.targetId, sourceId: x.sourceId, effectId: x.origin.effectId, reason });
    m.state.attackLocks = all.filter(keep);
    if (!m.state.attackLocks.length) delete m.state.attackLocks;
}
/** 8.6.2.1: "until your next turn" ends in the locking player's Start Phase, as Batch V22's ready lock does. */
export function expireAttackLocks(m: TurnMutation, player: PlayerId) { removeLocks(m, x => x.lockingPlayerId !== player, "NEXT_TURN"); }
/** A Unit that leaves the field is a new object; the lock does not follow it. */
export function expireAttackLocksOnDeparture(m: TurnMutation, targetId: CardInstanceId) { removeLocks(m, x => x.targetId !== targetId, "LEFT_FIELD"); }
/** A lock lives from its Program's resolution in the locking player's turn, through the next turn, and ends at the locking player's next
 * turn start (or a game that ended there); its target stays a face-up field Unit (a rival's, for "a rival Unit"), and its source is a pinned Program. */
export function validateAttackLocks(state: GameState, context: EngineContext) {
    const all = state.attackLocks;
    if (!all) return success(null);
    if (new Set(all.map(x => x.origin.effectId)).size !== all.length || canonicalSerialize(all) !== canonicalSerialize([...all].sort(compareLocks)))
        return failure("INVALID_ATTACK_LOCK", "Unique, ordered lock occurrences required");
    for (const x of all) {
        const source = state.objects.cards[x.sourceId], r = source && cardRevision(state, x.sourceId, context), a = r?.mechanics.abilities.find(a => a.id === x.origin.abilityId);
        const age = state.timing.turn - x.createdTurn, active = state.timing.activePlayer === x.lockingPlayerId;
        const lock = a?.effects.find(e => e.kind === "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN");
        if (!state.players[x.lockingPlayerId] || !attackLockTargets(state, context, lock?.kind === "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN" && lock.target ? x.lockingPlayerId : undefined).includes(x.targetId)
            || !r || r.type !== "PROGRAM" || !(supportsModalProgram(r, context).ok || supportsFreeCallUnit(r, context).ok) || source.ownerId !== x.lockingPlayerId || !lock
            || !(age === 0 && active || age === 1 && !active || age === 2 && active && (state.timing.step === "TURN_START" || Boolean(state.match.outcome))))
            return failure("INVALID_ATTACK_LOCK", "A lock needs its resolved pinned Program, a face-up field Unit target, and must end at its controller's next turn start");
    }
    return success(null);
}
