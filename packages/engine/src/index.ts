import { TurnMutation } from "./turn";
import { drawDeterministicDie } from "./rng";
import { GameActionSchema, GameCommandSchema, GameStateSchema, GameEventSchema, hashCanonical, canonicalSerialize, failure, success, type Result, type GameState, type GameAction, type GameEvent, type PlayerId, type LegalAction, type GigInstanceId, type PendingEffect, type Effect } from "@tcg/domain";
import { validateState, hashPosition, type EngineContext } from "./state";
import { RulesView } from "./view";
export * from "./state";
export * from "./view";
export * from "./observation";
export type ActionResult = {
    state: GameState;
    events: GameEvent[];
};
// Keep execution support separate from vocabulary support. Missing mechanics must never silently no-op.
function supportedContent(context: EngineContext) { return context.content.cards.every(c => !c.mechanics.abilities.length && !c.mechanics.modifiers.length); }
export function listLegalActions(state: GameState, actor: PlayerId, context: EngineContext): Result<LegalAction[]> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    if (!state.players[actor])
        return failure("UNKNOWN_PLAYER", "Player is not in match");
    if (!context.content.ruleset.gameplay?.turnSlice && !supportedContent(context))
        return failure("UNSUPPORTED_MECHANICS", "Ability/continuous-effect execution awaits reviewed handlers");
    if (state.resolution.stage !== "DECISION" && !(context.content.ruleset.gameplay?.turnSlice && state.resolution.stage === "CHOICE" && state.resolution.choice?.kind === "PAYMENT"))
        return failure("UNSUPPORTED_RESOLUTION", "Pending-effect/choice continuation requires a registered reviewed handler");
    if (actor !== state.timing.actingPlayer)
        return success([]);
    const view = new RulesView(valid.value, context);
    const actions: GameAction[] = [];
    const slice = context.content.ruleset.gameplay?.turnSlice;
    if (state.match.outcome)
        return success([]);
    if (slice && state.timing.window === "CHOOSE_GIG") {
        for (const gigInstanceId of view.listRollableFixerDice(actor))
            actions.push({ actorId: actor, action: { kind: "ROLL_GIG", gigInstanceId } });
    }
    else if (slice && state.timing.window === "PAYMENT_SELECTION") {
        const choice = state.resolution.choice;
        if (!choice || !state.resolution.callContinuation)
            return failure("INVALID_PAYMENT_STATE", "Missing CALL continuation");
        choice.options.forEach((_, index) => actions.push({ actorId: actor, action: { kind: "CHOOSE", choiceId: choice.id, optionIndices: [index] } }));
    }
    else if (state.timing.window === "MAIN") {
        for (const c of Object.values(state.objects.cards))
            if (view.canSellCard(actor, c.id))
                actions.push({ actorId: actor, action: { kind: "SELL_CARD", cardInstanceId: c.id } });
        if (slice) {
            for (const c of view.faceDownLegends(actor))
                if (view.canCallLegend(actor, c.id))
                    actions.push({ actorId: actor, action: { kind: "CALL_LEGEND", cardInstanceId: c.id } });
            actions.push({ actorId: actor, action: { kind: "END_TURN" } });
        }
    }
    const label = (a: GameAction) => {
        switch (a.action.kind) {
            case "SELL_CARD": return `Sell ${view.getRevision(a.action.cardInstanceId)?.displayName}`;
            case "CALL_LEGEND": return `Call face-down Legend ${state.players[actor].zones.LEGENDS.indexOf(a.action.cardInstanceId) + 1}`;
            case "ROLL_GIG": return `Roll ${view.getGig(a.action.gigInstanceId).dieType}`;
            case "CHOOSE": {
                const option = state.resolution.choice!.options[a.action.optionIndices[0]];
                if (option.kind !== "PAYMENT")
                    return "Unsupported choice";
                const source = option.source, zone = source.kind === "EDDIE" ? "EDDIES" : "LEGENDS";
                return `Pay with ${source.kind.toLowerCase()} ${state.players[actor].zones[zone].indexOf(source.cardInstanceId) + 1}`;
            }
            default: return a.action.kind;
        }
    };
    return success(actions.map(a => ({ ...a, actionId: hashCanonical({ version: 1, positionHash: hashPosition(state), seat: state.players[actor].seat, action: a.action }), descriptor: { kind: a.action.kind, label: label(a) } })).sort((a, b) => a.actionId < b.actionId ? -1 : 1));
}
export function listSellActions(state: GameState, actor: PlayerId, context: EngineContext) { const legal = listLegalActions(state, actor, context); return legal.ok ? success(legal.value.filter(a => a.action.kind === "SELL_CARD")) : legal; }
export function validateAction(state: GameState, input: GameAction, context: EngineContext): Result<GameAction> {
    const action = GameActionSchema.safeParse(input);
    if (!action.success)
        return failure("INVALID_ACTION", action.error.message);
    const legal = listLegalActions(state, action.data.actorId, context);
    if (!legal.ok)
        return legal;
    if (!legal.value.some(a => canonicalSerialize({ actorId: a.actorId, action: a.action }) === canonicalSerialize(action.data)))
        return failure("ILLEGAL_OR_UNSUPPORTED_ACTION", "Action is not currently enumerated by this engine");
    if (action.data.action.kind === "CALL_LEGEND") {
        const supported = new RulesView(state, context).callEffectSupport(action.data.action.cardInstanceId);
        if (!supported.ok)
            return supported;
    }
    return success(action.data);
}
export function applyAction(state: GameState, action: GameAction, context: EngineContext): Result<ActionResult> {
    const valid = validateAction(state, action, context);
    if (!valid.ok)
        return valid;
    if (context.content.ruleset.gameplay?.turnSlice) {
        const mutation = new TurnMutation(state, context), s = mutation.state, actor = action.actorId, view = new RulesView(state, context);
        switch (action.action.kind) {
            case "ROLL_GIG": {
                const gig = s.objects.gigs[action.action.gigInstanceId];
                mutation.phase("ROLL_GIG");
                const rolled = drawDeterministicDie(s.rng, Number(gig.dieType.slice(1))), counter = s.rng.counter;
                s.rng = rolled.rng;
                gig.roll = { kind: "ROLLED", initialValue: rolled.rawValue, currentValue: rolled.rawValue };
                s.players[actor].gigs.FIXER.splice(s.players[actor].gigs.FIXER.indexOf(gig.id), 1);
                s.players[actor].gigs.GIGS.push(gig.id);
                gig.location = { playerId: actor, zone: "GIGS" };
                mutation.emit({ kind: "GIG_DIE_ROLLED", gigInstanceId: gig.id, dieType: gig.dieType, rawValue: rolled.rawValue, rngCounter: counter });
                mutation.phase("MAIN");
                break;
            }
            case "CALL_LEGEND": {
                const cost = context.content.ruleset.gameplay.turnSlice.callCost;
                const candidates = view.paymentCandidates(actor, cost, []);
                const resolved = cost === 0 ? mutation.call(actor, action.action.cardInstanceId, []) : candidates.length === 1 && view.getPaymentValue(candidates[0]) === cost ? mutation.call(actor, action.action.cardInstanceId, [candidates[0]]) : mutation.paymentChoice(actor, action.action.cardInstanceId, cost, []);
                if (!resolved.ok)
                    return resolved;
                break;
            }
            case "CHOOSE": {
                const pending = s.resolution.callContinuation!, option = s.resolution.choice!.options[action.action.optionIndices[0]];
                if (option.kind !== "PAYMENT")
                    return failure("UNSUPPORTED_CHOICE", "Only CALL payment is implemented");
                const selected = [...pending.selectedSources, option.source], remaining = pending.remainingCost - view.getPaymentValue(option.source);
                const resolved = remaining === 0 ? mutation.call(actor, pending.legendId, selected) : mutation.paymentChoice(actor, pending.legendId, remaining, selected);
                if (!resolved.ok)
                    return resolved;
                break;
            }
            case "END_TURN": {
                // Overtime is deliberately a policy boundary, not a fabricated extra turn loop.
                if ((s.timing.emptyFixerStarts ?? 0) >= 2)
                    return failure("UNSUPPORTED_OVERTIME", "Two consecutive starts with both Fixers empty; overtime requires a reviewed implementation");
                mutation.phase("TURN_END");
                mutation.emit({ kind: "TURN_ENDED", playerId: actor, turn: s.timing.turn });
                s.timing.activePlayer = s.match.playerOrder[(s.players[actor].seat + 1) % s.match.playerOrder.length];
                s.timing.turn++;
                const started = mutation.startTurn();
                if (!started.ok)
                    return started;
                break;
            }
            case "SELL_CARD": {
                const id = action.action.cardInstanceId, c = s.objects.cards[id], p = s.players[actor], from = { ...c.zone };
                p.zones.HAND.splice(p.zones.HAND.indexOf(id), 1);
                p.zones.EDDIES.push(id);
                c.zone = { playerId: actor, zone: "EDDIES" };
                c.face = "DOWN";
                c.readiness = "READY";
                p.economy.sellsThisTurn++;
                mutation.emit({ kind: "CARD_MOVED", cardInstanceId: id, from, to: c.zone });
                mutation.emit({ kind: "CARD_SOLD", cardInstanceId: id, value: view.getRevision(id)!.sellProfile.baseEddieValue });
                break;
            }
            default: return failure("UNSUPPORTED_ACTION", "No handler in turn slice");
        }
        return mutation.result();
    }
    const next = GameStateSchema.parse(state), events: GameEvent[] = [];
    const emit = (payload: GameEvent["payload"]) => events.push(GameEventSchema.parse({ sequence: ++next.match.eventSequence, payload }));
    if (action.action.kind !== "SELL_CARD")
        return failure("UNSUPPORTED_ACTION", "No reviewed handler");
    const id = action.action.cardInstanceId, c = next.objects.cards[id], p = next.players[action.actorId], from = { ...c.zone };
    p.zones.HAND.splice(p.zones.HAND.indexOf(id), 1);
    p.zones.EDDIES.push(id);
    c.zone = { playerId: action.actorId, zone: "EDDIES" };
    c.face = "DOWN";
    c.readiness = "READY";
    p.economy.sellsThisTurn++;
    emit({ kind: "CARD_MOVED", cardInstanceId: id, from, to: c.zone });
    emit({ kind: "CARD_SOLD", cardInstanceId: id, value: new RulesView(state, context).getRevision(id)!.sellProfile.baseEddieValue });
    next.match.version++;
    const checked = validateState(next, context);
    return checked.ok ? success({ state: checked.value, events }) : checked;
}
/** Transport checks wrap, but never change, semantic action validation. */
export function applyCommand(state: GameState, input: unknown, context: EngineContext): Result<ActionResult> {
    const parsed = GameCommandSchema.safeParse(input);
    if (!parsed.success)
        return failure("INVALID_COMMAND", parsed.error.message);
    if (parsed.data.expectedStateVersion !== state.match.version)
        return failure("STALE_STATE", "Expected version differs");
    return applyAction(state, { actorId: parsed.data.actorId, action: parsed.data.action }, context);
}
export function resolveActionId(state: GameState, actor: PlayerId, actionId: string, context: EngineContext): Result<GameAction> {
    const legal = listLegalActions(state, actor, context);
    if (!legal.ok)
        return legal;
    const found = legal.value.find(a => a.actionId === actionId);
    return found ? success({ actorId: found.actorId, action: found.action }) : failure("UNKNOWN_ACTION_ID", "Re-enumerate actions from the authoritative current state");
}
/** Explicit low-level effect primitive, not a player action; no implicit clamping. */
export function modifyGigValue(state: GameState, id: GigInstanceId, delta: number, context: EngineContext): Result<ActionResult> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    const bounds = context.content.ruleset.gameplay?.gigValueBounds;
    if (!bounds || bounds === "UNSUPPORTED")
        return failure("UNSUPPORTED_GIG_BOUNDS", "Reviewed Gig bounds policy required");
    const next = GameStateSchema.parse(state), g = next.objects.gigs[id];
    if (!g || g.roll.kind !== "ROLLED" || !Number.isSafeInteger(delta))
        return failure("INVALID_GIG_CHANGE", "A rolled Gig and integer delta are required");
    const previous = g.roll.currentValue, current = previous + delta;
    if (current < bounds.min || current > bounds.max)
        return failure("GIG_VALUE_OUT_OF_BOUNDS", "Value rejected, never silently clamped");
    g.roll.currentValue = current;
    next.match.version++;
    const event = GameEventSchema.parse({ sequence: ++next.match.eventSequence, payload: { kind: "GIG_VALUE_CHANGED", gigInstanceId: id, previous, current } });
    const checked = validateState(next, context);
    return checked.ok ? success({ state: checked.value, events: [event] }) : checked;
}
export type EffectHandler = (view: RulesView, pending: PendingEffect) => Result<{
    events: GameEvent[];
    pending: PendingEffect[];
}>;
export class HandlerRegistry {
    private readonly handlers = new Map<string, EffectHandler>();
    register(id: string, handler: EffectHandler) {
        if (!/^[a-z][a-z0-9._-]+@\d+$/.test(id) || this.handlers.has(id))
            throw new Error("Invalid or duplicate handler ID");
        this.handlers.set(id, handler);
    }
    resolve(effect: Effect) { return effect.kind === "CUSTOM" ? this.handlers.get(effect.handlerId) : undefined; }
}
export const STATE_BASED_PIPELINE = ["RESOLVE_EFFECT", "STATE_BASED_CHECKS", "DISCOVER_TRIGGERS", "ORDER_TRIGGERS", "CHOICE", "DECISION"] as const;
export function advanceResolution(state: GameState, context: EngineContext): Result<GameState> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    return state.resolution.stage === "DECISION" ? valid : failure("UNSUPPORTED_RESOLUTION_POLICY", "Current effect must finish before discovered triggers; strategic ordering needs a PendingChoice. No implicit LIFO ordering.");
}
/** Effect primitives require a trusted rules handler to select the target; never auto-pick a die. */
export function rollGigDie(state: GameState, id: GigInstanceId, context: EngineContext): Result<ActionResult> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    const next = GameStateSchema.parse(state), gig = next.objects.gigs[id];
    if (!gig || !new RulesView(valid.value, context).listRollableFixerDice(gig.controllerId).includes(id))
        return failure("INELIGIBLE_DIE", "Choose an unrolled eligible Fixer die; D20 waits for other dice");
    const result = drawDeterministicDie(state.rng, Number(gig.dieType.slice(1)));
    gig.roll = { kind: "ROLLED", initialValue: result.rawValue, currentValue: result.rawValue };
    next.rng = result.rng;
    next.match.version++;
    const event = GameEventSchema.parse({ sequence: ++next.match.eventSequence, payload: { kind: "GIG_DIE_ROLLED", gigInstanceId: id, dieType: gig.dieType, rawValue: result.rawValue, rngCounter: state.rng.counter } });
    const checked = validateState(next, context);
    return checked.ok ? success({ state: checked.value, events: [event] }) : checked;
}
export function transferGigControl(state: GameState, id: GigInstanceId, controller: PlayerId, context: EngineContext): Result<ActionResult> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    const next = GameStateSchema.parse(state), gig = next.objects.gigs[id];
    if (!gig || gig.roll.kind !== "ROLLED" || !next.players[controller])
        return failure("INVALID_GIG_TRANSFER", "A rolled Gig and existing controller are required");
    const previous = gig.controllerId, refs = next.players[gig.location.playerId].gigs[gig.location.zone];
    refs.splice(refs.indexOf(id), 1);
    gig.controllerId = controller;
    gig.location = { playerId: controller, zone: "GIGS" };
    next.players[controller].gigs.GIGS.push(id);
    next.match.version++;
    const event = GameEventSchema.parse({ sequence: ++next.match.eventSequence, payload: { kind: "GIG_CONTROL_CHANGED", gigInstanceId: id, previous, current: controller } });
    const checked = validateState(next, context);
    return checked.ok ? success({ state: checked.value, events: [event] }) : checked;
}
export * from "./rng";
export * from "./initialization";
export * from "./win";
