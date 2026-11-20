import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled } from "./combat-resolution-policy";
export function targetedDefeatEnabled(context: EngineContext) { return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "targetedDefeat"); }
/** Exact per-card pin table (Cody, 2026-11-15): each admitted card's complete printed shape and
 * effect list, literally. A new card is admitted only by adding its whole entry here. */
const TARGETED_DEFEAT_SHAPES = [
    // Minotaur (targeted-defeat fixture).
    { type: "UNIT", colors: ["RED"], ram: { RED: 2 }, tags: ["Arasaka", "Drone", "Militech"], cost: 7, sell: false, power: 9,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 5 } }, when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" } } }] },
    // Over the Edge (targeted-defeat fixture).
    { type: "PROGRAM", colors: ["RED"], ram: { RED: 2 }, tags: ["Merc"], cost: 3, sell: true, power: null,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "CONTROLLED_GIG_VALUE", dieType: "D20" } } }] },
    // Batch V7: Royce: Don't Call Me Simon.
    { type: "UNIT", colors: ["RED"], ram: { RED: 2 }, tags: ["Ganger", "Maelstrom"], cost: 5, sell: false, power: 4,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 }, instead: { condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" }, power: { kind: "AT_MOST", value: 3 } } } }] },
    // Batch V7: Wild in the Streets.
    { type: "PROGRAM", colors: ["GREEN"], ram: { GREEN: 4 }, tags: ["Ganger"], cost: 5, sell: true, power: null,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" }, readiness: "SPENT" } }] },
    // Batch V9: Don't Fear the Reaper, spend all rival Units, then defeat a spent Unit.
    { type: "PROGRAM", colors: ["GREEN"], ram: { GREEN: 3 }, tags: ["Samurai"], cost: 7, sell: true, power: null,
        effects: [{ kind: "SPEND_ALL_UNITS", relation: "RIVAL" }, { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" }, readiness: "SPENT" } }] },
    // Batch V10: Adam Smasher: Metal Over Meat, {Play} defeat all other Units.
    { type: "UNIT", colors: ["YELLOW"], ram: { YELLOW: 6 }, tags: ["Arasaka", "Merc"], cost: 9, sell: false, power: 15,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" }, all: "OTHER_THAN_SOURCE" } }] },
    // Batch V12: Bonnie and Clyde, a rival Unit with power 4 or less; optionally a second while a Rival leads by 2+ Gigs.
    { type: "PROGRAM", colors: ["RED"], ram: { RED: 3 }, tags: ["Braindance"], cost: 3, sell: true, power: null,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 4 }, second: { condition: { kind: "RIVAL_GIG_COUNT_LEAD_AT_LEAST", minimum: 2 } } } }] },
    // Batch V12: Live with the Aftermath, each player defeats one of their own Units.
    { type: "PROGRAM", colors: ["YELLOW"], ram: { YELLOW: 3 }, tags: ["Plan"], cost: 3, sell: true, power: null,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "CONTROLLED", power: { kind: "ANY" }, each: "PLAYER_CHOOSES_OWN" } }] },
    // Batch V16: Carnage at the Colosseum, -1 per friendly Gig of 8+ (min 1); a rival Unit weaker than a friendly Unit.
    { type: "PROGRAM", colors: ["RED"], ram: { RED: 3 }, tags: ["Braindance", "Extreme"], cost: 6, sell: true, power: null,
        modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per: "FRIENDLY_GIG_VALUE_AT_LEAST_8", amount: 1, minimum: 1 }],
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "LESS_THAN_FRIENDLY_UNIT" } } }] },
    // Batch V18: Adam Smasher: Ender of Legends, a printed Go Solo Legend whose {Play} defeats a rival Unit (11.24.2, 11.29.1).
    { type: "LEGEND", colors: ["RED"], ram: { RED: 2 }, tags: ["Arasaka", "Merc"], cost: 9, sell: true, power: 9, keywords: ["GO_SOLO"],
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" } } }] },
    // Batch V46: Safety Override. "{Quick} The next time a friendly Unit loses a fight this turn, defeat the opposing rival Unit."
    { type: "PROGRAM", colors: ["YELLOW"], ram: { YELLOW: 3 }, tags: ["Quickhack"], cost: 2, sell: true, power: null, keywords: ["QUICK"],
        effects: [{ kind: "REGISTER_NEXT_FIGHT_OUTCOME", on: "FRIENDLY_UNIT_LOSES", effect: { kind: "DEFEAT_UNIT", target: { kind: "OPPOSING_UNIT" } } }] }
].map(shape => canonicalSerialize({ modifiers: [], keywords: [], ...shape }));
/** A multi-ability defeat card as pinned: every ability whole, in printed order; anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
const WHOLE_DEFEAT_SHAPES = [
    // Batch V31: Caliber: Totentanz's Top Dog. "{Play} Defeat a rival Unit with cost 2 or less. {Defeated} A Rival discards 1. If the
    // card's cost equals the value of a friendly Gig, that Rival discards 1 more."
    { type: "UNIT", colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Ganger", "Maelstrom"], cost: 5, sell: false, power: 5, abilities: [
        ability({ trigger: "WHEN_PLAYED", effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, cost: { kind: "AT_MOST", value: 2 } } }] }),
        ability({ trigger: "WHEN_DEFEATED", effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", more: { condition: { kind: "DISCARDED_COST_EQUALS_FRIENDLY_GIG_VALUE" }, count: 1 } }] })] }
].map(shape => canonicalSerialize({ keywords: [], modifiers: [], equip: null, restrictions: [], ...shape }));
/** Complete per-card shapes; no source-name dispatch or arbitrary filter/defeat admission. */
export function supportsTargetedDefeatCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0], p = context.content.ruleset.gameplay?.turnSlice;
    // Batch V31: a defeat card with more than one ability is admitted only by its whole pinned ability list.
    if (card && m && m.abilities.length > 1) {
        if (!targetedDefeatEnabled(context) || !combatResolutionEnabled(context) || !turnSliceAllows(p, "cardPlay") || !turnSliceAllows(p, "combatTriggers") || context.content.ruleset.gameplay?.gigValueBounds !== "DIE_FACES_V1" || !card.provenance.reviewed || card.execution?.scope !== "TARGETED_DEFEAT_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length
            || !WHOLE_DEFEAT_SHAPES.includes(canonicalSerialize({ type: card.type, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, modifiers: m.modifiers, equip: m.equip ?? null, restrictions: m.restrictions ?? [],
                abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
            return failure("UNSUPPORTED_TARGETED_DEFEAT", "Entire reviewed multi-ability defeat shape required");
        return success(null);
    }
    if (!targetedDefeatEnabled(context) || !combatResolutionEnabled(context) || !turnSliceAllows(p, "cardPlay") || !turnSliceAllows(p, "combatTriggers") || context.content.ruleset.gameplay?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "TARGETED_DEFEAT_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length || !m || m.equip || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard || a.conditions.length || a.cost.kind !== "NONE")
        return failure("UNSUPPORTED_TARGETED_DEFEAT", "Complete reviewed Unit/Program shape and semantic defeat policy required");
    const actual = canonicalSerialize({ type: card.type, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, modifiers: m.modifiers, effects: a.effects });
    if (!TARGETED_DEFEAT_SHAPES.includes(actual))
        return failure("UNSUPPORTED_TARGETED_DEFEAT", "Entire reviewed metadata, condition and distinct target/power shape required");
    return success(null);
}
// Owns TARGETED_DEFEAT_V1 and Unit-target defeat effects only. The Gear scope and Gear-target
// effects are owned by validateTargetedGearDefeatMetadata, which validateState registers alongside
// this one; a mixed card is claimed by both detectors and must satisfy both complete gates.
export function hasTargetedDefeatMetadata(card: DeepReadonly<CardRevisionSnapshot>) { return card.execution?.scope === "TARGETED_DEFEAT_V1" || card.mechanics.abilities.some(a => a.effects.some(e => e.kind === "DEFEAT_UNIT" && e.target.kind !== "GEAR" || e.kind === "SPEND_ALL_UNITS" || e.kind === "REGISTER_NEXT_FIGHT_OUTCOME")); }
export function validateTargetedDefeatMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) { const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision); if (r && hasTargetedDefeatMetadata(r)) { const v = supportsTargetedDefeatCard(r, context); if (!v.ok) return v; } }
    return success(null);
}
