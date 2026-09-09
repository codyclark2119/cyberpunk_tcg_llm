import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, createContentBundle, hashCanonical, type GameState, type LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, resolveActionId, RulesView, validateState } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { orderedContext, orderedInput, evelyn, EVELYN } from "./attack-ordered-effects-fixture";
import { evelynReplay } from "./attack-ordered-effects-replay";
import { KIROSHI } from "./private-information-fixture";
import { SATORI } from "./combat-triggers-fixture";
import { FLOOR_IT } from "./react-fixture";
import { REBOOT } from "./combat-restrictions-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { advanceTriggers } from "../packages/engine/src/trigger-resolution";
import { triggerChoice } from "../packages/engine/src/trigger-queries";
import { supportsOrderedAttackCard } from "../packages/engine/src/ordered-effects-support";
import { grantLegendKnowledge } from "../packages/engine/src/private-knowledge";
import { testCondition } from "../packages/engine/src/conditions";
import { unwrap } from "./turn-replay";
import source from "./fixtures/attack-ordered-effects-card-source.v1.json";
import rules from "./fixtures/attack-ordered-effects-rules.v1.json";
const context = orderedContext(), replay = evelynReplay();
const states: GameState[] = [replay.initialized.state]; for (const step of replay.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state);
const attackIndex = replay.steps.findIndex(s => s.action.action.kind === "DECLARE_ATTACK");
const before = states[attackIndex], pending = states[attackIndex + 1], after = states[attackIndex + 2];
const attack = replay.steps[attackIndex].action.action; assert.ok(attack.kind === "DECLARE_ATTACK");
const host = attack.cardInstanceId, actor = before.timing.activePlayer, rival = before.match.playerOrder.find(id => id !== actor)!;
const legal = (s: GameState) => unwrap(listLegalActions(s, s.timing.actingPlayer, context));
function act(s: GameState, predicate: (a: LegalAction) => boolean) { const a = legal(s).find(predicate); assert.ok(a, `action at ${s.timing.step}`); return unwrap(applyAction(s, { actorId: a.actorId, action: a.action }, context)); }
function choose(s: GameState, index = 0) { return act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index); }
function finish(s: GameState) { const events = []; while (s.resolution.choice) { const next = choose(s); s = next.state; events.push(...next.events); } return { state: s, events }; }
function start(s: GameState) { return act(s, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host); }
function attach(m: TurnMutation, card: string) {
    const g = Object.values(m.state.objects.cards).find(c => c.controllerId === actor && c.cardId === card)!;
    if (g.zone.zone !== "HAND") moveCardLocation(m, g.id, "HAND"); unwrap(attachPlayedGear(m, g.id, host)); return g.id;
}
/** Focused fixtures below are explicit trusted state arrangements, separate from the legal headline replay. */
function withCred(ownValue: number, rivalValue: number) {
    const s = GameStateSchema.parse(before);
    for (const g of Object.values(s.objects.gigs)) if (g.roll.kind === "ROLLED") g.roll.currentValue = g.controllerId === actor ? ownValue : rivalValue;
    return unwrap(validateState(s, context));
}
function swapHandIdentity(s: GameState, player = actor) {
    const d = GameStateSchema.parse(s), h = d.players[player].zones.HAND[0];
    const other = d.players[player].zones.DECK.find(id => d.objects.cards[id].cardId !== d.objects.cards[h].cardId)!;
    [d.objects.cards[h].cardId, d.objects.cards[other].cardId] = [d.objects.cards[other].cardId, d.objects.cards[h].cardId];
    [d.objects.cards[h].revision, d.objects.cards[other].revision] = [d.objects.cards[other].revision, d.objects.cards[h].revision];
    return unwrap(validateState(d, context));
}
test("Evelyn full captured record, all printings and errata are normalized", () => {
    assert.equal(evelyn.rulesText, "{Attack} Draw 1. Then, if you have more ☆ (Street Cred) than a Rival, discard 1.\n(Units with power 0 don't steal Gigs.)");
    assert.equal(evelyn.provenance.sourceHash, hashCanonical(source.record)); assert.equal(evelyn.printings.length, 5);
    assert.ok(evelyn.printings.some(p => p.id === "3757f0f3-32d0-41c2-89dc-515271d2b758" && p.collectorNumber === "010"));
    assert.equal(source.errata.length, 4); assert.deepEqual(evelyn.provenance.errata, []);
    assert.ok(supportsOrderedAttackCard(evelyn, context).ok); assert.equal(evelyn.sellProfile.allowed, false);
    assert.deepEqual(evelyn.mechanics.abilities[0].effects.map(e => e.kind), ["DRAW", "DISCARD_CARDS"]);
    for (const id of ["10.1.4", "10.2", "10.2.3", "10.3.3", "10.31.1", "10.31.2", "11.5.1", "11.21.2.2", "5.4.3", "5.9.2"]) assert.ok(rules.rules.some(r => r.id === id), id);
    assert.match(rules.decisions.discard, /no standalone DISCARD/);
});
test("headline pays, plays real Evelyn with Lag, clears Lag, then attacks to MAIN", () => {
    const played = states.find(s => s.objects.cards[host]?.zone.zone === "BATTLEFIELD")!;
    assert.ok(played.objects.cards[host].statuses.includes("LAG"));
    assert.equal(legal(played).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host), false);
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "PAYMENT_MADE")));
    assert.equal(before.objects.cards[host].statuses.includes("LAG"), false);
    assert.equal(replay.finalState.timing.step, "MAIN"); assert.equal(replay.finalState.timing.combat.stage, "NONE");
    assert.equal(new RulesView(before, context).getGigStealAllowance(host), 0);
    assert.equal(replay.steps.flatMap(s => s.events).some(e => e.payload.kind === "GIG_STOLEN"), false);
});
test("ATTACK draws before condition, pauses its second primitive, then discards before React", () => {
    const events = replay.steps[attackIndex].events.map(e => e.payload), draw = events.findIndex(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK" && e.to.zone === "HAND"), condition = events.findIndex(e => e.kind === "CONDITION_EVALUATED");
    assert.ok(draw >= 0 && condition > draw); assert.deepEqual(events[condition], { kind: "CONDITION_EVALUATED", effectId: pending.resolution.current!.id, met: true });
    assert.equal(events.some(e => e.kind === "EFFECT_RESOLVED"), false);
    assert.equal(pending.resolution.current!.primitiveIndex, 1); assert.equal(pending.resolution.triggerContinuation!.conditionMet, true);
    assert.equal(pending.objects.cards[host].readiness, "SPENT"); assert.equal(pending.timing.combat.stage, "TRIGGER_RESOLUTION");
    assert.equal(pending.players[actor].zones.HAND.length, before.players[actor].zones.HAND.length + 1);
    assert.equal(new RulesView(pending, context).getStreetCred(actor), new RulesView(before, context).getStreetCred(actor));
    const payloads = replay.steps[attackIndex + 1].events.map(e => e.payload.kind);
    assert.ok(payloads.indexOf("CARD_DISCARDED") < payloads.indexOf("EFFECT_RESOLVED")); assert.equal(after.timing.step, "RIVAL_REACT");
});
test("discard chooser is Evelyn controller; own strategic hand choices only, no nested reaction", () => {
    assert.equal(pending.timing.activePlayer, actor); assert.equal(pending.timing.actingPlayer, actor); assert.equal(pending.resolution.choice!.actorId, actor);
    assert.equal(pending.resolution.choice!.kind, "DISCARD"); assert.ok(legal(pending).length > 1);
    assert.deepEqual(pending.resolution.choice!.options, new RulesView(pending, context).getDiscardableCards(actor).map(cardInstanceId => ({ kind: "CARD", cardInstanceId })));
    assert.deepEqual(unwrap(listLegalActions(pending, rival, context)), []);
    assert.ok(legal(pending).every(a => a.action.kind === "CHOOSE" && a.descriptor.label.startsWith("Discard ")));
    assert.equal(applyAction(pending, { actorId: rival, action: { kind: "PASS_REACT" } }, context).ok, false);
    assert.equal(applyAction(pending, { actorId: rival, action: legal(pending)[0].action }, context).ok, false);
});
for (const [name, own, theirs] of [["less", 1, 4], ["equal", 1, 2]] as const) test(`post-draw condition ${name}: no discard and direct React`, () => {
    const result = start(withCred(own, theirs)), events = result.events.map(e => e.payload);
    assert.equal(result.state.timing.step, "RIVAL_REACT"); assert.equal(result.state.resolution.choice, null);
    assert.ok(events.some(e => e.kind === "CONDITION_EVALUATED" && !e.met)); assert.equal(events.some(e => e.kind === "CARD_DISCARDED"), false);
    assert.ok(events.findIndex(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK") < events.findIndex(e => e.kind === "CONDITION_EVALUATED"));
});
test("Street Cred comparison preserves numeric greater-than-Null and Null/Null", () => {
    const s = GameStateSchema.parse(before), condition = { kind: "STREET_CRED_GREATER_THAN_RIVAL" } as const;
    for (const g of Object.values(s.objects.gigs)) if (g.controllerId === rival) g.location.zone = "FIXER";
    assert.equal(testCondition(s, actor, condition, context), true); assert.equal(testCondition(s, rival, condition, context), false);
    for (const g of Object.values(s.objects.gigs)) g.location.zone = "FIXER";
    assert.equal(testCondition(s, actor, condition, context), false);
});
test("empty pre-draw own hand forces the newly drawn card; rival empty hand is irrelevant", () => {
    const m = new TurnMutation(before, context);
    for (const player of [actor, rival]) for (const id of [...m.state.players[player].zones.HAND]) moveCardLocation(m, id, "TRASH");
    const top = m.state.players[actor].zones.DECK[0], result = start(unwrap(validateState(m.state, context)));
    assert.equal(result.state.resolution.choice, null); assert.equal(result.state.timing.step, "RIVAL_REACT");
    assert.equal(result.state.players[actor].zones.HAND.length, 0); assert.equal(result.state.objects.cards[top].zone.zone, "TRASH");
    assert.ok(result.events.some(e => e.payload.kind === "CARD_DISCARDED" && e.payload.forced));
});
test("zero eligible discard at trusted primitive boundary resolves without a fake choice", () => {
    // Not a reachable Evelyn post-draw hand: success draws one, empty draw loses immediately.
    const m = new TurnMutation(pending, context);
    for (const id of [...m.state.players[actor].zones.HAND]) moveCardLocation(m, id, "TRASH");
    unwrap(advanceTriggers(m)); const result = unwrap(m.result());
    assert.equal(result.state.timing.step, "RIVAL_REACT"); assert.equal(result.state.resolution.choice, null);
    assert.equal(result.events.some(e => e.payload.kind === "CARD_DISCARDED"), false);
});
test("empty deck loses immediately during DRAW and never evaluates/discards", () => {
    const m = new TurnMutation(before, context); for (const id of [...m.state.players[actor].zones.DECK]) moveCardLocation(m, id, "TRASH");
    const result = start(unwrap(validateState(m.state, context)));
    assert.equal(result.state.match.outcome?.reason, "EMPTY_DRAW"); assert.equal(result.state.resolution.triggerContinuation, undefined);
    assert.equal(result.events.some(e => ["CONDITION_EVALUATED", "CARD_DISCARDED"].includes(e.payload.kind)), false);
});
test("selected physical hand card becomes public face-up Trash, with semantic source fact", () => {
    const option = pending.resolution.choice!.options[0]; assert.ok(option.kind === "CARD");
    assert.equal(after.objects.cards[option.cardInstanceId].zone.zone, "TRASH"); assert.equal(after.objects.cards[option.cardInstanceId].face, "UP");
    assert.equal(after.players[actor].zones.TRASH.at(-1), option.cardInstanceId);
    for (const viewer of [actor, rival]) assert.ok(unwrap(observe(after, viewer, context)).players[0].cards.some(c => c.zone === "TRASH" && c.content?.cardId === after.objects.cards[option.cardInstanceId].cardId));
    assert.ok(replay.steps[attackIndex + 1].events.some(e => e.payload.kind === "CARD_DISCARDED" && e.payload.cardInstanceId === option.cardInstanceId && e.payload.sourceId === host && e.payload.playerId === actor && !e.payload.forced));
});
for (const defect of ["actor", "source", "revision", "index", "condition", "options", "duplicate", "combat", "earlyReact"] as const) test(`forged discard ${defect} rejected atomically`, () => {
    const s = GameStateSchema.parse(pending), original = JSON.stringify(s);
    if (defect === "actor") s.resolution.choice!.actorId = rival;
    if (defect === "source") s.resolution.current!.sourceId = s.players[actor].zones.HAND[0];
    if (defect === "revision") s.resolution.current!.trigger!.source.cardId = s.objects.cards[s.players[actor].zones.HAND[0]].cardId;
    if (defect === "index") delete s.resolution.current!.primitiveIndex;
    if (defect === "condition") delete s.resolution.triggerContinuation!.conditionMet;
    if (defect === "options") s.resolution.choice!.options.pop();
    if (defect === "duplicate") s.resolution.choice!.options[1] = s.resolution.choice!.options[0];
    if (defect === "combat") s.timing.combat = { stage: "NONE" };
    if (defect === "earlyReact") { s.timing.step = "RIVAL_REACT"; s.timing.window = "RIVAL_REACT"; }
    assert.notEqual(JSON.stringify(s), original); const frozen = JSON.stringify(s);
    assert.equal(validateState(s, context).ok, false); assert.equal(applyAction(s, { actorId: actor, action: legal(pending)[0].action }, context).ok, false); assert.equal(JSON.stringify(s), frozen);
});
test("stale hand options and stale actionId reject instead of discarding a replacement", () => {
    const old = legal(pending)[0], m = new TurnMutation(pending, context), option = pending.resolution.choice!.options[0]; assert.ok(option.kind === "CARD");
    moveCardLocation(m, option.cardInstanceId, "TRASH");
    assert.equal(validateState(m.state, context).ok, false); assert.equal(resolveActionId(m.state, actor, old.actionId, context).ok, false);
    m.state.resolution.choice = triggerChoice(m.state, context); const fresh = unwrap(validateState(m.state, context));
    assert.equal(resolveActionId(fresh, actor, old.actionId, context).ok, false);
    assert.equal(applyAction(pending, { actorId: actor, action: { kind: "CHOOSE", choiceId: pending.resolution.choice!.id, optionIndices: [0, 0] } }, context).ok, false);
});
test("own-hand differences change chooser observation/position/actions, but stay hidden to rival", () => {
    const swapped = swapHandIdentity(pending);
    assert.notEqual(hashReplayState(swapped), hashReplayState(pending)); assert.notEqual(hashPosition(swapped), hashPosition(pending));
    assert.notEqual(hashObservation(unwrap(observe(swapped, actor, context))), hashObservation(unwrap(observe(pending, actor, context))));
    assert.equal(hashObservation(unwrap(observe(swapped, rival, context))), hashObservation(unwrap(observe(pending, rival, context))));
    assert.notDeepEqual(legal(swapped).map(a => a.actionId), legal(pending).map(a => a.actionId));
    assert.equal(resolveActionId(swapped, actor, legal(pending)[0].actionId, context).ok, false);
});
test("rival hidden hand cannot alter chooser-visible legal actions or appear in model input", () => {
    const swapped = swapHandIdentity(pending, rival);
    assert.notEqual(hashReplayState(swapped), hashReplayState(pending)); assert.deepEqual(legal(swapped), legal(pending));
    assert.deepEqual(unwrap(observe(swapped, actor, context)), unwrap(observe(pending, actor, context)));
    const s = GameStateSchema.parse(pending), secret = context.content.cards.find(c => c.id === "corpo-security")!;
    assert.ok(secret); for (const id of s.players[rival].zones.HAND) { s.objects.cards[id].cardId = secret.id; s.objects.cards[id].revision = secret.revision; }
    const p = unwrap(generatePosition(s, actor, context, "private-discard")), serialized = JSON.stringify(modelInput(p));
    for (const value of [secret.id, secret.displayName, ...s.players[rival].zones.HAND]) assert.equal(serialized.includes(value), false, value);
    assert.deepEqual(Object.keys(modelInput(p)).sort(), ["legalActions", "observation"]); assert.ok(validateTrainingPosition(p, context).ok);
});
test("ordered scope protects action IDs even when the content bundle has no Kiroshi scope", () => {
    const ctx = { content: createContentBundle(context.content.ruleset, context.content.cards.filter(c => c.id !== KIROSHI), context.content.manifest.engine) };
    const s = GameStateSchema.parse(pending), filler = ctx.content.cards.find(c => c.id === "slice-card-4")!;
    for (const c of Object.values(s.objects.cards)) if (c.cardId === KIROSHI) { c.cardId = filler.id; c.revision = filler.revision; }
    s.match.contentManifestHash = ctx.content.manifestHash; s.match.cards = ctx.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    const checked = unwrap(validateState(s, ctx)), changed = GameStateSchema.parse(checked);
    const h = changed.players[rival].zones.HAND[0], d = changed.players[rival].zones.DECK.find(id => changed.objects.cards[id].cardId !== changed.objects.cards[h].cardId)!;
    [changed.objects.cards[h].cardId, changed.objects.cards[d].cardId] = [changed.objects.cards[d].cardId, changed.objects.cards[h].cardId];
    [changed.objects.cards[h].revision, changed.objects.cards[d].revision] = [changed.objects.cards[d].revision, changed.objects.cards[h].revision];
    assert.notEqual(hashReplayState(checked), hashReplayState(changed));
    assert.deepEqual(unwrap(listLegalActions(checked, actor, ctx)), unwrap(listLegalActions(changed, actor, ctx)));
});
test("Evelyn support leaves constructed size, Legend count, copy and RAM constraints intact", () => {
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 });
    const input = orderedInput("constructed-boundary"); assert.ok(input.decks.every(d => d.main.length === 42 && d.legends.length === 3));
    for (const deck of [
        { ...input.decks[0], main: input.decks[0].main.slice(0, 27) },
        { ...input.decks[0], main: [...input.decks[0].main, ...input.decks[0].main.slice(0, 9)] },
        { ...input.decks[0], legends: input.decks[0].legends.slice(0, 2) },
        { ...input.decks[0], main: [...input.decks[0].main, EVELYN] },
        { ...input.decks[0], legends: input.decks[0].legends.map(id => id === "restriction-blue-support" ? "dev-legend-blue" : id) }
    ]) assert.equal(createGameWithEvents({ ...input, decks: [deck, input.decks[1]] }, context).ok, false);
});
for (const first of [EVELYN, KIROSHI]) test(`Evelyn + Kiroshi choose ${first} first without primitive interleaving`, () => {
    const m = new TurnMutation(before, context), gear = attach(m, KIROSHI), initial = start(unwrap(validateState(m.state, context))).state;
    assert.equal(initial.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(initial.resolution.pending.length, 2);
    const orderIndex = initial.resolution.choice!.options.findIndex(o => o.kind === "EFFECT" && initial.resolution.pending.find(e => e.id === o.effectId)?.sourceId === (first === EVELYN ? host : gear));
    const selected = choose(initial, orderIndex).state;
    assert.equal(selected.timing.step, first === EVELYN ? "DISCARD_SELECTION" : "TARGET_SELECTION");
    assert.equal(selected.resolution.pending.length, 1); assert.ok(legal(selected).every(a => a.action.kind === "CHOOSE"));
    const second = choose(selected).state;
    assert.equal(second.timing.step, first === EVELYN ? "TARGET_SELECTION" : "DISCARD_SELECTION");
    const done = choose(second).state; assert.equal(done.timing.step, "RIVAL_REACT"); assert.equal(done.privateKnowledge?.length, 1);
    assert.equal(done.players[actor].zones.HAND.length, m.state.players[actor].zones.HAND.length);
});
test("previous Kiroshi knowledge survives draw and discard unchanged", () => {
    const m = new TurnMutation(before, context); unwrap(grantLegendKnowledge(m, actor, 0));
    const s = start(unwrap(validateState(m.state, context))).state, next = choose(s).state;
    assert.deepEqual(s.privateKnowledge, m.state.privateKnowledge); assert.deepEqual(next.privateKnowledge, m.state.privateKnowledge);
});
test("Evelyn + Satori resolves ATTACK before React and fight-win draw after comparison", () => {
    const m = new TurnMutation(before, context); attach(m, SATORI);
    const target = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === EVELYN)!;
    moveCardLocation(m, target.id, "BATTLEFIELD"); target.readiness = "SPENT";
    let s = start(unwrap(validateState(m.state, context))).state;
    s = act(s, a => a.action.kind === "CHOOSE" && (() => { const o = s.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target.id; })()).state;
    assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.equal(s.resolution.current!.sourceId, host); assert.equal(s.resolution.pending.length, 0);
    s = choose(s).state; assert.equal(s.timing.step, "RIVAL_REACT");
    const result = act(s, a => a.action.kind === "PASS_REACT"), p = result.events.map(e => e.payload);
    const compared = p.findIndex(e => e.kind === "FIGHT_RESULT"), drawn = p.findIndex(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK");
    assert.ok(compared >= 0 && drawn > compared);
    assert.ok(p.some(e => e.kind === "EFFECT_PENDING")); assert.equal(finish(result.state).state.timing.step, "MAIN");
});
for (const program of [FLOOR_IT, REBOOT]) test(`${program} reacts only after Evelyn's entire ability`, () => {
    const m = new TurnMutation(before, context), card = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === program)!;
    moveCardLocation(m, card.id, "HAND"); for (const id of m.state.players[rival].zones.LEGENDS) m.state.objects.cards[id].readiness = "READY";
    const waiting = start(unwrap(validateState(m.state, context))).state;
    assert.equal(applyAction(waiting, { actorId: rival, action: { kind: "PLAY_CARD", cardInstanceId: card.id } }, context).ok, false);
    const react = choose(waiting).state, played = act(react, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === card.id), settled = finish(played.state);
    assert.equal(settled.state.timing.step, "RIVAL_REACT"); assert.equal(settled.state.resolution.triggerContinuation, undefined);
    assert.equal([...played.events, ...settled.events].some(e => e.payload.kind === "CONDITION_EVALUATED" || e.payload.kind === "CARD_DISCARDED"), false);
    assert.equal(finish(act(settled.state, a => a.action.kind === "PASS_REACT").state).state.timing.step, "MAIN");
});
test("two physical Evelyn copies produce independent ordinary ATTACK batches", () => {
    const m = new TurnMutation(before, context), second = Object.values(m.state.objects.cards).find(c => c.controllerId === actor && c.cardId === EVELYN && c.id !== host)!;
    moveCardLocation(m, second.id, "BATTLEFIELD"); second.readiness = "READY";
    const first = start(unwrap(validateState(m.state, context))).state;
    const ended = act(choose(first).state, a => a.action.kind === "PASS_REACT").state;
    const next = act(ended, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === second.id).state;
    assert.equal(next.resolution.current!.sourceId, second.id); assert.equal(next.resolution.pending.length, 0);
    assert.equal(next.resolution.triggerContinuation!.ordinal, first.resolution.triggerContinuation!.ordinal + 1);
});
test("complete shape gating rejects omitted clauses, false Sell, extra mechanics and old scopes", () => {
    const variants = [
        { ...evelyn, power: 1 }, { ...evelyn, sellProfile: { ...evelyn.sellProfile, allowed: true } },
        { ...evelyn, execution: { scope: "COMBAT_ATTACK_V1", status: "SUPPORTED" } },
        { ...evelyn, mechanics: { ...evelyn.mechanics, abilities: [{ ...evelyn.mechanics.abilities[0], effects: [{ kind: "DRAW", count: 1 }] }] } },
        { ...evelyn, mechanics: { ...evelyn.mechanics, keywords: ["BLOCKER"] } }
    ];
    for (const input of variants) {
        const r = CardRevisionSnapshotSchema.parse(input), ctx = { content: createContentBundle(context.content.ruleset, context.content.cards.map(c => c.id === EVELYN ? r : c), context.content.manifest.engine) };
        assert.equal(supportsOrderedAttackCard(r, ctx).ok, false); assert.equal(createGameWithEvents(orderedInput("reject"), ctx).ok, false);
    }
});
test("discard positions and actionId-only wire replays preserve exact choices/events", () => {
    const p = replay.positions.find(p => p.state.timing.step === "DISCARD_SELECTION")!; assert.ok(p); assert.ok(p.legalActions.length > 1); assert.equal(p.actingSeat, 0); assert.ok(validateTrainingPosition(p, context).ok);
    const response = handleRequest({ schemaVersion: 1, requestId: "discard", op: "applyAction", content: context.content, state: pending, actorId: actor, actionId: legal(pending)[0].actionId });
    assert.equal(response.ok, true);
    if (response.ok && response.value.kind === "transition") { assert.deepEqual(response.value.state, after); assert.deepEqual(response.value.events, replay.steps[attackIndex + 1].events); }
    const golden = JSON.parse(readFileSync(new URL("./fixtures/evelyn-replay.v1.json", import.meta.url), "utf8")); assert.deepEqual(golden, replay);
});
