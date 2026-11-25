import { failure, success, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { testCondition } from "./conditions";
import { defeatCards } from "./defeat";
import { discardedCostMatchesFriendlyGig } from "./discard";
import { defeatOrderChoice, unfinishedDefeatOrder } from "./combat-outcome-queries";
import { completePlayEffect } from "./play";
import { appendDefeatedTriggers, completed, prepareTriggerBatch } from "./trigger-resolution";
import { allOtherDefeatTargets, eachDefeatChoice, eachDefeatPlayers, ownDefeatTargets, secondDefeatChoice, secondDefeatTargets, targetedDefeatChoice, thenDefeatChoice, thenDefeatTargets } from "./targeted-defeat-queries";
function finishWithoutDefeat(m: TurnMutation) { return m.state.resolution.triggerContinuation ? completed(m) : completePlayEffect(m); }
export function beginTargetedDefeat(m: TurnMutation): Result<null> {
    const r = m.state.resolution, current = r.current!;
    if (current.effect.kind !== "DEFEAT_UNIT") return failure("INVALID_TARGETED_DEFEAT", "Expected typed defeat primitive");
    if (current.effect.when) {
        const met = testCondition(m.state, current.controllerId, current.effect.when.condition, m.context, current.sourceId);
        m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
        if (!met) return finishWithoutDefeat(m);
    }
    const all = allOtherDefeatTargets(m.state, current, m.context);
    if (all) {
        // No target choice: each defeated Unit's owner orders only its own Gear batch (11.19.2 shared movement).
        if (!all.length) return finishWithoutDefeat(m);
        for (const targetId of all) m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId, controllerId: current.controllerId, forced: true });
        r.defeatContinuation = { defeats: all.map(targetId => ({ targetId, defeatedBy: current.sourceId! })), orders: all.map(targetId => ({ targetId, cardIds: [] })) };
        r.targetedDefeatContinuation = { phase: "ORDER" };
        return advanceOwnerOrder(m);
    }
    if (current.effect.target.kind === "UNITS" && current.effect.target.each) {
        r.targetedDefeatContinuation = { phase: "EACH" }; // Defeats are recorded once the first is selected.
        return advanceEach(m);
    }
    const choice = targetedDefeatChoice(m.state, m.context);
    if (!choice.options.length) return finishWithoutDefeat(m);
    r.targetedDefeatContinuation = { phase: "TARGET" }; r.choice = choice;
    if (choice.options.length === 1) return continueTargetedDefeat(m, 0, true);
    r.stage = "CHOICE"; m.state.timing.actingPlayer = choice.actorId; m.state.timing.step = "TARGET_SELECTION"; m.state.timing.window = "TARGET_SELECTION"; m.emit({ kind: "PHASE_CHANGED", step: "TARGET_SELECTION" });
    return success(null);
}
function pauseForTarget(m: TurnMutation, choice: NonNullable<TurnMutation["state"]["resolution"]["choice"]>): Result<null> {
    const r = m.state.resolution;
    r.choice = choice; r.stage = "CHOICE"; m.state.timing.actingPlayer = choice.actorId; m.state.timing.step = "TARGET_SELECTION"; m.state.timing.window = "TARGET_SELECTION"; m.emit({ kind: "PHASE_CHANGED", step: "TARGET_SELECTION" });
    return success(null);
}
/** Each player, in turn order from the controller, picks one of their own Units; one candidate is forced, none is skipped. */
function advanceEach(m: TurnMutation): Result<null> {
    const r = m.state.resolution, current = r.current!, d = r.defeatContinuation ?? { defeats: [], orders: [] };
    for (const player of eachDefeatPlayers(m.state, current)) {
        if (d.defeats.some(x => m.state.objects.cards[x.targetId].controllerId === player)) continue;
        const options = ownDefeatTargets(m.state, player, current, m.context);
        if (!options.length) continue;
        if (options.length > 1) { if (d.defeats.length) r.defeatContinuation = d; return pauseForTarget(m, eachDefeatChoice(m.state, m.context, player)); }
        m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: options[0], controllerId: current.controllerId, forced: true });
        d.defeats.push({ targetId: options[0], defeatedBy: current.sourceId! }); d.orders.push({ targetId: options[0], cardIds: [] });
    }
    r.defeatContinuation = d;
    if (!d.defeats.length) { delete r.defeatContinuation; delete r.targetedDefeatContinuation; r.choice = null; m.state.timing.actingPlayer = current.controllerId; return finishWithoutDefeat(m); }
    r.targetedDefeatContinuation = { phase: "ORDER" };
    return advanceOwnerOrder(m);
}
function advanceOwnerOrder(m: TurnMutation): Result<null> {
    const r = m.state.resolution;
    while (unfinishedDefeatOrder(m.state, m.context)) {
        const choice = defeatOrderChoice(m.state, m.context);
        r.choice = choice;
        if (choice.options.length > 1) { r.stage = "CHOICE"; m.state.timing.actingPlayer = choice.actorId; m.state.timing.step = "DEFEAT_ORDER_SELECTION"; m.state.timing.window = "DEFEAT_ORDER_SELECTION"; m.emit({ kind: "PHASE_CHANGED", step: "DEFEAT_ORDER_SELECTION" }); return success(null); }
        const option = choice.options[0];
        if (option.kind !== "CARD") return failure("INVALID_DEFEAT_ORDER", "Expected owner card order");
        const order = unfinishedDefeatOrder(m.state, m.context)!;
        r.defeatContinuation!.orders.find(o => o.targetId === order.targetId)!.cardIds.push(option.cardInstanceId);
        m.emit({ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: order.targetId, cardInstanceId: option.cardInstanceId, ownerId: choice.actorId, forced: true });
    }
    const current = r.current!, defeats = r.defeatContinuation!.defeats, wasThen = Boolean(r.targetedDefeatContinuation?.then);
    const result = defeatCards(m, defeats, r.defeatContinuation!.orders, !wasThen && current.effect.kind === "DEFEAT_UNIT" && current.effect.target.kind === "GEAR");
    if (!result.ok) return result;
    delete r.defeatContinuation; delete r.targetedDefeatContinuation; r.choice = null;
    m.state.timing.actingPlayer = current.controllerId;
    if (r.triggerContinuation) {
        appendDefeatedTriggers(m, result.value.defeated, result.value.triggered); // Batch V89: what was actually defeated.
        // Batch V34: "If its cost equals the value of a friendly Gig, draw 1": the defeated card's printed cost, after it has moved.
        if (current.effect.kind === "DEFEAT_UNIT" && current.effect.draw) {
            const met = discardedCostMatchesFriendlyGig(m.state, current.controllerId, defeats[0].targetId, m.context);
            m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
            if (met) { const drawn = m.draw(current.controllerId, current.effect.draw.count); if (!drawn.ok) return drawn; }
            if (m.state.match.outcome) { m.emit({ kind: "EFFECT_RESOLVED", effectId: current.id }); return success(null); }
        }
        // Batch V55: "If you do, defeat a rival Unit ...": the first defeat happened, so the second clause applies now.
        if (current.effect.kind === "DEFEAT_UNIT" && current.effect.then && !wasThen && !m.state.match.outcome) return beginThenDefeat(m);
        return completed(m);
    }
    const batch = prepareTriggerBatch(m, { kind: "DEFEAT", effectSource: current.sourceId!, defeated: result.value.defeated }, result.value.triggered);
    if (batch) for (const e of batch.pending) m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
    return completePlayEffect(m, batch);
}
function beginThenDefeat(m: TurnMutation): Result<null> {
    const r = m.state.resolution, current = r.current!, targets = thenDefeatTargets(m.state, current, m.context);
    if (!targets.length) return completed(m);
    r.targetedDefeatContinuation = { phase: "THEN", then: true };
    if (targets.length === 1) { r.choice = thenDefeatChoice(m.state, m.context); return continueTargetedDefeat(m, 0, true); }
    return pauseForTarget(m, thenDefeatChoice(m.state, m.context));
}
export function continueTargetedDefeat(m: TurnMutation, index: number, forced = false): Result<null> {
    const r = m.state.resolution, c = r.targetedDefeatContinuation!, current = r.current!, choice = r.choice!, option = choice.options[index];
    // Batch V34: "You may defeat a Gear": declining defeats nothing, and nothing after it happens.
    if (c.phase === "TARGET" && option?.kind === "CONFIRM" && !option.confirmed && current.effect.kind === "DEFEAT_UNIT" && current.effect.optional) {
        m.emit({ kind: "OPTIONAL_TRIGGER_DECLINED", effectId: current.id, controllerId: current.controllerId });
        delete r.targetedDefeatContinuation; r.choice = null; m.state.timing.actingPlayer = current.controllerId;
        return finishWithoutDefeat(m);
    }
    if (c.phase === "SECOND" && option?.kind === "CONFIRM" && !option.confirmed) { c.phase = "ORDER"; return advanceOwnerOrder(m); } // Declined: defeat only the first.
    if (option?.kind !== "CARD") return failure("INVALID_DEFEAT_TARGET", "Choose one enumerated Unit or owner-order card");
    if (c.phase === "EACH") {
        if (!eachDefeatChoice(m.state, m.context, choice.actorId).options.some(o => o.kind === "CARD" && o.cardInstanceId === option.cardInstanceId)) return failure("INVALID_DEFEAT_TARGET", "Choose one of your own eligible Units");
        m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced });
        const d = r.defeatContinuation ??= { defeats: [], orders: [] };
        d.defeats.push({ targetId: option.cardInstanceId, defeatedBy: current.sourceId! }); d.orders.push({ targetId: option.cardInstanceId, cardIds: [] });
        return advanceEach(m);
    }
    if (c.phase === "THEN") {
        if (!thenDefeatTargets(m.state, current, m.context).includes(option.cardInstanceId)) return failure("INVALID_DEFEAT_TARGET", "Target must remain eligible");
        m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced });
        r.defeatContinuation = { defeats: [{ targetId: option.cardInstanceId, defeatedBy: current.sourceId! }], orders: [{ targetId: option.cardInstanceId, cardIds: [] }] };
        c.phase = "ORDER";
        return advanceOwnerOrder(m);
    }
    if (c.phase === "SECOND") {
        const firstId = r.defeatContinuation!.defeats[0].targetId;
        if (!secondDefeatTargets(m.state, current, firstId, m.context).includes(option.cardInstanceId)) return failure("INVALID_DEFEAT_TARGET", "Second target must remain eligible and distinct");
        m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced });
        r.defeatContinuation!.defeats.push({ targetId: option.cardInstanceId, defeatedBy: current.sourceId! }); r.defeatContinuation!.orders.push({ targetId: option.cardInstanceId, cardIds: [] });
        c.phase = "ORDER";
        return advanceOwnerOrder(m);
    }
    if (c.phase === "TARGET") {
        if (!targetedDefeatChoice(m.state, m.context).options.some(o => o.kind === "CARD" && o.cardInstanceId === option.cardInstanceId)) return failure("INVALID_DEFEAT_TARGET", "Target must remain eligible");
        m.emit({ kind: "DEFEAT_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced });
        r.defeatContinuation = { defeats: [{ targetId: option.cardInstanceId, defeatedBy: current.sourceId! }], orders: [{ targetId: option.cardInstanceId, cardIds: [] }] };
        if (secondDefeatTargets(m.state, current, option.cardInstanceId, m.context).length) { c.phase = "SECOND"; return pauseForTarget(m, secondDefeatChoice(m.state, m.context, option.cardInstanceId)); }
        c.phase = "ORDER";
    } else {
        const order = unfinishedDefeatOrder(m.state, m.context);
        if (!order) return failure("INVALID_DEFEAT_ORDER", "Unfinished owner order required");
        r.defeatContinuation!.orders.find(o => o.targetId === order.targetId)!.cardIds.push(option.cardInstanceId);
        m.emit({ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: order.targetId, cardInstanceId: option.cardInstanceId, ownerId: choice.actorId, forced });
    }
    return advanceOwnerOrder(m);
}
