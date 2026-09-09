import { supportsFieldLegend } from "./field-legend-support";
import type { LegendEntryMode } from "./legend-entry";
import { forgetLegendKnowledge } from "./private-knowledge";
import { failure, success, type CardInstanceId, type GameState, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import { validateState } from "./state";
import { TurnMutation } from "./turn";
import { attachmentHost, gearEnabled, legalEquipHosts } from "./attachments";
import { expirePowerOnHiddenEntry } from "./temporary-power";
import { combatResolutionEnabled } from "./combat-resolution-policy";
type Destination = "HAND" | "TRASH" | "REMOVED";
function revision(m: TurnMutation, id: CardInstanceId) {
    const c = m.state.objects.cards[id];
    return m.context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision)!;
}
/** Private transport of a physical card. Callers must complete the associated attachment rule processing. */
export function moveCardLocation(m: TurnMutation, id: CardInstanceId, zone: "BATTLEFIELD" | "LEGENDS" | "RESOLVING_PROGRAM" | Destination) {
    if (zone === "HAND") expirePowerOnHiddenEntry(m, id);
    const card = m.state.objects.cards[id], from = { ...card.zone };
    forgetLegendKnowledge(m, id);
    const refs = m.state.players[from.playerId].zones[from.zone]!;
    refs.splice(refs.indexOf(id), 1);
    if (from.zone === "RESOLVING_PROGRAM" && !refs.length) delete m.state.players[from.playerId].zones.RESOLVING_PROGRAM;
    card.zone = { playerId: zone === "REMOVED" ? card.ownerId : card.controllerId, zone };
    (m.state.players[card.zone.playerId].zones[zone] ??= []).push(id);
    if (zone === "HAND") card.face = "DOWN";
    else card.face = "UP";
    if (zone !== "BATTLEFIELD") card.statuses = card.statuses.filter(status => status !== "LAG" && status !== "GO_SOLO");
    m.emit({ kind: "CARD_MOVED", cardInstanceId: id, from, to: card.zone });
}
/** 4.12: one semantic transition. No external state is returned until host and Gear share FIELD. */
export function moveLegendToFieldWithAttachments(m: TurnMutation, id: CardInstanceId, mode: LegendEntryMode): Result<null> {
    const host = m.state.objects.cards[id];
    if (!host || host.face !== "UP" || host.zone.zone !== "LEGENDS" || !supportsFieldLegend(revision(m, id), m.context).ok) return failure("INVALID_LEGEND_ENTRY", "Reviewed public Legends-area source required");
    const gearIds = [...host.attachments].sort();
    moveCardLocation(m, id, "BATTLEFIELD");
    for (const gearId of gearIds) moveCardLocation(m, gearId, "BATTLEFIELD");
    // Go Solo overrides attack Lag only, not the Spend-icon restriction (official FAQ).
    host.statuses.push("LAG");
    if (mode === "GO_SOLO") { host.readiness = "READY"; host.statuses.push("GO_SOLO"); }
    return success(null);
}
export function attachPlayedGear(m: TurnMutation, gearId: CardInstanceId, hostId: CardInstanceId): Result<null> {
    if (!legalEquipHosts(m.state, gearId, m.context).includes(hostId)) return failure("INVALID_EQUIP_TARGET", "Host is no longer an eligible friendly Unit/Legend");
    const host = m.state.objects.cards[hostId];
    if (host.zone.zone !== "BATTLEFIELD" && host.zone.zone !== "LEGENDS") return failure("INVALID_EQUIP_TARGET", "Host area is invalid");
    moveCardLocation(m, gearId, host.zone.zone);
    host.attachments.push(gearId);
    m.emit({ kind: "GEAR_ATTACHED", gearInstanceId: gearId, hostInstanceId: hostId, reason: "PLAY_CARD" });
    return success(null);
}
function detach(m: TurnMutation, gearId: CardInstanceId, hostId: CardInstanceId, reason: "GEAR_LEFT_AREA" | "HOST_LEFT_AREA") {
    const host = m.state.objects.cards[hostId];
    host.attachments.splice(host.attachments.indexOf(gearId), 1);
    m.emit({ kind: "GEAR_DETACHED", gearInstanceId: gearId, hostInstanceId: hostId, reason });
}
/** Verified departure processing, shared by future trusted handlers. No repair of arbitrary invalid states. */
export function processDeparture(m: TurnMutation, id: CardInstanceId, destination: Destination, order?: readonly CardInstanceId[]): Result<null> {
    const source = m.state.objects.cards[id], host = attachmentHost(m.state, id), gearIds = [...source.attachments].sort();
    const batch = [id, ...gearIds];
    if (destination === "TRASH" && batch.length > 1 && !order) return failure("TRASH_ORDER_REQUIRED", "5.9.4.1: controlling operation must supply the owner's order for simultaneous trash entries");
    if (order && (order.length !== batch.length || new Set(order).size !== batch.length || order.some(cid => !batch.includes(cid)))) return failure("INVALID_MOVE_ORDER", "Movement order must contain exactly the host and its attached Gear");
    if (destination === "TRASH" && new Set(batch.map(cid => m.state.objects.cards[cid].ownerId)).size > 1) return failure("UNSUPPORTED_MULTI_OWNER_ORDER", "Independent owners' simultaneous trash ordering requires a reviewed choice protocol");
    if (destination !== "REMOVED" && batch.some(cid => m.state.objects.cards[cid].ownerId !== m.state.objects.cards[cid].controllerId)) return failure("UNSUPPORTED_MOVE_DESTINATION", "Cross-owner hand/trash movement requires the effect's explicit destination player; this helper does not infer it");
    m.state.resolution.stage = "STATE_BASED_CHECKS";
    for (const cid of order ?? batch) moveCardLocation(m, cid, destination);
    if (host) detach(m, id, host.id, "GEAR_LEFT_AREA");
    for (const gear of gearIds) detach(m, gear, id, "HOST_LEFT_AREA");
    // 4.4.1 / 4.12.2: Gear stays in the destination when its Legend is subsequently removed.
    if (revision(m, id).type === "LEGEND" && destination !== "REMOVED") moveCardLocation(m, id, "REMOVED");
    m.state.resolution.stage = "DECISION";
    return success(null);
}
/** Trusted engine effect/test boundary, NOT a player action or JSONL operation. No combat/defeat semantics.
 * This slice supports same-owner/controller HAND/TRASH departures and owners' REMOVED piles only. Bottom-deck groups and
 * other area transitions need their own reviewed action/ordering implementation; Legend field entry uses the separate atomic operation above. */
