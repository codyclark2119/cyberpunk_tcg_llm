import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";

/** Dependency review only. The foundation slice does NOT enable a Gear gameplay handler. */
export function targetedGearDefeatPolicyComplete(context: EngineContext) {
    const gameplay = context.content.ruleset.gameplay, p = gameplay?.turnSlice;
    return gameplay?.gigValueBounds === "DIE_FACES_V1"
        && turnSliceAllows(p, "targetedGearDefeat")
        && turnSliceAllows(p, "targetedDefeat")
        && turnSliceAllows(p, "cardPlay")
        && turnSliceAllows(p, "gear")
        && turnSliceAllows(p, "combat")
        && turnSliceAllows(p, "react")
        && turnSliceAllows(p, "combatTriggers")
        && turnSliceAllows(p, "combatResolution")
        && turnSliceAllows(p, "callEffects");
}
export function hasTargetedGearDefeatMetadata(card: DeepReadonly<CardRevisionSnapshot>) {
    return card.execution?.scope === "TARGETED_GEAR_DEFEAT_V1"
        || card.mechanics.abilities.some(a => a.effects.some(e => e.kind === "DEFEAT_UNIT" && e.target.kind === "GEAR"));
}
/** Shape review, NOT execution support. Do not delegate supportsPlay/React here before lifecycle validation lands.
 * Source names and text are deliberately not inspected. Tests use a synthetic probe, not an admitted real revision.
 */
export function reviewTargetedGearDefeatShape(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (!targetedGearDefeatPolicyComplete(context) || !card || !card.provenance.reviewed
        || card.execution?.scope !== "TARGETED_GEAR_DEFEAT_V1" || card.execution.status !== "SUPPORTED"
        || card.type !== "PROGRAM" || card.power !== undefined || card.printedCost.kind !== "EDDIES"
        || card.keywords.length)
        return failure("UNSUPPORTED_TARGETED_GEAR_DEFEAT_SHAPE", "Complete reviewed Program shape and explicit policy dependencies required");
    const m = card.mechanics, a = m.abilities[0];
    if (m.equip || m.restrictions?.length || m.modifiers.length || m.abilities.length !== 1 || !a
        || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard
        || a.cost.kind !== "NONE" || a.conditions.length)
        return failure("UNSUPPORTED_TARGETED_GEAR_DEFEAT_SHAPE", "Exactly one unconditional printed PLAY ability is reviewed");
    const expected = { colors: ["RED"], ram: { RED: 2 }, tags: ["Quickhack"], cost: 1,
        sellProfile: { allowed: true, baseEddieValue: 1 }, keywords: ["QUICK"],
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "GEAR", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 } } }] };
    const actual = { colors: card.colors, ram: card.ram ?? null, tags: card.tags, cost: card.printedCost.amount,
        sellProfile: card.sellProfile, keywords: m.keywords, effects: a.effects };
    if (canonicalSerialize(actual) !== canonicalSerialize(expected))
        return failure("UNSUPPORTED_TARGETED_GEAR_DEFEAT_SHAPE", "Exact Quick/rival-Gear/at-most-two metadata required, with no conditional or extra effect");
    return success(null);
}

/** A Gear-defeat Unit ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V34+: printed Units whose {Play} defeats a Gear, each pinned whole. */
const GEAR_DEFEAT_UNIT_SHAPES = [
    // Batch V34: Heywood Ripperdoc. "{Play} You may defeat a Gear. If its cost equals the value of a friendly Gig, draw 1."
    { colors: ["YELLOW"], ram: { YELLOW: 1 }, tags: ["Ripperdoc"], cost: 6, power: 8, abilities: [
        ability({ trigger: "WHEN_PLAYED", effects: [{ kind: "DEFEAT_UNIT", target: { kind: "GEAR", relation: "ANY" }, optional: true, draw: { condition: { kind: "DEFEATED_COST_EQUALS_FRIENDLY_GIG_VALUE" }, count: 1 } }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
function reviewGearDefeatUnit(card: DeepReadonly<CardRevisionSnapshot>, context: EngineContext) {
    const m = card.mechanics;
    if (!targetedGearDefeatPolicyComplete(context) || !card.provenance.reviewed || card.execution?.scope !== "TARGETED_GEAR_DEFEAT_V1" || card.execution.status !== "SUPPORTED" || card.keywords.length || card.printedCost.kind !== "EDDIES"
        || !GEAR_DEFEAT_UNIT_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_TARGETED_GEAR_DEFEAT_SHAPE", "Complete reviewed printed Unit with an exact {Play} Gear defeat required");
    return success(null);
}
/** Execution admission: the complete reviewed shape under its own explicit opt-in policy.
 * Separate from supportsTargetedDefeatCard so the two-card Unit gate keeps its keyword restrictions.
 */
export function supportsTargetedGearDefeatCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    return card?.type === "UNIT" ? reviewGearDefeatUnit(card, context) : reviewTargetedGearDefeatShape(card, context);
}
/** Registered in validateState beside validateTargetedDefeatMetadata; hidden sources are covered too. */
export function validateTargetedGearDefeatMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasTargetedGearDefeatMetadata(r)) { const v = supportsTargetedGearDefeatCard(r, context); if (!v.ok) return v; }
    }
    return success(null);
}
