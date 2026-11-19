import type { CardInstanceId, GameState, PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { readyLockIds } from "./ready-lock";
/** "Ready a friendly face-up Legend" (batch V8). Like the reviewed spend selector, readiness is not
 * a selector filter: an already-ready Legend is a legal choice that changes nothing. */
export function readyLegendTargets(state: GameState, actor: PlayerId, _context: EngineContext): CardInstanceId[] {
    return state.players[actor].zones.LEGENDS.filter(id => { const c = state.objects.cards[id]; return c.controllerId === actor && c.face === "UP"; }).sort();
}
/** Effect-caused ready. Readying a ready card is not a transition and emits nothing. */
export function readyCardForEffect(m: TurnMutation, id: CardInstanceId) {
    const c = m.state.objects.cards[id];
    if (!c || c.readiness !== "SPENT") return;
    const locks = readyLockIds(m.state, id);
    if (locks.length) { m.emit({ kind: "READY_PREVENTED", cardInstanceId: id, effectIds: locks }); return; } // Batch V22, 2.6.
    c.readiness = "READY";
    m.emit({ kind: "CARD_READIED", cardInstanceId: id });
}
