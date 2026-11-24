import { failure, success, type CardInstanceId, type GameState, type PlayerId, type Result, type TemporaryKeywordGrant, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { friendlyFieldUnits } from "./fight-power-grant";
import { friendlyValuePairs, supportsLegendSpendCard } from "./legend-spend-support";
import { activationEffectId } from "./play-state";
import { compareTemporaryPower } from "./temporary-power";

type BlockerGrant = Extract<TemporaryKeywordGrant, { keyword: "BLOCKER" }>;
type BlockerBonus = Extract<TemporaryPowerModifier, { scaled: "BLOCKER_GRANT_BONUS" }>;
/** Batch V74: "a friendly Unit with cost 4 or less": the controller's face-up field Units with a printed Eddie cost of 4 or less. */
export function blockerGrantTargets(state: GameState, actor: PlayerId, context: EngineContext) {
    return friendlyFieldUnits(state, actor, context).filter(id => { const r = cardRevision(state, id, context); return r?.printedCost.kind === "EDDIES" && r.printedCost.amount <= 4; });
}
/** The pinned Legend's Quick ability whose printed effect is the Blocker grant. */
function grantAbility(state: GameState, sourceId: CardInstanceId, context: EngineContext) {
    const r = cardRevision(state, sourceId, context);
    return supportsLegendSpendCard(r, context).ok ? r!.mechanics.abilities.find(a => a.activation?.timing === "QUICK" && a.effects[0]?.kind === "GRANT_BLOCKER_THIS_TURN") : undefined;
}
/** Gives {Blocker} this turn, then reads "if you control a value-pair of Gigs" as the effect resolves (6.6) for the +1 power. */
export function applyBlockerGrant(m: TurnMutation, targetId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current, c = s.resolution.playContinuation;
    if (current?.effect.kind !== "GRANT_BLOCKER_THIS_TURN" || !current.sourceId || c?.kind !== "ACTIVATE" || !c.abilityId) return failure("INVALID_KEYWORD_GRANT", "Current reviewed Blocker grant required");
    if (!blockerGrantTargets(s, current.controllerId, m.context).includes(targetId)) return failure("INVALID_KEYWORD_TARGET", "Choose a current friendly Unit with cost 4 or less");
    const origin = { effectId: current.id, sequence: current.causedBySequence }, expires = { kind: "END_OF_TURN" as const, turn: s.timing.turn };
    if (s.temporaryKeywords?.some(x => "sequence" in x.origin && x.origin.effectId === origin.effectId && x.origin.sequence === origin.sequence)) return failure("DUPLICATE_KEYWORD_GRANT", "A resolved grant occurrence cannot be applied twice");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    const grant: BlockerGrant = { kind: "KEYWORD", keyword: "BLOCKER", sourceId: current.sourceId, targetId, expires, origin: { effectId: current.id, abilityId: c.abilityId, sequence: current.causedBySequence } };
    (s.temporaryKeywords ??= []).push(grant);
    s.temporaryKeywords.sort(compareKeywordGrants);
    m.emit({ kind: "KEYWORD_GRANTED", grant });
    const paired = friendlyValuePairs(s, current.controllerId) > 0;
    m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met: paired });
    if (!paired) return success(null);
    const modifier: BlockerBonus = { kind: "POWER", sourceId: current.sourceId, targetId, expires, amount: 1, scaled: "BLOCKER_GRANT_BONUS", origin };
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
/** Grants sort by occurrence; repeated activations of one ability in a turn share an effect id and differ by sequence. */
export function compareKeywordGrants(a: TemporaryKeywordGrant, b: TemporaryKeywordGrant) {
    if (a.origin.effectId !== b.origin.effectId) return a.origin.effectId < b.origin.effectId ? -1 : 1;
    return ("sequence" in a.origin ? a.origin.sequence : -1) - ("sequence" in b.origin ? b.origin.sequence : -1);
}
/** The occurrence a grant or bonus came from: the pinned Legend's resolved current-turn activation, never the one still resolving. */
function validOccurrence(state: GameState, sourceId: CardInstanceId, origin: { effectId: string; sequence: number }, context: EngineContext, abilityId?: string) {
    const source = state.objects.cards[sourceId], a = grantAbility(state, sourceId, context), current = state.resolution.current;
    return Boolean(source && a && (abilityId === undefined || a.id === abilityId) && source.face === "UP" && source.zone.zone === "LEGENDS" && source.zone.playerId === source.controllerId
        && origin.effectId === activationEffectId(state, source.controllerId, sourceId, a.id, 0) && origin.sequence < state.match.eventSequence
        && !(current?.id === origin.effectId && current.causedBySequence === origin.sequence));
}
export function validateBlockerGrant(state: GameState, x: BlockerGrant, context: EngineContext) {
    const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.targetId, context);
    if (!source || !target || !validOccurrence(state, x.sourceId, x.origin, context, x.origin.abilityId) || x.expires.turn !== state.timing.turn || x.sourceId === x.targetId
        || target.face !== "UP" || target.zone.zone !== "BATTLEFIELD" || target.controllerId !== source.controllerId || !effectiveCardTypes(state, target.id, context).includes("UNIT")
        || r?.printedCost.kind !== "EDDIES" || r.printedCost.amount > 4)
        return failure("INVALID_KEYWORD_GRANT", "A Blocker grant needs its reviewed face-up Legend's resolved current-turn activation and a friendly field Unit with cost 4 or less");
    return success(null);
}
/** The +1 outlives the grant's own target departure, like any power this turn (5.3.2.2); it never needs the value pair to persist. */
export function validateBlockerBonus(state: GameState, x: BlockerBonus, context: EngineContext, publicUnit: (id: CardInstanceId) => boolean) {
    const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId];
    if (!source || !target || !validOccurrence(state, x.sourceId, x.origin, context) || x.expires.turn !== state.timing.turn || target.controllerId !== source.controllerId || !publicUnit(x.targetId))
        return failure("INVALID_TEMPORARY_POWER", "A Blocker grant's +1 needs its reviewed face-up Legend's resolved current-turn activation and a friendly public Unit");
    return success(null);
}
