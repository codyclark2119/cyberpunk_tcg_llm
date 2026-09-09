import { effectiveCardTypes } from "./characteristics";
import { delayedEffectsEnabled, supportsDelayedAttackGear } from "./delayed-effect-support";
import { delayedBinding } from "./delayed-effects";
import { delayedSubjectTypes } from "./delayed-effects";
import { readyableEddieSlots } from "./eddie-ready";
import { endTurnEnabled } from "./end-turn-support";
import { firstAttackHistoryEnabled, supportsFirstAttackLegend } from "./first-attack-support";
import { isFirstArasakaAttack } from "./first-attack-history";
import { supportsOrderedTriggerSource } from "./ordered-effects-support";
import { testCondition } from "./conditions";
import { canonicalSerialize, failure, success, type GameState, type FightResult, type TriggerBinding } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { supportsEffectiveTriggerSource, triggersEnabled } from "./trigger-support";
import { discoverTriggers, nextTriggerGroup, pendingTrigger, triggerChoice, triggerGigTargets, triggerId } from "./trigger-queries";

/** Validate the historical comparison, not a new comparison using post-trigger power. */
export function validFightFact(state: GameState, f: FightResult) {
    const c = state.timing.combat, a = Math.max(0, f.attackerPower), d = Math.max(0, f.defenderPower);
    return "target" in c && c.target?.kind === "CARD" && f.attackerId === c.attackerId && f.defenderId === c.target.cardInstanceId && f.attackerComparisonPower === a && f.defenderComparisonPower === d && f.winnerId === (a === d ? null : a > d ? f.attackerId : f.defenderId) && canonicalSerialize(f.loserIds) === canonicalSerialize([...(a <= d ? [f.attackerId] : []), ...(d <= a ? [f.defenderId] : [])]);
}
function validBinding(state: GameState, b: TriggerBinding, context: EngineContext) {
    const c = state.resolution.triggerContinuation!, source = state.objects.cards[b.sourceId], subject = state.objects.cards[b.subjectId], r = cardRevision(state, b.sourceId, context);
    const ability = r?.mechanics.abilities.find(a => a.id === b.abilityId);
    if (!source || !subject || !state.players[b.controllerId] || b.controllerId !== subject.controllerId || b.controllerId !== source.controllerId || !supportsEffectiveTriggerSource(r, context) || source.cardId !== b.source.cardId || source.revision !== b.source.revision || !ability || (b.delayedId ? ability.trigger !== "WHEN_ATTACKING" : ability.trigger !== b.kind) || (b.sourceId !== b.subjectId) !== (ability.inherited === "EQUIPPED_HOST")) return false;
    const origin = c.origin;
    if (b.delayedId || b.kind === "DELAYED_END_TURN") {
        const d = origin.kind === "END_TURN" && origin.delayedEffects?.find(d => d.id === b.delayedId);
        return Boolean(d && supportsDelayedAttackGear(r, context).ok && canonicalSerialize(b) === canonicalSerialize(delayedBinding(d)));
    }
    if (origin.kind === "END_TURN") return b.kind === "WHEN_OWN_TURN_ENDS" && b.sourceId === b.subjectId && b.controllerId === origin.playerId && ability.conditions.every(c => testCondition(state, b.controllerId, c, context, b.subjectId));
    if (origin.kind === "FIGHT") return b.kind === "WHEN_FIGHT_WON" && b.subjectId === origin.result.winnerId && validFightFact(state, origin.result);
    if (origin.kind === "DEFEAT") return b.kind === "WHEN_DEFEATED" && origin.defeated.some(d => d.targetId === b.subjectId) && !["BATTLEFIELD", "LEGENDS"].includes(subject.zone.zone);
    if (origin.kind === "ATTACK") {
        if (b.kind === "WHEN_UNIT_ATTACKS") return b.sourceId === b.subjectId && source.face === "UP" && source.zone.zone === "LEGENDS" && supportsFirstAttackLegend(r, context).ok && state.objects.cards[origin.subjectId]?.controllerId === b.controllerId && isFirstArasakaAttack(state, origin.subjectId, context);
        return b.kind === "WHEN_ATTACKING" && b.subjectId === origin.subjectId;
    }
    if (b.kind === "WHEN_PLAYED") return b.subjectId === origin.subjectId;
    const played = state.objects.cards[origin.subjectId], revision = cardRevision(state, origin.subjectId, context);
    return b.kind === "WHEN_CARD_PLAYED" && ability.guard === "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN" && r?.type === "LEGEND" && played?.controllerId === b.controllerId && revision?.colors.includes("BLUE") && effectiveCardTypes(state, played.id, context).some(t => t === "UNIT" || t === "GEAR") && state.turnHistory!.blueUnitOrGearPlays[b.controllerId] === 1;
}
export function validateTriggerState(state: GameState, context: EngineContext) {
    const r = state.resolution, c = r.triggerContinuation, history = state.turnHistory, enabled = triggersEnabled(context);
    const all = [...r.pending, ...(r.current ? [r.current] : []), ...r.discovered];
    if (!enabled && (c || history || all.some(e => e.trigger))) return failure("UNSUPPORTED_TRIGGER_POLICY", "Trigger/history data require the bounded policy");
    if (enabled && (!context.content.ruleset.gameplay?.turnSlice?.combatRestrictions || (!state.setup && (!history || history.turn !== state.timing.turn || canonicalSerialize(Object.keys(history.blueUnitOrGearPlays).sort()) !== canonicalSerialize([...state.match.playerOrder].sort()))))) return failure("INVALID_TURN_HISTORY", "Current turn, exact player counters and prior combat policy required");
    if (state.setup && history) return failure("INVALID_TURN_HISTORY", "Turn history starts with the first actual turn");
    if (!c) return all.some(e => e.trigger || e.primitiveIndex !== undefined) || state.timing.combat.stage === "TRIGGER_RESOLUTION" || ["EDDIE_READY_SELECTION", "DISCARD_SELECTION", "TRIGGER_ORDER_SELECTION", "OPTIONAL_TRIGGER_SELECTION"].includes(state.timing.step ?? "") ? failure("ORPHAN_TRIGGER", "Pending trigger metadata requires its continuation") : success(null);
    if (!enabled || state.setup || state.match.outcome || r.returnTo || r.legendEntryContinuation || r.playContinuation || r.callContinuation || r.searchContinuation || r.gigStealContinuation || r.defeatContinuation || r.discovered.length || r.stage !== "CHOICE" || !r.choice || c.ordinal !== history?.triggeredBatches || Object.values(state.objects.cards).some(c => c.zone.zone === "RESOLVING_PROGRAM")) return failure("INVALID_TRIGGER_CONTINUATION", "Exclusive player-choice trigger batch required");
    const combat = state.timing.combat;
    if (c.origin.kind === "END_TURN" && (!(endTurnEnabled(context) || delayedEffectsEnabled(context)) || c.origin.playerId !== state.timing.activePlayer || c.origin.turn !== state.timing.turn)) return failure("INVALID_END_TURN_RETURN", "Current active player/global turn and supported end-turn policy required");
    if (c.origin.kind === "PLAY" || c.origin.kind === "END_TURN" ? combat.stage !== "NONE" : combat.stage !== "TRIGGER_RESOLUTION" || combat.attackingPlayerId !== state.timing.activePlayer) return failure("INVALID_TRIGGER_COMBAT", "Trigger batch must pause its original combat stage");
    if (combat.stage === "TRIGGER_RESOLUTION") {
        const attacker = state.objects.cards[combat.attackerId];
        const targetValid = combat.target.kind === "CARD" ? state.objects.cards[combat.target.cardInstanceId]?.controllerId !== combat.attackingPlayerId && Boolean(state.objects.cards[combat.target.cardInstanceId]) : Boolean(state.players[combat.target.playerId]) && combat.target.playerId !== combat.attackingPlayerId;
        if (!attacker || attacker.controllerId !== combat.attackingPlayerId || !targetValid) return failure("INVALID_TRIGGER_COMBAT", "Historical participants must retain valid identity/controller references");
        if (c.origin.kind !== "DEFEAT" && (attacker.zone.zone !== "BATTLEFIELD" || (combat.target.kind === "CARD" && state.objects.cards[combat.target.cardInstanceId].zone.zone !== "BATTLEFIELD"))) return failure("UNSUPPORTED_TRIGGER_DEPARTURE", "Admitted pending primitives cannot move combat participants");
    }
    if (c.origin.kind === "ATTACK" && (combat.stage !== "TRIGGER_RESOLUTION" || combat.attackerId !== c.origin.subjectId || state.objects.cards[combat.attackerId].readiness !== "SPENT")) return failure("INVALID_ATTACK_TRIGGER", "Committed attacking subject required");
    if (c.origin.kind === "DEFEAT" && (new Set(c.origin.defeated.map(d => d.targetId)).size !== c.origin.defeated.length || c.origin.defeated.some(d => !state.objects.cards[d.defeatedBy] || !state.objects.cards[d.targetId] || ["BATTLEFIELD", "LEGENDS"].includes(state.objects.cards[d.targetId].zone.zone)))) return failure("INVALID_DEFEATED_TRIGGER", "Defeat declaration and movement must precede the pending batch");
    if (c.bindings.some(b => !validBinding(state, b, context))) return failure("INVALID_TRIGGER_SOURCE", "Immutable source, inherited subject, trigger-time controller and origin must match reviewed text");
    if (c.origin.kind === "ATTACK" && firstAttackHistoryEnabled(context)) {
        // These admitted attack primitives cannot remove/reveal sources. The complete captured
        // batch must therefore match declaration-time discovery, including already resolved bindings.
        const expected = discoverTriggers(state, c.origin, context).map(b => canonicalSerialize(b)).sort();
        if (canonicalSerialize(expected) !== canonicalSerialize(c.bindings.map(b => canonicalSerialize(b)).sort()))
            return failure("INVALID_TRIGGER_BATCH", "Every eligible attack source must be captured once");
    }
    const ids = c.bindings.map(b => triggerId(state, b, c.ordinal)), remaining = all.map(e => e.id), partition = [...remaining, ...c.resolvedIds];
    if (new Set(ids).size !== ids.length || new Set(partition).size !== partition.length || canonicalSerialize([...partition].sort()) !== canonicalSerialize([...ids].sort())) return failure("INVALID_TRIGGER_BATCH", "Every captured independent trigger must be exactly pending, current or resolved");
    for (const e of all) {
        if (e.primitiveIndex !== undefined && (e !== r.current || e.primitiveIndex !== 1 || !(supportsOrderedTriggerSource(cardRevision(state, e.sourceId!, context), context) || e.trigger?.kind === "WHEN_ATTACKING" && supportsDelayedAttackGear(cardRevision(state, e.sourceId!, context), context).ok))) return failure("INVALID_PRIMITIVE_INDEX", "Only the current reviewed ordered ability may advance to its second primitive");
        const binding = c.bindings.find(b => triggerId(state, b, c.ordinal) === e.id);
        if (!binding || canonicalSerialize(e) !== canonicalSerialize(pendingTrigger(state, binding, c.ordinal, e.causedBySequence, context, e.primitiveIndex ?? 0))) return failure("INVALID_PENDING_TRIGGER", "Pending effect must equal its immutable ability and semantic origin");
    }
    const activeIds = c.bindings.filter(b => b.controllerId === state.timing.activePlayer).map(b => triggerId(state, b, c.ordinal));
    const rivalHasResolved = c.resolvedIds.some(id => !activeIds.includes(id));
    if ((r.current && r.current.controllerId !== state.timing.activePlayer || rivalHasResolved) && activeIds.some(id => !c.resolvedIds.includes(id))) return failure("INVALID_TRIGGER_PRIORITY", "Turn player's pending effects precede the rival's");
    if (c.phase === "SELECT" ? Boolean(r.current) || nextTriggerGroup(state).length < 2 : !r.current) return failure("INVALID_TRIGGER_PHASE", "Ordering is strategic only with multiple eligible effects; effect choices require a current effect");
    if (c.phase !== "SELECT" && (!r.current || !["READY_EDDIES", "DISCARD_CARDS", "DECREASE_GIG_UP_TO", "ADJUST_GIG_UP_TO", "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN", "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND"].includes(r.current.effect.kind))) return failure("INVALID_TRIGGER_PHASE", "Only reviewed adjustment/look/discard/ready primitives pause for choices");
    if ((c.phase === "READY" || r.current?.effect.kind === "READY_EDDIES") && (c.phase !== "READY" || r.current?.effect.kind !== "READY_EDDIES" || c.origin.kind !== "END_TURN")) return failure("INVALID_READY_CONTINUATION", "Ready choices require their pending end-turn ability");
    if (c.selectedEddieSlots && (c.phase !== "READY" || r.current?.effect.kind !== "READY_EDDIES" || r.current.effect.count !== 2 || c.selectedEddieSlots.some(slot => !readyableEddieSlots(state, r.current!.controllerId).includes(slot))))
        return failure("INVALID_READY_SELECTION", "Only a count2 ready choice may hold one still-spent public slot");
    if (c.phase === "READY" && r.current?.effect.kind === "READY_EDDIES") {
        const e = r.current.effect, selected = c.selectedEddieSlots ?? [], available = readyableEddieSlots(state, r.current.controllerId).filter(slot => !selected.includes(slot));
        if (available.length <= e.count - selected.length || e.when && !testCondition(state, r.current.controllerId, e.when.condition, context, r.current.trigger!.subjectId, delayedSubjectTypes(state)))
            return failure("INVALID_READY_CONTINUATION", "Only a true-condition strategic selection may remain pending; forced cases resolve automatically");
    }
    if (c.phase === "DISCARD" || r.current?.effect.kind === "DISCARD_CARDS" || c.conditionMet !== undefined) {
        const e = r.current;
        // No admitted primitive can change Gigs while paused here. Historical true and current
        // true must agree; advancing an index cannot manufacture a false-condition discard.
        if (c.phase !== "DISCARD" || e?.effect.kind !== "DISCARD_CARDS" || e.primitiveIndex !== 1 || c.conditionMet !== true || !e.effect.when || !testCondition(state, e.controllerId, e.effect.when.condition, context, e.sourceId)) return failure("INVALID_DISCARD_CONTINUATION", "Post-draw true condition and exact current second primitive required");
    }
    if (r.current?.effect.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND" && c.phase !== "TARGET") return failure("INVALID_TRIGGER_PHASE", "Private look pauses only for a target");
    if (c.phase === "OPTIONAL" && r.current?.effect.kind !== "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN") return failure("INVALID_OPTIONAL_TRIGGER", "Only the printed may effect offers acceptance");
    if (c.phase === "AMOUNT" ? !c.targetGigId || !triggerGigTargets(state).includes(c.targetGigId) : Boolean(c.targetGigId)) return failure("INVALID_TRIGGER_TARGET", "Exact target required only during amount selection");
    const expectedStep = c.phase === "READY" ? "EDDIE_READY_SELECTION" : c.phase === "DISCARD" ? "DISCARD_SELECTION" : c.phase === "SELECT" ? "TRIGGER_ORDER_SELECTION" : c.phase === "OPTIONAL" ? "OPTIONAL_TRIGGER_SELECTION" : c.phase === "TARGET" ? "TARGET_SELECTION" : "AMOUNT_SELECTION";
    if (state.timing.step !== expectedStep || state.timing.window !== expectedStep || canonicalSerialize(r.choice) !== canonicalSerialize(triggerChoice(state, context)) || r.choice.options.length < 2) return failure("INVALID_TRIGGER_CHOICE", "Only exact strategic current options may pause automatic resolution");
    return success(null);
}
