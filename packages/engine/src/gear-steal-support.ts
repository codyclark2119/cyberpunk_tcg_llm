import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState, type GigInstanceId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { endTurnEnabled } from "./end-turn-support";
/** Batch V67+: Gear whose host's first steal each turn steals again, each pinned whole. Anything not listed is absent. */
const GEAR_STEAL_SHAPES = [
    // Batch V67: Gorilla Arms. "The first time this Unit steals 1 or more Gigs each turn, steal a rival Gig with a value not shared
    // by a friendly Gig." Its host inherits the trigger (11.23.3).
    { colors: ["YELLOW"], ram: { YELLOW: 3 }, tags: ["Cyberware"], cost: 4, power: 3,
        abilities: [{ trigger: "WHEN_GIG_STOLEN", inherited: "EQUIPPED_HOST", guard: "FIRST_HOST_STEAL_PER_TURN", activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
            effects: [{ kind: "STEAL_GIG", actor: "TRIGGER_SUBJECT", count: 1, valueNotSharedByFriendly: true }] }] }
].map(shape => canonicalSerialize({ type: "GEAR", sell: true, keywords: [], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }], restrictions: [], ...shape }));
export function hasGearStealMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.guard === "FIRST_HOST_STEAL_PER_TURN" || a.effects.some(e => e.kind === "STEAL_GIG" && e.valueNotSharedByFriendly)));
}
export function supportsGearStealCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !combatResolutionEnabled(context) || !endTurnEnabled(context) || g?.gigValueBounds !== "DIE_FACES_V1"
        || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !GEAR_STEAL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_GEAR_STEAL", "Complete reviewed Gear with an exact first-steal extra steal required");
    return success(null);
}
/** Batch V67: no steal by this Unit precedes this one (`gigInstanceIds`) this turn. The turn's recorded count for it is the steals
 * before this one, this one, and the effect steals by it recorded later in the current trigger batch. */
export function isFirstHostSteal(state: GameState, subjectId: CardInstanceId, gigInstanceIds: readonly GigInstanceId[]) {
    const c = state.resolution.triggerContinuation, origin = c?.origin, steals = (c?.effectSteals ?? []).filter(e => e.subjectId === subjectId);
    const same = (ids: readonly GigInstanceId[]) => ids.length === gigInstanceIds.length && ids.every(g => gigInstanceIds.includes(g));
    const index = steals.findIndex(e => same(e.gigInstanceIds));
    const after = origin?.kind === "STEAL" && origin.subjectId === subjectId && same(origin.gigInstanceIds) ? steals.length : index >= 0 ? steals.length - index - 1 : 0;
    return (state.turnHistory?.gigsStolenByUnit?.[subjectId] ?? 0) - gigInstanceIds.length - after === 0;
}
