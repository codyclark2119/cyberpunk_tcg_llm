import { attackingAuraEnabled, supportsAttackingAuraLegend } from "./attacking-aura-support";
import { supportsCapabilityGear } from "./capability-support";
import { supportsAttackPreventionUnit } from "./attack-prevention-support";
import type { CardInstanceId, GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { attachedGear, gearEnabled } from "./attachments";
export function cardRevision(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
}
/** Exact immutable classification value (3.13.1); Gear does not add classifications. */
export function hasClassification(state: GameState, id: CardInstanceId, classification: string, context: EngineContext) { return cardRevision(state, id, context)?.tags.includes(classification) ?? false; }
/** 4.2.1: field Legends are both types, independent of ordinary play versus Go Solo entry. */
export function effectiveCardTypes(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = cardRevision(state, id, context);
    return r ? [...new Set([r.type, ...(r.type === "LEGEND" && c.zone.zone === "BATTLEFIELD" ? ["UNIT" as const] : [])])] : [];
}
/** 9.3–9.5/9.29: a locked declared attack, through all pending/React/Fight/Steal stages until cleanup.
 * Target selection and historical non-executable combat vocabulary are not an active attack. */
export function isAttacking(state: GameState, id: CardInstanceId) { const c = state.timing.combat; return "target" in c && c.target !== null && c.attackerId === id; }
export type ApplicablePowerModifier = { sourceId: CardInstanceId; subjectId: CardInstanceId; kind: "GRANT_PRINTED_POWER_TO_HOST" | "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN" | "TEMPORARY_POWER" | "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER"; amount: number };
/** One shared derivation for printed Gear power, persistent host effects and temporary adjustments. */
export function applicablePowerModifiers(state: GameState, id: CardInstanceId, context: EngineContext): ApplicablePowerModifier[] {
    const card = state.objects.cards[id], revision = cardRevision(state, id, context);
    if (!card || !revision) return [];
    const result: ApplicablePowerModifier[] = [], gear = attachedGear(state, id, context);
    if (gearEnabled(context) && card.face === "UP" && ["BATTLEFIELD", "LEGENDS"].includes(card.zone.zone) && ["UNIT", "LEGEND"].includes(revision.type))
        for (const g of gear) result.push({ sourceId: g.id, subjectId: id, kind: "GRANT_PRINTED_POWER_TO_HOST", amount: cardRevision(state, g.id, context)?.power ?? 0 });
    for (const modifier of revision.mechanics.modifiers) {
        if (modifier.kind === "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER" && supportsAttackingAuraLegend(revision, context).ok) continue;
        if (modifier.kind === "GRANT_KEYWORD_TO_HOST" && supportsCapabilityGear(revision, context).ok) continue;
        if (modifier.kind === "RIVAL_LAGGING_UNITS_CANNOT_ATTACK" && supportsAttackPreventionUnit(revision, context).ok) continue;
        if (modifier.kind === "GRANT_PRINTED_POWER_TO_HOST" && revision.type === "GEAR" && gearEnabled(context)) continue;
        if (modifier.kind !== "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN") throw new Error("UNSUPPORTED_CONTINUOUS_MODIFIERS");
        if (card.face === "UP" && card.zone.zone === "LEGENDS" && state.timing.turn > 0 && state.timing.activePlayer === card.controllerId)
            result.push({ sourceId: id, subjectId: id, kind: modifier.kind, amount: modifier.amount * gear.length });
    }
    // Live source-controlled persistent contribution (10.22/10.23). Readiness and historical first
    // occurrences are deliberately unrelated. No stored aura targets, duration record or cleanup.
    if (attackingAuraEnabled(context) && isAttacking(state, id) && card.face === "UP" && card.zone.zone === "BATTLEFIELD" && card.zone.playerId === card.controllerId && effectiveCardTypes(state, id, context).includes("UNIT") && hasClassification(state, id, "Arasaka", context))
        for (const sourceId of [...state.players[card.controllerId].zones.LEGENDS].sort()) {
            const source = state.objects.cards[sourceId];
            if (source.face === "UP" && source.zone.zone === "LEGENDS" && source.zone.playerId === source.controllerId && source.controllerId === card.controllerId && supportsAttackingAuraLegend(cardRevision(state, sourceId, context), context).ok)
                result.push({ sourceId, subjectId: id, kind: "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount: 1 });
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
