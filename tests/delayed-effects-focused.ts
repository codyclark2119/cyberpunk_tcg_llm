import assert from "node:assert/strict";
import { CardRevisionSnapshotSchema, GameStateSchema, createContentBundle, hashCanonical, type GameState, type LegalAction } from "@tcg/domain";
import { applyAction, listLegalActions, validateState, type EngineContext } from "@tcg/engine";
import { delayedContext } from "./delayed-effects-fixture";
import { dyingNightReplay } from "./delayed-effects-replay";
import { delamain } from "./end-turn-history-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { unwrap } from "./turn-replay";
/** Synthetic vanilla Unit solely for the Name predicate: no actual V revision or Go Solo. */
export const trustedV = CardRevisionSnapshotSchema.parse({ ...delamain,
    id: "trusted-delayed-v-unit", name: "V", displayName: "V: Synthetic test host", subtitle: "Synthetic test host", deckbuildingIdentity: "V",
    rulesText: "", sourceMarkup: "", tags: [], mechanics: { keywords: [], modifiers: [], abilities: [] },
    execution: { scope: "COMBAT_RESTRICTIONS_V1", status: "SUPPORTED" },
    printings: [{ id: "trusted-delayed-v-print", setCode: "DEV", collectorNumber: "DV1", source: "Synthetic test fixture" }],
    provenance: { source: "Synthetic trusted Unit for delayed Name tests, not a real card admission or human gold", sourceHash: hashCanonical({ fixture: "trusted-delayed-v-unit", identity: "V" }), effectiveAt: "2026-09-09", errata: [], reviewed: true }
});
export function positiveFixture() {
    const base = delayedContext(), context = { content: createContentBundle(base.content.ruleset, [...base.content.cards, trustedV], base.content.manifest.engine) };
    const state = GameStateSchema.parse(dyingNightReplay().beforeAttack), actor = state.timing.activePlayer;
    const host = state.players[actor].zones.BATTLEFIELD.find(id => state.objects.cards[id].attachments.length)!;
    state.match.contentManifestHash = context.content.manifestHash; state.match.cards = context.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    state.objects.cards[host].cardId = trustedV.id;
    return { context, state: unwrap(validateState(state, context)), host, actor, rival: state.match.playerOrder.find(id => id !== actor)! };
}
export const actions = (s: GameState, context: EngineContext) => unwrap(listLegalActions(s, s.timing.actingPlayer, context));
export function take(s: GameState, context: EngineContext, predicate: (a: LegalAction) => boolean) {
    const a = actions(s, context).find(predicate); assert.ok(a, `action at ${s.timing.turn}/${s.timing.step}`);
    return unwrap(applyAction(s, { actorId: a.actorId, action: a.action }, context));
}
export const choose = (s: GameState, context: EngineContext, i = 0) => take(s, context, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === i);
export const end = (s: GameState, context: EngineContext) => take(s, context, a => a.action.kind === "END_TURN");
export function finishChoices(s: GameState, context: EngineContext) {
    let state = s; const events: ReturnType<typeof take>["events"][number][] = [];
    for (let limit = 0; state.resolution.choice; limit++) { assert.ok(limit < 40); const next = choose(state, context); state = next.state; events.push(...next.events); }
    return { state, events };
}
export function register(s: GameState, context: EngineContext, host = s.players[s.timing.activePlayer].zones.BATTLEFIELD.find(id => s.objects.cards[id].attachments.length)!) {
    const attack = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host);
    const result = finishChoices(attack.state, context); assert.equal(result.state.timing.step, "RIVAL_REACT");
    return { state: result.state, events: [...attack.events, ...result.events] };
}
export function mainAfterAttack(s: GameState, context: EngineContext) {
    const pass = take(s, context, a => a.action.kind === "PASS_REACT"), done = finishChoices(pass.state, context);
    assert.equal(done.state.timing.step, "MAIN"); return { state: done.state, events: [...pass.events, ...done.events] };
}
/** Explicit trusted arrangement, never used by the legal headline replay. */
export function stockEddies(s: GameState, context: EngineContext, count: number) {
    const actor = s.timing.activePlayer, m = new TurnMutation(s, context);
    for (const id of [...m.state.players[actor].zones.EDDIES]) moveCardLocation(m, id, "TRASH");
    const candidates = m.state.players[actor].zones.DECK.filter(id => context.content.cards.find(c => c.id === m.state.objects.cards[id].cardId)!.sellProfile.allowed).slice(0, count);
    assert.equal(candidates.length, count);
    for (const id of candidates) {
        m.state.players[actor].zones.DECK.splice(m.state.players[actor].zones.DECK.indexOf(id), 1); m.state.players[actor].zones.EDDIES.push(id);
        Object.assign(m.state.objects.cards[id], { zone: { playerId: actor, zone: "EDDIES" }, face: "DOWN", readiness: "SPENT" });
    }
    return unwrap(validateState(m.state, context));
}
