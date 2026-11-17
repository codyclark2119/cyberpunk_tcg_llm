import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function targetedSpendEnabled(context: EngineContext) { return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "targetedSpend"); }
/** Exact per-card pin table (Cody, 2026-11-15): complete printed shape and effect list per card. */
const TARGETED_SPEND_SHAPES = [
    // Corporate Surveillance.
    { type: "PROGRAM", colors: ["GREEN"], ram: { GREEN: 1 }, tags: ["Corpo"], cost: 2, sell: true, power: null,
        effects: [{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL", costAtMost: 4 } }] },
    // Batch V8: Offduty Malfini, "[Play] Spend this Unit and a rival Unit." (ordered: source, then the rival Unit).
    { type: "UNIT", colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Ganger", "Voodoo Boys"], cost: 4, sell: false, power: 5,
        effects: [{ kind: "SPEND_SOURCE" }, { kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL" } }] }
] as const;
/** This does not admit arbitrary spending cards or WHEN_SPENT. */
export function supportsTargetedSpendCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    if (!targetedSpendEnabled(context) || !turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "cardPlay") || !card?.provenance.reviewed || card.execution?.scope !== "TARGETED_SPEND_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard || a.conditions.length || a.cost.kind !== "NONE")
        return failure("UNSUPPORTED_TARGETED_SPEND", "Complete reviewed spend shape required");
    if (card.type === "UNIT" && !turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers")) return failure("UNSUPPORTED_TARGETED_SPEND", "A Unit PLAY spend requires the reviewed trigger policy");
    const actual = canonicalSerialize({ type: card.type, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, sell: card.sellProfile.allowed, power: card.power ?? null, effects: a.effects });
    if (!TARGETED_SPEND_SHAPES.some(shape => canonicalSerialize(shape) === actual))
        return failure("UNSUPPORTED_TARGETED_SPEND", "Entire reviewed metadata and spend shape required");
    return success(null);
}
function hasTargetedSpendMetadata(card: DeepReadonly<CardRevisionSnapshot>) { return card.execution?.scope === "TARGETED_SPEND_V1" || card.mechanics.abilities.some(a => a.effects.some(e => e.kind === "SPEND_UNIT" || e.kind === "SPEND_SOURCE")); }
export function validateTargetedSpendMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasTargetedSpendMetadata(r)) { const valid = supportsTargetedSpendCard(r, context); if (!valid.ok) return valid; }
    }
    return success(null);
}
