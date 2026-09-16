import { failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
export function restrictionsEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.combatRestrictions === "COMBAT_RESTRICTIONS_V1"; }
/** 11.23: printed [ADRENALINE] is executable only under the explicit reviewed ruleset policy. */
export function adrenalineEnabled(context: EngineContext) { return restrictionsEnabled(context) && context.content.ruleset.gameplay?.turnSlice?.adrenaline === "ADRENALINE_V1"; }
export function createsFightPrevention(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "CREATE_NEXT_RIVAL_FIGHT_PREVENTION")) ?? false;
}
/** Complete scoped shapes; explicit immutable reviewed revisions are still required per real card. */
export function supportsRestrictedPlay(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (!restrictionsEnabled(context) || !card || card.mechanics.abilities.some(a => a.inherited || a.guard) || !card.provenance.reviewed || card.execution?.scope !== "COMBAT_RESTRICTIONS_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount > 1000 || card.mechanics.equip || card.mechanics.modifiers.length)
        return failure("UNSUPPORTED_RESTRICTION_CARD", "Reviewed scope, numeric cost and full supported shape required");
    const m = card.mechanics, restrictions = m.restrictions ?? [];
    if (card.type === "UNIT" && card.power !== undefined && !m.abilities.length) {
        // Shared ordinary Unit shape, with no card-specific play/fight handlers.
        if (!m.keywords.length && !restrictions.length) return success(null);
        // Printed Adrenaline alone on the same ordinary shape; no other keyword, restriction or ability.
        if (m.keywords.length === 1 && m.keywords[0] === "ADRENALINE" && !restrictions.length && adrenalineEnabled(context)) return success(null);
        if (m.keywords.length === 1 && m.keywords[0] === "BLOCKER" && restrictions.length === 1 && restrictions[0].kind === "CANNOT_ATTACK") return success(null);
        if (!m.keywords.length && restrictions.length === 1 && restrictions[0].kind === "CANNOT_BE_BLOCKED" && restrictions[0].condition.kind === "STREET_CRED_LESS_THAN_RIVAL") return success(null);
    }
    const a = m.abilities[0];
    if (card.type === "PROGRAM" && card.power === undefined && card.printedCost.amount === 2 && !restrictions.length && m.keywords.length === 1 && m.keywords[0] === "QUICK" && m.abilities.length === 1 && a.trigger === "WHEN_PLAYED" && !a.activation && a.cost.kind === "NONE" && !a.conditions.length && a.effects.length === 1 && a.effects[0].kind === "CREATE_NEXT_RIVAL_FIGHT_PREVENTION") return success(null);
    return failure("UNSUPPORTED_RESTRICTION_CARD", "Only reviewed vanilla, policy-enabled Adrenaline, cannot-attack Blocker, conditional unblockability and next-fight prevention shapes are supported");
}
