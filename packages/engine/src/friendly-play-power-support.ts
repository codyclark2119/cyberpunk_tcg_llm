import { failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";

/** A new opt-in play trigger, using the existing public-zone temporary-power lifecycle. */
export function friendlyPlayPowerEnabled(context: EngineContext) {
    const gameplay = context.content.ruleset.gameplay, policy = gameplay?.turnSlice;
    return gameplay?.gigValueBounds === "DIE_FACES_V1"
        && policy?.friendlyPlayPower === "FRIENDLY_PLAY_POWER_V1"
        && policy.cardPlay === "NONCOMBAT_PLAY_V1"
        && policy.combatTriggers === "COMBAT_TRIGGERS_V1"
        && policy.combatRestrictions === "COMBAT_RESTRICTIONS_V1"
        && policy.react === "COMBAT_REACT_V1"
        && policy.combatResolution?.version === "COMBAT_RESOLUTION_V1";
}
export function hasFriendlyPlayPowerMetadata(card: DeepReadonly<CardRevisionSnapshot>) {
    return card.mechanics.abilities.some(a => a.effects.some(e => e.kind === "POWER_UNTIL_END_OF_TURN" && e.target.kind === "FRIENDLY_UNIT"));
}
/** Complete semantic admission, not a CardId dispatch or an English-text parser. */
export function supportsFriendlyPlayPowerUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (!friendlyPlayPowerEnabled(context) || !card || !card.provenance.reviewed
        || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.type !== "UNIT" || card.power === undefined
        || card.printedCost.kind !== "EDDIES" || card.printedCost.amount > 1000 || card.keywords.length)
        return failure("UNSUPPORTED_FRIENDLY_PLAY_POWER", "Reviewed Unit, numeric cost/power and complete friendly-play-power policy required");
    const m = card.mechanics, a = m.abilities[0];
    if (m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length
        || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED"
        || a.activation || a.inherited || a.guard || a.cost.kind !== "NONE" || a.conditions.length
        || a.effects.length !== 1 || a.effects[0].kind !== "POWER_UNTIL_END_OF_TURN"
        || a.effects[0].target.kind !== "FRIENDLY_UNIT" || a.effects[0].amount !== 2)
        return failure("UNSUPPORTED_FRIENDLY_PLAY_POWER", "Only one unconditional printed PLAY giving a friendly Unit +2 this turn is supported");
    return success(null);
}
/** Validate hidden sources as well: unsupported metadata must not be silently ignored on reload. */
export function validateFriendlyPlayPowerMetadata(state: GameState, context: EngineContext) {
    const revisions = context.content.cards.filter(hasFriendlyPlayPowerMetadata);
    if (!revisions.length) return success(null);
    for (const card of Object.values(state.objects.cards)) {
        const revision = revisions.find(r => r.id === card.cardId && r.revision === card.revision);
        if (!revision) continue;
        const supported = supportsFriendlyPlayPowerUnit(revision, context);
        if (!supported.ok) return supported;
        if (card.ownerId !== card.controllerId)
            return failure("UNSUPPORTED_FRIENDLY_PLAY_POWER_CONTROL", "Control-changing source lifetimes are not admitted");
    }
    return success(null);
}
