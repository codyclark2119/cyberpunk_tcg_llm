import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function targetedSpendEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.targetedSpend === "TARGETED_SPEND_V1"; }
/** Full captured Program shape. This does not admit arbitrary spending cards or WHEN_SPENT. */
export function supportsTargetedSpendCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    if (!targetedSpendEnabled(context) || context.content.ruleset.gameplay?.turnSlice?.cardPlay !== "NONCOMBAT_PLAY_V1" || !card?.provenance.reviewed || card.execution?.scope !== "TARGETED_SPEND_V1" || card.execution.status !== "SUPPORTED" || card.type !== "PROGRAM" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 2 || card.power !== undefined || !card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["GREEN"]) || canonicalSerialize(card.ram) !== canonicalSerialize({ GREEN: 1 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Corpo"]) || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard || a.conditions.length || a.cost.kind !== "NONE" || canonicalSerialize(a.effects) !== canonicalSerialize([{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL", costAtMost: 4 } }]))
        return failure("UNSUPPORTED_TARGETED_SPEND", "Complete reviewed Green RAM1 cost2 Program and rival Unit cost<=4 spend shape required");
    return success(null);
}
export function hasTargetedSpendMetadata(card: DeepReadonly<CardRevisionSnapshot>) { return card.execution?.scope === "TARGETED_SPEND_V1" || card.mechanics.abilities.some(a => a.effects.some(e => e.kind === "SPEND_UNIT")); }
export function validateTargetedSpendMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasTargetedSpendMetadata(r)) { const valid = supportsTargetedSpendCard(r, context); if (!valid.ok) return valid; }
    }
    return success(null);
}
