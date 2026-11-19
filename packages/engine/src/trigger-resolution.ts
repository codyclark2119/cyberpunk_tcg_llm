import { processDeparture } from "./card-movement";
import { beginTargetedDefeat } from "./targeted-defeat";
import { resolveSpendTarget } from "./targeted-spend";
import { listSpendUnitTargets } from "./targeted-spend-queries";
import { isUnitSpendSubject, spendUnitForEffect } from "./unit-spend";
import { readyCardForEffect, readyLegendTargets } from "./ready-unit";
import type { PendingEffect, DefeatInstruction } from "@tcg/domain";
import { effectiveCardTypes } from "./characteristics";
import { registerEndTurnEffect } from "./delayed-effects";
import { delayedSubjectTypes } from "./delayed-effects";
import { supportsDelayedAttackGear } from "./delayed-effect-support";
import { finishEndTurn } from "./end-turn";
import { readyableEddieSlots, readyEddie } from "./eddie-ready";
import { discardCard, getDiscardableCards } from "./discard";
import { testCondition } from "./conditions";
import { supportsOrderedTriggerSource } from "./ordered-effects-support";
import { grantLegendKnowledge, privateLookTargets } from "./private-knowledge";
import { friendlyPowerTargets } from "./friendly-play-power-queries";
import { supportsFriendlyPlayPowerUnit } from "./friendly-play-power-support";
import { applyTemporaryPower } from "./temporary-power";
import { PendingEffectSchema, TriggerBindingSchema, TriggerOriginSchema, failure, success, type CardInstanceId, type Result, type TriggerBinding, type TriggerOrigin } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { finishAction } from "./action-return";
import { finishAttackEffects } from "./combat";
import { finishCombat, completeFightResult } from "./combat-resolution";
import { HandlerRegistry, finishSearch } from "./effects";
import { searchTargets } from "./search-state";
import { changeGigValue, gigAdjustmentDelta } from "./gig-value";
import { triggersEnabled } from "./trigger-support";
import { discardingPlayer, discoverTriggers, pendingTrigger, trashUnitTargets, triggerChoice, triggerGigTargets } from "./trigger-queries";
import { moveCardLocation } from "./card-movement";

