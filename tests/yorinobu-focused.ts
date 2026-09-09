import assert from "node:assert/strict";
import { GameStateSchema, type CardInstanceId, type GameState } from "@tcg/domain";
import { validateState, type EngineContext } from "@tcg/engine";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation, processDeparture } from "../packages/engine/src/card-movement";
import { take, choose, finishChoices } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";
/** Explicit trusted arrangements for focused tests/persistence; never called by headline replay. */
export function bare(s: GameState, host: CardInstanceId, context: EngineContext) {
    const m = new TurnMutation(s, context);
    for (const id of [...m.state.objects.cards[host].attachments]) unwrap(processDeparture(m, id, "TRASH"));
    return unwrap(validateState(m.state, context));
}
export function addGear(s: GameState, host: CardInstanceId, cardId: string, context: EngineContext) {
    const m = new TurnMutation(s, context), actor = s.objects.cards[host].controllerId;
    const gear = Object.values(m.state.objects.cards).find(c => c.controllerId === actor && c.cardId === cardId && !Object.values(m.state.objects.cards).some(h => h.attachments.includes(c.id)))!;
    assert.ok(gear); moveCardLocation(m, gear.id, "HAND"); unwrap(attachPlayedGear(m, gear.id, host));
    return { state: unwrap(validateState(m.state, context)), gear: gear.id };
}
export function addUnit(s: GameState, cardId: string, context: EngineContext, player = s.timing.activePlayer) {
    const m = new TurnMutation(s, context), card = Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.cardId === cardId && c.zone.zone === "DECK")!;
    assert.ok(card); moveCardLocation(m, card.id, "BATTLEFIELD"); card.readiness = "READY"; card.statuses = [];
    return { state: unwrap(validateState(m.state, context)), unit: card.id };
}
export function declare(s: GameState, host: CardInstanceId, context: EngineContext, target?: CardInstanceId) {
    const result = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host);
    if (result.state.timing.step !== "ATTACK_TARGET_SELECTION") return result;
    const i = result.state.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && (target ? o.target.kind === "CARD" && o.target.cardInstanceId === target : o.target.kind === "GIG_AREA"));
    const chosen = choose(result.state, context, i);
    return { ...chosen, events: [...result.events, ...chosen.events] };
}
export function finishAttack(s: GameState, context: EngineContext) {
    const triggers = finishChoices(s, context), pass = take(triggers.state, context, a => a.action.kind === "PASS_REACT"), done = finishChoices(pass.state, context);
    assert.equal(done.state.timing.step, "MAIN"); return { state: done.state, events: [...triggers.events, ...pass.events, ...done.events] };
}
export function readyAgain(s: GameState, host: CardInstanceId, context: EngineContext) {
    const copy = GameStateSchema.parse(s); copy.objects.cards[host].readiness = "READY";
    return unwrap(validateState(copy, context));
}
