import { supportsFieldLegend } from "./field-legend-support";
import { CardInstanceIdSchema, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function endTurnEnabled(context: EngineContext) {
    return context.content.ruleset.gameplay?.turnSlice?.combatTriggers === "COMBAT_TRIGGERS_V1" && context.content.cards.some(c => c.execution?.scope === "END_TURN_HISTORY_V1");
}
/** Full captured ordinary Unit plus its one conditional own-turn end effect. */
export function supportsEndTurnCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    if (!endTurnEnabled(context) || !card?.provenance.reviewed || card.execution?.scope !== "END_TURN_HISTORY_V1" || card.execution.status !== "SUPPORTED" || card.type !== "UNIT" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 4 || card.power !== 4 || card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["BLUE"]) || canonicalSerialize(card.ram) !== canonicalSerialize({ BLUE: 2 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Vehicle"]) || card.keywords.length || !m || m.equip || m.modifiers.length || m.keywords.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_OWN_TURN_ENDS" || a.inherited || a.activation || a.guard || a.cost.kind !== "NONE" || canonicalSerialize(a.conditions) !== canonicalSerialize([{ kind: "SUBJECT_STOLE_GIG_THIS_TURN" }]) || canonicalSerialize(a.effects) !== canonicalSerialize([{ kind: "READY_EDDIES", player: "CONTROLLER", count: 1 }]))
        return failure("UNSUPPORTED_END_TURN_CARD", "Complete reviewed unsellable Blue RAM2 Vehicle, cost4 power4 and own-turn end / this-Unit steal / ready1 shape required");
    return success(null);
}
export function validateEndTurnMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "END_TURN_HISTORY_V1" || r.mechanics.abilities.some(a => a.trigger === "WHEN_OWN_TURN_ENDS" || a.conditions.some(c => c.kind === "SUBJECT_STOLE_GIG_THIS_TURN") || a.effects.some(e => e.kind === "READY_EDDIES" || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "SUBJECT_STOLE_GIG_THIS_TURN" || e.kind === "DISCARD_CARDS" && e.when?.condition.kind === "SUBJECT_STOLE_GIG_THIS_TURN")))) {
            const supported = supportsEndTurnCard(r, context); if (!supported.ok) return supported;
        }
    }
    const history = state.turnHistory?.gigsStolenByUnit;
    if (history && (!endTurnEnabled(context) || !Object.keys(history).length || Object.entries(history).some(([id, count]) => {
        const c = state.objects.cards[CardInstanceIdSchema.parse(id)], r = c && context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        return !c || (r?.type !== "UNIT" && !supportsFieldLegend(r, context).ok) || count > Object.keys(state.objects.gigs).length;
    }))) return failure("INVALID_STEAL_HISTORY", "Nonempty supported per-Unit actual-steal counts and existing physical Unit references required");
    return success(null);
}