export function recordPlayedCard(m: TurnMutation, sourceId: CardInstanceId) {
    const c = m.state.objects.cards[sourceId], r = cardRevision(m.state, sourceId, m.context)!;
    if (r.colors.includes("BLUE") && effectiveCardTypes(m.state, sourceId, m.context).some(t => t === "UNIT" || t === "GEAR")) {
        const ordinal = ++m.state.turnHistory!.blueUnitOrGearPlays[c.controllerId];
        m.emit({ kind: "QUALIFYING_PLAY_RECORDED", playerId: c.controllerId, cardInstanceId: sourceId, ordinal });
    }
    return beginTriggers(m, { kind: "PLAY", subjectId: sourceId });
}
function resume(m: TurnMutation, origin: TriggerOrigin): Result<null> {
    m.state.resolution = { stage: "STATE_BASED_CHECKS", current: null, pending: [], discovered: [], choice: null };
    m.state.timing.actingPlayer = m.state.timing.activePlayer;
    const combat = m.state.timing.combat;
    if (origin.kind === "END_TURN") return finishEndTurn(m);
    if (origin.kind === "PLAY") return finishAction(m);
    if (origin.kind === "ATTACK" && "target" in combat && combat.target) { m.state.timing.combat = { ...combat, stage: "ATTACK_EFFECTS" }; return finishAttackEffects(m); }
    // Batch V17 (9.11): Blocker-used effects resolve, then the defending player's React Step reopens.
    if (origin.kind === "BLOCK" && "target" in combat && combat.target) { m.state.timing.combat = { ...combat, stage: "RIVAL_REACT" }; return finishAttackEffects(m); }
    if (origin.kind === "FIGHT") return completeFightResult(m, origin.result);
    if (origin.kind === "DEFEAT") return origin.effectSource ? finishAction(m) : finishCombat(m);
    return failure("INVALID_TRIGGER_RETURN", "Trigger batch must return to its original reviewed stage");
}
export type PreparedTriggerBatch = { origin: TriggerOrigin; ordinal: number; bindings: TriggerBinding[]; pending: PendingEffect[] };
/** Creation of pending work is separate from resolution, so a Program can finish before it starts. */
export function prepareTriggerBatch(m: TurnMutation, origin: TriggerOrigin, captured?: readonly TriggerBinding[]): PreparedTriggerBatch | null {
    const bindings = [...(captured ?? discoverTriggers(m.state, origin, m.context))].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.abilityId < b.abilityId ? -1 : 1);
    if (!bindings.length) return null;
    const ordinal = ++m.state.turnHistory!.triggeredBatches, sequence = m.state.match.eventSequence;
    const pending = bindings.map(b => PendingEffectSchema.parse(pendingTrigger(m.state, b, ordinal, sequence, m.context)));
    return { origin, ordinal, bindings, pending };
}
export function activateTriggerBatch(m: TurnMutation, batch: PreparedTriggerBatch, alreadyAnnounced = false): Result<null> {
    const { origin, ordinal, bindings, pending } = batch;
    m.state.resolution = { stage: "DISCOVER_TRIGGERS", current: null, pending: pending.map(e => PendingEffectSchema.parse(e)), discovered: [], choice: null, triggerContinuation: { origin: TriggerOriginSchema.parse(origin), ordinal, bindings: bindings.map(b => TriggerBindingSchema.parse(b)), resolvedIds: [], phase: "SELECT" } };
    const combat = m.state.timing.combat;
    if (origin.kind !== "PLAY" && origin.kind !== "END_TURN" && "target" in combat && combat.target) m.state.timing.combat = { ...combat, stage: "TRIGGER_RESOLUTION" };
    if (!alreadyAnnounced) for (const e of pending) m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
    return advanceTriggers(m);
}
export function beginTriggers(m: TurnMutation, origin: TriggerOrigin, captured?: readonly TriggerBinding[]): Result<null> {
    if (!triggersEnabled(m.context)) return failure("UNSUPPORTED_TRIGGERS", "Trigger policy required");
    if (m.state.resolution.triggerContinuation) return failure("UNSUPPORTED_NESTED_TRIGGERS", "Begin a batch only after the current batch; targeted defeat appends pending work without a stack");
    const batch = prepareTriggerBatch(m, origin, captured);
    return batch ? activateTriggerBatch(m, batch) : resume(m, origin);
}
/** 10.14: append newly pending DEFEATED bindings to this batch; finish its current ability first. */
export function appendDefeatedTriggers(m: TurnMutation, defeats: readonly DefeatInstruction[], captured: readonly TriggerBinding[]) {
    const c = m.state.resolution.triggerContinuation!;
    c.effectDefeats = [...defeats];
    const sequence = m.state.match.eventSequence;
    for (const b of captured) {
        c.bindings.push(TriggerBindingSchema.parse(b));
        const e = PendingEffectSchema.parse(pendingTrigger(m.state, b, c.ordinal, sequence, m.context));
        m.state.resolution.pending.push(e); m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
    }
}
function offer(m: TurnMutation): Result<null> {
    const choice = triggerChoice(m.state, m.context), c = m.state.resolution.triggerContinuation!;
    if (choice.options.length === 1) { m.state.resolution.choice = choice; return continueTrigger(m, 0, true); }
    m.state.resolution.choice = choice; m.state.resolution.stage = "CHOICE"; m.state.timing.actingPlayer = choice.actorId;
    const step = c.phase === "READY" ? "EDDIE_READY_SELECTION" : c.phase === "DISCARD" ? "DISCARD_SELECTION" : c.phase === "SELECT" ? "TRIGGER_ORDER_SELECTION" : c.phase === "OPTIONAL" ? "OPTIONAL_TRIGGER_SELECTION" : c.phase === "TARGET" ? "TARGET_SELECTION" : "AMOUNT_SELECTION";
    m.state.timing.step = step; m.state.timing.window = step;
    m.emit({ kind: "PHASE_CHANGED", step });
    return success(null);
}
export function completed(m: TurnMutation): Result<null> {
    const current = m.state.resolution.current!, c = m.state.resolution.triggerContinuation!;
    if (!current.primitiveIndex && current.trigger?.kind === "WHEN_ATTACKING" && supportsDelayedAttackGear(cardRevision(m.state, current.sourceId!, m.context), m.context).ok) {
        const binding = c.bindings.find(b => b.sourceId === current.sourceId && b.abilityId === current.trigger?.abilityId)!;
        m.state.resolution.current = PendingEffectSchema.parse(pendingTrigger(m.state, binding, c.ordinal, current.causedBySequence, m.context, 1));
        return advanceTriggers(m);
    }
    m.emit({ kind: "EFFECT_RESOLVED", effectId: current.id });
    if (m.state.match.outcome) return success(null);
    c.resolvedIds.push(current.id); c.phase = "SELECT"; delete c.targetGigId; delete c.conditionMet; delete c.selectedEddieSlots;
    m.state.resolution.current = null; m.state.resolution.choice = null;
    return advanceTriggers(m);
}
/** Selection is sequential UI, but readiness changes only after the complete unordered set is chosen. */
function advanceReady(m: TurnMutation): Result<null> {
    const current = m.state.resolution.current!, c = m.state.resolution.triggerContinuation!, selected = c.selectedEddieSlots ?? [];
    if (current.effect.kind !== "READY_EDDIES") return failure("INVALID_READY_EFFECT", "Ready instruction required");
    const eligible = readyableEddieSlots(m.state, current.controllerId).filter(slot => !selected.includes(slot));
    if (selected.length >= current.effect.count || selected.length + eligible.length <= current.effect.count) {
        const slots = [...selected, ...(selected.length < current.effect.count ? eligible : [])].sort((a, b) => a - b);
        for (const slot of slots) { const result = readyEddie(m, current.controllerId, slot); if (!result.ok) return result; }
        return completed(m);
    }
    c.phase = "READY"; return offer(m);
}
export function advanceTriggers(m: TurnMutation): Result<null> {
    const r = m.state.resolution, c = r.triggerContinuation!;
    if (!r.current) {
        if (!r.pending.length) return resume(m, c.origin);
        c.phase = "SELECT"; return offer(m);
    }
    m.state.timing.actingPlayer = r.current.controllerId;
    r.stage = "RESOLVE_EFFECT"; r.choice = null;
    const e = r.current.effect;
    if (e.kind === "POWER_UNTIL_END_OF_TURN" && e.target.kind === "FRIENDLY_UNIT") {
        if (e.amount !== 2 || !r.current.sourceId || r.current.trigger?.kind !== "WHEN_PLAYED"
            || c.origin.kind !== "PLAY" || !supportsFriendlyPlayPowerUnit(cardRevision(m.state, r.current.sourceId, m.context), m.context).ok)
            return failure("INVALID_POWER_SOURCE", "Friendly power requires its reviewed PLAY trigger");
        if (!friendlyPowerTargets(m.state, r.current.controllerId, m.context).length) return completed(m);
        c.phase = "TARGET"; return offer(m);
    }
    if (e.kind === "DEFEAT_UNIT") { c.phase = "TARGET"; return beginTargetedDefeat(m); }
    // Batch V8: "Spend this Unit", then the ordered rival-Unit spend.
    if (e.kind === "SPEND_SOURCE") {
        const current = r.current;
        if (isUnitSpendSubject(m.state, current.sourceId!, m.context)) { const spent = spendUnitForEffect(m, current.sourceId!, current.sourceId!, current.id); if (!spent.ok) return spent; }
        return nextPrimitiveOrCompleted(m);
    }
    if (e.kind === "SPEND_UNIT") {
        if (!listSpendUnitTargets(m.state, r.current.controllerId, e.target, m.context).length) return completed(m);
        c.phase = "TARGET"; return offer(m);
    }
    // Batch V8: own-turn-end ready; the printed "if" is rechecked at resolution.
    if (e.kind === "READY_UNIT") {
        const current = r.current, a = cardRevision(m.state, current.sourceId!, m.context)!.mechanics.abilities.find(a => a.id === current.trigger!.abilityId)!;
        const met = a.conditions.every(cond => testCondition(m.state, current.controllerId, cond, m.context, current.trigger!.subjectId));
        if (a.conditions.length) m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
        if (!met) return completed(m);
        if (e.target.kind === "SOURCE") { const s = m.state.objects.cards[current.trigger!.subjectId]; if ((s?.zone.zone === "BATTLEFIELD" || s?.zone.zone === "LEGENDS") && s.face === "UP") readyCardForEffect(m, s.id); return completed(m); }
        if (!readyLegendTargets(m.state, current.controllerId, m.context).length) return completed(m);
        c.phase = "TARGET"; return offer(m);
    }
    // Batch V9: own-turn-end "return this Unit to its owner's hand"; 4.12 equipped Gear moves with it.
    if (e.kind === "RETURN_TO_HAND") {
        const subject = m.state.objects.cards[r.current.trigger!.subjectId];
        if (subject?.zone.zone !== "BATTLEFIELD" || subject.face !== "UP") return completed(m);
        const stage = m.state.resolution.stage, moved = processDeparture(m, subject.id, "HAND");
        if (!moved.ok) return moved;
        m.state.resolution.stage = stage; return completed(m);
    }
    // Batch V13: "[Defeated] Add another Unit from your trash to your hand"; nothing happens with no other Unit.
    if (e.kind === "RETURN_TRASH_UNIT_TO_HAND") {
        if (!trashUnitTargets(m.state, r.current, m.context).length) return completed(m);
        c.phase = "TARGET"; return offer(m);
    }
    if (e.kind === "REGISTER_END_TURN_EFFECT") { const result = registerEndTurnEffect(m); return result.ok ? completed(m) : result; }
    if (e.kind === "READY_EDDIES") {
        const current = r.current, a = cardRevision(m.state, current.sourceId!, m.context)!.mechanics.abilities.find(a => a.id === current.trigger!.abilityId)!;
        const met = e.when ? testCondition(m.state, current.controllerId, e.when.condition, m.context, current.trigger!.subjectId, delayedSubjectTypes(m.state)) : a.conditions.every(c => testCondition(m.state, current.controllerId, c, m.context, current.trigger!.subjectId));
        m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
        if (!met) return completed(m);
        return advanceReady(m);
    }
    if (e.kind === "DISCARD_CARDS") {
        // Evaluated only after the preceding primitive has actually changed authoritative state.
        const met = !e.when || testCondition(m.state, r.current.controllerId, e.when.condition, m.context, r.current.sourceId);
        if (e.when) m.emit({ kind: "CONDITION_EVALUATED", effectId: r.current.id, met });
        if (!met || !getDiscardableCards(m.state, discardingPlayer(m.state, r.current)).length) return completed(m);
        if (e.when) c.conditionMet = true;
        c.phase = "DISCARD"; return offer(m);
    }
    // Batch V19: "[Attack] Search the top N. Reveal a Gear and add it to your hand. Bottom-deck the rest."
    if (e.kind === "SEARCH_GEAR") {
        const actor = r.current.controllerId;
        r.searchContinuation = { looked: [...m.state.players[actor].zones.DECK.slice(0, e.count)], selected: [] };
        if (!searchTargets(m.state, m.context).length) { const done = finishSearch(m); return done.ok ? completed(m) : done; }
        c.phase = "TARGET"; return offer(m);
    }
    if (e.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND") {
        if (!privateLookTargets(m.state, r.current.controllerId, m.context).length) return completed(m);
        c.phase = "TARGET"; return offer(m);
    }
    if (e.kind === "DECREASE_GIG_UP_TO" || e.kind === "ADJUST_GIG_UP_TO" || e.kind === "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN") {
        if (!triggerGigTargets(m.state).length) return completed(m);
        c.phase = e.kind === "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN" ? "OPTIONAL" : "TARGET";
        return offer(m);
    }
    const current = r.current, result = new HandlerRegistry().resolve(m, e);
    if (!result.ok) return result;
    // Empty draw ends the game and clears the continuation; still preserve the resolved fact.
    if (m.state.match.outcome) { m.emit({ kind: "EFFECT_RESOLVED", effectId: current.id }); return success(null); }
    if (!current.primitiveIndex && supportsOrderedTriggerSource(cardRevision(m.state, current.sourceId!, m.context), m.context)) {
        const binding = c.bindings.find(b => b.sourceId === current.sourceId && b.abilityId === current.trigger?.abilityId)!;
        r.current = PendingEffectSchema.parse(pendingTrigger(m.state, binding, c.ordinal, current.causedBySequence, m.context, 1));
        return advanceTriggers(m);
    }
    return completed(m);
}
/** Advance an admitted two-primitive ability to its second primitive, or finish it. */
function nextPrimitiveOrCompleted(m: TurnMutation): Result<null> {
    const r = m.state.resolution, c = r.triggerContinuation!, current = r.current!;
    if (!current.primitiveIndex && supportsOrderedTriggerSource(cardRevision(m.state, current.sourceId!, m.context), m.context)) {
        const binding = c.bindings.find(b => b.sourceId === current.sourceId && b.abilityId === current.trigger?.abilityId)!;
        r.current = PendingEffectSchema.parse(pendingTrigger(m.state, binding, c.ordinal, current.causedBySequence, m.context, 1));
        return advanceTriggers(m);
    }
    return completed(m);
}
export function continueTrigger(m: TurnMutation, index: number, forced = false): Result<null> {
    const r = m.state.resolution, c = r.triggerContinuation!, option = r.choice?.options[index];
    if (!option) return failure("INVALID_TRIGGER_CHOICE", "Choose an enumerated pending-effect option");
    r.choice = null;
    if (c.phase === "SELECT") {
        if (option.kind !== "EFFECT") return failure("INVALID_TRIGGER_ORDER", "Choose a pending effect controlled by the scheduled player");
        const i = r.pending.findIndex(e => e.id === option.effectId); if (i < 0) return failure("INVALID_TRIGGER_ORDER", "Unknown pending effect");
        r.current = r.pending.splice(i, 1)[0]; m.state.timing.actingPlayer = r.current.controllerId;
        m.emit({ kind: "TRIGGER_ORDER_SELECTED", effectId: r.current.id, controllerId: r.current.controllerId, forced });
        return advanceTriggers(m);
    }
    const current = r.current!;
    if (c.phase === "READY") {
        if (current.effect.kind !== "READY_EDDIES" || option.kind !== "EDDIE_SLOT") return failure("INVALID_EDDIE_READY", "Choose a currently eligible Eddie slot");
        if (!readyableEddieSlots(m.state, current.controllerId).includes(option.slot) || c.selectedEddieSlots?.includes(option.slot)) return failure("INVALID_EDDIE_READY", "A spent Eddie can be selected only once");
        c.selectedEddieSlots = [...(c.selectedEddieSlots ?? []), option.slot].sort((a, b) => a - b);
        return advanceReady(m);
    }
    if (c.phase === "DISCARD") {
        if (current.effect.kind !== "DISCARD_CARDS" || option.kind !== "CARD") return failure("INVALID_DISCARD", "Choose one current own-hand card");
        const result = discardCard(m, current.effect, option.cardInstanceId, forced);
        return result.ok ? completed(m) : result;
    }
    if (c.phase === "OPTIONAL") {
        if (option.kind !== "CONFIRM") return failure("INVALID_OPTIONAL_TRIGGER", "Accept or decline explicitly");
        m.emit({ kind: option.confirmed ? "OPTIONAL_TRIGGER_ACCEPTED" : "OPTIONAL_TRIGGER_DECLINED", effectId: current.id, controllerId: current.controllerId });
        if (!option.confirmed) return completed(m);
        c.phase = "TARGET"; return offer(m);
    }
    if (c.phase === "TARGET") {
        if (current.effect.kind === "POWER_UNTIL_END_OF_TURN") {
            if (current.effect.target.kind !== "FRIENDLY_UNIT" || current.effect.amount !== 2 || option.kind !== "CARD")
                return failure("INVALID_POWER_TARGET", "Choose a friendly Unit for the reviewed PLAY power effect");
            const applied = applyTemporaryPower(m, option.cardInstanceId, forced);
            return applied.ok ? completed(m) : applied;
        }
        if (current.effect.kind === "SPEND_UNIT") {
            if (option.kind !== "CARD") return failure("INVALID_SPEND_TARGET", "Choose a current rival Unit");
            const spent = resolveSpendTarget(m, option.cardInstanceId, forced);
            return spent.ok ? completed(m) : spent;
        }
        if (current.effect.kind === "READY_UNIT") {
            if (option.kind !== "CARD" || !readyLegendTargets(m.state, current.controllerId, m.context).includes(option.cardInstanceId)) return failure("INVALID_READY_TARGET", "Choose a current friendly face-up Legend");
            m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced });
            readyCardForEffect(m, option.cardInstanceId);
            return completed(m);
        }
        if (current.effect.kind === "RETURN_TRASH_UNIT_TO_HAND") {
            if (option.kind !== "CARD" || !trashUnitTargets(m.state, current, m.context).includes(option.cardInstanceId)) return failure("INVALID_TRASH_TARGET", "Choose another Unit in your trash");
            m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced });
            moveCardLocation(m, option.cardInstanceId, "HAND");
            return completed(m);
        }
        if (current.effect.kind === "SEARCH_GEAR") {
            // 11.17.4.1: a hidden search may purposely fail to find; the rest is bottom-decked either way.
            const search = r.searchContinuation!;
            if (option.kind === "CARD") {
                if (search.selected.includes(option.cardInstanceId) || !searchTargets(m.state, m.context).includes(option.cardInstanceId)) return failure("INVALID_SEARCH_TARGET", "Chosen Gear is no longer eligible");
                search.selected.push(option.cardInstanceId);
            } else if (option.kind !== "MODE" || option.mode !== "DONE") return failure("INVALID_SEARCH_TARGET", "Choose a looked-at Gear or take none");
            if (option.kind === "CARD" && search.selected.length < current.effect.maxTake && searchTargets(m.state, m.context).some(id => !search.selected.includes(id))) return offer(m);
            const done = finishSearch(m); return done.ok ? completed(m) : done;
        }
        if (current.effect.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND") {
            if (option.kind !== "LEGEND_SLOT") return failure("INVALID_LOOK_TARGET", "Choose a public Legend slot");
            const learned = grantLegendKnowledge(m, current.controllerId, option.slot);
            return learned.ok ? completed(m) : learned;
        }
        if (option.kind !== "GIG" || !triggerGigTargets(m.state).includes(option.gigInstanceId)) return failure("INVALID_TRIGGER_TARGET", "Choose a currently valid Gig");
        c.targetGigId = option.gigInstanceId; c.phase = "AMOUNT";
        m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: option.gigInstanceId });
        return offer(m);
    }
    const delta = current.effect.kind === "ADJUST_GIG_UP_TO" ? gigAdjustmentDelta(current.effect, option) : option.kind === "AMOUNT" ? -option.amount : null;
    if (delta === null) return failure("INVALID_TRIGGER_AMOUNT", "Choose a legal adjustment or decrease amount");
    if (!delta) m.emit({ kind: "GIG_ADJUSTMENT_DECLINED", gigInstanceId: c.targetGigId! });
    else {
        const result = changeGigValue(m.state, c.targetGigId!, delta, m.context); if (!result.ok) return result;
        m.emit(result.value);
    }
    if (current.effect.kind === "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN") {
        const g = m.state.objects.gigs[c.targetGigId!], met = delta < 0 && g.roll.kind === "ROLLED" && g.roll.currentValue === 1;
        m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
        if (met) { const result = m.draw(current.controllerId, current.effect.draw); if (!result.ok) return result; }
        if (m.state.match.outcome) { m.emit({ kind: "EFFECT_RESOLVED", effectId: current.id }); return success(null); }
    }
    return completed(m);
}
