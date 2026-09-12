import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, createContentBundle, canonicalSerialize, hashCanonical, type CardInstanceId, type GameState, type LegalAction, type Result } from "@tcg/domain";
import { applyAction, advanceResolutionWithEvents, createGameWithEvents, hashPosition, hashReplayState, listLegalActions, modifyGigValue, observe, resolveActionId, RulesView, validateState } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { restrictionsContext, restrictionsInput, restrictionCards, REBOOT, CORPO, FLATHEAD, PSYCHO, ATLUS } from "./combat-restrictions-fixture";
import { preventionReplay, preventionExpirationReplay, permissionsReplay, vanillaReplay } from "./combat-restrictions-replay";
import { FLOOR_IT } from "./react-fixture";
import { MANTIS } from "./gear-fixture";
import { SWORDWISE } from "./combat-fixture";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/combat-restrictions-card-sources.v1.json";
import rules from "./fixtures/combat-restrictions-rules.v1.json";
const context = restrictionsContext(), prevention = preventionReplay(), permissions = permissionsReplay(), vanilla = vanillaReplay();
function traceStates(replay: typeof prevention) { const states: GameState[] = [replay.initialized.state]; for (const step of replay.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state); return states; }
const preventionStates = traceStates(prevention), permissionsStates = traceStates(permissions), vanillaStates = traceStates(vanilla);
const main = preventionStates[prevention.steps.findIndex(s => s.action.action.kind === "DECLARE_ATTACK")];
const active = main.timing.activePlayer, rival = main.match.playerOrder.find(id => id !== active)!;
const legal = (s: GameState, ctx = context) => unwrap(listLegalActions(s, s.timing.actingPlayer, ctx));
function act(s: GameState, select: (a: LegalAction) => boolean) { const a = legal(s).find(select); assert.ok(a, `Missing action at ${s.timing.step}`); return unwrap(applyAction(s, unwrap(resolveActionId(s, a.actorId, a.actionId, context)), context)); }
function fail<T>(r: Result<T>, code?: string) { assert.equal(r.ok, false); if (!r.ok && code) assert.equal(r.errors[0].code, code); }
function pass(s: GameState) { return act(s, a => a.action.kind === "PASS_REACT"); }
function finish(s: GameState) { const events = []; while (s.resolution.choice) { const r = act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0); s = r.state; events.push(...r.events); } return { state: s, events }; }
function relocate(s: ReturnType<typeof GameStateSchema.parse>, id: CardInstanceId, zone: "HAND" | "TRASH" | "BATTLEFIELD") {
    const c = s.objects.cards[id], refs = s.players[c.zone.playerId].zones[c.zone.zone]!;
    refs.splice(refs.indexOf(id), 1); s.players[c.controllerId].zones[zone].push(id); c.zone = { playerId: c.controllerId, zone }; c.face = zone === "HAND" ? "DOWN" : "UP"; c.statuses = [];
}
/** Trusted focused preparation only. All three headline traces use legal setup/turn actions. */
function combat(attacking = PSYCHO, defending = CORPO, attackGear = 0, defendGear = 0, attackMinus = 0, defendMinus = 0) {
    const s = GameStateSchema.parse(main);
    const attacker = Object.values(s.objects.cards).find(c => c.cardId === attacking && c.controllerId === active)!.id;
    const defender = Object.values(s.objects.cards).find(c => c.cardId === defending && c.controllerId === rival)!.id;
    for (const [id, gear, minus] of [[attacker, attackGear, attackMinus], [defender, defendGear, defendMinus]] as const) {
        relocate(s, id, "BATTLEFIELD"); s.objects.cards[id].readiness = "SPENT";
        const controller = s.objects.cards[id].controllerId;
        for (const g of Object.values(s.objects.cards).filter(c => c.cardId === MANTIS && c.controllerId === controller).slice(0, gear)) { relocate(s, g.id, "BATTLEFIELD"); s.objects.cards[id].attachments.push(g.id); }
        for (const f of Object.values(s.objects.cards).filter(c => c.cardId === FLOOR_IT && c.controllerId !== controller).slice(0, minus)) { relocate(s, f.id, "TRASH"); (s.temporaryModifiers ??= []).push({ kind: "POWER", sourceId: f.id, targetId: id, amount: -1, expires: { kind: "END_OF_TURN", turn: s.timing.turn } }); }
    }
    s.temporaryModifiers?.sort((a, b) => a.sourceId < b.sourceId ? -1 : 1);
    s.timing.combat = { stage: "RIVAL_REACT", attackerId: attacker, attackingPlayerId: active, target: { kind: "CARD", cardInstanceId: defender } };
    s.timing.actingPlayer = rival; s.timing.step = "RIVAL_REACT"; s.timing.window = "RIVAL_REACT";
    return { state: unwrap(validateState(s, context)), attacker, defender };
}
function prepareProgram(s: GameState, card = REBOOT) {
    const draft = GameStateSchema.parse(s), actor = draft.timing.actingPlayer;
    const source = Object.values(draft.objects.cards).find(c => c.cardId === card && c.controllerId === actor)!.id;
    relocate(draft, source, "HAND");
    return { state: unwrap(validateState(draft, context)), source };
}
function playProgram(s: GameState, id: CardInstanceId) {
    const first = act(s, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id); let state = first.state;
    const events = [...first.events];
    while (state.timing.step === "PAYMENT_SELECTION") { const next = act(state, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0); state = next.state; events.push(...next.events); }
    return { state, events };
}
function armed(attacking = PSYCHO, defending = CORPO, ag = 0, dg = 0, am = 0, dm = 0) {
    const p = combat(attacking, defending, ag, dg, am, dm), ready = prepareProgram(p.state), played = playProgram(ready.state, ready.source);
    return { ...p, ...played, source: ready.source };
}
function asMain(s: GameState) { const next = GameStateSchema.parse(s); next.timing.combat = { stage: "NONE" }; next.timing.actingPlayer = next.timing.activePlayer; next.timing.step = "MAIN"; next.timing.window = "MAIN"; return unwrap(validateState(next, context)); }

