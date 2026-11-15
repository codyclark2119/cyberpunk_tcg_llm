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
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" }, readiness: "SPENT" } }] }
] as const;
/** Complete per-card shapes; no source-name dispatch or arbitrary filter/defeat admission. */
export function supportsTargetedDefeatCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0], p = context.content.ruleset.gameplay?.turnSlice;
    if (!targetedDefeatEnabled(context) || !combatResolutionEnabled(context) || !turnSliceAllows(p, "cardPlay") || !turnSliceAllows(p, "combatTriggers") || context.content.ruleset.gameplay?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "TARGETED_DEFEAT_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard || a.conditions.length || a.cost.kind !== "NONE")
        return failure("UNSUPPORTED_TARGETED_DEFEAT", "Complete reviewed Unit/Program shape and semantic defeat policy required");
    const actual = canonicalSerialize({ type: card.type, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, sell: card.sellProfile.allowed, power: card.power ?? null, effects: a.effects });
    if (!TARGETED_DEFEAT_SHAPES.some(shape => canonicalSerialize(shape) === actual))
        return failure("UNSUPPORTED_TARGETED_DEFEAT", "Entire reviewed metadata, condition and distinct target/power shape required");
    return success(null);
}
// Owns TARGETED_DEFEAT_V1 and Unit-target defeat effects only. The Gear scope and Gear-target
// effects are owned by validateTargetedGearDefeatMetadata, which validateState registers alongside
// this one; a mixed card is claimed by both detectors and must satisfy both complete gates.
export function hasTargetedDefeatMetadata(card: DeepReadonly<CardRevisionSnapshot>) { return card.execution?.scope === "TARGETED_DEFEAT_V1" || card.mechanics.abilities.some(a => a.effects.some(e => e.kind === "DEFEAT_UNIT" && e.target.kind === "UNITS")); }
export function validateTargetedDefeatMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) { const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision); if (r && hasTargetedDefeatMetadata(r)) { const v = supportsTargetedDefeatCard(r, context); if (!v.ok) return v; } }
    return success(null);
}
