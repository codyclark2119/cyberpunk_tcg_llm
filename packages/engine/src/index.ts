import { combatResolutionEnabled } from "./combat-resolution-policy";
import { continueGigSteal, continueDefeatOrder, resolveCombat } from "./combat-resolution";
import { transferGigs } from "./gig-transfer";
import { isReactDecision, reactEnabled } from "./react-support";
import { declareBlocker, passReact } from "./rival-reactions";
import { expireTemporaryPower } from "./temporary-power";
import { startAttack, continueAttack } from "./combat";
import { canPlay, canActivate } from "./play-support";
import { startPlay, continuePlay, activateAbility } from "./play";
import { changeGigValue } from "./gig-value";
import { continueSearch } from "./effects";
import { continueSetup } from "./setup";
import { setupChoiceLabel } from "./setup-state";
import { TurnMutation } from "./turn";
import { drawDeterministicDie } from "./rng";
import { GameActionSchema, GameCommandSchema, GameStateSchema, GameEventSchema, hashCanonical, canonicalSerialize, failure, success, type Result, type GameState, type GameAction, type GameEvent, type PlayerId, type LegalAction, type GigInstanceId } from "@tcg/domain";
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
    if (state.resolution.stage !== "DECISION" && !(context.content.ruleset.gameplay?.turnSlice && state.resolution.stage === "CHOICE" && (state.resolution.choice?.kind === "PAYMENT" || state.resolution.searchContinuation || state.resolution.playContinuation || state.resolution.gigStealContinuation || state.resolution.defeatContinuation || state.setup || state.timing.combat.stage === "ATTACK_TARGET_SELECTION")))
        return failure("UNSUPPORTED_RESOLUTION", "Pending-effect/choice continuation requires a registered reviewed handler");
    if (actor !== state.timing.actingPlayer)
        return success([]);
    const view = new RulesView(valid.value, context);
    const actions: GameAction[] = [];
    const slice = context.content.ruleset.gameplay?.turnSlice;
    if (state.match.outcome || state.timing.combat.stage === "COMBAT_RESOLUTION_PENDING" || (state.timing.combat.stage === "RIVAL_REACT" && !reactEnabled(context)))
        return success([]);
    if (state.setup || state.resolution.searchContinuation || state.resolution.playContinuation || state.resolution.gigStealContinuation || state.resolution.defeatContinuation || state.timing.combat.stage === "ATTACK_TARGET_SELECTION") {
        const choice = state.resolution.choice!;
        choice.options.forEach((_, index) => actions.push({ actorId: actor, action: { kind: "CHOOSE", choiceId: choice.id, optionIndices: [index] } }));
    }
    else if (slice && state.timing.window === "CHOOSE_GIG") {
        for (const gigInstanceId of view.listRollableFixerDice(actor))
            actions.push({ actorId: actor, action: { kind: "ROLL_GIG", gigInstanceId } });
    }
    else if (slice && state.timing.window === "PAYMENT_SELECTION") {
        const choice = state.resolution.choice;
        if (!choice || !state.resolution.callContinuation)
            return failure("INVALID_PAYMENT_STATE", "Missing CALL continuation");
        choice.options.forEach((_, index) => actions.push({ actorId: actor, action: { kind: "CHOOSE", choiceId: choice.id, optionIndices: [index] } }));
    }
    else if (isReactDecision(state, actor, context)) {
        for (const c of view.faceDownLegends(actor)) if (view.canCallLegend(actor, c.id)) actions.push({ actorId: actor, action: { kind: "CALL_LEGEND", cardInstanceId: c.id } });
        for (const cardInstanceId of view.listQuickCards(actor)) actions.push({ actorId: actor, action: { kind: "PLAY_CARD", cardInstanceId } });
        for (const cardInstanceId of view.listBlockers(actor)) actions.push({ actorId: actor, action: { kind: "DECLARE_BLOCKER", cardInstanceId } });
        actions.push({ actorId: actor, action: { kind: "PASS_REACT" } });
    }
    else if (state.timing.window === "MAIN") {
        for (const c of Object.values(state.objects.cards))
            if (view.canSellCard(actor, c.id))
                actions.push({ actorId: actor, action: { kind: "SELL_CARD", cardInstanceId: c.id } });
        if (slice) {
            for (const card of Object.values(state.objects.cards)) {
                if (view.isAttackEligible(actor, card.id)) actions.push({ actorId: actor, action: { kind: "DECLARE_ATTACK", cardInstanceId: card.id } });
                if (canPlay(state, actor, card.id, context)) actions.push({ actorId: actor, action: { kind: "PLAY_CARD", cardInstanceId: card.id } });
                for (const ability of view.getRevision(card.id)?.mechanics.abilities ?? [])
                    if (canActivate(state, actor, card.id, ability.id, context)) actions.push({ actorId: actor, action: { kind: "ACTIVATE_ABILITY", sourceInstanceId: card.id, abilityId: ability.id } });
            }
            for (const c of view.faceDownLegends(actor))
                if (view.canCallLegend(actor, c.id))
                    actions.push({ actorId: actor, action: { kind: "CALL_LEGEND", cardInstanceId: c.id } });
            actions.push({ actorId: actor, action: { kind: "END_TURN" } });
        }
    }
    const label = (a: GameAction) => {
        switch (a.action.kind) {
            case "PASS_REACT": return "End React";
            case "DECLARE_BLOCKER": return `Block with ${view.getRevision(a.action.cardInstanceId)?.displayName}`;
            case "DECLARE_ATTACK": return `Attack with ${view.getRevision(a.action.cardInstanceId)?.displayName}`;
            case "PLAY_CARD": return `Play ${view.getRevision(a.action.cardInstanceId)?.displayName}`;
            case "ACTIVATE_ABILITY": return `Activate ${view.getRevision(a.action.sourceInstanceId)?.displayName}: Spend to draw 2`;
            case "SELL_CARD": return `Sell ${view.getRevision(a.action.cardInstanceId)?.displayName}`;
            case "CALL_LEGEND": return `Call face-down Legend ${state.players[actor].zones.LEGENDS.indexOf(a.action.cardInstanceId) + 1}`;
            case "ROLL_GIG": return `Roll ${view.getGig(a.action.gigInstanceId).dieType}`;
            case "CHOOSE": {
                if (state.setup) return setupChoiceLabel(state, a.action.optionIndices[0]);
                const option = state.resolution.choice!.options[a.action.optionIndices[0]];
                if (option.kind === "ATTACK_TARGET") return option.target.kind === "CARD" ? `Attack ${view.getRevision(option.target.cardInstanceId)?.displayName} (${option.target.cardInstanceId})` : "Attack rival Gig area";
                if (state.resolution.gigStealContinuation && option.kind === "GIG") {
                    const gig = view.getGig(option.gigInstanceId);
                    return `Steal ${gig.dieType} (${gig.id}, current ${gig.roll.kind === "ROLLED" ? gig.roll.currentValue : "unrolled"})`;
                }
                if (state.resolution.defeatContinuation && option.kind === "CARD") return `Next in your Trash: ${view.getRevision(option.cardInstanceId)?.displayName} (${option.cardInstanceId})`;
                if (state.resolution.searchContinuation) return option.kind === "CARD" ? `Reveal and take ${view.getRevision(option.cardInstanceId)?.displayName}` : "Take no more Gears";
                if (state.resolution.playContinuation?.phase === "EQUIP" && option.kind === "CARD") return `Equip to ${view.getRevision(option.cardInstanceId)?.displayName}`;
                if (state.resolution.playContinuation && option.kind === "CARD") return `Give ${view.getRevision(option.cardInstanceId)?.displayName} (${option.cardInstanceId}) -1 power this turn`;
                if (state.resolution.playContinuation && option.kind === "GIG") {
                    const gig = view.getGig(option.gigInstanceId);
                    return `Adjust ${gig.controllerId === actor ? "your" : "rival"} ${gig.dieType} (current ${gig.roll.kind === "ROLLED" ? gig.roll.currentValue : "unrolled"})`;
                }
                if (state.resolution.playContinuation && option.kind === "MODE") return option.mode === "KEEP" ? "Adjust by zero (keep current value)" : option.mode === "INCREASE_1" ? "Increase by 1" : "Decrease by 1";
                if (option.kind !== "PAYMENT")
                    return "Unsupported choice";
                const source = option.source, zone = source.kind === "EDDIE" ? "EDDIES" : "LEGENDS";
                return `Pay with ${source.kind.toLowerCase()} ${state.players[actor].zones[zone].indexOf(source.cardInstanceId) + 1}`;
            }
            default: return a.action.kind;
        }
    };
    const reactOrder = ["CALL_LEGEND", "PLAY_CARD", "DECLARE_BLOCKER", "PASS_REACT"];
    return success(actions.map(a => ({ ...a, actionId: hashCanonical({ version: 1, positionHash: hashPosition(state), seat: state.players[actor].seat, action: a.action }), descriptor: { kind: a.action.kind, label: label(a) } })).sort((a, b) => {
        if (isReactDecision(state, actor, context)) {
            const kindOrder = reactOrder.indexOf(a.action.kind) - reactOrder.indexOf(b.action.kind);
            if (kindOrder) return kindOrder;
            const left = canonicalSerialize(a.action), right = canonicalSerialize(b.action);
            return left < right ? -1 : left > right ? 1 : 0;
        }
        return a.actionId < b.actionId ? -1 : 1;
    }));
}
export function listSellActions(state: GameState, actor: PlayerId, context: EngineContext) { const legal = listLegalActions(state, actor, context); return legal.ok ? success(legal.value.filter(a => a.action.kind === "SELL_CARD")) : legal; }
export function validateAction(state: GameState, input: GameAction, context: EngineContext): Result<GameAction> {
    const action = GameActionSchema.safeParse(input);
    if (!action.success)
        return failure("INVALID_ACTION", action.error.message);
    const checked = validateState(state, context);
    if (!checked.ok) return checked;
    if (state.timing.combat.stage === "COMBAT_RESOLUTION_PENDING") return failure(combatResolutionEnabled(context) ? "AUTOMATIC_COMBAT_RESOLUTION_REQUIRED" : "UNSUPPORTED_COMBAT_RESOLUTION", "PASS_REACT resolves combat automatically; use advanceResolutionWithEvents to resume a trusted pending boundary without dropping its event batch. Earlier policy pins stop here");
    if (state.timing.combat.stage === "RIVAL_REACT" && !reactEnabled(context)) return failure("UNSUPPORTED_RIVAL_REACT", "Attack initiation is complete; defender reactions are not implemented and cannot be auto-passed");
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
            case "PASS_REACT": {
                const result = passReact(mutation, actor);
                if (!result.ok) return result;
                break;
            }
            case "DECLARE_BLOCKER": {
                const result = declareBlocker(mutation, actor, action.action.cardInstanceId);
                if (!result.ok) return result;
                break;
            }
            case "DECLARE_ATTACK": {
                const result = startAttack(mutation, actor, action.action.cardInstanceId);
                if (!result.ok) return result;
                break;
            }
            case "PLAY_CARD": {
                const result = startPlay(mutation, actor, action.action.cardInstanceId);
                if (!result.ok) return result;
                break;
            }
            case "ACTIVATE_ABILITY": {
                const result = activateAbility(mutation, actor, action.action.sourceInstanceId, action.action.abilityId);
                if (!result.ok) return result;
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
                if (s.resolution.gigStealContinuation || s.resolution.defeatContinuation) {
                    const result = s.resolution.gigStealContinuation ? continueGigSteal(mutation, action.action.optionIndices[0]) : continueDefeatOrder(mutation, action.action.optionIndices[0]);
                    if (!result.ok) return result;
                    break;
                }
                if (s.timing.combat.stage === "ATTACK_TARGET_SELECTION") {
                    const result = continueAttack(mutation, action.action.optionIndices[0]);
                    if (!result.ok) return result;
                    break;
                }
                if (s.resolution.playContinuation) {
                    const result = continuePlay(mutation, action.action.optionIndices[0]);
                    if (!result.ok) return result;
                    break;
                }
                if (s.setup) {
                    const resolved = continueSetup(mutation, action.action.optionIndices[0]);
                    if (!resolved.ok) return resolved;
                    break;
                }
                if (s.resolution.searchContinuation) {
                    const result = continueSearch(mutation, action.action.optionIndices[0]);
                    if (!result.ok) return result;
                    if (!s.resolution.searchContinuation) {
                        const finished = mutation.finishContinuedEffect();
                        if (!finished.ok) return finished;
                    }
                    break;
                }
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
                if (context.content.ruleset.gameplay.turnSlice.cardPlay === "NONCOMBAT_PLAY_V1")
                    for (const card of Object.values(s.objects.cards))
                        if (card.statuses.includes("LAG")) {
                            card.statuses = card.statuses.filter(status => status !== "LAG");
                            mutation.emit({ kind: "LAG_REMOVED", cardInstanceId: card.id });
                        }
                expireTemporaryPower(mutation);
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
    if (state.timing.combat.stage === "COMBAT_RESOLUTION_PENDING") return failure(combatResolutionEnabled(context) ? "AUTOMATIC_COMBAT_RESOLUTION_REQUIRED" : "UNSUPPORTED_COMBAT_RESOLUTION", "PASS_REACT resolves combat automatically; use advanceResolutionWithEvents to resume a trusted pending boundary without dropping its event batch. Earlier policy pins stop here");
    if (state.timing.combat.stage === "RIVAL_REACT" && !reactEnabled(context)) return failure("UNSUPPORTED_RIVAL_REACT", "No supported defender reactions; combat has not resolved");
    const found = legal.value.find(a => a.actionId === actionId);
    return found ? success({ actorId: found.actorId, action: found.action }) : failure("UNKNOWN_ACTION_ID", "Re-enumerate actions from the authoritative current state");
}
/** Explicit low-level effect primitive, not a player action; no implicit clamping. */
export function modifyGigValue(state: GameState, id: GigInstanceId, delta: number, context: EngineContext): Result<ActionResult> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    const next = GameStateSchema.parse(state), changed = changeGigValue(next, id, delta, context);
    if (!changed.ok) return changed;
    next.match.version++;
    const event = GameEventSchema.parse({ sequence: ++next.match.eventSequence, payload: changed.value });
    const checked = validateState(next, context);
    return checked.ok ? success({ state: checked.value, events: [event] }) : checked;
}
export { HandlerRegistry } from "./effects";
export const STATE_BASED_PIPELINE = ["RESOLVE_EFFECT", "STATE_BASED_CHECKS", "DISCOVER_TRIGGERS", "ORDER_TRIGGERS", "CHOICE", "DECISION"] as const;
/** Event-preserving automatic driver for a trusted persisted/transient pending boundary.
 * PASS_REACT calls the same reducer within its own transition. No new player or wire action.
 */