test("five immutable card reviews preserve complete text, canonical source hashes, printing UUIDs and errata pin", () => {
    assert.equal(restrictionCards.length, 5); assert.deepEqual(sources.matchingErrata, []);
    assert.equal(sources.errataSha256, rules.errataSha256);
    for (const card of restrictionCards) {
        const raw = sources.records.find(s => s.record.slug === card.id)!;
        assert.equal(card.provenance.sourceHash, hashCanonical(raw.record)); assert.equal(card.rulesText, raw.record.rules_text);
        assert.deepEqual(card.printings.map(p => p.id), raw.record.printings.map(p => p.id));
        assert.equal(card.power, raw.record.power ?? undefined); assert.deepEqual(card.printedCost, { kind: "EDDIES", amount: raw.record.cost });
        assert.equal(card.execution?.scope, "COMBAT_RESTRICTIONS_V1"); assert.equal(card.revision, 1);
        assert.ok(card.printings.some(p => p.setCode.endsWith("demodeck")));
    }
    for (const id of ["2.6", "3.18.1.2.3", "5.11.4.2", "9.19.3", "10.21", "10.22", "10.24", "10.28.1", "8.16.2"]) assert.ok(rules.rules.some(r => r.id === id));
});
test("complete admission rejects unsupported extra abilities, keywords, restrictions and unreviewed metadata", () => {
    for (const id of [REBOOT, CORPO, FLATHEAD, PSYCHO, ATLUS]) for (const mutate of [
        (c: typeof restrictionCards[number]) => ({ ...c, provenance: { ...c.provenance, reviewed: false } }),
        (c: typeof restrictionCards[number]) => ({ ...c, execution: { ...c.execution, status: "UNSUPPORTED" } }),
        (c: typeof restrictionCards[number]) => ({ ...c, mechanics: { ...c.mechanics, keywords: [...c.mechanics.keywords, "ADRENALINE"] } }),
        (c: typeof restrictionCards[number]) => ({ ...c, mechanics: { ...c.mechanics, restrictions: [...(c.mechanics.restrictions ?? []), { kind: "CANNOT_ATTACK" }] } }),
        (c: typeof restrictionCards[number]) => ({ ...c, mechanics: { ...c.mechanics, abilities: [...c.mechanics.abilities, { id: "unreviewed", trigger: "WHEN_DEFEATED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 2 }] }] } }),
        (c: typeof restrictionCards[number]) => ({ ...c, printedCost: { kind: "DASH" } })
    ]) {
        const cards = context.content.cards.map(c => CardRevisionSnapshotSchema.parse(c.id === id ? mutate(CardRevisionSnapshotSchema.parse(c)) : c));
        if (cards.some(c => !c.provenance.reviewed)) {
            assert.throws(() => createContentBundle(RulesetSchema.parse(context.content.ruleset), cards, context.content.manifest.engine));
            continue;
        }
        const ctx = { content: createContentBundle(RulesetSchema.parse(context.content.ruleset), cards, context.content.manifest.engine) };
        fail(createGameWithEvents(restrictionsInput("admission"), ctx));
    }
    const withoutPolicy = RulesetSchema.parse(context.content.ruleset); delete withoutPolicy.gameplay!.turnSlice!.combatRestrictions;
    const ctx = { content: createContentBundle(withoutPolicy, context.content.cards, context.content.manifest.engine) };
    fail(createGameWithEvents(restrictionsInput("policy"), ctx));
});
test("official constructed remains 40–50 main; 27+3 teaching decks cannot initialize", () => {
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 });
    assert.equal(Object.hasOwn(context.content.ruleset.formats!, "DEMO_STARTER"), false);
    const input = restrictionsInput("teaching");
    fail(createGameWithEvents({ ...input, decks: input.decks.map(d => ({ ...d, main: d.main.slice(0, 27) })) }, context), "INVALID_DECK");
});
test("Reboot creates public non-targeted prevention through normal Quick payment/Program/Trash lifecycle", () => {
    const p = armed(), effect = p.state.fightPreventions![0];
    assert.equal(p.state.timing.step, "RIVAL_REACT"); assert.equal(p.state.resolution.choice, null);
    assert.equal(p.state.objects.cards[p.source].zone.zone, "TRASH"); assert.equal(effect.sourceId, p.source); assert.equal(effect.controllerId, rival);
    assert.equal(effect.createdTurn, p.state.timing.turn); assert.equal(effect.expires.turn, p.state.timing.turn);
    assert.equal("targetId" in effect, false); assert.equal(p.state.temporaryModifiers, undefined);
    assert.equal(p.events.filter(e => e.payload.kind === "FIGHT_PREVENTION_CREATED").length, 1);
    assert.equal(p.events.filter(e => e.payload.kind === "PAYMENT_MADE").length, 1);
    assert.ok(p.events.some(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "RESOLVING_PROGRAM"));
    assert.equal(p.events.some(e => e.payload.kind === "FIGHT_STARTED"), false);
});
test("legal prevention alternate trace leaves a Gig attack unaffected and expires unused prevention before next MAIN", () => {
    const trace = preventionExpirationReplay(), events = trace.steps.flatMap(s => s.events);
    assert.ok(events.some(e => e.payload.kind === "FIGHT_PREVENTION_CREATED"));
    assert.ok(events.some(e => e.payload.kind === "GIG_STOLEN"));
    assert.ok(events.some(e => e.payload.kind === "FIGHT_PREVENTION_EXPIRED"));
    assert.equal(events.some(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED"), false);
    assert.equal(trace.finalState.fightPreventions, undefined); assert.equal(trace.finalState.timing.step, "MAIN");
});
test("Psycho Squad loses to higher printed power through ordinary defeat and movement", () => {
    const p = combat(PSYCHO, FLATHEAD), result = pass(p.state);
    assert.ok(result.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p.attacker));
    assert.equal(result.state.objects.cards[p.attacker].zone.zone, "TRASH");
    assert.equal(result.state.timing.step, "MAIN");
});
test("defeat prevention preserves winner/loser/power and produces no false CARD_DEFEATED or movement", () => {
    const p = armed(), before = hashReplayState(p.state), content = canonicalSerialize(context.content), result = pass(p.state);
    const outcome = result.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload; assert.ok(outcome.kind === "FIGHT_RESULT");
    assert.equal(outcome.winnerId, p.attacker); assert.deepEqual(outcome.loserIds, [p.defender]); assert.equal(outcome.attackerPower, 6); assert.equal(outcome.defenderPower, 2);
    assert.equal(result.events.some(e => e.payload.kind === "CARD_DEFEATED" || e.payload.kind === "CARD_MOVED"), false);
    assert.ok(result.events.some(e => e.payload.kind === "FIGHT_DEFEAT_PREVENTED" && e.payload.cardInstanceId === p.defender));
    assert.equal(result.state.fightPreventions, undefined); assert.equal(result.state.timing.window, "MAIN");
    assert.equal(result.state.objects.cards[p.defender].zone.zone, "BATTLEFIELD"); assert.equal(result.state.objects.cards[p.defender].readiness, "SPENT");
    assert.equal(hashReplayState(p.state), before); assert.equal(canonicalSerialize(context.content), content);
});
test("prevention consumes on the next fight even if the friendly Unit wins and needs no protection", () => {
    const p = armed(ATLUS, PSYCHO), result = pass(p.state);
    assert.equal(result.state.fightPreventions, undefined);
    assert.ok(result.events.some(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED"));
    assert.equal(result.events.some(e => e.payload.kind === "FIGHT_DEFEAT_PREVENTED"), false);
    assert.ok(result.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p.attacker));
});
test("zero-reference tie still consumes next-fight prevention without inventing defeat", () => {
    const p = armed(SWORDWISE, CORPO, 0, 0, 3, 2), result = pass(p.state);
    assert.ok(result.events.some(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED"));
    assert.equal(result.events.some(e => e.payload.kind === "CARD_DEFEATED" || e.payload.kind === "FIGHT_DEFEAT_PREVENTED"), false);
    assert.equal(result.state.fightPreventions, undefined);
});
test("positive tie protects only the friendly loser; remaining defeat with Gear retains a scoped proof until owner ordering", () => {
    const p = armed(ATLUS, PSYCHO, 1), result = pass(p.state);
    assert.equal(result.state.timing.step, "DEFEAT_ORDER_SELECTION"); assert.equal(result.state.fightPreventions, undefined);
    assert.deepEqual(result.state.resolution.defeatContinuation?.appliedPrevention, p.state.fightPreventions![0]);
    assert.deepEqual(result.state.resolution.defeatContinuation?.defeats, [{ targetId: p.attacker, defeatedBy: p.defender }]);
    const completed = finish(result.state);
    assert.equal(completed.state.objects.cards[p.defender].zone.zone, "BATTLEFIELD"); assert.equal(completed.state.objects.cards[p.attacker].zone.zone, "TRASH");
    assert.equal(completed.state.resolution.defeatContinuation, undefined);
    assert.ok(completed.events.some(e => e.payload.kind === "GEAR_DETACHED"));
    const forged = GameStateSchema.parse(result.state); delete forged.resolution.defeatContinuation!.appliedPrevention; fail(validateState(forged, context));
});
test("a consumed effect does not prevent a second fight in the same turn", () => {
    const p = armed(), first = pass(p.state).state, s = GameStateSchema.parse(first);
    const second = Object.values(s.objects.cards).find(c => c.cardId === PSYCHO && c.controllerId === active && c.id !== p.attacker)!.id;
    relocate(s, second, "BATTLEFIELD"); s.objects.cards[second].readiness = "READY";
    let next = act(s, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === second).state;
    if (next.timing.step === "ATTACK_TARGET_SELECTION") next = act(next, a => a.action.kind === "CHOOSE" && (() => { const o = next.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === p.defender; })()).state;
    const result = pass(next);
    assert.ok(result.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p.defender));
    assert.equal(result.events.some(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED"), false);
});
test("Gig-area combat and invalidated attack do not consume a fight-only effect; unused effect expires at turn end", () => {
    const p = armed(), s = GameStateSchema.parse(p.state); assert.ok("target" in s.timing.combat); s.timing.combat.target = { kind: "GIG_AREA", playerId: rival };
    const begin = pass(s), completed = finish(begin.state);
    assert.deepEqual(completed.state.fightPreventions, p.state.fightPreventions);
    assert.equal([...begin.events, ...completed.events].some(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED"), false);
    const end = act(completed.state, a => a.action.kind === "END_TURN");
    assert.equal(end.state.fightPreventions, undefined); assert.ok(end.events.some(e => e.payload.kind === "FIGHT_PREVENTION_EXPIRED"));
    const invalid = GameStateSchema.parse(p.state); delete invalid.objects.cards[p.attacker]; const hash = hashReplayState(invalid);
    fail(applyAction(invalid, { actorId: rival, action: { kind: "PASS_REACT" } }, context)); assert.equal(hashReplayState(invalid), hash);
});
test("MAIN play protects its controller on offense and source movement does not cancel the independent effect", () => {
    const base = asMain(combat(ATLUS, PSYCHO).state), ready = prepareProgram(base), created = playProgram(ready.state, ready.source).state;
    assert.equal(created.fightPreventions![0].controllerId, active);
    const s = GameStateSchema.parse(created), source = s.objects.cards[ready.source]; relocate(s, source.id, "HAND");
    const attacker = Object.values(s.objects.cards).find(c => c.cardId === ATLUS && c.controllerId === active && c.zone.zone === "BATTLEFIELD")!.id;
    const defender = Object.values(s.objects.cards).find(c => c.cardId === PSYCHO && c.controllerId === rival && c.zone.zone === "BATTLEFIELD")!.id;
    s.timing.combat = { stage: "RIVAL_REACT", attackingPlayerId: active, attackerId: attacker, target: { kind: "CARD", cardInstanceId: defender } }; s.timing.actingPlayer = rival; s.timing.step = "RIVAL_REACT"; s.timing.window = "RIVAL_REACT";
    const result = pass(s); assert.equal(result.state.objects.cards[attacker].zone.zone, "BATTLEFIELD");
    assert.ok(result.events.some(e => e.payload.kind === "FIGHT_DEFEAT_PREVENTED" && e.payload.cardInstanceId === attacker));
    assert.equal(result.state.objects.cards[source.id].zone.zone, "HAND");
});
test("Reboot uses the Blocker-replaced participants and leaves the originally attacked Gig area alone", () => {
    const final = prevention.finalState, events = prevention.steps.flatMap(s => s.events);
    const block = events.find(e => e.payload.kind === "BLOCKER_DECLARED")!.payload; assert.ok(block.kind === "BLOCKER_DECLARED"); assert.equal(block.previousTarget.kind, "GIG_AREA");
    const consumed = events.find(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED")!.payload; assert.ok(consumed.kind === "FIGHT_PREVENTION_CONSUMED"); assert.equal(consumed.defenderId, block.cardInstanceId);
    assert.equal(final.objects.cards[block.cardInstanceId].cardId, CORPO); assert.equal(final.objects.cards[block.cardInstanceId].zone.zone, "BATTLEFIELD");
    assert.equal(events.some(e => e.payload.kind === "GIG_STOLEN"), false);
});
test("second Reboot is legal while duplicate/stale/forged records reject atomically", () => {
    const p = armed(), next = GameStateSchema.parse(p.state), second = Object.values(next.objects.cards).find(c => c.cardId === REBOOT && c.controllerId === rival && c.id !== p.source)!.id;
    relocate(next, second, "HAND"); const hash = hashReplayState(next);
    assert.equal(legal(next).some(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === second), true);
    assert.ok(applyAction(next, { actorId: rival, action: { kind: "PLAY_CARD", cardInstanceId: second } }, context).ok);
    for (const mutate of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.fightPreventions!.push(s.fightPreventions![0]); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.fightPreventions![0].id = "0".repeat(64); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.fightPreventions![0].expires.turn++; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.fightPreventions![0].createdTurn--; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.fightPreventions![0].sourceId = p.attacker; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.fightPreventions = []; }
    ]) { const s = GameStateSchema.parse(next); mutate(s); fail(validateState(s, context)); }
    assert.equal(hashReplayState(next), hash);
});
test("Corpo plays with Lag, cannot attack when ready, but independently blocks and fights normally", () => {
    const playedIndex = prevention.steps.findIndex(s => s.events.some(e => e.payload.kind === "CARD_PLAYED" && preventionStates[prevention.steps.indexOf(s)+1].objects.cards[e.payload.cardInstanceId].cardId === CORPO));
    const played = preventionStates[playedIndex+1], id = played.players[rival].zones.BATTLEFIELD.find(id => played.objects.cards[id].cardId === CORPO)!;
    assert.equal(played.objects.cards[id].readiness, "READY"); assert.ok(played.objects.cards[id].statuses.includes("LAG"));
    const turn = preventionStates.find(s => s.timing.activePlayer === rival && s.timing.turn === 4 && s.timing.step === "MAIN")!;
    const view = new RulesView(turn, context); assert.deepEqual(view.getAttackRestrictions(id), [{ kind: "CANNOT_ATTACK" }]); assert.equal(view.isAttackEligible(rival, id), false);
    assert.equal(legal(turn).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id), false); fail(applyAction(turn, { actorId: rival, action: { kind: "DECLARE_ATTACK", cardInstanceId: id } }, context));
    const open = preventionStates.find(s => s.timing.step === "RIVAL_REACT")!;
    assert.equal(new RulesView(open, context).isBlockerEligible(rival, id), true);
    const lagged = GameStateSchema.parse(open); lagged.objects.cards[id].statuses = ["LAG"];
    assert.equal(new RulesView(unwrap(validateState(lagged, context)), context).isBlockerEligible(rival, id), true);
    const blocked = act(open, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === id).state;
    assert.equal(blocked.objects.cards[id].readiness, "SPENT");
    const result = pass(blocked); assert.equal(result.state.objects.cards[id].zone.zone, "TRASH");
});
test("Flathead current condition removes only Blocker actions; CALL/Quick/PASS stay available", () => {
    const s = permissionsStates.find(s => s.timing.step === "RIVAL_REACT")!, c = s.timing.combat; assert.ok(c.stage === "RIVAL_REACT");
    const view = new RulesView(s, context), actions = legal(s);
    assert.equal(view.getRevision(c.attackerId)!.id, FLATHEAD); assert.equal(view.canBeBlocked(c.attackerId), false);
    assert.deepEqual([...new Set(actions.map(a => a.action.kind))], ["CALL_LEGEND", "PLAY_CARD", "PASS_REACT"]);
    const blocker = Object.values(s.objects.cards).find(c => c.cardId === CORPO && c.controllerId === rival && c.zone.zone === "BATTLEFIELD")!.id;
    fail(applyAction(s, { actorId: rival, action: { kind: "DECLARE_BLOCKER", cardInstanceId: blocker } }, context));
    assert.equal(new RulesView(permissions.finalState, context).getControlledGigCount(active), 4);
});
test("blocking permission rederives from current Street Cred without a combat cache", () => {
    let s = permissionsStates.find(s => s.timing.step === "RIVAL_REACT")!; const before = s;
    assert.ok("attackerId" in s.timing.combat); const attacker = s.timing.combat.attackerId;
    const beforeActions = legal(s);
    for (const g of new RulesView(s, context).getControlledGigs(rival)) { assert.ok(g.roll.kind === "ROLLED"); if (g.roll.currentValue > 1) s = unwrap(modifyGigValue(s, g.id, 1 - g.roll.currentValue, context)).state; }
    assert.equal(new RulesView(s, context).canBeBlocked(attacker), true); assert.ok(legal(s).some(a => a.action.kind === "DECLARE_BLOCKER"));
    const unchangedKinds = beforeActions.map(a => canonicalSerialize(a.action)); assert.ok(unchangedKinds.every(a => legal(s).some(b => canonicalSerialize(b.action) === a)));
    assert.notEqual(hashPosition(s), hashPosition(before)); fail(resolveActionId(s, rival, beforeActions[0].actionId, context));
    const reordered = GameStateSchema.parse(s); reordered.objects.gigs = Object.fromEntries(Object.entries(reordered.objects.gigs).reverse()); assert.deepEqual(legal(reordered), legal(s));
    // Three active-player Gigs at 1 versus two rival Gigs at 1 and 2: equality permits blocking.
    for (const player of [active, rival]) for (const [index, g] of new RulesView(s, context).getControlledGigs(player).entries()) {
        assert.ok(g.roll.kind === "ROLLED"); const value = player === rival && index === 1 ? 2 : 1;
        if (g.roll.currentValue !== value) s = unwrap(modifyGigValue(s, g.id, value - g.roll.currentValue, context)).state;
    }
    const equal = new RulesView(s, context); assert.equal(equal.getStreetCred(active), equal.getStreetCred(rival));
    assert.equal(equal.canBeBlocked(attacker), true);
    // Existing reviewed Quick/CALL effects do not change Street Cred; the trusted value primitive proves the query is live for future effects.
});
test("Null Street Cred comparison for restrictions is explicit and does not make two empty areas less than each other", () => {
    const s = GameStateSchema.parse(main);
    for (const p of Object.values(s.players)) for (const id of [...p.gigs.GIGS]) { const g = s.objects.gigs[id]; p.gigs.GIGS.splice(p.gigs.GIGS.indexOf(id), 1); p.gigs.FIXER.push(id); g.location.zone = "FIXER"; g.roll = { kind: "UNROLLED" }; }
    const empty = new RulesView(s, context); assert.equal(empty.testCondition(active, { kind: "STREET_CRED_LESS_THAN_RIVAL" }), false);
    const id = s.players[rival].gigs.FIXER[0], g = s.objects.gigs[id]; s.players[rival].gigs.FIXER.shift(); s.players[rival].gigs.GIGS.push(id); g.location.zone = "GIGS"; g.roll = { kind: "ROLLED", initialValue: 1, currentValue: 1 };
    assert.equal(new RulesView(s, context).testCondition(active, { kind: "STREET_CRED_LESS_THAN_RIVAL" }), true);
    assert.equal(new RulesView(s, context).testCondition(rival, { kind: "STREET_CRED_LESS_THAN_RIVAL" }), false);
});
for (const cardId of [PSYCHO, ATLUS]) test(`${cardId} consumes ordinary play/Lag/attack/fight/defeat without bespoke pending effects`, () => {
    const index = vanilla.steps.findIndex(s => s.events.some(e => e.payload.kind === "CARD_PLAYED" && vanillaStates[vanilla.steps.indexOf(s)+1].objects.cards[e.payload.cardInstanceId].cardId === cardId));
    assert.ok(index >= 0); const result = vanillaStates[index+1], card = Object.values(result.objects.cards).find(c => c.cardId === cardId && c.zone.zone === "BATTLEFIELD")!;
    assert.equal(card.readiness, "READY"); assert.deepEqual(card.statuses, ["LAG"]);
    assert.equal(new RulesView(result, context).isAttackEligible(card.controllerId, card.id), false);
    assert.equal(vanilla.steps[index].events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
    assert.ok(vanilla.steps.some(s => s.action.action.kind === "DECLARE_ATTACK" && s.action.action.cardInstanceId === card.id));
    assert.equal(new RulesView(vanilla.finalState, context).getEffectivePower(card.id), cardId === PSYCHO ? 6 : 4);
    if (cardId === ATLUS) assert.equal(vanilla.finalState.objects.cards[card.id].zone.zone, "TRASH");
});
test("public effects/restrictions appear in observation without revealing undeclared Reboot hand choices to the rival", () => {
    const prepared = prepareProgram(combat().state), before = unwrap(observe(prepared.state, active, context));
    assert.equal(JSON.stringify(before).includes(prepared.source), false);
    const p = playProgram(prepared.state, prepared.source);
    for (const actor of [active, rival]) {
        const o = unwrap(observe(p.state, actor, context)); assert.equal(o.fightPreventions?.[0].sourceId, prepared.source); assert.equal(o.fightPreventions?.[0].controllerSeat, 1);
    }
    const position = unwrap(generatePosition(p.state, rival, context, "armed-react")), input = JSON.stringify(modelInput(position));
    assert.equal(input.includes(p.state.rng.seed), false); assert.equal(input.includes('"rng"'), false);
    const c = p.state.timing.combat; assert.ok(c.stage === "RIVAL_REACT");
    const corpse = Object.values(p.state.objects.cards).find(c => c.cardId === CORPO && c.zone.zone === "BATTLEFIELD")!;
    assert.deepEqual(unwrap(observe(p.state, rival, context)).players.flatMap(p => p.cards).find(c => c.publicId === corpse.id)!.restrictions, ["CANNOT_ATTACK"]);
});
test("event-preserving resume applies mandatory prevention without a model choice", () => {
    const p = armed(), pending = GameStateSchema.parse(p.state); assert.ok("target" in pending.timing.combat && pending.timing.combat.target);
    pending.timing.combat = { ...pending.timing.combat, target: pending.timing.combat.target, stage: "COMBAT_RESOLUTION_PENDING" }; pending.timing.step = "COMBAT_RESOLUTION_PENDING"; pending.timing.window = "COMBAT_RESOLUTION_PENDING";
    const resumed = unwrap(advanceResolutionWithEvents(pending, context)), passed = pass(p.state);
    assert.deepEqual(resumed.events.map(e => e.payload), passed.events.slice(2).map(e => e.payload)); assert.equal(hashPosition(resumed.state), hashPosition(passed.state));
    fail(generatePosition(pending, rival, context, "automatic"));
});
for (const [name, replay] of [["prevention-replay", prevention], ["permissions-replay", permissions], ["vanilla-replay", vanilla]] as const) test(`${name} exact replay and wire v1 actionId traversal`, () => {
    assert.deepEqual(JSON.parse(readFileSync(`tests/fixtures/${name}.v1.json`, "utf8")), replay);
    let state = replay.initialized.state;
    for (const step of replay.steps) {
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: replay.content, state, actorId: step.actorId, actionId: step.actionId });
        assert.ok(response.ok, JSON.stringify(response)); if (!response.ok || response.value.kind !== "transition") throw new Error("Expected transition");
        assert.deepEqual(response.value.events, step.events); assert.equal(response.value.stateHash, step.stateHash); state = response.value.state;
    }
    assert.deepEqual(state, replay.finalState); assert.equal(state.timing.window, "MAIN"); assert.ok(replay.positions.every(p => p.legalActions.length > 1));
    assert.equal(replay.positions.some(p => p.state.timing.combat.stage === "COMBAT_RESOLUTION_PENDING"), false);
});


/** Trusted focused arrangement of the second physical Program; exact Demo prefixes are tested separately. */
function secondPrevention(p: ReturnType<typeof armed>) {
    const draft = GameStateSchema.parse(p.state);
    const source = Object.values(draft.objects.cards).find(c => c.cardId === REBOOT && c.controllerId === rival && c.id !== p.source)!.id;
    relocate(draft, source, "HAND");
    const before = unwrap(validateState(draft, context));
    const played = playProgram(before, source);
    assert.equal(played.state.fightPreventions!.length, 2);
    assert.equal(played.state.objects.cards[source].zone.zone, "TRASH");
    assert.equal(played.state.resolution.choice, null);
    return { ...p, ...played, second: source };
}
for (const [label, args, prevented] of [
    ["friendly loses", [PSYCHO, CORPO], 1],
    ["friendly wins redundantly", [ATLUS, PSYCHO], 0],
    ["zero-zero fight", [SWORDWISE, CORPO, 0, 0, 3, 2], 0],
    ["positive tie with owner ordering", [ATLUS, PSYCHO, 1], 1]
] as const) test(`multiplicity: both consume on ${label}`, () => {
    const p = secondPrevention(armed(args[0], args[1], args[2] ?? 0, args[3] ?? 0, args[4] ?? 0, args[5] ?? 0)), before = hashReplayState(p.state), result = pass(p.state);
    assert.equal(hashReplayState(p.state), before);
    const consumed = result.events.filter(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED").map(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED" ? e.payload.effectId : "");
    assert.deepEqual(consumed, p.state.fightPreventions!.map(e => e.id));
    assert.equal(result.events.filter(e => e.payload.kind === "FIGHT_RESULT").length, 1);
    assert.equal(result.events.filter(e => e.payload.kind === "FIGHT_DEFEAT_PREVENTED").length, prevented);
    assert.equal(result.state.fightPreventions, undefined);
    assert.equal(result.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p.defender), false);
    const completed = finish(result.state);
    assert.equal(completed.state.objects.cards[p.defender].zone.zone, "BATTLEFIELD");
    if (label === "friendly wins redundantly" || label === "positive tie with owner ordering") assert.equal(completed.state.objects.cards[p.attacker].zone.zone, "TRASH");
    if (label === "positive tie with owner ordering") {
        assert.equal(result.state.resolution.defeatContinuation!.appliedPrevention, undefined);
        assert.deepEqual(result.state.resolution.defeatContinuation!.appliedPreventions, p.state.fightPreventions);
        assert.ok(handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "validateState", content: context.content, state: result.state, actorId: result.state.timing.actingPlayer }).ok);
        for (const mutate of [
            (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.defeatContinuation!.appliedPrevention = s.resolution.defeatContinuation!.appliedPreventions![0]; },
            (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.defeatContinuation!.appliedPreventions!.push(s.resolution.defeatContinuation!.appliedPreventions![0]); },
            (s: ReturnType<typeof GameStateSchema.parse>) => { s.fightPreventions = GameStateSchema.parse(p.state).fightPreventions; },
            (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.defeatContinuation!.appliedPreventions!.reverse(); }
        ]) { const draft = GameStateSchema.parse(result.state); mutate(draft); fail(validateState(draft, context)); }
    }
});
test("multiplicity: no-fight Gig steal retains both and end-turn expires each", () => {
    const p = secondPrevention(armed()), draft = GameStateSchema.parse(p.state);
    draft.timing.combat = { stage: "RIVAL_REACT", attackerId: p.attacker, attackingPlayerId: active, target: { kind: "GIG_AREA", playerId: rival } };
    const first = pass(unwrap(validateState(draft, context))), after = finish(first.state);
    assert.deepEqual(after.state.fightPreventions, p.state.fightPreventions);
    assert.equal([...first.events, ...after.events].some(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED"), false);
    const ended = act(after.state, a => a.action.kind === "END_TURN");
    assert.equal(ended.state.fightPreventions, undefined);
    assert.deepEqual(ended.events.filter(e => e.payload.kind === "FIGHT_PREVENTION_EXPIRED").map(e => e.payload.kind === "FIGHT_PREVENTION_EXPIRED" ? e.payload.effectId : ""), p.state.fightPreventions!.map(e => e.id));
});
test("multiplicity: later same-turn fight has no protection", () => {
    const p = secondPrevention(armed()), first = pass(p.state), draft = GameStateSchema.parse(first.state);
    const attacker = Object.values(draft.objects.cards).find(c => c.cardId === PSYCHO && c.controllerId === active && c.id !== p.attacker)!.id;
    relocate(draft, attacker, "BATTLEFIELD"); draft.objects.cards[attacker].readiness = "SPENT";
    draft.timing.combat = { stage: "RIVAL_REACT", attackerId: attacker, attackingPlayerId: active, target: { kind: "CARD", cardInstanceId: p.defender } };
    draft.timing.actingPlayer = rival; draft.timing.window = "RIVAL_REACT"; draft.timing.step = "RIVAL_REACT";
    const result = pass(unwrap(validateState(draft, context)));
    assert.ok(result.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p.defender));
    assert.equal(result.events.some(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED"), false);
});
test("multiplicity: Blocker-created fight consumes both", () => {
    const p = secondPrevention(armed()), draft = GameStateSchema.parse(p.state);
    draft.objects.cards[p.defender].readiness = "READY";
    draft.timing.combat = { stage: "RIVAL_REACT", attackerId: p.attacker, attackingPlayerId: active, target: { kind: "GIG_AREA", playerId: rival } };
    const blocked = act(unwrap(validateState(draft, context)), a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === p.defender);
    const fought = pass(blocked.state);
    assert.equal(fought.events.filter(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED").length, 2);
});
test("multiplicity: public counts/hashes differ and state generation is canonically ordered", () => {
    const two = secondPrevention(armed()), zero = GameStateSchema.parse(two.state), single = GameStateSchema.parse(two.state);
    delete zero.fightPreventions; single.fightPreventions = [single.fightPreventions![0]];
    // Isolate the occurrence collection: payment, zones and every other state field are identical.
    const states = [unwrap(validateState(zero, context)), unwrap(validateState(single, context)), two.state];
    assert.equal(new Set(states.map(hashPosition)).size, 3);
    for (const actor of [active, rival]) {
        const views = states.map(s => unwrap(observe(s, actor, context)));
        assert.deepEqual(views.map(o => o.fightPreventions?.length ?? 0), [0, 1, 2]);
        assert.equal(new Set(views.map(hashCanonical)).size, 3);
    }
    assert.deepEqual(two.state.fightPreventions!.map(e => e.id), two.state.fightPreventions!.map(e => e.id).sort());
    const reversed = GameStateSchema.parse(two.state); reversed.fightPreventions!.reverse(); fail(validateState(reversed, context));
    const invalid = GameStateSchema.parse(two.state); invalid.fightPreventions![1].sourceId = invalid.fightPreventions![0].sourceId; fail(validateState(invalid, context));
});
