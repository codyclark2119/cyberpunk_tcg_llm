import { failure, success, type CardInstanceId, type GameState, type GigInstanceId } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes, effectivePower } from "./characteristics";
import { supportsFieldLegend } from "./field-legend-support";
import { belowPowerHistoryEnabled } from "./quick-activation-support";

/** Batch V49: the stealer's power as the steal begins, read before any Gig moves; null when it cannot qualify. */
export function belowPowerStealerPower(state: GameState, stealerId: CardInstanceId, context: EngineContext) {
    if (!belowPowerHistoryEnabled(context) || !effectiveCardTypes(state, stealerId, context).includes("UNIT")) return null;
    return effectivePower(state, stealerId, context);
}
/** Batch V49: after the Gigs moved, record this Unit's steal of a Gig with value less than its power, at most once per stealer and
 * only while the turn has fewer than 2 records for its controller: the first such steal, and the first by a different Unit. */
export function recordBelowPowerSteal(m: TurnMutation, stealerId: CardInstanceId, gigIds: readonly GigInstanceId[], power: number | null) {
    const h = m.state.turnHistory, controllerId = m.state.objects.cards[stealerId]?.controllerId;
    if (power === null || !h || !controllerId) return;
    const list = h.belowPowerSteals?.[controllerId] ?? [];
    if (list.length >= 2 || list.some(x => x.stealerId === stealerId)) return;
    const gig = [...gigIds].sort().find(id => { const g = m.state.objects.gigs[id]; return g?.roll.kind === "ROLLED" && g.roll.currentValue < power; });
    if (!gig) return;
    (h.belowPowerSteals ??= {})[controllerId] = [...list, { stealerId, gigInstanceId: gig }];
}
/** "The first time another friendly Unit steals ..." for the observer: the turn's first record unless the observer made it, else the second. */
export function belowPowerStealFires(state: GameState, observerId: CardInstanceId, stealerId: CardInstanceId, gigId: GigInstanceId) {
    const list = state.turnHistory?.belowPowerSteals?.[state.objects.cards[stealerId]?.controllerId ?? ""];
    if (!list) return false;
    const [first, second] = list;
    return first.stealerId !== observerId ? first.stealerId === stealerId && first.gigInstanceId === gigId : second?.stealerId === stealerId && second.gigInstanceId === gigId;
}
export function validateBelowPowerHistory(state: GameState, context: EngineContext) {
    const h = state.turnHistory?.belowPowerSteals;
    if (!h) return success(null);
    if (!belowPowerHistoryEnabled(context) || state.setup || state.turnHistory?.turn !== state.timing.turn) return failure("INVALID_BELOW_POWER_HISTORY", "First-steal history needs its reviewed reader and the current turn");
    for (const [controllerId, list] of Object.entries(h)) {
        if (!state.match.playerOrder.includes(controllerId as never) || new Set(list.map(x => x.stealerId)).size !== list.length) return failure("INVALID_BELOW_POWER_HISTORY", "Per-player records by distinct stealers required");
        for (const x of list) {
            const c = state.objects.cards[x.stealerId], r = cardRevision(state, x.stealerId, context), g = state.objects.gigs[x.gigInstanceId];
            // Departed stealers remain physical objects; this scope has no control change.
            if (!c || !r || !g || c.controllerId !== controllerId || !(r.type === "UNIT" || r.type === "LEGEND" && supportsFieldLegend(r, context).ok)) return failure("INVALID_BELOW_POWER_HISTORY", "Each record names a physical friendly Unit and an existing Gig");
        }
    }
    return success(null);
}
