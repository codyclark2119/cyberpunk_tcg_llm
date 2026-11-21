import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function capabilitiesEnabled(context: EngineContext) { return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "gearCapabilities"); }
/** Batch V39+: Gears whose host keyword depends on a live condition, each pinned whole. */
const CONDITIONAL_KEYWORD_GEAR_SHAPES = [
    // Batch V39: Adrenaline Converter. "(Equip to a friendly Unit or face-up Legend.) If a Rival controls at least 2 more Gigs than you,
    // this Unit has [Adrenaline]."
    { colors: ["YELLOW"], ram: { YELLOW: 4 }, tags: ["Cyberware", "Medtech"], cost: 2, power: 3,
        modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "GRANT_KEYWORD_TO_HOST_IF", keyword: "ADRENALINE", condition: { kind: "RIVAL_CONTROLS_MORE_GIGS", minimum: 2 } }] }
].map(shape => canonicalSerialize({ type: "GEAR", sell: true, keywords: [], abilities: [], restrictions: [], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, ...shape }));
/** Batch V56+: Blocker Gears that also tax a Rival's {Go Solo}, each pinned whole. */
const GO_SOLO_TAX_GEAR_SHAPES = [
    // Batch V56: Riot Shield. "(Equip to a friendly Unit or face-up Legend.) {Blocker} Rivals must pay +2 €$ to use {Go Solo}."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Weapon"], cost: 2, power: 1,
        modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "GRANT_KEYWORD_TO_HOST", keyword: "BLOCKER" }, { kind: "RIVAL_GO_SOLO_COST_INCREASE", amount: 2 }] }
].map(shape => canonicalSerialize({ type: "GEAR", sell: true, keywords: [], abilities: [], restrictions: [], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, ...shape }));
export function hasGoSoloTax(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(m => m.kind === "RIVAL_GO_SOLO_COST_INCREASE"));
}
export function hasConditionalKeywordGrant(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(m => m.kind === "GRANT_KEYWORD_TO_HOST_IF"));
}
/** One complete reviewed Gear shape; this is not blanket admission of inherited keywords. */
export function supportsCapabilityGear(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const policy = context.content.ruleset.gameplay?.turnSlice;
    if (hasGoSoloTax(card)) {
        const m = card!.mechanics;
        if (!capabilitiesEnabled(context) || !turnSliceAllows(policy, "gear") || !turnSliceAllows(policy, "react") || !turnSliceAllows(policy, "fieldLegends") || !card!.provenance.reviewed || card!.execution?.scope !== "GEAR_CAPABILITIES_V1" || card!.execution.status !== "SUPPORTED" || card!.printedCost.kind !== "EDDIES" || card!.keywords.length
            || !GO_SOLO_TAX_GEAR_SHAPES.includes(canonicalSerialize({ type: card!.type, sell: card!.sellProfile.allowed, keywords: m.keywords, abilities: m.abilities, restrictions: m.restrictions ?? [], equip: m.equip ?? null,
                colors: card!.colors, ram: card!.ram, tags: card!.tags, cost: card!.printedCost.amount, power: card!.power ?? null, modifiers: m.modifiers })))
            return failure("UNSUPPORTED_CAPABILITY_GEAR", "Complete reviewed Gear with an exact Blocker grant and Go Solo tax required");
        return success(null);
    }
    if (hasConditionalKeywordGrant(card)) {
        const m = card!.mechanics;
        if (!capabilitiesEnabled(context) || !turnSliceAllows(policy, "gear") || !turnSliceAllows(policy, "adrenaline") || !card!.provenance.reviewed || card!.execution?.scope !== "GEAR_CAPABILITIES_V1" || card!.execution.status !== "SUPPORTED" || card!.printedCost.kind !== "EDDIES" || card!.keywords.length
            || !CONDITIONAL_KEYWORD_GEAR_SHAPES.includes(canonicalSerialize({ type: card!.type, sell: card!.sellProfile.allowed, keywords: m.keywords, abilities: m.abilities, restrictions: m.restrictions ?? [], equip: m.equip ?? null,
                colors: card!.colors, ram: card!.ram, tags: card!.tags, cost: card!.printedCost.amount, power: card!.power ?? null, modifiers: m.modifiers })))
            return failure("UNSUPPORTED_CAPABILITY_GEAR", "Complete reviewed Gear with an exact conditional host keyword required");
        return success(null);
    }
    if (!capabilitiesEnabled(context) || !turnSliceAllows(policy, "gear") || !turnSliceAllows(policy, "react") || !card || !card.provenance.reviewed || card.execution?.scope !== "GEAR_CAPABILITIES_V1" || card.execution.status !== "SUPPORTED" || card.type !== "GEAR" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 1 || card.power !== 0)
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
        if (r && (r.execution?.scope === "GEAR_CAPABILITIES_V1" || r.mechanics.modifiers.some(m => m.kind === "GRANT_KEYWORD_TO_HOST" || m.kind === "GRANT_KEYWORD_TO_HOST_IF" || m.kind === "RIVAL_GO_SOLO_COST_INCREASE"))) {
            const supported = supportsCapabilityGear(r, context); if (!supported.ok) return supported;
        }
    }
    return success(null);
}
