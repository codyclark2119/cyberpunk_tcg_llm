import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled } from "./combat-resolution-policy";
export function targetedDefeatEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.targetedDefeat === "TARGETED_DEFEAT_V1"; }
/** Complete two-card shapes; no source-name dispatch or arbitrary filter/defeat admission. */
export function supportsTargetedDefeatCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0], p = context.content.ruleset.gameplay?.turnSlice;
    if (!targetedDefeatEnabled(context) || !combatResolutionEnabled(context) || p?.cardPlay !== "NONCOMBAT_PLAY_V1" || p.combatTriggers !== "COMBAT_TRIGGERS_V1" || context.content.ruleset.gameplay?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "TARGETED_DEFEAT_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard || a.conditions.length || a.cost.kind !== "NONE")
        return failure("UNSUPPORTED_TARGETED_DEFEAT", "Complete reviewed Unit/Program shape and semantic defeat policy required");
    const expected = card.type === "UNIT" ? { colors: ["RED"], ram: { RED: 2 }, tags: ["Arasaka", "Drone", "Militech"], cost: 7, sell: false, power: 9,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 5 } }, when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" } } }] }
        : card.type === "PROGRAM" ? { colors: ["RED"], ram: { RED: 2 }, tags: ["Merc"], cost: 3, sell: true, power: null,
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "CONTROLLED_GIG_VALUE", dieType: "D20" } } }] } : null;
    if (!expected || canonicalSerialize(expected) !== canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, sell: card.sellProfile.allowed, power: card.power ?? null, effects: a.effects }))
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
