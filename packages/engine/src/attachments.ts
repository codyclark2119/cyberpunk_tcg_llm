import { supportsPrivateLookGear } from "./private-look-support";
import { supportsCapabilityGear } from "./capability-support";
import { supportsTriggerCard } from "./trigger-support";
import { failure, success, type GameState, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
export function gearEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.gear === "REVIEWED_GEAR_V1"; }
function revision(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
}
export function supportsGear(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (card?.execution?.scope === "GEAR_PRIVATE_LOOK_V1") return supportsPrivateLookGear(card, context);
    if (card?.execution?.scope === "GEAR_CAPABILITIES_V1") return supportsCapabilityGear(card, context);
    if (gearEnabled(context) && card?.type === "GEAR" && card.execution?.scope === "COMBAT_TRIGGERS_V1") return supportsTriggerCard(card, context);
    if (!gearEnabled(context) || !card || card.type !== "GEAR" || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount > 1000 || card.power === undefined || card.mechanics.restrictions?.length || card.mechanics.equip?.kind !== "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" || card.mechanics.abilities.length || card.mechanics.keywords.length || card.mechanics.modifiers.length !== 1 || card.mechanics.modifiers[0].kind !== "GRANT_PRINTED_POWER_TO_HOST")
        return failure("UNSUPPORTED_GEAR", "Reviewed simple Gear shape, equip rule and printed-power inheritance required; extra abilities are not certified");
    return success(null);
}
/** host.attachments is the sole authoritative relation; reverse lookup is derived. */
export function attachedGear(state: GameState, hostId: CardInstanceId, context: EngineContext) {
    return (state.objects.cards[hostId]?.attachments ?? []).map(id => state.objects.cards[id]).filter(c => c && revision(state, c.id, context)?.type === "GEAR").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function attachmentHost(state: GameState, gearId: CardInstanceId) {
    return Object.values(state.objects.cards).find(c => c.attachments.includes(gearId)) ?? null;
}
function supportedHost(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = revision(state, id, context);
    // Field Legends/effective Unit transitions remain a separate unsupported lifecycle.
    return c?.face === "UP" && c.zone.playerId === c.controllerId && ((r?.type === "UNIT" && c.zone.zone === "BATTLEFIELD") || (r?.type === "LEGEND" && c.zone.zone === "LEGENDS"));
}
export function legalEquipHosts(state: GameState, gearId: CardInstanceId, context: EngineContext) {
    const gear = state.objects.cards[gearId];
    if (!gear || !supportsGear(revision(state, gearId, context), context).ok || attachmentHost(state, gearId)) return [];
    return Object.values(state.objects.cards).filter(host => host.id !== gearId && host.controllerId === gear.controllerId && supportedHost(state, host.id, context)).map(host => host.id).sort();
}
/** Strict opt-in lifecycle invariants. Legacy fixture policies retain their historical representation. */
export function validateGearAttachments(state: GameState, context: EngineContext) {
    if (!gearEnabled(context)) return success(null);
    const seen = new Set<CardInstanceId>();
    for (const host of Object.values(state.objects.cards)) {
        if (host.attachments.length && !supportedHost(state, host.id, context)) return failure("INVALID_EQUIP_HOST", "Only friendly face-up field Units or Legends-area Legends are supported hosts");
        for (const id of host.attachments) {
            const gear = state.objects.cards[id];
            if (!gear || id === host.id || seen.has(id) || !supportsGear(revision(state, id, context), context).ok || gear.attachments.length || gear.face !== "UP" || gear.controllerId !== host.controllerId || gear.zone.playerId !== host.zone.playerId || gear.zone.zone !== host.zone.zone)
                return failure("INVALID_GEAR_ATTACHMENT", "Gear must exist, be unique, face-up, and share its valid host's area/controller");
            seen.add(id);
        }
    }
    for (const c of Object.values(state.objects.cards)) {
        const r = revision(state, c.id, context);
        if (r?.type === "GEAR" && (c.zone.zone === "BATTLEFIELD" || c.zone.zone === "LEGENDS") && !seen.has(c.id)) return failure("UNATTACHED_GEAR", "Played Gear cannot remain independently in a field or Legends area");
        if (r?.type === "LEGEND" && !["BATTLEFIELD", "LEGENDS", "REMOVED"].includes(c.zone.zone)) return failure("LEGEND_REQUIRES_REMOVAL", "4.4: a Legend outside a valid area must be removed during rule processing");
    }
    return success(null);
}
