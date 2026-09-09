import { supportsValueConditionCard } from "./value-conditions-support";
import { firstAttackHistoryEnabled, supportsFirstAttackLegend } from "./first-attack-support";
import { supportsDelayedAttackGear } from "./delayed-effect-support";
import { supportsEndTurnCard } from "./end-turn-support";
import { supportsOrderedAttackCard } from "./ordered-effects-support";
import { supportsPrivateLookGear, privateInformationEnabled } from "./private-look-support";
import { supportsAttackPlay } from "./attack-support";
import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
export function triggersEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.combatTriggers === "COMBAT_TRIGGERS_V1"; }
/** Complete shapes, not card-name matching. The bundle must still pin explicitly reviewed immutable revisions. */
export function supportsTriggerCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (!triggersEnabled(context) || !card || !card.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.mechanics.keywords.length || card.mechanics.restrictions?.length)
        return failure("UNSUPPORTED_TRIGGER_CARD", "Explicit reviewed trigger scope and complete supported mechanics required");
    const m = card.mechanics;
    const simple = m.abilities.every(a => !a.activation && !a.conditions.length && a.cost.kind === "NONE" && a.effects.length === 1);
    if (!simple) return failure("UNSUPPORTED_TRIGGER_CARD", "Only complete reviewed single-primitive triggered abilities are supported");
    const a = m.abilities[0];
    if (card.type === "GEAR" && card.printedCost.kind === "EDDIES" && card.printedCost.amount === 2 && card.power === 2 && m.equip?.kind === "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" && m.modifiers.length === 1 && m.modifiers[0].kind === "GRANT_PRINTED_POWER_TO_HOST" && m.abilities.length === 1 && a.trigger === "WHEN_FIGHT_WON" && a.inherited === "EQUIPPED_HOST" && !a.guard && a.effects[0].kind === "DRAW" && a.effects[0].count === 1) return success(null);
    if (m.equip || m.modifiers.length) return failure("UNSUPPORTED_TRIGGER_CARD", "Unit/Legend trigger shapes have no omitted characteristic modifiers or equip clause");
    if (card.type === "LEGEND" && card.printedCost.kind === "DASH" && card.power === undefined && m.abilities.length === 1 && a.trigger === "WHEN_CARD_PLAYED" && a.guard === "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN" && !a.inherited && a.effects[0].kind === "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN" && a.effects[0].maximum === 2 && a.effects[0].draw === 1) return success(null);
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
    return (card?.type === "UNIT" && supportsValueConditionCard(card, context).ok) || supportsFirstAttackLegend(card, context).ok || supportsDelayedAttackGear(card, context).ok || supportsEndTurnCard(card, context).ok || supportsOrderedAttackCard(card, context).ok || supportsTriggerCard(card, context).ok || supportsPrivateLookGear(card, context).ok || ((privateInformationEnabled(context) || firstAttackHistoryEnabled(context)) && supportsAttackPlay(card, context).ok);
}
