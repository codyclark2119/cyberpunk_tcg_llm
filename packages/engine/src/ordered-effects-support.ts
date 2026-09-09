import { supportsFirstAttackLegend } from "./first-attack-support";
import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function orderedEffectsEnabled(context: EngineContext) {
    return context.content.ruleset.gameplay?.turnSlice?.combatTriggers === "COMBAT_TRIGGERS_V1" && context.content.cards.some(c => c.execution?.scope === "ATTACK_ORDERED_EFFECTS_V1");
}
/** Complete reviewed shape. No name/slug dispatch, speculative selectors or partial ability admission. */
export function supportsOrderedAttackCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    const effects = [{ kind: "DRAW", count: 1 }, { kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" } } }];
    if (!orderedEffectsEnabled(context) || !card?.provenance.reviewed || card.execution?.scope !== "ATTACK_ORDERED_EFFECTS_V1" || card.execution.status !== "SUPPORTED" || card.type !== "UNIT" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 2 || card.power !== 0 || card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["BLUE"]) || canonicalSerialize(card.ram) !== canonicalSerialize({ BLUE: 3 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Doll"]) || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_ATTACKING" || a.activation || a.inherited || a.guard || a.conditions.length || a.cost.kind !== "NONE" || canonicalSerialize(a.effects) !== canonicalSerialize(effects))
        return failure("UNSUPPORTED_ORDERED_ATTACK", "Complete reviewed unsellable Blue RAM3 Doll, cost2 power0 and ordered ATTACK draw/conditional own-hand discard required");
    return success(null);
}
/** Both reviewed draw-then-discard abilities use the same two-primitive continuation. */
export function supportsOrderedTriggerSource(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) { return supportsOrderedAttackCard(card, context).ok || supportsFirstAttackLegend(card, context).ok; }
/** Inspect hidden content too: old execution scopes cannot silently ignore the new metadata. */
export function validateOrderedMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "ATTACK_ORDERED_EFFECTS_V1" || r.mechanics.abilities.some(a => a.conditions.some(c => c.kind === "STREET_CRED_GREATER_THAN_RIVAL") || a.effects.some(e => e.kind === "DISCARD_CARDS" || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "STREET_CRED_GREATER_THAN_RIVAL")))) {
            const supported = supportsOrderedAttackCard(r, context); if (!supported.ok && !supportsFirstAttackLegend(r, context).ok) return supported;
        }
    }
    return success(null);
}
