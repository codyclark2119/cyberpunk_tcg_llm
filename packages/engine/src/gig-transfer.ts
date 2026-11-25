import { failure, success, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { checkOvertimeVictory } from "./overtime";
import type { TurnMutation } from "./turn";
import { noteRivalGigChange } from "./gig-change-triggers";
/** Trusted transfer batch: validate everything, move all, then publish canonical facts.
 * No decisions, triggers, observers or state validation can interleave the simultaneous moves.
 */
export function transferGigs(m: TurnMutation, ids: readonly GigInstanceId[], controller: PlayerId, recordSemanticFacts?: () => void) {
    if (m.state.match.outcome) return failure("GAME_ALREADY_ENDED", "No control changes after terminal victory or loss");
    if (!m.state.players[controller] || new Set(ids).size !== ids.length || ids.some(id => !m.state.objects.gigs[id] || m.state.objects.gigs[id].roll.kind !== "ROLLED"))
        return failure("INVALID_GIG_TRANSFER", "Distinct rolled Gigs and an existing controller are required");
    const transfers = [...ids].sort().map(id => ({ id, previous: m.state.objects.gigs[id].controllerId }));
    for (const { id } of transfers) {
        const g = m.state.objects.gigs[id], refs = m.state.players[g.location.playerId].gigs[g.location.zone];
        refs.splice(refs.indexOf(id), 1);
        g.controllerId = controller;
        g.location = { playerId: controller, zone: "GIGS" };
        m.state.players[controller].gigs.GIGS.push(id);
    }
    for (const { id, previous } of transfers) m.emit({ kind: "GIG_CONTROL_CHANGED", gigInstanceId: id, previous, current: controller });
    // The optional hook records the same transfer (e.g. stolen facts/history), never another effect or decision.
    recordSemanticFacts?.();
    checkOvertimeVictory(m);
    return success(null);
}
/** Batch V23, 6.7: both Gig dice change areas at the same time and keep their values (6.7.1). A swap is not stealing (6.7.2),
 * so it records no stolen facts and is not limited by steal restrictions. Gig counts are unchanged; the overtime check still runs. */
export function swapGigs(m: TurnMutation, effectId: string, friendlyId: GigInstanceId, rivalId: GigInstanceId) {
    const s = m.state, a = s.objects.gigs[friendlyId], b = s.objects.gigs[rivalId];
    if (s.match.outcome) return failure("GAME_ALREADY_ENDED", "No control changes after terminal victory or loss");
    if (!a || !b || a.roll.kind !== "ROLLED" || b.roll.kind !== "ROLLED" || a.location.zone !== "GIGS" || b.location.zone !== "GIGS" || a.controllerId === b.controllerId)
        return failure("INVALID_GIG_SWAP", "A rolled friendly Gig and a rolled rival Gig in Gig areas are required");
    const pa = a.controllerId, pb = b.controllerId, ra = s.players[pa].gigs.GIGS, rb = s.players[pb].gigs.GIGS;
    ra.splice(ra.indexOf(friendlyId), 1); rb.splice(rb.indexOf(rivalId), 1);
    a.controllerId = pb; a.location = { playerId: pb, zone: "GIGS" }; rb.push(friendlyId);
    b.controllerId = pa; b.location = { playerId: pa, zone: "GIGS" }; ra.push(rivalId);
    const moved = [{ id: friendlyId, previous: pa, current: pb }, { id: rivalId, previous: pb, current: pa }].sort((x, y) => x.id < y.id ? -1 : 1);
    for (const x of moved) m.emit({ kind: "GIG_CONTROL_CHANGED", gigInstanceId: x.id, previous: x.previous, current: x.current });
    m.emit({ kind: "GIGS_SWAPPED", effectId, gigInstanceIds: [friendlyId, rivalId] });
    noteRivalGigChange(m, [pa, pb]); // Batch V88: the Rival whose Gig was swapped observes it.
    checkOvertimeVictory(m);
    return success(null);
}
