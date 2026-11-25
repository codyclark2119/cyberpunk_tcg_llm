import { failure, success, type CardInstanceId, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { attachedGear, attachmentHost } from "./attachments";
import { moveCardLocation } from "./card-movement";
import { friendlyFieldUnits } from "./fight-power-grant";
import { readyCardForEffect } from "./ready-unit";

/** Batch V82: the Gear attached to the activating Legend, in id order. */
export function sourceGear(state: GameState, sourceId: CardInstanceId, context: EngineContext) {
    return attachedGear(state, sourceId, context).map(g => g.id);
}
/** "An unequipped friendly Unit": the controller's face-up field Units with no attached Gear. */
export function unequippedUnits(state: GameState, actor: PlayerId, context: EngineContext) {
    return friendlyFieldUnits(state, actor, context).filter(id => !attachedGear(state, id, context).length);
}
/** "Move a Gear from this Legend to an unequipped friendly Unit": a lone Gear or lone Unit is taken without a choice; with no Gear on
 * the Legend or no unequipped Unit nothing moves, so nothing readies. */
export function beginGearMove(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const current = m.state.resolution.current!;
    const gears = sourceGear(m.state, current.sourceId!, m.context), units = unequippedUnits(m.state, current.controllerId, m.context);
    if (!gears.length || !units.length) return success(null);
    if (gears.length > 1) return offer(m);
    return selectMovedGear(m, gears[0], offer);
}
/** With the Gear fixed, a lone Unit completes the move; several pause with the Gear held. */
export function selectMovedGear(m: TurnMutation, gearId: CardInstanceId, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const current = m.state.resolution.current!, c = m.state.resolution.playContinuation!, units = unequippedUnits(m.state, current.controllerId, m.context);
    if (!sourceGear(m.state, current.sourceId!, m.context).includes(gearId)) return failure("INVALID_GEAR_MOVE", "Choose a Gear attached to this Legend");
    if (units.length > 1) { c.movedGearId = gearId; return offer(m); }
    return moveGearAndReady(m, gearId, units[0]);
}
/** The Gear leaves the Legend for the Unit's area (4.12: an equipped Gear shares its host's area), then the Unit readies. */
export function moveGearAndReady(m: TurnMutation, gearId: CardInstanceId, unitId: CardInstanceId): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.playContinuation!, source = s.objects.cards[current.sourceId!];
    if (!sourceGear(s, source.id, m.context).includes(gearId) || attachmentHost(s, gearId)?.id !== source.id || !unequippedUnits(s, current.controllerId, m.context).includes(unitId))
        return failure("INVALID_GEAR_MOVE", "Move a Gear on this Legend to a current unequipped friendly Unit");
    delete c.movedGearId;
    source.attachments.splice(source.attachments.indexOf(gearId), 1);
    moveCardLocation(m, gearId, "BATTLEFIELD");
    s.objects.cards[unitId].attachments.push(gearId);
    m.emit({ kind: "GEAR_MOVED", effectId: current.id, gearInstanceId: gearId, fromHostId: source.id, toHostId: unitId });
    readyCardForEffect(m, unitId);
    return success(null);
}
/** The held Gear exists only while this effect waits for its Unit, with more than one Unit to choose from. */
export function validateGearMove(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation, current = state.resolution.current;
    if (!c?.movedGearId) return success(null);
    if (current?.effect.kind !== "MOVE_SOURCE_GEAR_TO_UNEQUIPPED_UNIT_THEN_READY" || c.kind !== "ACTIVATE" || current.sourceId !== c.sourceId || !sourceGear(state, c.sourceId, context).includes(c.movedGearId)
        || unequippedUnits(state, c.actorId, context).length < 2)
        return failure("INVALID_GEAR_MOVE", "A held Gear belongs to its Legend's current move while an unequipped Unit is chosen");
    return success(null);
}
/** "At the end of your turn, if 5 or more friendly Units and/or Legends are equipped, ready them": hosts with a Gear, counted here. */
export function equippedFriendlyHosts(state: GameState, actor: PlayerId, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.controllerId === actor && c.face === "UP" && (c.zone.zone === "BATTLEFIELD" || c.zone.zone === "LEGENDS") && attachedGear(state, c.id, context).length).map(c => c.id).sort();
}
export function readyEquippedFriendly(m: TurnMutation, minimum: number) {
    const current = m.state.resolution.current!, hosts = equippedFriendlyHosts(m.state, current.controllerId, m.context), met = hosts.length >= minimum;
    m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
    if (met) for (const id of hosts) readyCardForEffect(m, id);
}
