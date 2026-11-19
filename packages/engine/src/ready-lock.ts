import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type PlayerId, type ReadyLock, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { isUnitSpendSubject } from "./unit-spend";
import { supportsPinnedPlayUnit } from "./play-pin-support";
import { supportsTargetedSpendCard } from "./targeted-spend-support";
import { triggerId } from "./trigger-queries";

/** Batch V22: "It can't ready until your next turn." A lock prevents every ready transition of its target (2.6), the 8.6.3 Ready
 * Phase included. It ends at the start of the locking player's next turn (8.6.2.1) or when the target leaves the field. */
export function readyLockIds(state: GameState, id: CardInstanceId) {
    return (state.readyLocks ?? []).filter(x => x.targetId === id).map(x => x.origin.effectId);
}
function compareLocks(a: ReadyLock, b: ReadyLock) { return a.origin.effectId < b.origin.effectId ? -1 : a.origin.effectId > b.origin.effectId ? 1 : 0; }
/** Locks the chosen rival Unit for the current resolving primitive (a Program's spend or a PLAY trigger). */
export function applyReadyLock(m: TurnMutation, targetId: CardInstanceId): Result<null> {
    const s = m.state, current = s.resolution.current, effect = current?.effect;
    const locks = effect?.kind === "PREVENT_UNIT_READY" || effect?.kind === "SPEND_UNIT" && effect.preventReady;
    if (!current || !locks || !current.sourceId || !isUnitSpendSubject(s, targetId, m.context) || s.objects.cards[targetId].controllerId === current.controllerId)
        return failure("INVALID_READY_LOCK", "A current reviewed lock and a rival field Unit are required");
    if (s.readyLocks?.some(x => x.origin.effectId === current.id)) return failure("DUPLICATE_READY_LOCK", "A resolved lock occurrence cannot be applied twice");
    const abilityId = current.trigger?.abilityId ?? cardRevision(s, current.sourceId, m.context)?.mechanics.abilities[0]?.id;
    if (!abilityId) return failure("INVALID_READY_LOCK", "A lock needs its source ability");
    const lock: ReadyLock = { kind: "READY_LOCK", targetId, sourceId: current.sourceId, lockingPlayerId: current.controllerId, createdTurn: s.timing.turn,
        origin: { effectId: current.id, abilityId, ...(current.trigger ? { ordinal: current.trigger.ordinal } : {}) } };
    (s.readyLocks ??= []).push(lock);
    s.readyLocks.sort(compareLocks);
    m.emit({ kind: "READY_LOCKED", lock });
    return success(null);
}
function removeLocks(m: TurnMutation, keep: (x: ReadyLock) => boolean, reason: "NEXT_TURN" | "LEFT_FIELD") {
    const all = m.state.readyLocks;
    if (!all?.some(x => !keep(x))) return;
    for (const x of all.filter(x => !keep(x))) m.emit({ kind: "READY_LOCK_EXPIRED", targetId: x.targetId, sourceId: x.sourceId, effectId: x.origin.effectId, reason });
    m.state.readyLocks = all.filter(keep);
    if (!m.state.readyLocks.length) delete m.state.readyLocks;
}
/** 8.6.2.1: "until your next turn" ends in the locking player's Start Phase, before their 8.6.3 Ready Phase. */
export function expireReadyLocks(m: TurnMutation, player: PlayerId) { removeLocks(m, x => x.lockingPlayerId !== player, "NEXT_TURN"); }
/** A Unit that leaves the field is a new object (a Go Solo Legend is removed from the game, 11.29.1); the lock does not follow it. */
export function expireReadyLocksOnDeparture(m: TurnMutation, targetId: CardInstanceId) { removeLocks(m, x => x.targetId !== targetId, "LEFT_FIELD"); }

function lockOrigin(state: GameState, x: ReadyLock, context: EngineContext) {
    const r = cardRevision(state, x.sourceId, context), a = r?.mechanics.abilities.find(a => a.id === x.origin.abilityId), source = state.objects.cards[x.sourceId];
    if (!r || !a || !source) return false;
    if (r.type === "PROGRAM") {
        const e = a.effects[0];
        return x.origin.ordinal === undefined && supportsTargetedSpendCard(r, context).ok && e?.kind === "SPEND_UNIT" && e.preventReady === "UNTIL_YOUR_NEXT_TURN" && source.ownerId === x.lockingPlayerId;
    }
    const e = a.effects[0], ordinal = x.origin.ordinal, continuation = state.resolution.triggerContinuation;
    if (ordinal === undefined || !supportsPinnedPlayUnit(r, context).ok || a.trigger !== "WHEN_PLAYED" || e?.kind !== "PREVENT_UNIT_READY") return false;
    if (x.origin.effectId !== triggerId({ ...state, timing: { ...state.timing, turn: x.createdTurn } }, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: x.lockingPlayerId, abilityId: a.id, kind: "WHEN_PLAYED" }, ordinal)) return false;
    return x.createdTurn !== state.timing.turn || ordinal <= (state.turnHistory?.triggeredBatches ?? 0) && !(continuation?.ordinal === ordinal && !continuation.resolvedIds.includes(x.origin.effectId) && state.resolution.current?.id !== x.origin.effectId);
}
/** A lock lives from its resolution through the rival's turn, and into the locking player's next turn only before 8.6.2.1 (the 8.6.1 check)
 * or in a game that ended there; its target stays a rival face-up field Unit. */
export function validateReadyLocks(state: GameState, context: EngineContext) {
    const all = state.readyLocks;
    if (!all) return success(null);
    if (new Set(all.map(x => x.origin.effectId)).size !== all.length || canonicalSerialize(all) !== canonicalSerialize([...all].sort(compareLocks)))
        return failure("INVALID_READY_LOCK", "Unique, ordered lock occurrences required");
    for (const x of all) {
        const target = state.objects.cards[x.targetId], age = state.timing.turn - x.createdTurn, active = state.timing.activePlayer === x.lockingPlayerId;
        if (!state.players[x.lockingPlayerId] || !target || !isUnitSpendSubject(state, x.targetId, context) || target.controllerId === x.lockingPlayerId
            || !(age === 0 && active || age === 1 && !active || age === 2 && active && (state.timing.step === "TURN_START" || state.match.outcome))
            || !lockOrigin(state, x, context))
            return failure("INVALID_READY_LOCK", "A lock needs its resolved reviewed origin, a rival field Unit target, and must end at its controller's next turn start");
    }
    return success(null);
}
