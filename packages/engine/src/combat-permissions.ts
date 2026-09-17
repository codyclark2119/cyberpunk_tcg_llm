import type { CardInstanceId, CombatRestriction, GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { attackPreventionEnabled, supportsAttackPreventionUnit } from "./attack-prevention-support";
import { restrictionsEnabled, supportsRestrictedPlay } from "./restriction-support";
import { testCondition } from "./conditions";
export function currentCombatRestrictions(state: GameState, id: CardInstanceId, context: EngineContext): readonly CombatRestriction[] {
    const c = state.objects.cards[id], r = cardRevision(state, id, context);
    if (!restrictionsEnabled(context) || !c || c.face !== "UP" || c.zone.zone !== "BATTLEFIELD" || !supportsRestrictedPlay(r, context).ok) return [];
    // Only conditional unblockability carries a condition; unconditional printed restrictions always apply.
    return (r?.mechanics.restrictions ?? []).filter(x => x.kind !== "CANNOT_BE_BLOCKED" || testCondition(state, c.controllerId, x.condition, context, id));
}
/** 2.6/11.3.1: a rival source prevents Units that entered the field this turn from attacking; prevention outranks any permission. */
export function imposedAttackPrevention(state: GameState, id: CardInstanceId, context: EngineContext): readonly CombatRestriction[] {
    const c = state.objects.cards[id];
    if (!attackPreventionEnabled(context) || !c || c.face !== "UP" || c.zone.zone !== "BATTLEFIELD" || !c.statuses.includes("LAG") || !effectiveCardTypes(state, id, context).includes("UNIT")) return [];
    return Object.values(state.objects.cards).some(x => x.controllerId !== c.controllerId && x.face === "UP" && x.zone.zone === "BATTLEFIELD" && x.zone.playerId === x.controllerId && supportsAttackPreventionUnit(cardRevision(state, x.id, context), context).ok) ? [{ kind: "CANNOT_ATTACK" }] : [];
}
/** Printed prohibitions plus rival-imposed prevention. Target-class restrictions (9.3.2.3) are applied when listing targets, not here. */
export function getAttackRestrictions(state: GameState, id: CardInstanceId, context: EngineContext) { return [...currentCombatRestrictions(state, id, context).filter(x => x.kind === "CANNOT_ATTACK"), ...imposedAttackPrevention(state, id, context)]; }
/** Restricts BLOCKER only, never the React window or CALL/QUICK/PASS. No declaration-time cache. */
export function canBeBlocked(state: GameState, attacker: CardInstanceId, context: EngineContext) { return !currentCombatRestrictions(state, attacker, context).some(x => x.kind === "CANNOT_BE_BLOCKED"); }
