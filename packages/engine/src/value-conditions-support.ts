import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function valueConditionsEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.valueConditions === "VALUE_CONDITIONS_V1"; }
/** Complete two-card admission; executable shapes, not names/slugs or an expression language. */
export function supportsValueConditionCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0], policy = context.content.ruleset.gameplay?.turnSlice;
    if (!valueConditionsEnabled(context) || policy?.cardPlay !== "NONCOMBAT_PLAY_V1" || policy.combatTriggers !== "COMBAT_TRIGGERS_V1" || context.content.ruleset.gameplay?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "VALUE_CONDITIONS_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard || a.conditions.length || a.cost.kind !== "NONE")
        return failure("UNSUPPORTED_VALUE_CONDITIONS", "Complete reviewed current-value Program/PLAY Unit shape and bounded policy required");
    const expected = card.type === "PROGRAM" ? { colors: ["RED"], ram: { RED: 1 }, tags: ["Arasaka", "Braindance"], cost: 1, sell: true, power: null,
        effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 4, direction: "INCREASE" }, { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE_AT_LEAST", minimum: 8 }, count: 1 }] }
        : card.type === "UNIT" ? { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Arasaka", "Corpo", "Techie"], cost: 3, sell: false, power: 2,
            effects: [{ kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "STREET_CRED_IS_EVEN" }, count: 1 }] } : null;
    if (!expected || canonicalSerialize(expected) !== canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, sell: card.sellProfile.allowed, power: card.power ?? null, effects: a.effects }))
        return failure("UNSUPPORTED_VALUE_CONDITIONS", "Entire reviewed Industrial/Field Operator metadata and ordered effects required");
    return success(null);
}
export function hasValueConditionMetadata(card: DeepReadonly<CardRevisionSnapshot>) {
    return card.execution?.scope === "VALUE_CONDITIONS_V1" || card.mechanics.abilities.some(a => a.conditions.some(c => c.kind === "STREET_CRED_IS_EVEN") || a.effects.some(e => e.kind === "ADJUST_GIG_UP_TO" && e.direction !== "DECREASE" && (e.maximum !== 1 || e.direction !== undefined) || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "STREET_CRED_IS_EVEN" || e.kind === "DISCARD_CARDS" && e.when?.condition.kind === "STREET_CRED_IS_EVEN"));
}
/** Hidden/unused physical sources also fail closed; no old-scope silent omission. */
export function validateValueConditionMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasValueConditionMetadata(r)) { const supported = supportsValueConditionCard(r, context); if (!supported.ok) return supported; }
    }
    return success(null);
}
