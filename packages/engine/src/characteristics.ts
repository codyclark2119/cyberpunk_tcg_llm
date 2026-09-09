import { supportsCapabilityGear } from "./capability-support";
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
export type ApplicablePowerModifier = { sourceId: CardInstanceId; subjectId: CardInstanceId; kind: "GRANT_PRINTED_POWER_TO_HOST" | "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN" | "TEMPORARY_POWER"; amount: number };
/** One shared derivation for printed Gear power, persistent host effects and temporary adjustments. */
export function applicablePowerModifiers(state: GameState, id: CardInstanceId, context: EngineContext): ApplicablePowerModifier[] {
    const card = state.objects.cards[id], revision = cardRevision(state, id, context);
    if (!card || !revision) return [];
    const result: ApplicablePowerModifier[] = [], gear = attachedGear(state, id, context);
    if (gearEnabled(context) && card.face === "UP" && ["BATTLEFIELD", "LEGENDS"].includes(card.zone.zone) && ["UNIT", "LEGEND"].includes(revision.type))
        for (const g of gear) result.push({ sourceId: g.id, subjectId: id, kind: "GRANT_PRINTED_POWER_TO_HOST", amount: cardRevision(state, g.id, context)?.power ?? 0 });
    for (const modifier of revision.mechanics.modifiers) {
        if (modifier.kind === "GRANT_KEYWORD_TO_HOST" && supportsCapabilityGear(revision, context).ok) continue;
        if (modifier.kind === "GRANT_PRINTED_POWER_TO_HOST" && revision.type === "GEAR" && gearEnabled(context)) continue;
        if (modifier.kind !== "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN") throw new Error("UNSUPPORTED_CONTINUOUS_MODIFIERS");
        if (card.face === "UP" && card.zone.zone === "LEGENDS" && state.timing.turn > 0 && state.timing.activePlayer === card.controllerId)
            result.push({ sourceId: id, subjectId: id, kind: modifier.kind, amount: modifier.amount * gear.length });
    }
    for (const m of state.temporaryModifiers ?? []) if (m.targetId === id && m.expires.turn === state.timing.turn && (card.zone.zone === "BATTLEFIELD" || (combatResolutionEnabled(context) && ["TRASH", "REMOVED"].includes(card.zone.zone))))
        result.push({ sourceId: m.sourceId, subjectId: id, kind: "TEMPORARY_POWER", amount: m.amount });
    return result;
}
/** Null remains Null; no base revision or cached instance power is mutated. */
export function effectivePower(state: GameState, id: CardInstanceId, context: EngineContext) {
    const revision = cardRevision(state, id, context);
    return !revision || revision.power === undefined ? null : revision.power + applicablePowerModifiers(state, id, context).reduce((sum, m) => sum + m.amount, 0);
}
