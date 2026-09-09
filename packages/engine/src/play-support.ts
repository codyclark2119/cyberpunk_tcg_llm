import { supportsTriggerCard } from "./trigger-support";
import { createsFightPrevention, supportsRestrictedPlay } from "./restriction-support";
import { isReactDecision, supportsReactPlay } from "./react-support";
import { supportsAttackPlay } from "./attack-support";
import { supportsGear, legalEquipHosts } from "./attachments";
import { failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type CardInstanceId, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { paymentCandidates } from "./payment";
import { testCondition } from "./conditions";
export function playEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.cardPlay === "NONCOMBAT_PLAY_V1" && context.content.ruleset.gameplay.gigValueBounds === "DIE_FACES_V1"; }
export function revisionOf(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
}
/** Admission certifies only these reviewed shapes, never catalog legality or arbitrary metadata. */
export function supportsPlay(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_TRIGGERS_V1" && card.type !== "LEGEND") return supportsTriggerCard(card, context);
    if (card?.mechanics.abilities.some(a => a.inherited || a.guard)) return failure("UNSUPPORTED_TRIGGER_METADATA", "Granted abilities and first-event guards require their full reviewed scope");
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_RESTRICTIONS_V1") return supportsRestrictedPlay(card, context);
    if (card?.mechanics.restrictions?.length) return failure("UNSUPPORTED_CARD_RESTRICTIONS", "Printed restrictions require their complete reviewed execution scope");
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_REACT_V1") return supportsReactPlay(card, context);
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_ATTACK_V1") return supportsAttackPlay(card, context);
    if (playEnabled(context) && card?.type === "GEAR") return supportsGear(card, context);
    if (!playEnabled(context) || !card || card.execution?.status !== "SUPPORTED" || card.execution.scope !== "NONCOMBAT_PLAY_V1" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount > 1000 || card.mechanics.equip || card.mechanics.modifiers.length || card.mechanics.keywords.length || card.mechanics.abilities.length !== 1)
        return failure("UNSUPPORTED_CARD_PLAY", "Explicit noncombat play scope and reviewed type, cost and mechanics required");
    const a = card.mechanics.abilities[0];
    if (a.cost.kind !== "NONE") return failure("UNSUPPORTED_CARD_PLAY", "Ordinary play uses printed cost; activated costs are separate");
    if (card.type === "PROGRAM") {
        const [adjust, draw] = a.effects;
        if (a.trigger === "WHEN_PLAYED" && !a.activation && !a.conditions.length && a.effects.length === 2 && adjust.kind === "ADJUST_GIG_UP_TO" && draw.kind === "CONDITIONAL_DRAW" && draw.condition.kind === "DISTINCT_GIG_VALUES" && draw.condition.minimum === 2 && draw.count === 1) return success(null);
    }
    if (card.type === "UNIT") {
        if (!a.trigger && a.activation?.timing === "MAIN" && a.activation.conditionTiming === "ACTIVATION_AND_RESOLUTION" && a.activation.costs.length === 1 && a.activation.costs[0].kind === "SPEND_SOURCE" && a.conditions.length === 1 && a.conditions[0].kind === "GIG_VALUE_AT_LEAST" && a.conditions[0].minimum === 8 && a.effects.length === 1 && a.effects[0].kind === "DRAW" && a.effects[0].count === 2) return success(null);
    }
    return failure("UNSUPPORTED_CARD_PLAY", "Only reviewed Afterparty Program and Kerry Unit shapes are supported; no combat or partial ability omission");
}
function main(state: GameState, actor: PlayerId) { return state.timing.activePlayer === actor && state.timing.actingPlayer === actor && state.timing.window === "MAIN" && state.resolution.stage === "DECISION" && state.timing.combat.stage === "NONE" && !state.match.outcome; }
export function canPlay(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = revisionOf(state, id, context);
    return Boolean((main(state, actor) || (isReactDecision(state, actor, context) && r?.type === "PROGRAM" && r.mechanics.keywords.includes("QUICK"))) && c?.zone.zone === "HAND" && c.zone.playerId === actor && c.controllerId === actor && supportsPlay(r, context).ok && !(createsFightPrevention(r) && state.fightPreventions?.length) && (r?.type !== "GEAR" || legalEquipHosts(state, id, context).length > 0) && r?.printedCost.kind === "EDDIES" && (r.printedCost.amount === 0 || paymentCandidates(state, actor, context, r.printedCost.amount, []).length));
}
export function canActivate(state: GameState, actor: PlayerId, id: CardInstanceId, abilityId: string, context: EngineContext) {
    const c = state.objects.cards[id], r = revisionOf(state, id, context), a = r?.mechanics.abilities.find(a => a.id === abilityId);
    return Boolean(main(state, actor) && supportsPlay(r, context).ok && r?.type === "UNIT" && c?.zone.zone === "BATTLEFIELD" && c.zone.playerId === actor && c.controllerId === actor && c.face === "UP" && c.readiness === "READY" && !c.statuses.includes("LAG") && a?.activation && a.conditions.every(condition => testCondition(state, actor, condition)));
}
