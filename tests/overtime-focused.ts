import assert from "node:assert/strict";
import { GameStateSchema, type GameState, type LegalAction } from "@tcg/domain";
import { applyAction, listLegalActions, validateState, type EngineContext } from "@tcg/engine";
import { overtimeContext } from "./overtime-fixture";
import { endTurnContext } from "./end-turn-history-fixture";
import { delamainReplay } from "./end-turn-history-replay";
import { fieldLegendContext } from "./field-legends-fixture";
import { vDyingNightReplay } from "./field-legends-replay";
import { unwrap } from "./turn-replay";
export function repinOvertime(input: GameState, context: EngineContext) {
    const s = GameStateSchema.parse(input), b = context.content;
    Object.assign(s.match, { rulesetId: b.ruleset.id, rulesetVersion: b.ruleset.version, rulesetHash: b.manifest.ruleset.hash,
        engineVersion: b.manifest.engine.version, engineArtifactHash: b.manifest.engine.artifactHash, contentManifestHash: b.manifestHash,
        cards: b.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision })) });
    return s;
}
/** Explicit trusted edge arrangement, never called by the headline or Demo setup replay.
 * Ownership is retained. Optional returned D20 represents a future-restoration board, not an admitted action. */
export function arrangeGigs(input: GameState, p0Count = 6, returnedD20 = false) {
    const s = GameStateSchema.parse(input), [p0, p1] = s.match.playerOrder;
    const returned = returnedD20 ? Object.values(s.objects.gigs).find(g => g.ownerId === p0 && g.dieType === "D20")!.id : undefined;
    for (const p of Object.values(s.players)) p.gigs = { FIXER: [], GIGS: [] };
    let placed = 0;
    for (const g of Object.values(s.objects.gigs).sort((a, b) => a.id.localeCompare(b.id))) {
        if (g.id === returned) { g.roll = { kind: "UNROLLED" }; g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: "FIXER" }; s.players[g.ownerId].gigs.FIXER.push(g.id); continue; }
        if (g.roll.kind === "UNROLLED") g.roll = { kind: "ROLLED", initialValue: 1, currentValue: 1 };
        const controller = placed++ < p0Count ? p0 : p1;
        g.controllerId = controller; g.location = { playerId: controller, zone: "GIGS" }; s.players[controller].gigs.GIGS.push(g.id);
    }
    return s;
}
export const overtimeActions = (s: GameState, c: EngineContext) => unwrap(listLegalActions(s, s.timing.actingPlayer, c));
export function overtimeTake(s: GameState, c: EngineContext, predicate: (a: LegalAction) => boolean) {
    const action = overtimeActions(s, c).find(predicate); assert.ok(action, `Missing action ${s.timing.turn}/${s.timing.step}`);
    return unwrap(applyAction(s, { actorId: action.actorId, action: action.action }, c));
}
export const overtimeChoose = (s: GameState, c: EngineContext) => overtimeTake(s, c, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
export const overtimeEnd = (s: GameState, c: EngineContext) => overtimeTake(s, c, a => a.action.kind === "END_TURN");
export function overtimeFinishChoices(s: GameState, c: EngineContext) {
    let state = s; const events = [];
    for (let i = 0; state.resolution.choice && !state.match.outcome; i++) {
        assert.ok(i < 30); const result = overtimeChoose(state, c); state = result.state; events.push(...result.events);
    }
    return { state, events };
}
export function overtimeEndCase(kind: "Delamain" | "Dying Night") {
    const base = kind === "Delamain" ? endTurnContext() : fieldLegendContext();
    const context = overtimeContext(base), original = kind === "Delamain" ? delamainReplay().beforeEndTurn : vDyingNightReplay().beforeEndTurn;
    const s = arrangeGigs(repinOvertime(original, context)); s.timing.emptyFixerStarts = 2;
    return { context, state: unwrap(validateState(s, context)) };
}
/** Attach three existing Mantis instances (+2 each) to the existing Atlus; no revision mutation. */
export function overtimeMultiStealState(input: GameState, context: EngineContext) {
    const s = GameStateSchema.parse(input), actor = s.match.playerOrder[0], host = s.players[actor].zones.BATTLEFIELD.find(id => s.objects.cards[id].cardId === "emergency-atlus")!;
    const gears = Object.values(s.objects.cards).filter(c => c.ownerId === actor && c.cardId === "mantis-blades"); assert.equal(gears.length, 3);
    for (const g of gears) {
        const zone = s.players[g.zone.playerId].zones[g.zone.zone]!; zone.splice(zone.indexOf(g.id), 1);
        g.zone = { playerId: actor, zone: "BATTLEFIELD" }; g.face = "UP"; g.readiness = "READY";
        s.players[actor].zones.BATTLEFIELD.push(g.id); s.objects.cards[host].attachments.push(g.id);
    }
    return unwrap(validateState(s, context));
}
export function overtimeAttackToSteal(s: GameState, context: EngineContext) {
    const host = s.players[s.timing.activePlayer].zones.BATTLEFIELD.find(id => s.objects.cards[id].cardId === "emergency-atlus")!;
    let result = overtimeTake(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host);
    if (result.state.timing.step === "ATTACK_TARGET_SELECTION") {
        const state = result.state;
        result = overtimeTake(state, context, a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"; })());
    }
    assert.equal(result.state.timing.step, "RIVAL_REACT");
    return overtimeTake(result.state, context, a => a.action.kind === "PASS_REACT").state;
}
