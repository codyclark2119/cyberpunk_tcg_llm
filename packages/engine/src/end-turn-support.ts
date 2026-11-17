import { supportsFieldLegend } from "./field-legend-support";
import { turnSliceAllows, CardInstanceIdSchema, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function endTurnEnabled(context: EngineContext) {
    return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") && context.content.cards.some(c => c.execution?.scope === "END_TURN_HISTORY_V1");
}
/** Exact per-card pin table (Cody, 2026-11-15): complete printed shape, condition and effect list per card. */
const END_TURN_SHAPES = [
    // Delamain Cab: if this Unit stole a Gig this turn, ready 1 Eddie.
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Vehicle"], cost: 4, power: 4, conditions: [{ kind: "SUBJECT_STOLE_GIG_THIS_TURN" }], effects: [{ kind: "READY_EDDIES", player: "CONTROLLER", count: 1 }] },
    // Batch V8: Modded Muramasa, if you have less Street Cred than a Rival, ready this Unit.
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Vehicle"], cost: 5, power: 4, conditions: [{ kind: "STREET_CRED_LESS_THAN_RIVAL" }], effects: [{ kind: "READY_UNIT", target: { kind: "SOURCE" } }] },
    // Batch V8: MaxTac Squadron, if this Unit is spent, ready a friendly face-up Legend.
    { colors: ["GREEN"], ram: { GREEN: 3 }, tags: ["NCPD"], cost: 3, power: 4, conditions: [{ kind: "SUBJECT_IS_SPENT" }], effects: [{ kind: "READY_UNIT", target: { kind: "FRIENDLY_FACE_UP_LEGEND" } }] }
] as const;
/** Full captured ordinary unsellable Unit plus its one conditional own-turn end effect. */
export function supportsEndTurnCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    if (!endTurnEnabled(context) || !card?.provenance.reviewed || card.execution?.scope !== "END_TURN_HISTORY_V1" || card.execution.status !== "SUPPORTED" || card.type !== "UNIT" || card.printedCost.kind !== "EDDIES" || card.sellProfile.allowed || card.keywords.length || !m || m.equip || m.modifiers.length || m.keywords.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_OWN_TURN_ENDS" || a.inherited || a.activation || a.guard || a.cost.kind !== "NONE")
        return failure("UNSUPPORTED_END_TURN_CARD", "Complete reviewed unsellable Unit with one own-turn end ability required");
    const actual = canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, conditions: a.conditions, effects: a.effects });
    if (!END_TURN_SHAPES.some(shape => canonicalSerialize(shape) === actual))
        return failure("UNSUPPORTED_END_TURN_CARD", "Entire reviewed metadata, condition and effect shape required");
    return success(null);
}
export function validateEndTurnMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "END_TURN_HISTORY_V1" || r.mechanics.abilities.some(a => a.trigger === "WHEN_OWN_TURN_ENDS" || a.conditions.some(c => c.kind === "SUBJECT_STOLE_GIG_THIS_TURN" || c.kind === "SUBJECT_IS_SPENT") || a.effects.some(e => e.kind === "READY_EDDIES" || e.kind === "READY_UNIT" || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "SUBJECT_STOLE_GIG_THIS_TURN" || e.kind === "DISCARD_CARDS" && e.when?.condition.kind === "SUBJECT_STOLE_GIG_THIS_TURN")))) {
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
