import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { testCondition } from "./conditions";
/** Batch V64+: printed Units whose only text is a conditional attack permission, each pinned whole. */
const ATTACK_PERMISSION_SHAPES = [
    // Batch V64: Nadia: Fighting Through Grief. "If a Rival controls more Gigs than you, this Unit can attack their Gig area the turn
    // it's played."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Medtech", "Trauma Team"], cost: 6, power: 8,
        modifiers: [{ kind: "CAN_ATTACK_GIG_AREA_WHILE_LAGGING_IF", condition: { kind: "RIVAL_CONTROLS_MORE_GIGS", minimum: 1 } }] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, restrictions: [], abilities: [], ...shape }));
export function hasAttackPermissionMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(x => x.kind === "CAN_ATTACK_GIG_AREA_WHILE_LAGGING_IF"));
}
export function supportsAttackPermissionUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !ATTACK_PERMISSION_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_ATTACK_PERMISSION", "Complete reviewed printed Unit with an exact attack permission required");
    return success(null);
}
/** Batch V64: a lagging pinned Unit may attack the Gig area while its condition holds for its controller (11.3.1). */
export function laggingGigAreaAttack(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = cardRevision(state, id, context), grant = r?.mechanics.modifiers.find(x => x.kind === "CAN_ATTACK_GIG_AREA_WHILE_LAGGING_IF");
    return Boolean(c && grant && supportsAttackPermissionUnit(r, context).ok && testCondition(state, c.controllerId, grant.condition, context, id));
}
