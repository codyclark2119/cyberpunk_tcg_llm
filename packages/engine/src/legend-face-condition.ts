import type { GameState, PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
/** 1.7.2/.2.1,4.2.1,4.4,5.13.2: only controlled Legends still in play.
 * 3.4.1 keeps printed Legend identity public even while face-down. */
export function friendlyLegends(state: GameState, actor: PlayerId, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.controllerId === actor && c.zone.playerId === actor && ["LEGENDS", "BATTLEFIELD"].includes(c.zone.zone) && cardRevision(state, c.id, context)?.type === "LEGEND").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function areAllFriendlyLegendsFaceUp(state: GameState, actor: PlayerId, context: EngineContext) {
    // Universal text: no qualifying face-down Legend. No implicit exactly-three or
    // nonempty requirement; empty-set truth is deliberate, not a zero-Legend format admission.
    return !friendlyLegends(state, actor, context).some(c => c.face !== "UP");
}