export function advanceResolutionWithEvents(state: GameState, context: EngineContext): Result<ActionResult> {
    const valid = validateState(state, context);
    if (!valid.ok) return valid;
    if (state.timing.combat.stage === "COMBAT_RESOLUTION_PENDING" && combatResolutionEnabled(context)) {
        const m = new TurnMutation(valid.value, context), resolved = resolveCombat(m);
        return resolved.ok ? m.result() : resolved;
    }
    const advanced = advanceResolution(state, context);
    return advanced.ok ? success({ state: advanced.value, events: [] }) : advanced;
}
export function advanceResolution(state: GameState, context: EngineContext): Result<GameState> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    if (state.timing.combat.stage === "COMBAT_RESOLUTION_PENDING") return failure(combatResolutionEnabled(context) ? "AUTOMATIC_COMBAT_RESOLUTION_REQUIRED" : "UNSUPPORTED_COMBAT_RESOLUTION", "PASS_REACT resolves combat automatically; use advanceResolutionWithEvents to resume a trusted pending boundary without dropping its event batch. Earlier policy pins stop here");
    if (state.timing.combat.stage === "RIVAL_REACT" && !reactEnabled(context)) return failure("UNSUPPORTED_RIVAL_REACT", "React requires a reviewed defender-action implementation");
    if (state.resolution.gigStealContinuation || state.resolution.defeatContinuation) return failure("PLAYER_DECISION_REQUIRED", "The owner of the current combat choice must select a legal actionId");
    if (state.timing.combat.stage === "RIVAL_REACT") return failure("PLAYER_DECISION_REQUIRED", "Defender must finish the current reaction or select an explicit React action, including PASS_REACT");
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
    const mutation = new TurnMutation(valid.value, context), transferred = transferGigs(mutation, [id], controller);
    return transferred.ok ? mutation.result() : transferred;
}
export * from "./rng";
export * from "./initialization";
export * from "./win";

export { moveCardForEffect } from "./card-movement";
