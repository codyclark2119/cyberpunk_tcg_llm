import type { GameState, PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { effectiveCardTypes } from "./characteristics";
import { friendlyPlayPowerEnabled } from "./friendly-play-power-support";

/** Ready/spent/Lag do not affect this target set. The played source and effective field Legends qualify. */
export function friendlyPowerTargets(state: GameState, actor: PlayerId, context: EngineContext) {
    if (!friendlyPlayPowerEnabled(context)) return [];
    return Object.values(state.objects.cards)
        .filter(card => card.controllerId === actor && card.zone.playerId === actor
            && card.zone.zone === "BATTLEFIELD" && card.face === "UP"
            && effectiveCardTypes(state, card.id, context).includes("UNIT"))
        .map(card => card.id).sort();
}
