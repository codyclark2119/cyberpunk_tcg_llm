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
