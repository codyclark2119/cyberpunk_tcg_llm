import type { CardInstanceId, GameState, PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { isReactDecision, supportsReactPlay } from "./react-support";

export function isBlockerEligible(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = cardRevision(state, id, context);
    // 11.3 restricts attacking and Spend-icon abilities. BLOCKER is a separate keyword cost.
    return Boolean(isReactDecision(state, actor, context) && c?.controllerId === actor && c.zone.playerId === actor && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && c.readiness === "READY" && effectiveCardTypes(state, id, context).includes("UNIT") && supportsReactPlay(r, context).ok && r?.mechanics.keywords.includes("BLOCKER"));
}
/** Floor It: any rival field Unit, not only the attacking or defending object. */
export function powerTargets(state: GameState, actor: PlayerId, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.controllerId !== actor && c.zone.playerId === c.controllerId && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && effectiveCardTypes(state, c.id, context).includes("UNIT")).map(c => c.id).sort();
}
