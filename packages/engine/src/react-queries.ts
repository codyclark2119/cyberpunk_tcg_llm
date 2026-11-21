import { canBeBlocked } from "./combat-permissions";
import { effectiveKeywords } from "./capabilities";
import { supportsPlay } from "./play-support";
import type { CardInstanceId, GameState, PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { isReactDecision } from "./react-support";

export function isBlockerEligible(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = cardRevision(state, id, context);
    // 11.3 restricts attacking and Spend-icon abilities. BLOCKER is a separate keyword cost.
    // Batch V65: an attacked ready Blocker cannot redirect the attack to itself (9.9.1: "to it instead").
    const combat = state.timing.combat, target = combat.stage !== "NONE" && "target" in combat ? combat.target : null, attacked = target?.kind === "CARD" && target.cardInstanceId === id;
    return Boolean(!attacked && isReactDecision(state, actor, context) && state.timing.combat.stage !== "NONE" && canBeBlocked(state, state.timing.combat.attackerId, context) && c?.controllerId === actor && c.zone.playerId === actor && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && c.readiness === "READY" && effectiveCardTypes(state, id, context).includes("UNIT") && supportsPlay(r, context).ok && effectiveKeywords(state, id, context).includes("BLOCKER"));
}
/** Floor It: any rival field Unit, not only the attacking or defending object. */
export function powerTargets(state: GameState, actor: PlayerId, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.controllerId !== actor && c.zone.playerId === c.controllerId && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && effectiveCardTypes(state, c.id, context).includes("UNIT")).map(c => c.id).sort();
}
