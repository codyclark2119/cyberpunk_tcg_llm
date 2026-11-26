import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V48+: cards whose effect plays a Unit (Batch V68: or a Gear; Batch V97: or a Program) for free (11.11.4), each pinned whole (Batch V50: with its first-ARASAKA-defeat
 * draw). Anything not listed is absent. */
const FREE_PLAY_SHAPES = [
    // Batch V48: The Relic: Experimental Biochip. "{Defeated} Play another Unit with cost 9 or less from your trash for free.
    // Then, bottom-deck this Unit." A Gear: its host inherits the {Defeated} ability (11.23.3).
    { type: "GEAR", sell: true, power: 3, equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }],
        colors: ["YELLOW"], ram: { YELLOW: 4 }, tags: ["Arasaka", "Cyberware"], cost: 5,
        abilities: [{ trigger: "WHEN_DEFEATED", inherited: "EQUIPPED_HOST", guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
            effects: [{ kind: "PLAY_UNIT_FREE", from: "TRASH", maxCost: 9, exclude: "SUBJECT", then: "BOTTOM_DECK_SUBJECT" }] }] },
    // Batch V50: Yorinobu Arasaka: Steel Dragon. "{Play} You may play a Unit with cost 4 or less from your hand or trash for free.
    // It can attack rival Units this turn. The first time an ARASAKA Unit is defeated each turn, draw 1."
    { type: "UNIT", sell: false, power: 9, equip: null, modifiers: [], colors: ["RED"], ram: { RED: 3 }, tags: ["Arasaka", "Corpo"], cost: 7,
        abilities: [
            { trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "PLAY_UNIT_FREE", from: "HAND_OR_TRASH", maxCost: 4, optional: true, grant: "ATTACK_RIVAL_UNITS_THIS_TURN" }] },
            { trigger: "WHEN_UNIT_DEFEATED", inherited: null, guard: "FIRST_ARASAKA_UNIT_DEFEAT_PER_TURN", activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "DRAW", count: 1 }] }] },
    // Batch V68: Viktor Vektor: You Might Feel a Little Pinch. "{Play} Play a CYBERWARE Gear with cost 2 or less from your trash for
    // free. Equip it only to another friendly Unit."
    { type: "UNIT", sell: false, power: 3, equip: null, modifiers: [], colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Ripperdoc"], cost: 3,
        abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
            effects: [{ kind: "PLAY_GEAR_FREE", from: "TRASH", maxCost: 2, tag: "Cyberware", host: "ANOTHER_FRIENDLY_UNIT" }] }] },
    // Batch V97: Lizzy Wizzy: Delicate Weapon. "{Play} You may play a Program with cost 3 or less from your hand or trash for free.
    // Bottom-deck it after you play it. {Blocker}"
    { type: "UNIT", sell: false, power: 2, equip: null, modifiers: [], keywords: ["BLOCKER"], colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Rocker"], cost: 5,
        abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
            effects: [{ kind: "MAY_PLAY_PROGRAM_FREE_FROM_HAND_OR_TRASH_THEN_BOTTOM_DECK", maxCost: 3 }] }] }
].map(shape => canonicalSerialize({ keywords: [], restrictions: [], ...shape }));
/** Any free play routes here first, so no other gate can admit what it does not read. */
export function hasFreePlayEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.trigger === "WHEN_UNIT_DEFEATED" || a.guard === "FIRST_ARASAKA_UNIT_DEFEAT_PER_TURN" || a.effects.some(e => e.kind === "PLAY_UNIT_FREE" || e.kind === "PLAY_GEAR_FREE" || e.kind === "MAY_PLAY_PROGRAM_FREE_FROM_HAND_OR_TRASH_THEN_BOTTOM_DECK")));
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
