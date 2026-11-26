import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V89+: Gears with a replacement of their host's defeat (10.24-10.29), each pinned whole. Anything not listed is absent. */
const DEFEAT_REPLACEMENT_GEAR_SHAPES = [
    // Batch V89: Deadman Transmitter. "(Equip to a friendly Unit or face-up Legend.) If this Unit would be defeated, defeat its
    // "DEADMAN TRANSMITTER" instead."
    { colors: ["RED"], ram: { RED: 3 }, tags: ["Cyberware", "Trauma Team"], cost: 3, power: 1,
        modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "DEFEAT_THIS_GEAR_INSTEAD_OF_HOST" }] }
].map(shape => canonicalSerialize({ type: "GEAR", sell: true, keywords: [], abilities: [], restrictions: [], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, ...shape }));
/** Any host-defeat replacement routes here first, so no other gate can admit what it does not read. */
export function hasDefeatReplacement(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(m => m.kind === "DEFEAT_THIS_GEAR_INSTEAD_OF_HOST"));
}
export function supportsDefeatReplacementGear(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "cardPlay") || !turnSliceAllows(p, "gear") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "combatResolution") || !turnSliceAllows(p, "combatTriggers")
        || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m
        || !DEFEAT_REPLACEMENT_GEAR_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, abilities: m.abilities, restrictions: m.restrictions ?? [], equip: m.equip ?? null,
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, modifiers: m.modifiers })))
        return failure("UNSUPPORTED_DEFEAT_REPLACEMENT", "Complete reviewed Gear with an exact host-defeat replacement required");
    return success(null);
}
/** Batch V100+: Go Solo Legends with an optional, paid replacement of a friendly Unit's defeat by their own, each pinned whole. */
const DEFEAT_REPLACEMENT_LEGEND_SHAPES = [
    // Batch V100: Jackie Welles: Mama's Favorite. "[Go Solo] If a friendly Unit would be defeated, you may spend 1 €$ to defeat this
    // Legend instead. (Remove it from the game.)"
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Merc"], cost: 6, power: 8,
        modifiers: [{ kind: "MAY_SPEND_TO_DEFEAT_THIS_LEGEND_INSTEAD_OF_FRIENDLY_UNIT", cost: 1 }] }
].map(shape => canonicalSerialize({ type: "LEGEND", sell: true, keywords: ["GO_SOLO"], abilities: [], restrictions: [], equip: null, ...shape }));
/** Any Legend replacement of a friendly Unit's defeat routes here first. */
export function hasLegendDefeatReplacement(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(m => m.kind === "MAY_SPEND_TO_DEFEAT_THIS_LEGEND_INSTEAD_OF_FRIENDLY_UNIT"));
}
export function supportsDefeatReplacementLegend(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "cardPlay") || !turnSliceAllows(p, "fieldLegends") || !turnSliceAllows(p, "gear") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "react") || !turnSliceAllows(p, "combatResolution") || !turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "targetedDefeat")
        || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m
        || !DEFEAT_REPLACEMENT_LEGEND_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, abilities: m.abilities, restrictions: m.restrictions ?? [], equip: m.equip ?? null,
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, modifiers: m.modifiers })))
        return failure("UNSUPPORTED_DEFEAT_REPLACEMENT", "Complete reviewed Go Solo Legend with an exact paid friendly-Unit defeat replacement required");
    return success(null);
}
