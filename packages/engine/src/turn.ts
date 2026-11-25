import { noteSpent } from "./spend-triggers";
import { expireAttackLocks } from "./attack-lock";
import { effectiveCallCost } from "./free-call-support";
import { beginLegendCallChoice, beginLegendCallEffects, legendStartTurnEnabled, resolveStartTurnLegends } from "./legend-spend";
import { supportsCallTrashProgram } from "./call-trash-program-support";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { programPlayHistoryEnabled } from "./restriction-support";
import { expireMustAttack } from "./must-attack";
import { checkOvertimeVictory, recordOvertimeTurnStart } from "./overtime";
import { forgetLegendKnowledge } from "./private-knowledge";
import { cardRevision } from "./characteristics";
import { firstAttackHistoryEnabled } from "./first-attack-support";
import { initialFirstAttackHistory } from "./first-attack-history";
import { triggersEnabled } from "./trigger-support";
import { actionReturnContext, finishAction } from "./action-return";
import { resolveCallPrimitive } from "./effects";
import { z } from "zod";
import { turnSliceAllows, GameStateSchema, GameEventSchema, EffectSchema, hashCanonical, failure, success, type GameState, type GameEvent, type PlayerId, type CardInstanceId, type PaymentSource, type Result } from "@tcg/domain";
import { type EngineContext, validateState } from "./state";
import { RulesView } from "./view";
import { evaluateWinConditions } from "./win";
import { expireStealRestrictions } from "./play-pin-effects";
import { expireReadyLocks, readyLockIds } from "./ready-lock";
export type DraftState = z.infer<typeof GameStateSchema>;
export class TurnMutation {
    readonly state: DraftState;
    readonly events: GameEvent[] = [];
    constructor(state: GameState, readonly context: EngineContext) { this.state = GameStateSchema.parse(state); }
    emit(payload: GameEvent["payload"]) { this.events.push(GameEventSchema.parse({ sequence: ++this.state.match.eventSequence, payload })); }
    phase(step: NonNullable<GameState["timing"]["step"]>) {
        this.state.timing.step = step;
        this.state.timing.window = step === "CHOOSE_GIG" || step === "MAIN" || step === "PAYMENT_SELECTION" || step === "FINISHED" ? step : "RESOLVING";
        if (step === "MAIN" || step === "CHOOSE_GIG" || step === "FINISHED")
            this.state.resolution.stage = "DECISION";
        else if (step !== "PAYMENT_SELECTION")
            this.state.resolution.stage = "STATE_BASED_CHECKS";
        this.emit({ kind: "PHASE_CHANGED", step });
    }
    finish(winnerId: PlayerId, loserId: PlayerId, reason: "EMPTY_DRAW" | "START_TURN_GIGS" | "OVERTIME_GIGS") {
        delete this.state.delayedEffects;
        this.state.match.outcome = { winnerId, loserId, reason };
        this.state.timing.combat = { stage: "NONE" };
        this.state.timing.actingPlayer = this.state.timing.activePlayer;
        this.state.resolution = { stage: "DECISION", current: null, pending: [], discovered: [], choice: null };
        this.phase("FINISHED");
        this.emit({ kind: "GAME_ENDED", winnerId, loserId, reason });
    }
    draw(actor: PlayerId, count: number): Result<null> {
        const p = this.state.players[actor];
        for (let i = 0; i < count; i++) {
            const id = p.zones.DECK[0];
            if (!id) {
                if (!turnSliceAllows(this.context.content.ruleset.gameplay?.turnSlice, "emptyDraw"))
                    return failure("UNSUPPORTED_EMPTY_DRAW", "No empty-draw loss policy");
                this.finish(this.state.match.playerOrder.find(id => id !== actor)!, actor, "EMPTY_DRAW");
                return success(null);
            }
            p.zones.DECK.shift();
            p.zones.HAND.push(id);
            const card = this.state.objects.cards[id], from = { ...card.zone };
            card.zone = { playerId: actor, zone: "HAND" };
            this.emit({ kind: "CARD_MOVED", cardInstanceId: id, from, to: card.zone });
        }
        return success(null);
    }
    startTurn(): Result<null> {
        if (this.state.match.outcome) return failure("GAME_ALREADY_ENDED", "No turn starts after terminal victory or loss");
        const s = this.state, actor = s.timing.activePlayer, rules = this.context.content.ruleset.gameplay!, policy = rules.turnSlice!;
        s.timing.actingPlayer = actor;
        if (triggersEnabled(this.context)) s.turnHistory = { ...(firstAttackHistoryEnabled(this.context) ? { firstArasakaAttacks: initialFirstAttackHistory(s) } : {}), turn: s.timing.turn, triggeredBatches: 0, blueUnitOrGearPlays: Object.fromEntries(s.match.playerOrder.map(id => [id, 0])), ...(programPlayHistoryEnabled(this.context) ? { programPlays: Object.fromEntries(s.match.playerOrder.map(id => [id, 0])) } : {}) };
        s.resolution = { stage: "DECISION", current: null, pending: [], discovered: [], choice: null };
        // Usage belongs to the global turn, including future rival reaction calls.
        for (const p of Object.values(s.players))
            p.economy = { sellsThisTurn: 0, callsThisTurn: 0, usageTurn: s.timing.turn };
        recordOvertimeTurnStart(this);
        this.phase("TURN_START");
        this.emit({ kind: "TURN_STARTED", playerId: actor, turn: s.timing.turn });
        if (checkOvertimeVictory(this)) return success(null);
        // Use the generic evaluator before READY (rules 1.10.1 / 8.6.1).
        const winners = evaluateWinConditions(s, this.context, "TURN_START");
        if (!winners.ok)
            return winners;
        if (winners.value.length) {
            this.finish(actor, s.match.playerOrder.find(id => id !== actor)!, "START_TURN_GIGS");
            return success(null);
        }
        expireStealRestrictions(this, actor); // 8.6.2.1, after the 8.6.1 check.
        expireReadyLocks(this, actor);
        expireAttackLocks(this, actor); // Batch V83.
        expireMustAttack(this, actor); // Batch V43: "next turn" is over once the forcing player's own turn starts.
        if (legendStartTurnEnabled(this.context)) { // Batch V59, 8.6.2.2: start-of-turn effects, before READY and the draw.
            const started = resolveStartTurnLegends(this); if (!started.ok || s.match.outcome) return started;
        }
        this.phase("READY");
        for (const zone of policy.readyZones)
            for (const id of s.players[actor].zones[zone]) {
                const card = s.objects.cards[id];
                const excepted = policy.firstTurnSpentLegendsStaySpent && s.timing.turn === 1 && actor === s.timing.firstPlayer && zone === "LEGENDS" && s.players[actor].zones.LEGENDS.indexOf(id) < rules.firstPlayerSpentLegends;
                const locks = card.readiness === "SPENT" && !excepted ? readyLockIds(s, id) : [];
                if (locks.length) this.emit({ kind: "READY_PREVENTED", cardInstanceId: id, effectIds: locks }); // Batch V22, 2.6.
                else if (card.readiness === "SPENT" && !excepted) {
                    card.readiness = "READY";
                    this.emit({ kind: "CARD_READIED", cardInstanceId: id });
                }
            }
        this.phase("DRAW");
        const drawn = this.draw(actor, policy.drawPerTurn);
        if (!drawn.ok || s.match.outcome)
            return drawn;
        const eligible = new RulesView(s, this.context).listRollableFixerDice(actor);
        this.phase(eligible.length ? "CHOOSE_GIG" : "MAIN");
        return success(null);
    }
    call(actor: PlayerId, legendId: CardInstanceId, sources: PaymentSource[]): Result<null> {
        const s = this.state, view = new RulesView(s, this.context);
        const supported = view.callEffectSupport(legendId);
        if (!supported.ok)
            return supported;
        const payment = view.validatePaymentChoice(actor, sources, { kind: "EDDIES", amount: effectiveCallCost(s, actor, this.context) }); // Batch V66.
        if (!payment.ok)
            return payment;
        s.resolution.returnTo = actionReturnContext(s);
        for (const source of sources)
        { s.objects.cards[source.cardInstanceId].readiness = "SPENT"; noteSpent(this, source.cardInstanceId); } // Batch V69.
        this.emit({ kind: "PAYMENT_MADE", sources });
        s.resolution.choice = null;
        delete s.resolution.callContinuation;
        this.revealCalledLegend(actor, legendId);
        return this.startCallAbility(actor, legendId);
    }
    /** The Call itself: the Legend turns face up and counts against the turn's Call limit. */
    revealCalledLegend(actor: PlayerId, legendId: CardInstanceId) {
        this.state.objects.cards[legendId].face = "UP";
        forgetLegendKnowledge(this, legendId);
        this.state.players[actor].economy.callsThisTurn!++;
        this.emit({ kind: "LEGEND_CALLED", cardInstanceId: legendId });
    }
    /** The Called Legend's {Call} ability, if any, then the end of the action (Batch V84: also for a Call an effect made). */
    startCallAbility(actor: PlayerId, legendId: CardInstanceId): Result<null> {
        const s = this.state, revision = cardRevision(s, legendId, this.context);
        const ability = revision!.mechanics.abilities.find(a => a.trigger === "WHEN_CALLED");
        // Batch V60: "{Call} Choose one effect." pauses for its mode through the activation continuation.
        if (ability?.choose && supportsLegendSpendCard(revision, this.context).ok) return beginLegendCallChoice(this, legendId, actor, ability.id);
        if (ability && supportsCallTrashProgram(revision, this.context).ok) return beginLegendCallEffects(this, legendId, actor, ability.id); // Batch V73.
        if (ability && supportsLegendSpendCard(revision, this.context).ok) return beginLegendCallEffects(this, legendId, actor, ability.id); // Batch V75: a pinned non-modal {Call}.
        if (ability) {
            this.phase("CALL_EFFECT");
            const effect = ability.effects[0];
            const pending = { id: hashCanonical({ kind: "CALL", turn: s.timing.turn, sourceId: legendId }), controllerId: actor, sourceId: legendId, effect: EffectSchema.parse(effect), causedBySequence: s.match.eventSequence };
            s.resolution.stage = "DISCOVER_TRIGGERS";
            s.resolution.pending = [pending];
            this.emit({ kind: "EFFECT_PENDING", effectId: pending.id, sourceId: legendId });
            s.resolution.current = s.resolution.pending.shift()!;
            s.resolution.stage = "RESOLVE_EFFECT";
            const result = resolveCallPrimitive(this, pending.effect);
            if (!result.ok)
                return result;
            if (s.resolution.searchContinuation) return success(null);
            this.emit({ kind: "EFFECT_RESOLVED", effectId: pending.id });
            if (s.match.outcome)
                return success(null);
            s.resolution.current = null;
            s.resolution.stage = "STATE_BASED_CHECKS";
        }
        return finishAction(this);
    }
    finishContinuedEffect() {
        const current = this.state.resolution.current!;
        this.emit({ kind: "EFFECT_RESOLVED", effectId: current.id });
        return finishAction(this);
    }
    paymentChoice(actor: PlayerId, legendId: CardInstanceId, remainingCost: number, selectedSources: PaymentSource[]): Result<null> {
        const view = new RulesView(this.state, this.context), candidates = view.paymentCandidates(actor, remainingCost, selectedSources);
        if (!candidates.length)
            return failure("CANNOT_PAY", "No exact payment continuation exists");
        this.state.resolution.returnTo = actionReturnContext(this.state);
        this.state.resolution.stage = "CHOICE";
        this.state.resolution.callContinuation = { actorId: actor, legendId, remainingCost, selectedSources };
        this.state.resolution.choice = { id: hashCanonical({ kind: "call-payment", turn: this.state.timing.turn, actorSeat: this.state.players[actor].seat, legendId, selectedSources }), actorId: actor, kind: "PAYMENT", options: candidates.map(source => ({ kind: "PAYMENT" as const, source })), min: 1, max: 1, ordered: false, continuationId: "call-payment@1" };
        this.phase("PAYMENT_SELECTION");
        return success(null);
    }
    result(increment = true) {
        if (increment)
            this.state.match.version++;
        const valid = validateState(this.state, this.context);
        return valid.ok ? success({ state: valid.value, events: this.events }) : valid;
    }
}
