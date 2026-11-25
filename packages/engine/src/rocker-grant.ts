import { failure, success, type CardInstanceId, type GameState, type PlayerId, type Result, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { friendlyFieldUnits } from "./fight-power-grant";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { activationEffectId } from "./play-state";
import { compareTemporaryPower } from "./temporary-power";

type RockerBonus = Extract<TemporaryPowerModifier, { scaled: "ROCKER_ATTACK_GRANT_BONUS" }>;
/** The pinned Legend's {Spend} ability whose printed effect is the rival-Unit attack grant. */
function grantAbility(state: GameState, sourceId: CardInstanceId, context: EngineContext) {
    const r = cardRevision(state, sourceId, context);
    return supportsLegendSpendCard(r, context).ok ? r!.mechanics.abilities.find(a => a.activation && a.effects[0]?.kind === "FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED") : undefined;
}
/** Batch V80: content holding the reviewed Legend that grants "can attack spent rival Units the turn it's played". */
export function rockerGrantEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.type === "LEGEND" && r.mechanics.abilities.some(a => a.effects[0]?.kind === "FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED") && supportsLegendSpendCard(r, context).ok);
}
/** "A friendly Unit": the controller's face-up field Units. */
export function rockerGrantTargets(state: GameState, actor: PlayerId, context: EngineContext) { return friendlyFieldUnits(state, actor, context); }
/** The Unit may attack (spent) rival Units the turn it's played, as a free play's grant does (Batch V50); a ROCKER also gets +2 power
 * this turn, read from its classifications as the effect resolves. */
export function applyRockerGrant(m: TurnMutation, targetId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current, c = s.resolution.playContinuation, h = s.turnHistory;
    if (current?.effect.kind !== "FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED" || !current.sourceId || c?.kind !== "ACTIVATE" || !h) return failure("INVALID_ATTACK_GRANT", "Current reviewed rival-Unit attack grant required");
    if (!rockerGrantTargets(s, current.controllerId, m.context).includes(targetId)) return failure("INVALID_GRANT_TARGET", "Choose a current friendly field Unit");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    if (!h.rivalUnitAttackGrants?.includes(targetId)) h.rivalUnitAttackGrants = [...(h.rivalUnitAttackGrants ?? []), targetId].sort();
    const rocker = Boolean(cardRevision(s, targetId, m.context)?.tags.includes(current.effect.alsoPowerIfTag));
    m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met: rocker });
    if (!rocker) return success(null);
    const modifier: RockerBonus = { kind: "POWER", sourceId: current.sourceId, targetId, expires: { kind: "END_OF_TURN", turn: s.timing.turn }, amount: current.effect.amount, scaled: "ROCKER_ATTACK_GRANT_BONUS", origin: { effectId: current.id, sequence: current.causedBySequence } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
/** The +2 on a friendly public ROCKER Unit from the pinned face-up Legend's resolved current-turn activation. */
export function validateRockerBonus(state: GameState, x: RockerBonus, context: EngineContext, publicUnit: (id: CardInstanceId) => boolean) {
    const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], a = grantAbility(state, x.sourceId, context), current = state.resolution.current;
    if (!source || !target || !a || source.face !== "UP" || source.zone.zone !== "LEGENDS" || source.zone.playerId !== source.controllerId || x.expires.turn !== state.timing.turn || target.controllerId !== source.controllerId
        || !publicUnit(x.targetId) || !cardRevision(state, x.targetId, context)?.tags.includes("Rocker")
        || x.origin.effectId !== activationEffectId(state, source.controllerId, source.id, a.id, 0) || x.origin.sequence >= state.match.eventSequence || current?.id === x.origin.effectId && current.causedBySequence === x.origin.sequence)
        return failure("INVALID_TEMPORARY_POWER", "A ROCKER grant's +2 needs its reviewed face-up Legend's resolved current-turn activation and a friendly public ROCKER Unit");
    return success(null);
}
/** "-1 €$ for each friendly Gig with 8+ value", read whenever the payable amount is computed. */
export function activationCostReduction(state: GameState, actor: PlayerId, reduction: { per: "FRIENDLY_GIG_VALUE_AT_LEAST_8"; amount: number }) {
    return reduction.amount * Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue >= 8).length;
}
