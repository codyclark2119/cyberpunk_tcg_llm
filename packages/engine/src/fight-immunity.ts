import { canonicalSerialize, failure, success, type CardInstanceId, type DefeatInstruction, type FightDefeatImmunity, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { isUnitSpendSubject } from "./unit-spend";
import { friendlyFieldUnits } from "./fight-power-grant";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { activationEffectId } from "./play-state";

/** Batch V61: "can't be defeated in a fight this turn" removes only the fight's own defeat of that Unit; it still loses (11.4.1.1). */
export function withoutImmuneFightDefeats(state: GameState, defeats: DefeatInstruction[]) {
    const immune = new Set((state.fightDefeatImmunities ?? []).map(x => x.targetId));
    return immune.size ? defeats.filter(d => !immune.has(d.targetId)) : defeats;
}
function compare(a: FightDefeatImmunity, b: FightDefeatImmunity) { return a.origin.effectId < b.origin.effectId ? -1 : a.origin.effectId > b.origin.effectId ? 1 : 0; }
export function applyFightDefeatImmunity(m: TurnMutation, targetId: CardInstanceId, forced: boolean) {
    const s = m.state, current = s.resolution.current;
    if (!current?.sourceId || current.effect.kind !== "FIGHT_DEFEAT_IMMUNITY_THIS_TURN" || !friendlyFieldUnits(s, current.controllerId, m.context).includes(targetId))
        return failure("INVALID_FIGHT_IMMUNITY", "Choose a current friendly field Unit");
    if (s.fightDefeatImmunities?.some(x => x.origin.effectId === current.id)) return failure("DUPLICATE_FIGHT_IMMUNITY", "A resolved occurrence cannot be applied twice");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    (s.fightDefeatImmunities ??= []).push({ kind: "FIGHT_DEFEAT_IMMUNITY", targetId, sourceId: current.sourceId, controllerId: current.controllerId, createdTurn: s.timing.turn, origin: { effectId: current.id } });
    s.fightDefeatImmunities.sort(compare);
    return success(null);
}
export function expireFightDefeatImmunities(m: TurnMutation) { delete m.state.fightDefeatImmunities; }
export function expireFightDefeatImmunitiesOnDeparture(m: TurnMutation, targetId: CardInstanceId) {
    if (!m.state.fightDefeatImmunities) return;
    m.state.fightDefeatImmunities = m.state.fightDefeatImmunities.filter(x => x.targetId !== targetId);
    if (!m.state.fightDefeatImmunities.length) delete m.state.fightDefeatImmunities;
}
export function validateFightDefeatImmunities(state: GameState, context: EngineContext) {
    const all = state.fightDefeatImmunities;
    if (!all) return success(null);
    if (new Set(all.map(x => x.origin.effectId)).size !== all.length || canonicalSerialize(all) !== canonicalSerialize([...all].sort(compare))) return failure("INVALID_FIGHT_IMMUNITY", "Unique, ordered immunity occurrences required");
    for (const x of all) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context);
        const a = r?.mechanics.abilities.find(a => a.trigger === "WHEN_CALLED" && a.choose), index = a ? a.effects.findIndex(e => e.kind === "FIGHT_DEFEAT_IMMUNITY_THIS_TURN") : -1;
        if (!source || !target || !a || index < 0 || x.createdTurn !== state.timing.turn || !supportsLegendSpendCard(r, context).ok || source.controllerId !== x.controllerId || source.zone.zone !== "LEGENDS" || source.face !== "UP"
            || x.origin.effectId !== activationEffectId(state, x.controllerId, x.sourceId, a.id, index) || !isUnitSpendSubject(state, x.targetId, context) || target.controllerId !== x.controllerId)
            return failure("INVALID_FIGHT_IMMUNITY", "An immunity needs its reviewed Called Legend, its chosen mode this turn and a friendly field Unit target");
    }
    return success(null);
}
