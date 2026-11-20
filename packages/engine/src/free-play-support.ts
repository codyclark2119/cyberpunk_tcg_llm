import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V48+: cards whose effect plays a Unit for free (11.11.4), each pinned whole. Anything not listed is absent. */
const FREE_PLAY_SHAPES = [
    // Batch V48: The Relic: Experimental Biochip. "{Defeated} Play another Unit with cost 9 or less from your trash for free.
    // Then, bottom-deck this Unit." A Gear: its host inherits the {Defeated} ability (11.23.3).
    { type: "GEAR", sell: true, power: 3, equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }],
        colors: ["YELLOW"], ram: { YELLOW: 4 }, tags: ["Arasaka", "Cyberware"], cost: 5,
        abilities: [{ trigger: "WHEN_DEFEATED", inherited: "EQUIPPED_HOST", guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
            effects: [{ kind: "PLAY_UNIT_FREE", from: "TRASH", maxCost: 9, exclude: "SUBJECT", then: "BOTTOM_DECK_SUBJECT" }] }] }
].map(shape => canonicalSerialize({ keywords: [], restrictions: [], ...shape }));
/** Any free play routes here first, so no other gate can admit what it does not read. */
export function hasFreePlayEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "PLAY_UNIT_FREE")));
}
export function supportsFreePlayCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !turnSliceAllows(g?.turnSlice, "gear") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !FREE_PLAY_SHAPES.includes(canonicalSerialize({ keywords: m.keywords, restrictions: m.restrictions ?? [], type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, equip: m.equip ?? null, modifiers: m.modifiers,
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_FREE_PLAY", "Complete reviewed printed card with an exact free Unit play required");
    return success(null);
}
