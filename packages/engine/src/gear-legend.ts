import { failure, success, type CardInstanceId, type GameState, type PlayerId, type Result, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { attachedGear } from "./attachments";
import { defeatCards, gearDefeatSupport } from "./defeat";
import { friendlyFieldUnits } from "./fight-power-grant";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { activationEffectId } from "./play-state";
import { compareTemporaryPower } from "./temporary-power";

type GearPower = Extract<TemporaryPowerModifier, { scaled: "PER_EQUIPPED_GEAR" }>;
/** Batch V75: "a friendly Gear": face-up Gear the controller controls, attached in an active area, that an effect may defeat. */
export function friendlyGearTargets(state: GameState, actor: PlayerId, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.controllerId === actor && c.zone.playerId === actor && gearDefeatSupport(state, c.id, context).ok).map(c => c.id).sort();
}
/** "You may defeat a friendly Gear. If you do, draw 2. Otherwise, draw 1." `gearId` undefined is the decline (or no Gear at all). A
 * Gear's own defeat discovers no reviewed trigger; any binding fails closed rather than resolving without its batch. */
export function resolveGearDefeatDraw(m: TurnMutation, gearId: CardInstanceId | undefined, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current;
    if (current?.effect.kind !== "MAY_DEFEAT_FRIENDLY_GEAR_THEN_DRAW" || !current.sourceId) return failure("INVALID_GEAR_DEFEAT", "Current reviewed Gear defeat required");
    s.resolution.choice = null;
    if (gearId === undefined) {
        if (friendlyGearTargets(s, current.controllerId, m.context).length) m.emit({ kind: "OPTIONAL_TRIGGER_DECLINED", effectId: current.id, controllerId: current.controllerId });
        return m.draw(current.controllerId, current.effect.otherwise);
    }
    if (!friendlyGearTargets(s, current.controllerId, m.context).includes(gearId)) return failure("INVALID_DEFEAT_TARGET", "Choose a current friendly Gear");
    m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId: gearId, controllerId: current.controllerId, forced });
    const defeated = defeatCards(m, [{ targetId: gearId, defeatedBy: current.sourceId }], [{ targetId: gearId, cardIds: [gearId] }], true);
    if (!defeated.ok) return defeated;
    if (defeated.value.triggered.length) return failure("UNSUPPORTED_DEFEAT_TRIGGERS", "A defeated Gear's triggers need a reviewed batch");
    return m.draw(current.controllerId, current.effect.ifDefeated);
}
/** The pinned Legend's Quick ability whose printed effect is the per-Gear power. */
function gearPowerAbility(state: GameState, sourceId: CardInstanceId, context: EngineContext) {
    const r = cardRevision(state, sourceId, context);
    return supportsLegendSpendCard(r, context).ok ? r!.mechanics.abilities.find(a => a.activation?.timing === "QUICK" && a.effects[0]?.kind === "POWER_PER_EQUIPPED_GEAR_THIS_TURN") : undefined;
}
/** "+1 power this turn for each of its equipped Gear": the target's Gear counted once, as the effect resolves; none gives nothing. */
export function applyGearPower(m: TurnMutation, targetId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current;
    if (current?.effect.kind !== "POWER_PER_EQUIPPED_GEAR_THIS_TURN" || !current.sourceId) return failure("INVALID_POWER_SOURCE", "Current reviewed per-Gear power required");
    if (!friendlyFieldUnits(s, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Choose a current friendly field Unit");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    const amount = current.effect.amount * attachedGear(s, targetId, m.context).length;
    if (!amount) return success(null);
    const modifier: GearPower = { kind: "POWER", sourceId: current.sourceId, targetId, expires: { kind: "END_OF_TURN", turn: s.timing.turn }, amount, scaled: "PER_EQUIPPED_GEAR", origin: { effectId: current.id, sequence: current.causedBySequence } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
/** A resolved current-turn activation of the pinned face-up Legend, never the one still resolving; the count cannot be rechecked after
 * Gear moves, so it is bounded by the Gear in the game. */
export function validateGearPower(state: GameState, x: GearPower, context: EngineContext, publicUnit: (id: CardInstanceId) => boolean) {
    const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], a = gearPowerAbility(state, x.sourceId, context), current = state.resolution.current;
    const gear = Object.values(state.objects.cards).filter(c => c.controllerId === source?.controllerId && cardRevision(state, c.id, context)?.type === "GEAR").length;
    if (!source || !target || !a || source.face !== "UP" || source.zone.zone !== "LEGENDS" || x.expires.turn !== state.timing.turn || target.controllerId !== source.controllerId || !publicUnit(x.targetId) || x.amount > gear
        || x.origin.effectId !== activationEffectId(state, source.controllerId, source.id, a.id, 0) || x.origin.sequence >= state.match.eventSequence || current?.id === x.origin.effectId && current.causedBySequence === x.origin.sequence)
        return failure("INVALID_TEMPORARY_POWER", "Per-Gear power needs its reviewed face-up Legend's resolved current-turn activation and a friendly public Unit");
    return success(null);
}
