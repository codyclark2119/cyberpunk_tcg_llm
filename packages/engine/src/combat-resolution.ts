import { failure, success } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { RulesView } from "./view";
import { defeatCards, defeatSupport } from "./defeat";
import { transferGigs } from "./gig-transfer";
import { defeatOrderChoice, evaluateFight, gigStealChoice, listStealableGigs, unfinishedDefeatOrder } from "./combat-outcome-queries";

export function finishCombat(m: TurnMutation) {
    const c = m.state.timing.combat;
    if (c.stage === "NONE") return failure("INVALID_COMBAT_CLEANUP", "A current attack is required");
    m.emit({ kind: "ATTACK_ENDED", attackerId: c.attackerId, reason: "COMPLETED" });
    m.state.timing.combat = { stage: "NONE" };
    m.state.timing.actingPlayer = m.state.timing.activePlayer;
    m.state.resolution = { stage: "DECISION", current: null, pending: [], discovered: [], choice: null };
    // 9.29 does not ready participants or expire Floor It's END_OF_TURN modifier.
    m.phase("MAIN");
    return success(null);
}
function advanceDefeats(m: TurnMutation) {
    const continuation = m.state.resolution.defeatContinuation!;
    while (unfinishedDefeatOrder(m.state)) {
        const choice = defeatOrderChoice(m.state), order = unfinishedDefeatOrder(m.state)!;
        if (choice.options.length > 1) {
            const c = m.state.timing.combat;
            if (!("target" in c) || !c.target) return failure("INVALID_FIGHT", "Locked target required");
            m.state.timing.combat = { ...c, stage: "DEFEAT_ORDER_SELECTION" };
            m.state.timing.step = "DEFEAT_ORDER_SELECTION"; m.state.timing.window = "DEFEAT_ORDER_SELECTION";
            m.state.timing.actingPlayer = choice.actorId;
            m.state.resolution.stage = "CHOICE"; m.state.resolution.choice = choice;
            return success(null);
        }
        const option = choice.options[0];
        if (option.kind !== "CARD") return failure("INVALID_DEFEAT_ORDER", "Expected card order");
        m.state.resolution.defeatContinuation!.orders.find(o => o.targetId === order.targetId)!.cardIds.push(option.cardInstanceId);
        m.emit({ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: order.targetId, cardInstanceId: option.cardInstanceId, ownerId: choice.actorId, forced: true });
    }
    m.state.resolution.choice = null;
    const result = defeatCards(m, continuation.defeats, continuation.orders);
    return result.ok ? finishCombat(m) : result;
}
export function continueDefeatOrder(m: TurnMutation, index: number) {
    const choice = m.state.resolution.choice, option = choice?.options[index], order = unfinishedDefeatOrder(m.state);
    if (!order || option?.kind !== "CARD") return failure("INVALID_DEFEAT_ORDER", "Choose the next card in its owner's Trash order");
    m.state.resolution.defeatContinuation!.orders.find(o => o.targetId === order.targetId)!.cardIds.push(option.cardInstanceId);
    m.emit({ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: order.targetId, cardInstanceId: option.cardInstanceId, ownerId: choice!.actorId, forced: false });
    return advanceDefeats(m);
}
function advanceGigSteal(m: TurnMutation) {
    const c = m.state.timing.combat, continuation = m.state.resolution.gigStealContinuation!;
    if (!("target" in c) || c.target?.kind !== "GIG_AREA") return failure("INVALID_GIG_STEAL", "Current target must be a Gig area");
    const available = listStealableGigs(m.state, c.target.playerId).filter(g => !continuation.selected.includes(g.id));
    if (continuation.remaining > 0 && continuation.remaining < available.length) {
        m.state.timing.combat = { ...c, target: c.target, stage: "GIG_STEAL_SELECTION" };
        m.state.timing.step = "GIG_STEAL_SELECTION"; m.state.timing.window = "GIG_STEAL_SELECTION";
        m.state.timing.actingPlayer = c.attackingPlayerId;
        m.state.resolution.stage = "CHOICE"; m.state.resolution.choice = gigStealChoice(m.state);
        return success(null);
    }
    for (const g of available.slice(0, continuation.remaining)) {
        continuation.selected.push(g.id);
        m.emit({ kind: "GIG_STEAL_SELECTED", gigInstanceId: g.id, attackerId: c.attackerId, forced: true });
    }
    const transferred = transferGigs(m, continuation.selected, c.attackingPlayerId);
    if (!transferred.ok) return transferred;
    // 9.23.5 all moves precede each stolen fact / future 9.23.6 trigger discovery.
    for (const id of [...continuation.selected].sort()) {
        const g = m.state.objects.gigs[id];
        if (g.roll.kind !== "ROLLED") return failure("INVALID_GIG_STEAL", "Rolled Gig required");
        m.emit({ kind: "GIG_STOLEN", gigInstanceId: id, fromPlayer: c.target.playerId, toPlayer: c.attackingPlayerId, currentValue: g.roll.currentValue, attackerId: c.attackerId });
    }
    return finishCombat(m);
}
export function continueGigSteal(m: TurnMutation, index: number) {
    const option = m.state.resolution.choice?.options[index], c = m.state.timing.combat, continuation = m.state.resolution.gigStealContinuation;
    if (c.stage !== "GIG_STEAL_SELECTION" || !continuation || option?.kind !== "GIG" || continuation.selected.includes(option.gigInstanceId)) return failure("INVALID_GIG_SELECTION", "Choose an unselected rival Gig");
    continuation.selected.push(option.gigInstanceId);
    continuation.remaining--;
    m.emit({ kind: "GIG_STEAL_SELECTED", gigInstanceId: option.gigInstanceId, attackerId: c.attackerId, forced: false });
    return advanceGigSteal(m);
}
/** Called synchronously by explicit PASS_REACT; stops only at a reviewed player choice. */
export function resolveCombat(m: TurnMutation) {
    const c = m.state.timing.combat;
    if (c.stage !== "COMBAT_RESOLUTION_PENDING") return failure("INVALID_COMBAT_RESOLUTION", "React must close first");
    const view = new RulesView(m.state, m.context);
    if (c.target.kind === "CARD") {
        for (const id of [c.attackerId, c.target.cardInstanceId]) {
            const supported = defeatSupport(m.state, id, m.context);
            if (!supported.ok) return supported;
            if (view.getEffectivePower(id) === null) return failure("UNSUPPORTED_NULL_FIGHT_POWER", "Null is not a numeric power");
        }
        m.emit({ kind: "FIGHT_STARTED", attackerId: c.attackerId, defenderId: c.target.cardInstanceId });
        const result = evaluateFight(m.state, m.context, id => view.getEffectivePower(id));
        m.emit(result.event);
        // No admitted fight-result triggers (9.18). Never cache power/outcome into GameState.
        if (!result.defeats.length) return finishCombat(m);
        m.state.resolution.defeatContinuation = { defeats: result.defeats, orders: result.defeats.map(d => ({ targetId: d.targetId, cardIds: [] })) };
        return advanceDefeats(m);
    }
    const power = view.getEffectivePower(c.attackerId);
    if (power === null) return failure("UNSUPPORTED_NULL_STEAL_POWER", "Null is not a numeric power");
    const allowance = view.getGigStealAllowance(c.attackerId), available = listStealableGigs(m.state, c.target.playerId);
    const count = Math.min(allowance!, available.length);
    m.emit({ kind: "GIG_STEAL_STARTED", attackerId: c.attackerId, defendingPlayerId: c.target.playerId, power, allowance: allowance!, count });
    if (!count) return finishCombat(m);
    m.state.resolution.gigStealContinuation = { selected: [], remaining: count };
    return advanceGigSteal(m);
}
