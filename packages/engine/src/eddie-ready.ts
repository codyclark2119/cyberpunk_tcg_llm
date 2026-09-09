import { failure, success, type GameState, type PlayerId } from "@tcg/domain";
import type { TurnMutation } from "./turn";
/** Rules 3.8/5.8: own spent Eddies only, identified by public area slot, never sold-card content. */
export function readyableEddieSlots(state: GameState, player: PlayerId): number[] {
    return state.players[player].zones.EDDIES.flatMap((id, slot) => {
        const c = state.objects.cards[id];
        return c.zone.playerId === player && c.zone.zone === "EDDIES" && c.controllerId === player && c.face === "DOWN" && c.readiness === "SPENT" ? [slot] : [];
    });
}
export function readyEddie(m: TurnMutation, player: PlayerId, slot: number) {
    if (!readyableEddieSlots(m.state, player).includes(slot)) return failure("INVALID_EDDIE_READY", "Choose a currently spent friendly Eddie slot");
    const id = m.state.players[player].zones.EDDIES[slot];
    m.state.objects.cards[id].readiness = "READY";
    m.emit({ kind: "CARD_READIED", cardInstanceId: id });
    return success(null);
}
