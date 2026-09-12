import { failure, success, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { checkOvertimeVictory } from "./overtime";
import type { TurnMutation } from "./turn";
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
