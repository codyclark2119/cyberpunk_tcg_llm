import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
export function restrictionsEnabled(context: EngineContext) { return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatRestrictions"); }
/** 11.23: printed [ADRENALINE] is executable only under the explicit reviewed ruleset policy. */
export function adrenalineEnabled(context: EngineContext) { return restrictionsEnabled(context) && turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "adrenaline"); }
/** 9.3.2.3: printed target-class restrictions execute only under the explicit reviewed policy. */
export function attackTargetRestrictionsEnabled(context: EngineContext) { return restrictionsEnabled(context) && turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "attackTargetRestrictions"); }
/** Batch V10: Program-play turn history exists only with the trigger history it extends. */
export function programPlayHistoryEnabled(context: EngineContext) { const p = context.content.ruleset.gameplay?.turnSlice; return restrictionsEnabled(context) && turnSliceAllows(p, "combatTriggers") && turnSliceAllows(p, "programPlayHistory"); }
/** Exact per-card pins (Cody, 2026-11-15) for Units whose only printed text is a conditional attack ban. */
const CONDITIONAL_ATTACK_BAN_SHAPES = [
    // Batch V10: Jacked-in Voodoo Boy, "This Unit can't attack unless you played a Program this turn."
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Netrunner", "Voodoo Boys"], cost: 2, power: 2, sell: false, restrictions: [{ kind: "CANNOT_ATTACK_UNLESS_PROGRAM_PLAYED_THIS_TURN" }] }
] as const;
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
        // Printed Gig-area target restriction alone on the same ordinary shape; it never bans attacking outright.
        if (!m.keywords.length && restrictions.length === 1 && restrictions[0].kind === "CANNOT_ATTACK_GIG_AREA" && attackTargetRestrictionsEnabled(context)) return success(null);
        if (m.keywords.length === 1 && m.keywords[0] === "BLOCKER" && restrictions.length === 1 && restrictions[0].kind === "CANNOT_ATTACK") return success(null);
        if (!m.keywords.length && restrictions.length === 1 && restrictions[0].kind === "CANNOT_BE_BLOCKED" && restrictions[0].condition.kind === "STREET_CRED_LESS_THAN_RIVAL") return success(null);
        if (!m.keywords.length && !card.keywords.length && restrictions.some(x => x.kind === "CANNOT_ATTACK_UNLESS_PROGRAM_PLAYED_THIS_TURN")) {
            const actual = canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power, sell: card.sellProfile.allowed, restrictions });
            if (programPlayHistoryEnabled(context) && CONDITIONAL_ATTACK_BAN_SHAPES.some(shape => canonicalSerialize(shape) === actual)) return success(null);
        }
    }
    const a = m.abilities[0];
    if (card.type === "PROGRAM" && card.power === undefined && card.printedCost.amount === 2 && !restrictions.length && m.keywords.length === 1 && m.keywords[0] === "QUICK" && m.abilities.length === 1 && a.trigger === "WHEN_PLAYED" && !a.activation && a.cost.kind === "NONE" && !a.conditions.length && a.effects.length === 1 && a.effects[0].kind === "CREATE_NEXT_RIVAL_FIGHT_PREVENTION") return success(null);
    return failure("UNSUPPORTED_RESTRICTION_CARD", "Only reviewed vanilla, policy-enabled Adrenaline and Gig-area target restriction, cannot-attack Blocker, conditional unblockability and next-fight prevention shapes are supported");
}
