import { failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function capabilitiesEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.gearCapabilities === "GEAR_CAPABILITIES_V1"; }
/** One complete reviewed Gear shape; this is not blanket admission of inherited keywords. */
export function supportsCapabilityGear(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const policy = context.content.ruleset.gameplay?.turnSlice;
    if (!capabilitiesEnabled(context) || policy?.gear !== "REVIEWED_GEAR_V1" || policy.react !== "COMBAT_REACT_V1" || !card || !card.provenance.reviewed || card.execution?.scope !== "GEAR_CAPABILITIES_V1" || card.execution.status !== "SUPPORTED" || card.type !== "GEAR" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 1 || card.power !== 0)
        return failure("UNSUPPORTED_CAPABILITY_GEAR", "Reviewed capability Gear scope, equip/React policies, printed cost 1 and printed power 0 required");
    const m = card.mechanics;
    if (m.equip?.kind !== "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" || m.keywords.length || m.abilities.length || m.restrictions?.length || m.modifiers.length !== 2 || m.modifiers.filter(x => x.kind === "GRANT_PRINTED_POWER_TO_HOST").length !== 1 || m.modifiers.filter(x => x.kind === "GRANT_KEYWORD_TO_HOST" && x.keyword === "BLOCKER").length !== 1)
        return failure("UNSUPPORTED_CAPABILITY_GEAR", "Complete equip, printed-power inheritance and inherited BLOCKER shape required, without omitted extra mechanics");
    return success(null);
}
/** Fail closed even when a malformed/old-policy inherited Gear is still in a hidden zone. */
export function validateCapabilityMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "GEAR_CAPABILITIES_V1" || r.mechanics.modifiers.some(m => m.kind === "GRANT_KEYWORD_TO_HOST"))) {
            const supported = supportsCapabilityGear(r, context); if (!supported.ok) return supported;
        }
    }
    return success(null);
}
