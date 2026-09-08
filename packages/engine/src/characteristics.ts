import type { CardInstanceId, GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { attachedGear, gearEnabled } from "./attachments";
export function cardRevision(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
}
/** 4.2.1: field Legends are both types, independent of the future method of entering the field. */
export function effectiveCardTypes(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = cardRevision(state, id, context);
    return r ? [...new Set([r.type, ...(r.type === "LEGEND" && c.zone.zone === "BATTLEFIELD" ? ["UNIT" as const] : [])])] : [];
}
/** Pure derived query usable during trusted resolution and by the validated public RulesView. */
export function effectivePower(state: GameState, id: CardInstanceId, context: EngineContext) {
    const card = state.objects.cards[id], revision = cardRevision(state, id, context);
    if (!revision || revision.power === undefined) return null;
    let power = revision.power;
    const gear = attachedGear(state, id, context);
    if (gearEnabled(context) && card.face === "UP" && (card.zone.zone === "BATTLEFIELD" || card.zone.zone === "LEGENDS") && (revision.type === "UNIT" || revision.type === "LEGEND"))
        power += gear.reduce((sum, g) => sum + (cardRevision(state, g.id, context)?.power ?? 0), 0);
    for (const modifier of revision.mechanics.modifiers) {
        if (modifier.kind === "GRANT_PRINTED_POWER_TO_HOST" && revision.type === "GEAR" && gearEnabled(context)) continue;
        if (modifier.kind !== "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN") throw new Error("UNSUPPORTED_CONTINUOUS_MODIFIERS");
        if (card.face === "UP" && card.zone.zone === "LEGENDS" && state.timing.turn > 0 && state.timing.activePlayer === card.controllerId)
            power += modifier.amount * gear.length;
    }
    power += (state.temporaryModifiers ?? []).filter(m => m.targetId === id && m.expires.turn === state.timing.turn && (card.zone.zone === "BATTLEFIELD" || (combatResolutionEnabled(context) && ["TRASH", "REMOVED"].includes(card.zone.zone)))).reduce((sum, m) => sum + m.amount, 0);
    return power;
}
