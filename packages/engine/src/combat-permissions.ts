import type { CardInstanceId, CombatRestriction, GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { restrictionsEnabled, supportsRestrictedPlay } from "./restriction-support";
import { testCondition } from "./conditions";
export function currentCombatRestrictions(state: GameState, id: CardInstanceId, context: EngineContext): readonly CombatRestriction[] {
    const c = state.objects.cards[id], r = cardRevision(state, id, context);
    if (!restrictionsEnabled(context) || !c || c.face !== "UP" || c.zone.zone !== "BATTLEFIELD" || !supportsRestrictedPlay(r, context).ok) return [];
    return (r?.mechanics.restrictions ?? []).filter(x => x.kind === "CANNOT_ATTACK" || testCondition(state, c.controllerId, x.condition, context, id));
}
export function getAttackRestrictions(state: GameState, id: CardInstanceId, context: EngineContext) { return currentCombatRestrictions(state, id, context).filter(x => x.kind === "CANNOT_ATTACK"); }
/** Restricts BLOCKER only, never the React window or CALL/QUICK/PASS. No declaration-time cache. */
export function canBeBlocked(state: GameState, attacker: CardInstanceId, context: EngineContext) { return !currentCombatRestrictions(state, attacker, context).some(x => x.kind === "CANNOT_BE_BLOCKED"); }
