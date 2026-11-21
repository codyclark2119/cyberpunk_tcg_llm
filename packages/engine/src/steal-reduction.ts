import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type StealReduction } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, hasClassification } from "./characteristics";
import { isUnitSpendSubject } from "./unit-spend";
import { powerTargets } from "./react-queries";
import { supportsStealReductionProgram } from "./steal-reduction-support";

/** Batch V57: the Gig steals a Unit loses this turn; its steal allowance never goes below 0. */
export function stealReduction(state: GameState, id: CardInstanceId) {
    return (state.stealReductions ?? []).filter(x => x.targetId === id).reduce((n, x) => n + x.amount, 0);
}
export function reducedAllowance(state: GameState, id: CardInstanceId, allowance: number) { return Math.max(0, allowance - stealReduction(state, id)); }
function compare(a: StealReduction, b: StealReduction) { return a.origin.effectId < b.origin.effectId ? -1 : a.origin.effectId > b.origin.effectId ? 1 : 0; }
/** Resolves the current Program effect on its chosen rival Unit, then "if that Unit is an AI, DRONE, or VEHICLE, draw 1". */
export function applyStealReduction(m: TurnMutation, targetId: CardInstanceId, forced: boolean) {
    const s = m.state, current = s.resolution.current, effect = current?.effect;
    if (!current?.sourceId || effect?.kind !== "STEAL_FEWER_THIS_TURN" || !powerTargets(s, current.controllerId, m.context).includes(targetId))
        return failure("INVALID_STEAL_REDUCTION", "Choose a current rival field Unit for the reviewed Program");
    if (s.stealReductions?.some(x => x.origin.effectId === current.id)) return failure("DUPLICATE_STEAL_REDUCTION", "A resolved occurrence cannot be applied twice");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    (s.stealReductions ??= []).push({ kind: "STEAL_REDUCTION", targetId, sourceId: current.sourceId, controllerId: current.controllerId, amount: effect.amount, createdTurn: s.timing.turn, origin: { effectId: current.id } });
    s.stealReductions.sort(compare);
    const met = effect.draw.classifications.some(c => hasClassification(s, targetId, c, m.context));
    m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
    return met ? m.draw(current.controllerId, effect.draw.count) : success(null);
}
export function expireStealReductions(m: TurnMutation) { delete m.state.stealReductions; }
/** A Unit that leaves the field is a new object; the reduction does not follow it. */
export function expireStealReductionsOnDeparture(m: TurnMutation, targetId: CardInstanceId) {
    if (!m.state.stealReductions) return;
    m.state.stealReductions = m.state.stealReductions.filter(x => x.targetId !== targetId);
    if (!m.state.stealReductions.length) delete m.state.stealReductions;
}
export function validateStealReductions(state: GameState, context: EngineContext) {
    const all = state.stealReductions;
    if (!all) return success(null);
    if (new Set(all.map(x => x.origin.effectId)).size !== all.length || canonicalSerialize(all) !== canonicalSerialize([...all].sort(compare))) return failure("INVALID_STEAL_REDUCTION", "Unique, ordered reduction occurrences required");
    for (const x of all) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context);
        if (!source || !target || x.createdTurn !== state.timing.turn || !supportsStealReductionProgram(r, context).ok || source.ownerId !== x.controllerId || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone)
            || !isUnitSpendSubject(state, x.targetId, context) || target.controllerId === x.controllerId || state.resolution.current?.id === x.origin.effectId && source.zone.zone !== "RESOLVING_PROGRAM")
            return failure("INVALID_STEAL_REDUCTION", "A reduction needs its reviewed played Program, the current turn and a rival field Unit target");
    }
    return success(null);
}
