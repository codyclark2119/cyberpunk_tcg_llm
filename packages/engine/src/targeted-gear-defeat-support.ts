import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";

/** Dependency review only. The foundation slice does NOT enable a Gear gameplay handler. */
export function targetedGearDefeatPolicyComplete(context: EngineContext) {
    const gameplay = context.content.ruleset.gameplay, p = gameplay?.turnSlice;
    return gameplay?.gigValueBounds === "DIE_FACES_V1"
        && p?.targetedGearDefeat === "TARGETED_GEAR_DEFEAT_V1"
        && p.targetedDefeat === "TARGETED_DEFEAT_V1"
        && p.cardPlay === "NONCOMBAT_PLAY_V1"
        && p.gear === "REVIEWED_GEAR_V1"
        && p.combat === "COMBAT_ATTACK_V1"
        && p.react === "COMBAT_REACT_V1"
        && p.combatTriggers === "COMBAT_TRIGGERS_V1"
        && p.combatResolution?.version === "COMBAT_RESOLUTION_V1"
        && p.callEffects === "REVIEWED_CALL_V1";
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
