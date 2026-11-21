import { hasGearStealMetadata, supportsGearStealCard } from "./gear-steal-support";
import { hasFreeCallMetadata, supportsFreeCallUnit } from "./free-call-support";
import { hasAttackPermissionMetadata, supportsAttackPermissionUnit } from "./attack-permission-support";
import { hasLegendSpendMetadata, supportsLegendSpendCard } from "./legend-spend-support";
import { hasFightPowerGrant, supportsFightPowerProgram } from "./fight-power-grant-support";
import { hasStealReduction, supportsStealReductionProgram } from "./steal-reduction-support";
import { hasFightWinMetadata, supportsFightWinUnit } from "./fight-win-support";
import { hasAttackConditionPowerMetadata, supportsAttackConditionPowerCard } from "./attack-condition-power-support";
import { hasTargetedDefeatMetadata, supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { hasTargetedGearDefeatMetadata, supportsTargetedGearDefeatCard } from "./targeted-gear-defeat-support";
import { hasValueConditionMetadata, supportsValueConditionCard } from "./value-conditions-support";
import { hasMinGigProgramMetadata, supportsMinGigProgramCard } from "./min-gig-program-support";
import { hasProgramSearchEffect, supportsProgramSearch } from "./program-search-support";
import { hasGigSetEffect, supportsGigSetProgram } from "./program-gig-set-support";
import { hasFriendlyPlayPowerMetadata, supportsFriendlyPlayPowerUnit } from "./friendly-play-power-support";
import { supportsTargetedSpendCard } from "./targeted-spend-support";
import { hasPlayCostReductionMetadata, playPaymentAmount, supportsPlayCostReduction } from "./play-cost-support";
import { supportsFieldLegend } from "./field-legend-support";
import { hasLegendStealTrigger, supportsLegendStealTrigger } from "./legend-steal-support";
import { hasLegendRevealEffect, supportsLegendReveal } from "./legend-reveal-support";
import { supportsEndTurnCard } from "./end-turn-support";
import { supportsOrderedAttackCard } from "./ordered-effects-support";
import { supportsTriggerCard } from "./trigger-support";
import { supportsRestrictedPlay } from "./restriction-support";
import { supportsAttackPreventionUnit } from "./attack-prevention-support";
import { isReactDecision, supportsReactPlay } from "./react-support";
import { supportsAttackPlay } from "./attack-support";
import { supportsGear, legalEquipHosts } from "./attachments";
import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type CardInstanceId, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { hasModalChoice, supportsModalProgram } from "./modal-program-support";
import { hasSellTopEffect, supportsSellTopProgram } from "./program-sell-support";
import { hasFightStealEffect, supportsFightStealProgram } from "./fight-steal-support";
import { hasFreePlayEffect, supportsFreePlayCard } from "./free-play-support";
import { paymentCandidates } from "./payment";
import { activationPaymentAmount, hasQuickActivation, supportsQuickActivationCard } from "./quick-activation-support";
import { testCondition } from "./conditions";
export function playEnabled(context: EngineContext) { return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "cardPlay") && context.content.ruleset.gameplay?.gigValueBounds === "DIE_FACES_V1"; }
export function revisionOf(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
}
/** Admission certifies only reviewed semantic shapes, never catalog legality or arbitrary metadata. */
export function supportsPlay(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    // Batch V59: a Legend {Spend} ability or start-of-turn trigger is never played; its Legend pin admits it.
    if (card && hasLegendSpendMetadata(card)) return failure("UNSUPPORTED_LEGEND_SPEND", "A Legend {Spend} ability is admitted only by its exact Legend pin");
    // Batch V44: a modal ability ("Choose one effect ... choose both instead") is admitted only by its exact Program pin.
    if (card && hasModalChoice(card)) return supportsModalProgram(card, context);
    // Batch V64: a conditional attack permission is admitted only by its exact Unit pin.
    if (card && hasAttackPermissionMetadata(card)) return supportsAttackPermissionUnit(card, context);
    // Batch V66: a free Call and its discard-then-draw are admitted only by their exact Unit pin.
    if (card && hasFreeCallMetadata(card)) return supportsFreeCallUnit(card, context);
    // Batch V45: an effect sell ("Sell the top card of your deck") is admitted only by its exact Program pin.
    if (card && hasSellTopEffect(card)) return supportsSellTopProgram(card, context);
    // Batch V47: a next-fight steal is admitted only by its exact Program pin.
    if (card && hasGearStealMetadata(card)) return supportsGearStealCard(card, context); // Batch V67.
    if (card && hasFightStealEffect(card)) return supportsFightStealProgram(card, context);
    // Batch V48: a free Unit play is admitted only by its exact pin.
    if (card && hasFreePlayEffect(card)) return supportsFreePlayCard(card, context);
    // Batch V49: a Quick or paid activation is admitted only by its exact Unit pin.
    if (card && hasQuickActivation(card)) return supportsQuickActivationCard(card, context);
    // Batch V57: a steal reduction is admitted only by its exact Quick Program pin.
    if (card && hasStealReduction(card)) return supportsStealReductionProgram(card, context);
    // Batch V58: a while-fighting power grant is admitted only by its exact Quick Program pin.
    if (card && hasFightPowerGrant(card)) return supportsFightPowerProgram(card, context);
    // Batch V52: a fight-win override or first-win ready is admitted only by its exact Unit pin.
    if (card && hasFightWinMetadata(card)) return supportsFightWinUnit(card, context);
    if (card && hasPlayCostReductionMetadata(card)) return supportsPlayCostReduction(card, context);
    if (card && hasFriendlyPlayPowerMetadata(card)) return supportsFriendlyPlayPowerUnit(card, context);
    if (card && hasAttackConditionPowerMetadata(card)) return supportsAttackConditionPowerCard(card, context);
    if (card && hasTargetedGearDefeatMetadata(card)) return supportsTargetedGearDefeatCard(card, context);
    if (card && hasTargetedDefeatMetadata(card)) return supportsTargetedDefeatCard(card, context);
    if (card && hasMinGigProgramMetadata(card)) return supportsMinGigProgramCard(card, context);
    // Batch V40: the Go Solo Legend with a friendly-Legend steal trigger is admitted only by its exact pin.
    if (card && hasLegendStealTrigger(card)) return supportsLegendStealTrigger(card, context);
    if (card && hasLegendRevealEffect(card)) return supportsLegendReveal(card, context);
    // Batch V36: Program top-of-deck searches are admitted only by their exact pins.
    if (card && hasProgramSearchEffect(card)) return supportsProgramSearch(card, context);
    // Batch V37: the optional Gig set is admitted only by its exact pin.
    if (card && hasGigSetEffect(card)) return supportsGigSetProgram(card, context);
    if (card && hasValueConditionMetadata(card)) return supportsValueConditionCard(card, context);
    if (card?.execution?.scope === "TARGETED_SPEND_V1") return supportsTargetedSpendCard(card, context);
    if (playEnabled(context) && card?.execution?.scope === "FIELD_LEGENDS_V1") return supportsFieldLegend(card, context);
    if (playEnabled(context) && card?.execution?.scope === "END_TURN_HISTORY_V1") return supportsEndTurnCard(card, context);
    if (playEnabled(context) && card?.execution?.scope === "ATTACK_ORDERED_EFFECTS_V1") return supportsOrderedAttackCard(card, context);
    if (playEnabled(context) && card?.execution?.scope === "ATTACK_PREVENTION_V1" && card.type === "UNIT") return supportsAttackPreventionUnit(card, context);
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_TRIGGERS_V1" && card.type !== "LEGEND") return supportsTriggerCard(card, context);
    if (playEnabled(context) && card?.execution?.scope === "GEAR_DELAYED_ATTACK_V1" && card.type === "GEAR") return supportsGear(card, context);
    if (playEnabled(context) && card?.execution?.scope === "GEAR_PRIVATE_LOOK_V1" && card.type === "GEAR") return supportsGear(card, context);
    if (card?.mechanics.abilities.some(a => a.inherited || a.guard)) return failure("UNSUPPORTED_TRIGGER_METADATA", "Granted abilities and first-event guards require their full reviewed scope");
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_RESTRICTIONS_V1") return supportsRestrictedPlay(card, context);
    if (card?.mechanics.restrictions?.length) return failure("UNSUPPORTED_CARD_RESTRICTIONS", "Printed restrictions require their complete reviewed execution scope");
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_REACT_V1") return supportsReactPlay(card, context);
    if (playEnabled(context) && card?.execution?.scope === "COMBAT_ATTACK_V1") return supportsAttackPlay(card, context);
    if (playEnabled(context) && card?.type === "GEAR") return supportsGear(card, context);
    if (!playEnabled(context) || !card || !card.provenance.reviewed || card.execution?.status !== "SUPPORTED" || card.execution.scope !== "NONCOMBAT_PLAY_V1" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount > 1000 || card.mechanics.equip || card.mechanics.modifiers.length || card.mechanics.keywords.length || card.mechanics.abilities.length !== 1)
        return failure("UNSUPPORTED_CARD_PLAY", "Explicit noncombat play scope and reviewed type, cost and mechanics required");
    const a = card.mechanics.abilities[0];
    if (a.cost.kind !== "NONE") return failure("UNSUPPORTED_CARD_PLAY", "Ordinary play uses printed cost; activated costs are separate");
    if (card.type === "PROGRAM") {
        const [adjust, draw] = a.effects;
        // Batch V14: All Is Lost, its complete printed shape pinned literally.
        if (canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, sell: card.sellProfile.allowed, keywords: card.keywords, trigger: a.trigger ?? null, activation: a.activation ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, conditions: a.conditions, effects: a.effects })
            === canonicalSerialize({ colors: ["RED"], ram: { RED: 2 }, tags: ["Zetatech"], cost: 1, power: null, sell: true, keywords: [], trigger: "WHEN_PLAYED", activation: null, inherited: null, guard: null, conditions: [], effects: [{ kind: "TRASH_THEN_RETURN_UNIT", count: 3 }] })) return success(null);
        if (a.effects.some(e => e.kind === "TRASH_THEN_RETURN_UNIT")) return failure("UNSUPPORTED_CARD_PLAY", "Trash-return requires the pinned Batch V14 shape");
        // Batch V15: Les Élémens and Unlikely Bond, their complete printed shapes pinned literally.
        const shape = canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, sell: card.sellProfile.allowed, keywords: card.keywords, trigger: a.trigger ?? null, activation: a.activation ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, conditions: a.conditions, effects: a.effects });
        if (shape === canonicalSerialize({ colors: ["BLUE"], ram: { BLUE: 4 }, tags: ["Corpo"], cost: 5, power: null, sell: true, keywords: [], trigger: "WHEN_PLAYED", activation: null, inherited: null, guard: null, conditions: [], effects: [{ kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL", lowestPower: true } }] })) return success(null);
        if (shape === canonicalSerialize({ colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Maelstrom", "Mox"], cost: 4, power: null, sell: true, keywords: [], trigger: "WHEN_PLAYED", activation: null, inherited: null, guard: null, conditions: [], effects: [{ kind: "BOTTOM_DECK_UNIT", target: { relation: "CONTROLLED", readiness: "READY" }, then: { relation: "RIVAL", readiness: "SPENT" } }] })) return success(null);
        if (a.effects.some(e => e.kind === "BOTTOM_DECK_UNIT")) return failure("UNSUPPORTED_CARD_PLAY", "Bottom-deck requires a pinned Batch V15 shape");
        if (a.trigger === "WHEN_PLAYED" && !a.activation && !a.conditions.length && a.effects.length === 2 && adjust.kind === "ADJUST_GIG_UP_TO" && draw.kind === "CONDITIONAL_DRAW" && draw.condition.kind === "DISTINCT_GIG_VALUES" && draw.condition.minimum === 2 && draw.count === 1) return success(null);
    }
    if (card.type === "UNIT") {
        if (!a.trigger && a.activation?.timing === "MAIN" && a.activation.conditionTiming === "ACTIVATION_AND_RESOLUTION" && a.activation.costs.length === 1 && a.activation.costs[0].kind === "SPEND_SOURCE" && a.conditions.length === 1 && a.conditions[0].kind === "GIG_VALUE_AT_LEAST" && a.conditions[0].minimum === 8 && a.effects.length === 1 && a.effects[0].kind === "DRAW" && a.effects[0].count === 2) return success(null);
        if (a.trigger === "WHEN_PLAYED" && !a.activation && !a.conditions.length && a.effects.length === 1 && a.effects[0].kind === "DRAW" && a.effects[0].count === 2) return success(null);
    }
    return failure("UNSUPPORTED_CARD_PLAY", "Only reviewed Afterparty, Kerry and simple Unit play-draw shapes are supported; no combat or partial ability omission");
}
function main(state: GameState, actor: PlayerId) { return state.timing.activePlayer === actor && state.timing.actingPlayer === actor && state.timing.window === "MAIN" && state.resolution.stage === "DECISION" && state.timing.combat.stage === "NONE" && !state.match.outcome; }
export function canPlay(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = revisionOf(state, id, context);
    return Boolean((main(state, actor) || (isReactDecision(state, actor, context) && r?.type === "PROGRAM" && r.mechanics.keywords.includes("QUICK"))) && c?.zone.zone === "HAND" && c.zone.playerId === actor && c.controllerId === actor && supportsPlay(r, context).ok && (r?.type !== "GEAR" || legalEquipHosts(state, id, context).length > 0) && r?.printedCost.kind === "EDDIES" && (playPaymentAmount(state, actor, id, context) === 0 || paymentCandidates(state, actor, context, playPaymentAmount(state, actor, id, context)!, []).length));
}
/** Batch V63: a Legend spends itself for its {Spend} ability, so it cannot also pay that ability's Eddie cost. */
function spentCopy(state: GameState, id: CardInstanceId): GameState {
    return { ...state, objects: { ...state.objects, cards: { ...state.objects.cards, [id]: { ...state.objects.cards[id], readiness: "SPENT" } } } };
}
export function canActivate(state: GameState, actor: PlayerId, id: CardInstanceId, abilityId: string, context: EngineContext) {
    const c = state.objects.cards[id], r = revisionOf(state, id, context), a = r?.mechanics.abilities.find(a => a.id === abilityId);
    // Batch V49 (11.30.2): a Quick activation is also offered in its controller's React Step; its Eddie cost must be payable (8.14.1: no Lag).
    const amount = activationPaymentAmount(a);
    // Batch V59: a face-up Legend's {Spend} ability is used from the Legends area (Legends never Lag).
    const legend = r?.type === "LEGEND" && c?.zone.zone === "LEGENDS" && supportsLegendSpendCard(r, context).ok;
    return Boolean((main(state, actor) || a?.activation?.timing === "QUICK" && isReactDecision(state, actor, context)) && (legend || supportsPlay(r, context).ok && r?.type === "UNIT" && c?.zone.zone === "BATTLEFIELD") && c.zone.playerId === actor && c.controllerId === actor && c.face === "UP" && c.readiness === "READY" && !c.statuses.includes("LAG") && a?.activation && a.conditions.every(condition => testCondition(state, actor, condition))
        && (!amount || paymentCandidates(legend ? spentCopy(state, id) : state, actor, context, amount, []).length));
}