export function moveCardForEffect(state: GameState, id: CardInstanceId, destination: Destination, context: EngineContext, trashOrder?: readonly CardInstanceId[]) {
    const valid = validateState(state, context);
    if (!valid.ok) return valid;
    if (!gearEnabled(context) || state.resolution.stage !== "DECISION" || state.timing.window !== "MAIN" || state.timing.combat.stage !== "NONE" || state.match.outcome)
        return failure("UNSUPPORTED_CARD_MOVEMENT", "Trusted departure requires the reviewed Gear policy and stable noncombat MAIN");
    const card = state.objects.cards[id];
    if (!card || !["BATTLEFIELD", "LEGENDS"].includes(card.zone.zone) || !["HAND", "TRASH", "REMOVED"].includes(destination)) return failure("UNSUPPORTED_CARD_MOVEMENT", "Only departures from active host/Gear areas are implemented");
    if (!combatResolutionEnabled(context) && state.temporaryModifiers?.some(x => x.targetId === id)) return failure("UNSUPPORTED_MODIFIER_ZONE_CHANGE", "Temporary power across target zone changes needs a separately reviewed lifecycle policy");
    const m = new TurnMutation(valid.value, context), moved = processDeparture(m, id, destination, trashOrder);
    return moved.ok ? m.result() : moved;
}
