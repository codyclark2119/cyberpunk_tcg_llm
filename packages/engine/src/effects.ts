import { powerTargets } from "./react-queries";
import { applyTemporaryPower } from "./temporary-power";
import { testCondition } from "./conditions";
import { adjustmentTargets } from "./play-state";
import { offerPlayChoice } from "./play";
import { failure, success, type Effect, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { searchChoice, searchTargets } from "./search-state";
import { drawDeterministicInteger } from "./rng";

type Primitive<K extends Effect["kind"]> = Extract<Effect, { kind: K }>;
/** Handwritten, typed primitive registry; metadata cannot install arbitrary handlers. */
export class HandlerRegistry {
    readonly primitives = {
    POWER_UNTIL_END_OF_TURN: (m: TurnMutation): Result<null> => {
        const targets = powerTargets(m.state, m.state.timing.actingPlayer, m.context);
        return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyTemporaryPower(m, targets[0]) : success(null);
    },
    ADJUST_GIG_UP_TO: (m: TurnMutation): Result<null> => adjustmentTargets(m.state).length ? offerPlayChoice(m) : success(null),
    CONDITIONAL_DRAW: (m: TurnMutation, effect: Primitive<"CONDITIONAL_DRAW">): Result<null> => {
        const met = testCondition(m.state, m.state.timing.actingPlayer, effect.condition, m.context, m.state.resolution.current?.sourceId);
        m.emit({ kind: "CONDITION_EVALUATED", effectId: m.state.resolution.current!.id, met });
        return met ? this.primitives.DRAW(m, { kind: "DRAW", count: effect.count }) : success(null);
    },
    DRAW: (m: TurnMutation, effect: Primitive<"DRAW">) => m.draw(m.state.timing.actingPlayer, effect.count),
    SEARCH_GEAR: (m: TurnMutation, effect: Primitive<"SEARCH_GEAR">): Result<null> => {
        const s = m.state, actor = s.timing.actingPlayer;
        s.resolution.searchContinuation = { looked: [...s.players[actor].zones.DECK.slice(0, effect.count)], selected: [] };
        return offerSearch(m);
    }
    };
    resolve(m: TurnMutation, effect: Effect): Result<null> {
        if (effect.kind === "POWER_UNTIL_END_OF_TURN") return this.primitives.POWER_UNTIL_END_OF_TURN(m);
        if (effect.kind === "ADJUST_GIG_UP_TO") return this.primitives.ADJUST_GIG_UP_TO(m);
        if (effect.kind === "CONDITIONAL_DRAW") return this.primitives.CONDITIONAL_DRAW(m, effect);
        if (effect.kind === "DRAW") return this.primitives.DRAW(m, effect);
        if (effect.kind === "SEARCH_GEAR") return this.primitives.SEARCH_GEAR(m, effect);
        return failure("UNSUPPORTED_CALL_EFFECT", "No registered typed CALL primitive");
    }
}
const callHandlers = new HandlerRegistry();
export function resolveCallPrimitive(m: TurnMutation, effect: Effect): Result<null> {
    return callHandlers.resolve(m, effect);
}
function finishSearch(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.searchContinuation!, actor = current.controllerId, p = s.players[actor];
    const selected = new Set(c.selected);
    p.zones.DECK.splice(0, c.looked.length);
    for (const id of c.selected) {
        const card = s.objects.cards[id], from = { ...card.zone };
        m.emit({ kind: "CARD_REVEALED", cardInstanceId: id });
        card.zone = { playerId: actor, zone: "HAND" };
        p.zones.HAND.push(id);
        m.emit({ kind: "CARD_MOVED", cardInstanceId: id, from, to: card.zone });
    }
    const remainder = c.looked.filter(id => !selected.has(id)), rngCounter = s.rng.counter;
    for (let i = remainder.length - 1; i > 0; i--) {
        const r = drawDeterministicInteger(s.rng, i + 1);
        s.rng = r.rng;
        [remainder[i], remainder[r.rawValue - 1]] = [remainder[r.rawValue - 1], remainder[i]];
    }
    p.zones.DECK.push(...remainder);
    m.emit({ kind: "SEARCH_REMAINDER_BOTTOMED", playerId: actor, order: remainder, rngCounter });
    delete s.resolution.searchContinuation;
    s.resolution.choice = null;
    s.resolution.stage = "STATE_BASED_CHECKS";
    return success(null);
}
function offerSearch(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.searchContinuation!;
    if (current.effect.kind !== "SEARCH_GEAR") return failure("INVALID_SEARCH_STATE", "Expected search primitive");
    if (c.selected.length === current.effect.maxTake || !searchTargets(s, m.context).some(id => !c.selected.includes(id))) return finishSearch(m);
    s.resolution.choice = searchChoice(s, m.context);
    s.resolution.stage = "CHOICE";
    s.timing.step = "TARGET_SELECTION";
    s.timing.window = "TARGET_SELECTION";
    m.emit({ kind: "PHASE_CHANGED", step: "TARGET_SELECTION" });
    return success(null);
}
export function continueSearch(m: TurnMutation, index: number): Result<null> {
    const c = m.state.resolution.searchContinuation!, option = m.state.resolution.choice!.options[index];
    if (option.kind === "MODE" && option.mode === "DONE") return finishSearch(m);
    if (option.kind !== "CARD" || c.selected.includes(option.cardInstanceId) || !searchTargets(m.state, m.context).includes(option.cardInstanceId)) return failure("INVALID_SEARCH_TARGET", "Chosen Gear is no longer eligible");
    c.selected.push(option.cardInstanceId);
    return offerSearch(m);
}
