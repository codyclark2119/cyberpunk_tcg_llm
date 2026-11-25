import { chooseTrashProgram } from "./trash-program";
import { applyGearPower, resolveGearDefeatDraw } from "./gear-legend";
import { applyBlockerGrant } from "./blocker-grant";
import { applyRockerGrant } from "./rocker-grant";
import { moveGearAndReady, selectMovedGear } from "./gear-move";
import { noteSpent } from "./spend-triggers";
import { applyMustAttack } from "./must-attack";
import { applyFightDefeatImmunity } from "./fight-immunity";
import { advanceCrossSet, advanceMandatorySwap, crossSetSources, crossSetTargets, swapChoiceGigs } from "./legend-spend";
import { swapGigs } from "./gig-transfer";
import { applyFightPowerGrant } from "./fight-power-grant";
import { applyStealReduction } from "./steal-reduction";
import { recordCyberwareGearPlay } from "./play-cost-support";
import { resolveSpendTarget } from "./targeted-spend";
import { activateTriggerBatch, beginTriggers, joinProgramPlayBindings, type PreparedTriggerBatch } from "./trigger-resolution";
import { recordPlayedCard } from "./trigger-resolution";
import { discoverTriggers } from "./trigger-queries";
import { chooseTrashedTopProgram, isBraindanceProgram } from "./braindance-legend";
import { chooseRivalReveal } from "./rival-reveal";
import { chooseHandResetDraw } from "./hand-reset";
import { chooseGrantMode, selectGrantUnit } from "./ready-attack-grant";
import { triggersEnabled } from "./trigger-support";
import { actionReturnContext, finishAction } from "./action-return";
import { applyTemporaryPower } from "./temporary-power";
import { attachPlayedGear, moveCardLocation } from "./card-movement";
import { EffectSchema, failure, success, type CardInstanceId, type GameState, type GigInstanceId, type PlayerId, type PaymentSource, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { revisionOf } from "./play-support";
import { playChoice, playEffectId, adjustmentTargets } from "./play-state";
import { forcedPaymentSources, paymentValue, validatePayment } from "./payment";
import { playPaymentAmount } from "./play-cost-support";
import { activationPaymentAmount } from "./quick-activation-support";
import { HandlerRegistry, continueSearch } from "./effects";
import { chooseTrashedUnit } from "./trash-return";
import { chooseBottomDeck } from "./bottom-deck";
import { changeGigValue, gigAdjustmentDelta, gigSetSources, gigSetTargets } from "./gig-value";
import { testCondition } from "./conditions";

export function offerPlayChoice(m: TurnMutation) {
    const choice = playChoice(m.state, m.context);
    m.state.resolution.choice = choice;
    const effect = m.state.resolution.current?.effect;
    // Only new directional effects adopt forced target/zero-magnitude resolution; preserve old replay protocols.
    if (effect?.kind === "ADJUST_GIG_UP_TO" && effect.direction !== undefined && choice.options.length === 1) return continuePlay(m, 0);
    m.state.resolution.stage = "CHOICE";
    const step = choice.kind === "PAYMENT" ? "PAYMENT_SELECTION" : choice.kind === "TARGET" || choice.kind === "MODE" ? "TARGET_SELECTION" : "AMOUNT_SELECTION";
    m.state.timing.step = step;
    m.state.timing.window = step;
    m.emit({ kind: "PHASE_CHANGED", step });
    return success(null);
}
function finishPlay(m: TurnMutation, sourceId: CardInstanceId, aftermath?: PreparedTriggerBatch | null) {
    if (m.state.objects.cards[sourceId].zone.zone === "RESOLVING_PROGRAM") moveCardLocation(m, sourceId, "TRASH");
    // Batch V76: "When you play a BRAINDANCE Program" bindings, pending since the play, wait for the Program to resolve.
    const programPlay = !m.state.match.outcome && triggersEnabled(m.context) && m.state.resolution.playContinuation?.kind === "PLAY" && isBraindanceProgram(m.state, sourceId, m.context)
        ? discoverTriggers(m.state, { kind: "PLAY", subjectId: sourceId }, m.context) : [];
    if (aftermath && programPlay.length) joinProgramPlayBindings(m, aftermath, sourceId, programPlay);
    if (!m.state.match.outcome && aftermath) return activateTriggerBatch(m, aftermath, true);
    if (programPlay.length) return beginTriggers(m, { kind: "PLAY", subjectId: sourceId }, programPlay);
    if (!m.state.match.outcome && triggersEnabled(m.context) && m.state.resolution.playContinuation?.kind === "PLAY" && ["UNIT", "GEAR"].includes(revisionOf(m.state, sourceId, m.context)!.type)) return recordPlayedCard(m, sourceId);
    if (!m.state.match.outcome) return finishAction(m);
    return success(null);
}
/** Resolves an ordered finite list. Choices pause the current primitive, never create model positions mid-chain. */
function resolveChain(m: TurnMutation): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, sourceId = c.sourceId;
    const registry = new HandlerRegistry();
    while (s.resolution.current) {
        const current = s.resolution.current;
        s.resolution.stage = "RESOLVE_EFFECT";
        const result = registry.resolve(m, current.effect);
        if (!result.ok) return result;
        // A forced target/amount may have resumed and finished the chain synchronously.
        if ((current.effect.kind === "DEFEAT_UNIT" || current.effect.kind === "ADJUST_GIG_UP_TO" && current.effect.direction !== undefined) && s.resolution.current !== current) return success(null);
        if (s.resolution.choice) return success(null);
        m.emit({ kind: "EFFECT_RESOLVED", effectId: current.id });
        if (s.match.outcome) return finishPlay(m, sourceId);
        c.effectIndex++;
        s.resolution.current = s.resolution.pending.shift() ?? null;
    }
    return finishPlay(m, sourceId);
}
/** Finish the current Program primitive, then its lifecycle before resolving newly pending work. */
export function completePlayEffect(m: TurnMutation, aftermath?: PreparedTriggerBatch | null): Result<null> {
    const r = m.state.resolution, current = r.current!, c = r.playContinuation!;
    m.emit({ kind: "EFFECT_RESOLVED", effectId: current.id });
    r.choice = null; c.effectIndex++; r.current = r.pending.shift() ?? null;
    return r.current ? resolveChain(m) : finishPlay(m, c.sourceId, aftermath);
}
/** The resolving ability: an activation names its own (Batch V49: not necessarily the first printed one). */
function playAbility(m: TurnMutation) {
    const c = m.state.resolution.playContinuation!, abilities = revisionOf(m.state, c.sourceId, m.context)!.mechanics.abilities;
    return c.kind === "ACTIVATE" ? abilities.find(a => a.id === c.abilityId)! : abilities[0];
}
function beginEffects(m: TurnMutation): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, r = revisionOf(s, c.sourceId, m.context)!, a = playAbility(m);
    c.phase = "EFFECT";
    s.resolution.choice = null;
    if (c.kind === "PLAY" && r.type === "UNIT") return finishPlay(m, c.sourceId); // Spend is not an ON_PLAY trigger.
    m.phase("CARD_EFFECT");
    s.resolution.stage = "DISCOVER_TRIGGERS";
    if (a.choose) {
        // Batch V44: "If <condition>, choose both instead" is checked as the Program resolves; otherwise its controller picks one mode.
        if (!a.choose.allInstead) return failure("INVALID_MODE", "A Program's modal ability names its both-instead condition"); // Batch V60: Legends start in MODE.
        const all = testCondition(s, c.actorId, a.choose.allInstead, m.context, c.sourceId);
        m.emit({ kind: "CONDITION_EVALUATED", effectId: playEffectId(s, 0), met: all });
        if (!all) { c.phase = "MODE"; return offerPlayChoice(m); }
    }
    return pendEffects(m, a.effects.map((_, index) => index));
}
/** Batch V73: a Called Legend's single printed {Call} effect resolves through the activation continuation, so it can pause for a choice. */
export function beginActivationEffects(m: TurnMutation): Result<null> {
    m.state.resolution.choice = null;
    return pendEffects(m, playAbility(m).effects.map((_, index) => index));
}
/** The listed printed effects become pending in printed order, each keeping its printed index, and resolve as a chain. */
function pendEffects(m: TurnMutation, indexes: number[]): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, a = playAbility(m), causedBySequence = s.match.eventSequence;
    c.effectIndex = indexes[0];
    s.resolution.pending = indexes.map(index => ({ id: playEffectId(s, index), sourceId: c.sourceId, controllerId: c.actorId, causedBySequence, effect: EffectSchema.parse(a.effects[index]) }));
    for (const effect of s.resolution.pending) m.emit({ kind: "EFFECT_PENDING", effectId: effect.id, sourceId: c.sourceId });
    s.resolution.current = s.resolution.pending.shift() ?? null;
    return resolveChain(m);
}
function completePayment(m: TurnMutation, sources: PaymentSource[]): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, r = revisionOf(s, c.sourceId, m.context)!;
    const amount = c.kind === "ACTIVATE" ? activationPaymentAmount(playAbility(m), s, c.actorId) : playPaymentAmount(s, c.actorId, c.sourceId, m.context)!;
    const payment = validatePayment(s, c.actorId, m.context, sources, { kind: "EDDIES", amount });
    return payment.ok ? payValidated(m, payment.value) : payment;
}

