import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type MustAttack, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { isUnitSpendSubject } from "./unit-spend";
import { supportsMustAttackUnit } from "./must-attack-support";
import { triggerId } from "./trigger-queries";
import { isAttackEligible } from "./combat-queries";

/** Batch V43: "A rival Unit must attack next turn if it can." The obligation binds the chosen rival field Unit during its
 * controller's next turn: while that Unit can declare an attack, its controller cannot end the turn. Declaring an attack with it
 * fulfils the obligation. It ends at the start of the forcing player's next turn, or when the Unit leaves the field (a new object). */
export function mustAttackTargets(state: GameState, controller: PlayerId, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.controllerId !== controller && isUnitSpendSubject(state, c.id, context)).map(c => c.id).sort();
}
function compare(a: MustAttack, b: MustAttack) { return a.origin.effectId < b.origin.effectId ? -1 : a.origin.effectId > b.origin.effectId ? 1 : 0; }
export function applyMustAttack(m: TurnMutation, targetId: CardInstanceId): Result<null> {
    const s = m.state, current = s.resolution.current, t = current?.trigger;
    if (current?.effect.kind !== "FORCE_RIVAL_UNIT_ATTACK" || !current.sourceId || !t || t.kind !== "WHEN_PLAYED" || !mustAttackTargets(s, current.controllerId, m.context).includes(targetId))
        return failure("INVALID_MUST_ATTACK", "A current reviewed {Play} obligation and a rival field Unit are required");
    if (s.mustAttack?.some(x => x.origin.effectId === current.id)) return failure("DUPLICATE_MUST_ATTACK", "A resolved obligation cannot be applied twice");
    const obligation: MustAttack = { kind: "MUST_ATTACK", targetId, sourceId: current.sourceId, forcingPlayerId: current.controllerId, createdTurn: s.timing.turn,
        origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    (s.mustAttack ??= []).push(obligation);
    s.mustAttack.sort(compare);
    m.emit({ kind: "MUST_ATTACK_CREATED", obligation });
    return success(null);
}
function remove(m: TurnMutation, keep: (x: MustAttack) => boolean, reason: "ATTACKED" | "NEXT_TURN" | "LEFT_FIELD") {
    const all = m.state.mustAttack;
    if (!all?.some(x => !keep(x))) return;
    for (const x of all.filter(x => !keep(x))) m.emit({ kind: "MUST_ATTACK_ENDED", targetId: x.targetId, effectId: x.origin.effectId, reason });
    m.state.mustAttack = all.filter(keep);
    if (!m.state.mustAttack.length) delete m.state.mustAttack;
}
/** Declaring an attack with the Unit during its controller's turn fulfils every obligation on it. */
export function fulfilMustAttack(m: TurnMutation, attackerId: CardInstanceId) { remove(m, x => !(x.targetId === attackerId && x.createdTurn < m.state.timing.turn), "ATTACKED"); }
export function expireMustAttack(m: TurnMutation, player: PlayerId) { remove(m, x => x.forcingPlayerId !== player, "NEXT_TURN"); }
export function expireMustAttackOnDeparture(m: TurnMutation, targetId: CardInstanceId) { remove(m, x => x.targetId !== targetId, "LEFT_FIELD"); }
/** The Units the acting player must still attack with this turn: bound last turn, still able to declare an attack now. */
export function unmetMustAttack(state: GameState, actor: PlayerId, context: EngineContext) {
    return (state.mustAttack ?? []).filter(x => x.createdTurn < state.timing.turn && state.objects.cards[x.targetId]?.controllerId === actor && isAttackEligible(state, actor, x.targetId, context)).map(x => x.targetId);
}
function origin(state: GameState, x: MustAttack, context: EngineContext) {
    const r = cardRevision(state, x.sourceId, context), a = r?.mechanics.abilities.find(a => a.id === x.origin.abilityId), source = state.objects.cards[x.sourceId], continuation = state.resolution.triggerContinuation;
    if (!r || !a || !source || !supportsMustAttackUnit(r, context).ok || a.trigger !== "WHEN_PLAYED" || a.effects[0]?.kind !== "FORCE_RIVAL_UNIT_ATTACK") return false;
    if (x.origin.effectId !== triggerId({ ...state, timing: { ...state.timing, turn: x.createdTurn } }, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: x.forcingPlayerId, abilityId: a.id, kind: "WHEN_PLAYED" }, x.origin.ordinal)) return false;
    return x.createdTurn !== state.timing.turn || x.origin.ordinal <= (state.turnHistory?.triggeredBatches ?? 0) && !(continuation?.ordinal === x.origin.ordinal && !continuation.resolvedIds.includes(x.origin.effectId) && state.resolution.current?.id !== x.origin.effectId);
}
/** An obligation lives from its resolution through the rival's turn, and into the forcing player's next turn only before 8.6.2.1
 * or in a game that ended there; its target stays a rival face-up field Unit. */
export function validateMustAttack(state: GameState, context: EngineContext) {
    const all = state.mustAttack;
    if (!all) return success(null);
    if (new Set(all.map(x => x.origin.effectId)).size !== all.length || canonicalSerialize(all) !== canonicalSerialize([...all].sort(compare)))
        return failure("INVALID_MUST_ATTACK", "Unique, ordered obligations required");
    for (const x of all) {
        const target = state.objects.cards[x.targetId], age = state.timing.turn - x.createdTurn, active = state.timing.activePlayer === x.forcingPlayerId;
        if (!state.players[x.forcingPlayerId] || !target || !isUnitSpendSubject(state, x.targetId, context) || target.controllerId === x.forcingPlayerId
            || !(age === 0 && active || age === 1 && !active || age === 2 && active && (state.timing.step === "TURN_START" || state.match.outcome))
            || !origin(state, x, context))
            return failure("INVALID_MUST_ATTACK", "An obligation needs its resolved reviewed origin and a rival field Unit target, and ends at the forcing player's next turn start");
    }
    return success(null);
}
