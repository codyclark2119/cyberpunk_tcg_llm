import assert from "node:assert/strict";
import { GameStateSchema, type GameState, type PlayerId, type PendingChoice } from "@tcg/domain";
import { validateState, type EngineContext } from "@tcg/engine";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { take, choose } from "./delayed-effects-focused";
import { INDUSTRIAL } from "./value-conditions-fixture";
import { unwrap } from "./turn-replay";
/** Explicit trusted focused arrangements, never used by the legal headline/alternative replay. */
export function withGigs(s: GameState, context: EngineContext, values: Record<string, number>) {
    const d = GameStateSchema.parse(s);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs)) {
        const value = values[g.id]; g.location = { playerId: g.controllerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.controllerId].gigs[g.location.zone].push(g.id);
    }
    return unwrap(validateState(d, context));
}
export function placeCard(s: GameState, context: EngineContext, cardId: string, player: PlayerId = s.timing.activePlayer) {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!;
    const c = Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.cardId === cardId && c.zone.zone === "DECK") ?? Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.cardId.startsWith("slice-card-") && c.zone.zone === "DECK")!;
    assert.ok(c && r); c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
export function pick(s: GameState, context: EngineContext, predicate: (o: PendingChoice["options"][number]) => boolean) {
    assert.ok(s.resolution.choice); const i = s.resolution.choice.options.findIndex(predicate); assert.ok(i >= 0); return choose(s, context, i);
}
export function playCard(s: GameState, context: EngineContext, cardId: string) {
    const played = take(s, context, a => a.action.kind === "PLAY_CARD" && s.objects.cards[a.action.cardInstanceId].cardId === cardId);
    let state = played.state; const events = [...played.events];
    while (state.resolution.choice?.kind === "PAYMENT") { const next = pick(state, context, o => o.kind === "PAYMENT"); state = next.state; events.push(...next.events); }
    return { state, events };
}
export function resolveIndustrial(s: GameState, context: EngineContext, target: string, amount: number) {
    let { state, events } = playCard(s, context, INDUSTRIAL);
    if (state.resolution.choice?.kind === "TARGET") { const next = pick(state, context, o => o.kind === "GIG" && o.gigInstanceId === target); state = next.state; events = [...events, ...next.events]; }
    if (state.resolution.choice?.kind === "AMOUNT") { const next = pick(state, context, o => o.kind === "AMOUNT" && o.amount === amount); state = next.state; events = [...events, ...next.events]; }
    return { state, events };
}
