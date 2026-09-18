import { failure, success, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { testCondition } from "./conditions";
import { defeatCards } from "./defeat";
import { defeatOrderChoice, unfinishedDefeatOrder } from "./combat-outcome-queries";
import { completePlayEffect } from "./play";
import { appendDefeatedTriggers, completed, prepareTriggerBatch } from "./trigger-resolution";
import { targetedDefeatChoice } from "./targeted-defeat-queries";
function finishWithoutDefeat(m: TurnMutation) { return m.state.resolution.triggerContinuation ? completed(m) : completePlayEffect(m); }
export function beginTargetedDefeat(m: TurnMutation): Result<null> {
    const r = m.state.resolution, current = r.current!;
    if (current.effect.kind !== "DEFEAT_UNIT") return failure("INVALID_TARGETED_DEFEAT", "Expected typed defeat primitive");
    if (current.effect.when) {
        const met = testCondition(m.state, current.controllerId, current.effect.when.condition, m.context, current.sourceId);
        m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
        if (!met) return finishWithoutDefeat(m);
    }
    const choice = targetedDefeatChoice(m.state, m.context);
    if (!choice.options.length) return finishWithoutDefeat(m);
    r.targetedDefeatContinuation = { phase: "TARGET" }; r.choice = choice;
    if (choice.options.length === 1) return continueTargetedDefeat(m, 0, true);
    r.stage = "CHOICE"; m.state.timing.actingPlayer = choice.actorId; m.state.timing.step = "TARGET_SELECTION"; m.state.timing.window = "TARGET_SELECTION"; m.emit({ kind: "PHASE_CHANGED", step: "TARGET_SELECTION" });
    return success(null);
}
function advanceOwnerOrder(m: TurnMutation): Result<null> {
    const r = m.state.resolution;
    while (unfinishedDefeatOrder(m.state)) {
        const choice = defeatOrderChoice(m.state);
        r.choice = choice;
        if (choice.options.length > 1) { r.stage = "CHOICE"; m.state.timing.actingPlayer = choice.actorId; m.state.timing.step = "DEFEAT_ORDER_SELECTION"; m.state.timing.window = "DEFEAT_ORDER_SELECTION"; m.emit({ kind: "PHASE_CHANGED", step: "DEFEAT_ORDER_SELECTION" }); return success(null); }
        const option = choice.options[0];
        if (option.kind !== "CARD") return failure("INVALID_DEFEAT_ORDER", "Expected owner card order");
        const order = unfinishedDefeatOrder(m.state)!;
        r.defeatContinuation!.orders.find(o => o.targetId === order.targetId)!.cardIds.push(option.cardInstanceId);
        m.emit({ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: order.targetId, cardInstanceId: option.cardInstanceId, ownerId: choice.actorId, forced: true });
    }
    const current = r.current!, defeats = r.defeatContinuation!.defeats;
    const result = defeatCards(m, defeats, r.defeatContinuation!.orders, current.effect.kind === "DEFEAT_UNIT" && current.effect.target.kind === "GEAR");
    if (!result.ok) return result;
    delete r.defeatContinuation; delete r.targetedDefeatContinuation; r.choice = null;
    m.state.timing.actingPlayer = current.controllerId;
    if (r.triggerContinuation) { appendDefeatedTriggers(m, defeats, result.value); return completed(m); }
    const batch = prepareTriggerBatch(m, { kind: "DEFEAT", effectSource: current.sourceId!, defeated: defeats }, result.value);
    if (batch) for (const e of batch.pending) m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
    return completePlayEffect(m, batch);
}
export function continueTargetedDefeat(m: TurnMutation, index: number, forced = false): Result<null> {
    const r = m.state.resolution, c = r.targetedDefeatContinuation!, current = r.current!, choice = r.choice!, option = choice.options[index];
    if (option?.kind !== "CARD") return failure("INVALID_DEFEAT_TARGET", "Choose one enumerated Unit or owner-order card");
    if (c.phase === "TARGET") {
        if (!targetedDefeatChoice(m.state, m.context).options.some(o => o.kind === "CARD" && o.cardInstanceId === option.cardInstanceId)) return failure("INVALID_DEFEAT_TARGET", "Target must remain eligible");
        m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced });
        r.defeatContinuation = { defeats: [{ targetId: option.cardInstanceId, defeatedBy: current.sourceId! }], orders: [{ targetId: option.cardInstanceId, cardIds: [] }] };
        c.phase = "ORDER";
    } else {
        const order = unfinishedDefeatOrder(m.state);
        if (!order) return failure("INVALID_DEFEAT_ORDER", "Unfinished owner order required");
        r.defeatContinuation!.orders.find(o => o.targetId === order.targetId)!.cardIds.push(option.cardInstanceId);
        m.emit({ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: order.targetId, cardInstanceId: option.cardInstanceId, ownerId: choice.actorId, forced });
    }
    return advanceOwnerOrder(m);
}
