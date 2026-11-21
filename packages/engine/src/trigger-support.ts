import { hasGearStealMetadata, supportsGearStealCard } from "./gear-steal-support";
import { hasFreeCallMetadata, supportsFreeCallUnit } from "./free-call-support";
import { hasLegendSpendMetadata, supportsLegendSpendCard } from "./legend-spend-support";
import { hasFightPowerGrant } from "./fight-power-grant-support";
import { hasStealReduction } from "./steal-reduction-support";
import { hasFightWinMetadata, supportsFightWinUnit } from "./fight-win-support";
import { supportsAttackConditionPowerCard } from "./attack-condition-power-support";
import { hasMustAttackEffect, supportsMustAttackUnit } from "./must-attack-support";
import { hasTypeRevealEffect, supportsTypeRevealUnit } from "./type-reveal-support";
import { supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { supportsTargetedGearDefeatCard } from "./targeted-gear-defeat-support";
import { supportsTargetedSpendCard } from "./targeted-spend-support";
import { supportsValueConditionCard } from "./value-conditions-support";
import { firstAttackHistoryEnabled, supportsFirstAttackLegend } from "./first-attack-support";
import { supportsDelayedAttackGear } from "./delayed-effect-support";
import { supportsEndTurnCard } from "./end-turn-support";
import { supportsOrderedAttackCard } from "./ordered-effects-support";
import { supportsPrivateLookGear, privateInformationEnabled } from "./private-look-support";
import { supportsAttackPlay } from "./attack-support";
import { supportsBlockerUsedUnit } from "./blocker-trigger-support";
import { hasStealTrigger, supportsStealTriggerUnit } from "./steal-trigger-support";
import { hasLegendStealTrigger, supportsLegendStealTrigger } from "./legend-steal-support";
import { hasLegendRevealEffect, supportsLegendReveal } from "./legend-reveal-support";
import { hasGigParityEffect, supportsGigParityUnit } from "./gig-parity-support";
import { hasValuePairMetadata, supportsValuePairUnit } from "./value-pair-support";
import { hasProgramDiscardEffect, supportsProgramDiscardUnit } from "./program-discard-support";
import { hasGigSearchEffect, supportsGigSearchUnit } from "./gig-search-support";
import { hasAttackingReadyMetadata, supportsAttackingReadyUnit } from "./attacking-ready-support";
import { supportsAttackSearchUnit } from "./attack-search-support";
import { hasPinnedPlayEffect, supportsPinnedPlayUnit } from "./play-pin-support";
import { hasFriendlyPlayPowerMetadata, supportsFriendlyPlayPowerUnit } from "./friendly-play-power-support";
import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
import { hasModalChoice } from "./modal-program-support";
import { hasSellTopEffect } from "./program-sell-support";
import { hasFightStealEffect } from "./fight-steal-support";
import { hasFreePlayEffect, supportsFreePlayCard } from "./free-play-support";
import { hasQuickActivation, supportsQuickActivationCard } from "./quick-activation-support";
export function triggersEnabled(context: EngineContext) { return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers"); }
/** Complete shapes, not card-name matching. The bundle must still pin explicitly reviewed immutable revisions. */
export function supportsTriggerCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (hasFreeCallMetadata(card)) return supportsFreeCallUnit(card, context); // Batch V66.
    if (hasGearStealMetadata(card)) return supportsGearStealCard(card, context); // Batch V67.
    // Batch V59, V63: a pinned Legend's scheduled trigger (not its Call or start-of-turn effect) is admitted by its Legend pin, and nothing else of it.
    if (hasLegendSpendMetadata(card)) return card!.mechanics.abilities.some(a => a.trigger && a.trigger !== "WHEN_CALLED" && a.trigger !== "WHEN_OWN_TURN_STARTS") ? supportsLegendSpendCard(card, context)
        : failure("UNSUPPORTED_LEGEND_SPEND", "A Legend {Spend} ability is admitted only by its exact Legend pin");
    // Batch V44: modal abilities are read only by the modal Program gate.
    if (hasModalChoice(card)) return failure("UNSUPPORTED_MODAL_CHOICE", "A modal ability is admitted only by its exact Program pin");
    // Batch V45: effect sells are read only by the sell Program gate.
    if (hasSellTopEffect(card)) return failure("UNSUPPORTED_EFFECT_SELL", "An effect sell is admitted only by its exact Program pin");
    if (hasFightStealEffect(card)) return failure("UNSUPPORTED_FIGHT_STEAL", "A next-fight steal is admitted only by its exact Program pin"); // Batch V47.
    if (hasFreePlayEffect(card)) return supportsFreePlayCard(card, context); // Batch V48.
    if (hasQuickActivation(card)) return supportsQuickActivationCard(card, context); // Batch V49.
    if (hasFightWinMetadata(card)) return supportsFightWinUnit(card, context); // Batch V52.
    if (hasStealReduction(card)) return failure("UNSUPPORTED_STEAL_REDUCTION", "A steal reduction is admitted only by its exact Quick Program pin"); // Batch V57.
    if (hasFightPowerGrant(card)) return failure("UNSUPPORTED_FIGHT_POWER", "A while-fighting power grant is admitted only by its exact Quick Program pin"); // Batch V58.
    if (card && hasFriendlyPlayPowerMetadata(card)) return supportsFriendlyPlayPowerUnit(card, context);
    // Batch V43: the {Play} must-attack obligation (on a Blocker Unit) is admitted only by its exact pin.
    if (hasMustAttackEffect(card)) return supportsMustAttackUnit(card, context);
    if (card?.mechanics.keywords.length && supportsBlockerUsedUnit(card, context).ok) return success(null);
    // Batch V40: the friendly-Legend steal trigger and its parity branch are admitted only by their exact pins.
    if (hasLegendStealTrigger(card)) return supportsLegendStealTrigger(card, context);
    // Batch V41: the Go Solo Legend's {Attack} reveal for power and {Defeated} rival discard are admitted only by their exact pins.
    if (hasLegendRevealEffect(card)) return supportsLegendReveal(card, context);
    // Batch V42: the can't-attack own-turn end type reveal is admitted only by its exact pin.
    if (hasTypeRevealEffect(card)) return supportsTypeRevealUnit(card, context);
    // Batch V24: steal triggers and the "if it's equipped" condition are admitted only by their exact pins.
    if (hasStealTrigger(card)) return supportsStealTriggerUnit(card, context);
    // Batch V28: amounts counted from friendly Gig parity are admitted only by their exact pins.
    if (hasGigParityEffect(card)) return supportsGigParityUnit(card, context);
    // Batch V29: value-pair conditions and the tagged Legend ready are admitted only by their exact pins.
    if (hasValuePairMetadata(card)) return supportsValuePairUnit(card, context);
    // Batch V32: "you may discard N Programs, then bottom-deck a rival Unit" is admitted only by its exact pins.
    if (hasProgramDiscardEffect(card)) return supportsProgramDiscardUnit(card, context);
    // Batch V38: the other-attackers aura and own-turn end "ready up to 3 friendly Units" are admitted only by their exact pins.
    if (hasAttackingReadyMetadata(card)) return supportsAttackingReadyUnit(card, context);
    // Batch V35: the {Play} cost-matching search is admitted only by its exact pin.
    if (hasGigSearchEffect(card)) return supportsGigSearchUnit(card, context);
    // Batch V19: the [Attack] Gear search is admitted only by its exact pin.
    if (card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "SEARCH_GEAR"))) return supportsAttackSearchUnit(card, context);
    // Batch V20: the {Play} trash-3 Program pick and the {Play} Adrenaline grant are admitted only by their exact pins.
    if (hasPinnedPlayEffect(card)) return supportsPinnedPlayUnit(card, context);
    if (!triggersEnabled(context) || !card || !card.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.mechanics.keywords.length || card.mechanics.restrictions?.length)
        return failure("UNSUPPORTED_TRIGGER_CARD", "Explicit reviewed trigger scope and complete supported mechanics required");
    const m = card.mechanics;
    const simple = m.abilities.every(a => !a.activation && !a.conditions.length && a.cost.kind === "NONE" && a.effects.length === 1);
    if (!simple) return failure("UNSUPPORTED_TRIGGER_CARD", "Only complete reviewed single-primitive triggered abilities are supported");
    const a = m.abilities[0];
    if (card.type === "GEAR" && card.printedCost.kind === "EDDIES" && card.printedCost.amount === 2 && card.power === 2 && m.equip?.kind === "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" && m.modifiers.length === 1 && m.modifiers[0].kind === "GRANT_PRINTED_POWER_TO_HOST" && m.abilities.length === 1 && a.trigger === "WHEN_FIGHT_WON" && a.inherited === "EQUIPPED_HOST" && !a.guard && a.effects[0].kind === "DRAW" && a.effects[0].count === 1) return success(null);
    if (m.equip || m.modifiers.length) return failure("UNSUPPORTED_TRIGGER_CARD", "Unit/Legend trigger shapes have no omitted characteristic modifiers or equip clause");
    if (card.type === "LEGEND" && card.printedCost.kind === "DASH" && card.power === undefined && m.abilities.length === 1 && a.trigger === "WHEN_CARD_PLAYED" && a.guard === "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN" && !a.inherited && a.effects[0].kind === "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN" && a.effects[0].maximum === 2 && a.effects[0].draw === 1) return success(null);
    // Batch V7: Delamain: Rideshare AI, the complete printed shape and its single PLAY draw.
    if (card.type === "UNIT" && card.printedCost.kind === "EDDIES" && card.printedCost.amount === 3 && card.power === 0 && card.keywords.length === 0 && card.sellProfile.allowed === false
        && canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, abilities: m.abilities.map(a => ({ trigger: a.trigger, inherited: a.inherited ?? null, guard: a.guard ?? null, effects: a.effects })) })
        === canonicalSerialize({ colors: ["BLUE"], ram: { BLUE: 3 }, tags: ["AI"], abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, effects: [{ kind: "DRAW", count: 2 }] }] })) return success(null);
    // Batch V13: Screw: Lovelorn Fool, the complete printed shape and its single DEFEATED trash return.
    if (card.type === "UNIT" && card.printedCost.kind === "EDDIES" && card.printedCost.amount === 5 && card.power === 7 && card.keywords.length === 0 && card.sellProfile.allowed === false
        && canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, abilities: m.abilities.map(a => ({ trigger: a.trigger, inherited: a.inherited ?? null, guard: a.guard ?? null, effects: a.effects })) })
        === canonicalSerialize({ colors: ["RED"], ram: { RED: 2 }, tags: ["Ganger", "Maelstrom"], abilities: [{ trigger: "WHEN_DEFEATED", inherited: null, guard: null, effects: [{ kind: "RETURN_TRASH_UNIT_TO_HAND", exclude: "SUBJECT" }] }] })) return success(null);
    if (card.type === "UNIT" && card.printedCost.kind === "EDDIES" && card.printedCost.amount === 3 && card.power === 4 && m.abilities.length === 3 && m.abilities.every(a => !a.inherited && !a.guard)) {
        const expected = [
            { trigger: "WHEN_PLAYED", effect: { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 } },
            { trigger: "WHEN_ATTACKING", effect: { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 } },
            { trigger: "WHEN_DEFEATED", effect: { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "STREET_CRED_DIFFERENCE_AT_LEAST", minimum: 10 }, count: 2 } }
        ];
        if (canonicalSerialize(m.abilities.map(a => ({ trigger: a.trigger, effect: a.effects[0] }))) === canonicalSerialize(expected)) return success(null);
    }
    return failure("UNSUPPORTED_TRIGGER_CARD", "Both Gear power/granted trigger or the entire reviewed Unit/Legend shape must be implemented");
}

/** Scheduler admission includes the older complete printed ATTACK shape only in the new private-look bundle. */
export function supportsEffectiveTriggerSource(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    return supportsAttackConditionPowerCard(card, context).ok || ((card?.type === "UNIT" || card?.type === "LEGEND") && supportsTargetedDefeatCard(card, context).ok) || (card?.type === "UNIT" && supportsTargetedGearDefeatCard(card, context).ok) || (card?.type === "UNIT" && supportsTargetedSpendCard(card, context).ok) || (card?.type === "UNIT" && supportsValueConditionCard(card, context).ok) || supportsFirstAttackLegend(card, context).ok || supportsDelayedAttackGear(card, context).ok || supportsEndTurnCard(card, context).ok || supportsOrderedAttackCard(card, context).ok || supportsTriggerCard(card, context).ok || supportsPrivateLookGear(card, context).ok || ((privateInformationEnabled(context) || firstAttackHistoryEnabled(context)) && supportsAttackPlay(card, context).ok);
}