export function startPlay(m: TurnMutation, actorId: PlayerId, sourceId: CardInstanceId): Result<null> {
    const s = m.state, r = revisionOf(s, sourceId, m.context)!;
    if (r.printedCost.kind !== "EDDIES") return failure("UNSUPPORTED_CARD_PLAY", "Reviewed printed payment required");
    s.resolution.returnTo = actionReturnContext(s);
    s.objects.cards[sourceId].face = "UP";
    m.emit({ kind: "CARD_REVEALED", cardInstanceId: sourceId });
    s.resolution.playContinuation = { kind: "PLAY", actorId, sourceId, ...(r.type !== "GEAR" && r.mechanics.abilities[0] ? { abilityId: r.mechanics.abilities[0].id } : {}), phase: "PAYMENT", remainingCost: playPaymentAmount(s, actorId, sourceId, m.context)!, selectedSources: [], effectIndex: 0 };
    const forced = forcedPaymentSources(s, actorId, m.context, s.resolution.playContinuation.remainingCost, []);
    if (forced) return completePayment(m, forced);
    return offerPlayChoice(m);
}
// Used after validation of a forced payment or completion of an enumerated payment continuation.
function payValidated(m: TurnMutation, sources: PaymentSource[]): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, r = revisionOf(s, c.sourceId, m.context)!;
    c.selectedSources = sources; c.remainingCost = 0;
    for (const p of sources) { s.objects.cards[p.cardInstanceId].readiness = "SPENT"; noteSpent(m, p.cardInstanceId); } // Batch V69.
    m.emit({ kind: "PAYMENT_MADE", sources });
    if (c.kind === "ACTIVATE") return beginEffects(m); // Batch V49: a paid activation's effect follows its costs.
    if (r.type === "GEAR") {
        c.phase = "EQUIP";
        s.objects.cards[c.sourceId].readiness = "READY";
        return offerPlayChoice(m);
    }
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: c.sourceId });
    if (r.type === "PROGRAM" && s.turnHistory?.programPlays) s.turnHistory.programPlays[c.actorId]++;
    moveCardLocation(m, c.sourceId, r.type === "PROGRAM" ? "RESOLVING_PROGRAM" : "BATTLEFIELD");
    if (r.type === "UNIT") { s.objects.cards[c.sourceId].readiness = "READY"; s.objects.cards[c.sourceId].statuses.push("LAG"); }
    return beginEffects(m);
}
export function continuePlay(m: TurnMutation, index: number): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, option = s.resolution.choice!.options[index];
    if (c.phase === "PAYMENT") {
        if (option.kind !== "PAYMENT") return failure("INVALID_PAYMENT", "Expected payment source");
        const sources = [...c.selectedSources, option.source], remaining = c.remainingCost - paymentValue(s, m.context, option.source);
        const forced = forcedPaymentSources(s, c.actorId, m.context, remaining, sources);
        if (forced) return completePayment(m, [...sources, ...forced]);
        c.selectedSources = sources; c.remainingCost = remaining;
        return offerPlayChoice(m);
    }
    if (c.phase === "MODE") {
        // Batch V44: one printed mode, named by its effect kind; only it becomes pending.
        const effects = playAbility(m).effects, index = option.kind === "MODE" ? effects.findIndex(e => e.kind === option.mode) : -1;
        if (index < 0) return failure("INVALID_MODE", "Choose one enumerated printed mode");
        c.phase = "EFFECT"; c.chosenEffect = index; s.resolution.choice = null;
        m.emit({ kind: "EFFECT_MODE_CHOSEN", sourceId: c.sourceId, playerId: c.actorId, effectIndex: index });
        return pendEffects(m, [index]);
    }
    if (c.phase === "EQUIP") {
        if (option.kind !== "CARD") return failure("INVALID_EQUIP_TARGET", "Choose an enumerated host");
        const equipped = attachPlayedGear(m, c.sourceId, option.cardInstanceId);
        if (!equipped.ok) return equipped;
        recordCyberwareGearPlay(m, c.actorId, c.sourceId); // Batch V53.
        // 11.20.2: play requirements are fulfilled only after equipping, not merely after payment.
        m.emit({ kind: "CARD_PLAYED", cardInstanceId: c.sourceId });
        return finishPlay(m, c.sourceId);
    }
    if (s.resolution.current?.effect.kind === "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG") {
        const searched = continueSearch(m, index);
        return !searched.ok || s.resolution.searchContinuation ? searched : completePlayEffect(m);
    }
    if (s.resolution.current?.effect.kind === "SET_GIG_TO_ANOTHER_GIG_VALUE") return continueGigSet(m, option);
    if (s.resolution.current?.effect.kind === "SPEND_UNIT") {
        if (option.kind !== "CARD") return failure("INVALID_SPEND_TARGET", "Choose an enumerated Unit");
        const spent = resolveSpendTarget(m, option.cardInstanceId);
        return spent.ok ? completePlayEffect(m) : spent;
    }
    if (s.resolution.current?.effect.kind === "TRASH_THEN_RETURN_UNIT") {
        if (option.kind !== "CARD") return failure("INVALID_TRASH_TARGET", "Choose an enumerated trashed Unit");
        const returned = chooseTrashedUnit(m, option.cardInstanceId);
        return returned.ok ? completePlayEffect(m) : returned;
    }
    if (s.resolution.current?.effect.kind === "TRASH_THEN_ADD_TRASH_PROGRAM") { // Batch V73.
        if (option.kind !== "CARD") return failure("INVALID_TRASH_TARGET", "Choose an enumerated trash Program");
        const added = chooseTrashProgram(m, option.cardInstanceId);
        return added.ok ? completePlayEffect(m) : added;
    }
    if (s.resolution.current?.effect.kind === "BOTTOM_DECK_UNIT") {
        if (option.kind !== "CARD") return failure("INVALID_BOTTOM_DECK_TARGET", "Choose an enumerated Unit");
        const moved = chooseBottomDeck(m, option.cardInstanceId, offerPlayChoice);
        // An "if you do" clause may pause on its own choice before the primitive completes.
        return !moved.ok ? moved : s.resolution.choice ? success(null) : completePlayEffect(m);
    }
    if (s.resolution.current?.effect.kind === "FORCE_RIVAL_UNIT_ATTACK") { // Batch V63.
        if (option.kind !== "CARD") return failure("INVALID_MUST_ATTACK", "Choose an enumerated rival Unit");
        s.resolution.choice = null;
        const applied = applyMustAttack(m, option.cardInstanceId, false);
        return applied.ok ? completePlayEffect(m) : applied;
    }
    if (s.resolution.current?.effect.kind === "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE") { // Batch V62.
        const valid = c.targetGigId ? crossSetSources(s, c.targetGigId) : crossSetTargets(s);
        if (option.kind !== "GIG" || !valid.includes(option.gigInstanceId)) return failure("INVALID_GIG_TARGET", "Choose an enumerated Gig");
        s.resolution.choice = null;
        m.emit({ kind: "GIG_TARGET_SELECTED", effectId: s.resolution.current.id, gigInstanceId: option.gigInstanceId });
        const advanced = c.targetGigId ? advanceCrossSet(m, c.targetGigId, option.gigInstanceId) : advanceCrossSet(m, option.gigInstanceId, undefined);
        return !advanced.ok ? advanced : advanced.value === "CHOICE" ? offerPlayChoice(m) : completePlayEffect(m);
    }
    if (s.resolution.current?.effect.kind === "SWAP_GIGS") { // Batch V59: the friendly Gig, then the rival Gig.
        const current = s.resolution.current;
        if (option.kind !== "GIG" || !swapChoiceGigs(s, c.actorId, c.targetGigId).includes(option.gigInstanceId)) return failure("INVALID_GIG_SWAP", "Choose an enumerated Gig");
        s.resolution.choice = null;
        m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: option.gigInstanceId });
        if (!c.targetGigId) {
            const advanced = advanceMandatorySwap(m, c.actorId, option.gigInstanceId);
            if (!advanced.ok) return advanced;
            if (advanced.value === "CHOICE") return offerPlayChoice(m);
        } else {
            const swapped = swapGigs(m, current.id, c.targetGigId, option.gigInstanceId);
            if (!swapped.ok) return swapped;
        }
        delete c.targetGigId;
        return completePlayEffect(m);
    }
    if (s.resolution.current?.effect.kind === "FRIENDLY_UNIT_READY_ATTACK_AND_POWER") { // Batch V79: the Unit, then (with less Street Cred) the Rival's effect.
        const chosen = c.grantTargetId ? option.kind === "MODE" ? chooseGrantMode(m, option.mode) : failure("INVALID_GRANT_MODE", "Choose one effect for the Unit")
            : option.kind === "CARD" ? selectGrantUnit(m, option.cardInstanceId, false, offerPlayChoice) : failure("INVALID_GRANT_TARGET", "Choose a current friendly field Unit");
        if (!chosen.ok || s.resolution.choice) return chosen;
        return completePlayEffect(m);
    }
    if (s.resolution.current?.effect.kind === "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW") { // Batch V78: the controller, then the Rival.
        if (option.kind !== "MODE") return failure("INVALID_OPTIONAL_DRAW", "Choose whether to draw");
        const sourceId = c.sourceId, chosen = chooseHandResetDraw(m, option.mode === "DRAW");
        if (!chosen.ok) return chosen;
        if (m.state.match.outcome) return finishPlay(m, sourceId);
        return chosen.value.done ? completePlayEffect(m) : offerPlayChoice(m);
    }
    if (s.resolution.current?.effect.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH") { // Batch V77.
        if (option.kind !== "MODE") return failure("INVALID_DESTINATION", "Choose hand or trash for the revealed cards");
        const sourceId = c.sourceId, chosen = chooseRivalReveal(m, option.mode);
        if (!chosen.ok) return chosen;
        return m.state.match.outcome ? finishPlay(m, sourceId) : completePlayEffect(m); // Drawing from an empty deck ends the game, as in resolveChain.
    }
    if (s.resolution.current?.effect.kind === "TRASH_TOP_MAY_ADD_PROGRAM") { // Batch V76.
        if (option.kind !== "CARD" && !(option.kind === "CONFIRM" && !option.confirmed)) return failure("INVALID_TRASH_TARGET", "Add the trashed Program, or leave it");
        const chosen = chooseTrashedTopProgram(m, option.kind === "CARD" ? option.cardInstanceId : undefined);
        return chosen.ok ? completePlayEffect(m) : chosen;
    }
    if (s.resolution.current?.effect.kind === "MAY_DEFEAT_FRIENDLY_GEAR_THEN_DRAW") { // Batch V75.
        if (option.kind !== "CARD" && !(option.kind === "CONFIRM" && !option.confirmed)) return failure("INVALID_DEFEAT_TARGET", "Choose an enumerated friendly Gear, or decline");
        const resolved = resolveGearDefeatDraw(m, option.kind === "CARD" ? option.cardInstanceId : undefined, false);
        return resolved.ok ? completePlayEffect(m) : resolved;
    }
    if (s.resolution.current?.effect.kind === "POWER_PER_EQUIPPED_GEAR_THIS_TURN") { // Batch V75.
        if (option.kind !== "CARD") return failure("INVALID_POWER_TARGET", "Choose an enumerated friendly Unit");
        s.resolution.choice = null;
        const applied = applyGearPower(m, option.cardInstanceId, false);
        return applied.ok ? completePlayEffect(m) : applied;
    }
    if (s.resolution.current?.effect.kind === "MOVE_SOURCE_GEAR_TO_UNEQUIPPED_UNIT_THEN_READY") { // Batch V82: the Gear, then its Unit.
        if (option.kind !== "CARD") return failure("INVALID_GEAR_MOVE", "Choose a Gear on this Legend or an unequipped friendly Unit");
        const held = c.movedGearId, moved = held ? moveGearAndReady(m, held, option.cardInstanceId) : selectMovedGear(m, option.cardInstanceId, offerPlayChoice);
        return !moved.ok || s.resolution.playContinuation?.movedGearId ? moved : completePlayEffect(m);
    }
    if (s.resolution.current?.effect.kind === "FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED") { // Batch V80.
        if (option.kind !== "CARD") return failure("INVALID_GRANT_TARGET", "Choose a current friendly field Unit");
        const applied = applyRockerGrant(m, option.cardInstanceId, false);
        return applied.ok ? completePlayEffect(m) : applied;
    }
    if (s.resolution.current?.effect.kind === "GRANT_BLOCKER_THIS_TURN") { // Batch V74.
        if (option.kind !== "CARD") return failure("INVALID_KEYWORD_TARGET", "Choose an enumerated friendly Unit");
        s.resolution.choice = null;
        const applied = applyBlockerGrant(m, option.cardInstanceId, false);
        return applied.ok ? completePlayEffect(m) : applied;
    }
    if (s.resolution.current?.effect.kind === "FIGHT_DEFEAT_IMMUNITY_THIS_TURN") { // Batch V61.
        if (option.kind !== "CARD") return failure("INVALID_FIGHT_IMMUNITY", "Choose an enumerated friendly Unit");
        s.resolution.choice = null;
        const applied = applyFightDefeatImmunity(m, option.cardInstanceId, false);
        return applied.ok ? completePlayEffect(m) : applied;
    }
    if (s.resolution.current?.effect.kind === "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN") { // Batch V58.
        if (option.kind !== "CARD") return failure("INVALID_FIGHT_POWER", "Choose an enumerated friendly Unit");
        s.resolution.choice = null;
        const applied = applyFightPowerGrant(m, option.cardInstanceId, false);
        return applied.ok ? completePlayEffect(m) : applied;
    }
    if (s.resolution.current?.effect.kind === "STEAL_FEWER_THIS_TURN") { // Batch V57.
        if (option.kind !== "CARD") return failure("INVALID_STEAL_REDUCTION", "Choose an enumerated rival Unit");
        s.resolution.choice = null;
        const applied = applyStealReduction(m, option.cardInstanceId, false);
        return applied.ok ? completePlayEffect(m) : applied;
    }
    if (s.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN") {
        if (option.kind !== "CARD") return failure("INVALID_POWER_TARGET", "Choose an enumerated rival Unit");
        const applied = applyTemporaryPower(m, option.cardInstanceId);
        if (!applied.ok) return applied;
        m.emit({ kind: "EFFECT_RESOLVED", effectId: s.resolution.current.id });
        c.effectIndex++; s.resolution.choice = null;
        s.resolution.current = s.resolution.pending.shift() ?? null;
        return resolveChain(m);
    }
    if (!c.targetGigId) {
        if (option.kind !== "GIG" || !adjustmentTargets(s).includes(option.gigInstanceId)) return failure("INVALID_GIG_TARGET", "Target is no longer eligible");
        c.targetGigId = option.gigInstanceId;
        m.emit({ kind: "GIG_TARGET_SELECTED", effectId: s.resolution.current!.id, gigInstanceId: c.targetGigId });
        return offerPlayChoice(m);
    }
    const effect = s.resolution.current?.effect, delta = effect?.kind === "ADJUST_GIG_UP_TO" ? gigAdjustmentDelta(effect, option) : null;
    if (delta === null) return failure("INVALID_GIG_AMOUNT", "Choose an enumerated adjustment");
    if (delta === 0) m.emit({ kind: "GIG_ADJUSTMENT_DECLINED", gigInstanceId: c.targetGigId });
    else {
        const changed = changeGigValue(s, c.targetGigId, delta, m.context);
        if (!changed.ok) return changed;
        m.emit(changed.value);
    }
    m.emit({ kind: "EFFECT_RESOLVED", effectId: s.resolution.current!.id });
    delete c.targetGigId; c.effectIndex++;
    s.resolution.choice = null;
    s.resolution.current = s.resolution.pending.shift() ?? null;
    return resolveChain(m);
}
/** Batch V37: decline, or pick the Gig to set; then the other Gig whose value it takes (a lone source needs no choice). */
function continueGigSet(m: TurnMutation, option: NonNullable<GameState["resolution"]["choice"]>["options"][number]): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, current = s.resolution.current!;
    if (!c.targetGigId) {
        if (option.kind === "CONFIRM" && !option.confirmed) { m.emit({ kind: "OPTIONAL_TRIGGER_DECLINED", effectId: current.id, controllerId: c.actorId }); return completePlayEffect(m); }
        if (option.kind !== "GIG" || !gigSetTargets(s).includes(option.gigInstanceId)) return failure("INVALID_GIG_TARGET", "Choose an enumerated Gig to set");
        c.targetGigId = option.gigInstanceId;
        m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: c.targetGigId });
        const sources = gigSetSources(s, c.targetGigId);
        return sources.length === 1 ? setGig(m, sources[0]) : offerPlayChoice(m);
    }
    if (option.kind !== "GIG" || !gigSetSources(s, c.targetGigId).includes(option.gigInstanceId)) return failure("INVALID_GIG_TARGET", "Choose an enumerated Gig whose value to take");
    return setGig(m, option.gigInstanceId);
}
function setGig(m: TurnMutation, sourceGigId: GigInstanceId): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, target = s.objects.gigs[c.targetGigId!], source = s.objects.gigs[sourceGigId];
    if (target.roll.kind !== "ROLLED" || source.roll.kind !== "ROLLED") return failure("INVALID_GIG_TARGET", "Both Gigs must be rolled");
    const changed = changeGigValue(s, target.id, source.roll.currentValue - target.roll.currentValue, m.context);
    if (!changed.ok) return changed;
    m.emit(changed.value);
    delete c.targetGigId;
    return completePlayEffect(m);
}
export function activateAbility(m: TurnMutation, actorId: PlayerId, sourceId: CardInstanceId, abilityId: string): Result<null> {
    const s = m.state, ability = revisionOf(s, sourceId, m.context)!.mechanics.abilities.find(a => a.id === abilityId)!;
    s.objects.cards[sourceId].readiness = "SPENT"; noteSpent(m, sourceId); // Batch V69.
    m.emit({ kind: "CARD_SPENT", cardInstanceId: sourceId });
    m.emit({ kind: "ABILITY_ACTIVATED", sourceInstanceId: sourceId, abilityId });
    const amount = activationPaymentAmount(ability, s, actorId);
    if (amount) {
        // Batch V49 (11.30.2): a paid Quick activation, in MAIN or the React Step; it returns to whichever decision it was taken from.
        s.resolution.returnTo = actionReturnContext(s);
        s.resolution.playContinuation = { kind: "ACTIVATE", sourceId, actorId, abilityId, phase: "PAYMENT", remainingCost: amount, selectedSources: [], effectIndex: 0 };
        const forced = forcedPaymentSources(s, actorId, m.context, amount, []);
        return forced ? completePayment(m, forced) : offerPlayChoice(m);
    }
    s.resolution.returnTo = { kind: "MAIN" };
    s.resolution.playContinuation = { kind: "ACTIVATE", sourceId, actorId, abilityId, phase: "EFFECT", remainingCost: 0, selectedSources: [], effectIndex: 0 };
    // 11.15.3.1: distinct activation and resolution checks, even though no reaction window intervenes here.
    if (!ability.conditions.every(condition => testCondition(s, actorId, condition))) return finishPlay(m, sourceId);
    return beginEffects(m);
}
