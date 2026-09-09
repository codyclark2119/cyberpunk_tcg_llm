import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, type CardInstanceId, type GameState } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, observe, resolveActionId, RulesView, validateState, type EngineContext } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { fieldLegendContext, fieldLegendInput, fieldLegend, V } from "./field-legends-fixture";
import { vDyingNightReplay } from "./field-legends-replay";
import { actions, take, choose, end, finishChoices, stockEddies } from "./delayed-effects-focused";
import { KIROSHI } from "./private-information-fixture";
import { MANDIBULAR } from "./gear-capabilities-fixture";
import { MANTIS, ROYCE } from "./gear-fixture";
import { JACKIE, SATORI } from "./combat-triggers-fixture";
import { DELAMAIN } from "./end-turn-history-fixture";
import { PSYCHO } from "./combat-restrictions-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, moveLegendToFieldWithAttachments, attachPlayedGear, processDeparture } from "../packages/engine/src/card-movement";
import { canEnterField, legendEntryChoice } from "../packages/engine/src/legend-entry";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { testCondition } from "../packages/engine/src/conditions";
import { grantLegendKnowledge } from "../packages/engine/src/private-knowledge";
import { unwrap } from "./turn-replay";
import source from "./fixtures/field-legends-card-source.v1.json";
import rules from "./fixtures/field-legends-rules.v1.json";
const context = fieldLegendContext(), replay = vDyingNightReplay(), host = replay.legend, actor = replay.beforeGoSolo.timing.activePlayer, rival = replay.beforeGoSolo.match.playerOrder.find(p => p !== actor)!;
const readyCount = (s: GameState) => s.players[actor].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "READY").length;
function pay(s: GameState, ctx: EngineContext = context) {
    let state = s; const events: ReturnType<typeof take>["events"] = [];
    while (state.resolution.choice?.kind === "PAYMENT") { const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); const next = choose(state, ctx, Math.max(0, i)); state = next.state; events.push(...next.events); }
    return { state, events };
}
function enter(s: GameState, mode: "GO_SOLO" | "PLAY_CARD" = "GO_SOLO", ctx: EngineContext = context) {
    const started = take(s, ctx, a => a.action.kind === mode && a.action.cardInstanceId === host), done = pay(started.state, ctx);
    return { state: done.state, events: [...started.events, ...done.events] };
}
/** Explicit trusted preparations for individual rules; the canonical headline never calls these helpers. */
function addGear(s: GameState, cardId: string, controller = actor, target = host) {
    const m = new TurnMutation(s, context), gear = Object.values(m.state.objects.cards).find(c => c.cardId === cardId && c.controllerId === controller && !Object.values(m.state.objects.cards).some(h => h.attachments.includes(c.id)))!;
    assert.ok(gear); moveCardLocation(m, gear.id, "HAND"); unwrap(attachPlayedGear(m, gear.id, target));
    return { state: unwrap(validateState(m.state, context)), gear: gear.id };
}
function removeGear(s: GameState) {
    const m = new TurnMutation(s, context);
    for (const gear of [...m.state.objects.cards[host].attachments]) unwrap(processDeparture(m, gear, "TRASH"));
    return unwrap(validateState(m.state, context));
}
function fight(s: GameState, defender: CardInstanceId) {
    const attack = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host);
    let current = attack.state; const events = [...attack.events];
    if (current.timing.step === "ATTACK_TARGET_SELECTION") {
        const i = current.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === defender);
        const next = choose(current, context, i); current = next.state; events.push(...next.events);
    }
    const triggers = finishChoices(current, context); events.push(...triggers.events);
    const pass = take(triggers.state, context, a => a.action.kind === "PASS_REACT"), done = finishChoices(pass.state, context);
    return { state: done.state, events: [...events, ...pass.events, ...done.events] };
}
function rivalReact(s: GameState) {
    let state = end(s, context).state;
    state = take(state, context, a => a.action.kind === "ROLL_GIG").state;
    const m = new TurnMutation(state, context), enemy = Object.values(m.state.objects.cards).find(c => c.cardId === PSYCHO && c.controllerId === rival)!;
    moveCardLocation(m, enemy.id, "BATTLEFIELD"); enemy.readiness = "READY";
    state = take(m.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === enemy.id).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = choose(state, context, state.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA")).state;
    assert.equal(state.timing.step, "RIVAL_REACT"); return state;
}

test("full real V source, six printings, errata review and rule/FAQ pins", () => {
    assert.equal(fieldLegend.rulesText, "{Go Solo} (Pay this Legend's cost to play it as a ready Unit. It can attack this turn. When it leaves the field, remove it from the game.)");
    assert.equal(fieldLegend.type, "LEGEND"); assert.deepEqual(fieldLegend.ram, { BLUE: 2 }); assert.equal(fieldLegend.power, 8); assert.deepEqual(fieldLegend.printedCost, { kind: "EDDIES", amount: 5 }); assert.equal(fieldLegend.sellProfile.allowed, true);
    assert.deepEqual(fieldLegend.tags, ["Corpo", "Merc"]); assert.equal(fieldLegend.mechanics.abilities.length, 0); assert.deepEqual(fieldLegend.mechanics.keywords, ["GO_SOLO"]);
    assert.equal(fieldLegend.printings.length, 6); assert.ok(fieldLegend.printings.some(p => p.id === "20bd1c78-1773-486e-bf45-4075fd4f2a3f" && p.collectorNumber === "008"));
    assert.equal(source.errata.length, 4); assert.deepEqual(fieldLegend.provenance.errata, []); assert.equal(fieldLegend.provenance.sourceHash, hashCanonical(source.record));
    for (const id of ["3.4.1", "4.2.1", "4.4.1", "4.4.2", "4.5.1", "4.5.2", "4.12.1", "4.12.2", "5.6.4", "5.7.2", "8.14.1", "10.10.1", "11.3.1.2", "11.19.2", "11.25.1"]) assert.ok(rules.rules.some(r => r.id === id), id);
    assert.equal(rules.faqFindings.length, 16); assert.ok(supportsFieldLegend(fieldLegend, context).ok);
});
test("legal headline reveals by CALL and moves the same pre-equipped V/Dying instances atomically", () => {
    const before = replay.beforeGoSolo.objects.cards[host], after = replay.fieldEntry.objects.cards[host], gear = before.attachments[0];
    assert.equal(before.face, "UP"); assert.equal(before.zone.zone, "LEGENDS"); assert.equal(after.zone.zone, "BATTLEFIELD"); assert.equal(replay.fieldEntry.objects.cards[gear].zone.zone, "BATTLEFIELD");
    for (const key of ["id", "cardId", "revision", "ownerId", "controllerId", "face", "attachments"] as const) assert.deepEqual(after[key], before[key]);
    assert.ok(replay.steps.some(s => s.action.action.kind === "CALL_LEGEND"));
    assert.equal(new RulesView(replay.preEquippedLegend, context).getEffectivePower(host), 10); assert.equal(new RulesView(replay.fieldEntry, context).getEffectivePower(host), 10);
    const entry = replay.steps.find(s => s.events.some(e => e.payload.kind === "GO_SOLO_ACTIVATED"))!.events.map(e => e.payload);
    const moved = entry.filter(e => e.kind === "CARD_MOVED"); assert.deepEqual(moved.map(e => e.cardInstanceId), [host, gear]);
    assert.equal(entry.some(e => e.kind === "GEAR_DETACHED" || e.kind === "GEAR_ATTACHED"), false);
    assert.equal(entry.filter(e => e.kind === "CARD_PLAYED").length, 1); assert.equal(entry.filter(e => e.kind === "QUALIFYING_PLAY_RECORDED").length, 1);
    assert.ok(entry.findIndex(e => e.kind === "PAYMENT_MADE") < entry.findIndex(e => e.kind === "CARD_MOVED"));
});
test("Go Solo grants attack permission with Lag retained; ordinary play remains a distinct action", () => {
    const view = new RulesView(replay.fieldEntry, context);
    assert.deepEqual(view.getEffectiveCardTypes(host), ["LEGEND", "UNIT"]); assert.equal(view.getRevision(host)!.type, "LEGEND");
    assert.deepEqual(new RulesView(replay.beforeGoSolo, context).getEffectiveCardTypes(host), ["LEGEND"]);
    assert.ok(replay.fieldEntry.objects.cards[host].statuses.includes("LAG")); assert.ok(replay.fieldEntry.objects.cards[host].statuses.includes("GO_SOLO")); assert.ok(view.isAttackEligible(actor, host));
    const kinds = actions(replay.beforeGoSolo, context).filter(a => "cardInstanceId" in a.action && a.action.cardInstanceId === host).map(a => a.action.kind);
    assert.ok(kinds.includes("GO_SOLO")); assert.ok(kinds.includes("PLAY_CARD")); assert.ok(!kinds.includes("DECLARE_ATTACK"));
});
for (const readiness of ["READY", "SPENT"] as const) for (const mode of ["GO_SOLO", "PLAY_CARD"] as const) test(`${mode} from ${readiness}: readiness and attack permission follow the selected entry mode`, () => {
    const s = GameStateSchema.parse(stockEddies(replay.beforeGoSolo, context, 5));
    for (const id of s.players[actor].zones.EDDIES) s.objects.cards[id].readiness = "READY";
    for (const id of s.players[actor].zones.LEGENDS) s.objects.cards[id].readiness = "SPENT";
    s.objects.cards[host].readiness = readiness;
    const done = enter(s, mode), c = done.state.objects.cards[host];
    assert.equal(c.readiness, mode === "GO_SOLO" ? "READY" : readiness); assert.ok(c.statuses.includes("LAG"));
    assert.equal(new RulesView(done.state, context).isAttackEligible(actor, host), mode === "GO_SOLO");
    assert.equal(done.events.some(e => e.payload.kind === "PAYMENT_MADE" && e.payload.sources.some(p => p.cardInstanceId === host)), false);
});
for (const mode of ["GO_SOLO", "PLAY_CARD"] as const) test(`${mode} may pay using the entering Legend; only Go Solo readies it afterward`, () => {
    const s = GameStateSchema.parse(stockEddies(replay.beforeGoSolo, context, 4));
    for (const id of s.players[actor].zones.EDDIES) s.objects.cards[id].readiness = "READY";
    for (const id of s.players[actor].zones.LEGENDS) s.objects.cards[id].readiness = id === host ? "READY" : "SPENT";
    const done = enter(s, mode); assert.ok(done.events.some(e => e.payload.kind === "PAYMENT_MADE" && e.payload.sources.some(p => p.cardInstanceId === host)));
    assert.equal(done.state.objects.cards[host].readiness, mode === "GO_SOLO" ? "READY" : "SPENT"); assert.equal(done.events.some(e => e.payload.kind === "PHASE_CHANGED" && e.payload.step === "PAYMENT_SELECTION"), false);
});
test("unpayable, face-down, opponent, field and unresolved sources cannot enter", () => {
    const s = GameStateSchema.parse(replay.beforeGoSolo);
    for (const p of new RulesView(s, context).listPaymentSources(actor)) s.objects.cards[p.cardInstanceId].readiness = "SPENT";
    assert.equal(canEnterField(s, actor, host, context), false); assert.equal(canEnterField(replay.beforeGoSolo, rival, host, context), false);
    assert.equal(canEnterField(replay.fieldEntry, actor, host, context), false); assert.equal(canEnterField(replay.pendingEntry, actor, host, context), false);
    const down = GameStateSchema.parse(replay.calledLegend); down.objects.cards[host].face = "DOWN";
    assert.equal(canEnterField(down, actor, host, context), false); assert.equal(actions(down, context).some(a => a.action.kind === "GO_SOLO"), false);
    const before = hashReplayState(down); assert.equal(applyAction(down, { actorId: actor, action: { kind: "GO_SOLO", cardInstanceId: host } }, context).ok, false); assert.equal(hashReplayState(down), before);
});
test("Kiroshi knowledge of a face-down V does not grant Go Solo or expose its identity", () => {
    const m = new TurnMutation(replay.calledLegend, context); m.state.objects.cards[host].face = "DOWN"; unwrap(grantLegendKnowledge(m, actor, m.state.players[actor].zones.LEGENDS.indexOf(host)));
    const state = unwrap(validateState(m.state, context)); assert.equal(actions(state, context).some(a => a.action.kind === "GO_SOLO"), false);
    const opponent = JSON.stringify(unwrap(observe(state, rival, context))); assert.equal(opponent.includes('"rememberedContent"'), false);
});
test("Legend ordinary CALL payment preserves pre-equipped topology and inherited text without field movement", () => {
    const s = GameStateSchema.parse(replay.beforeGoSolo); s.players[actor].economy.callsThisTurn = 0;
    for (const p of new RulesView(s, context).listPaymentSources(actor)) s.objects.cards[p.cardInstanceId].readiness = p.cardInstanceId === host ? "READY" : "SPENT";
    const target = s.players[actor].zones.LEGENDS.find(id => id !== host && s.objects.cards[id].cardId === "dev-legend-red")!;
    const next = take(s, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === target);
    assert.deepEqual(next.state.objects.cards[host], { ...s.objects.cards[host], readiness: "SPENT" });
    assert.deepEqual(new RulesView(next.state, context).getEffectiveTriggeredAbilities(host), new RulesView(s, context).getEffectiveTriggeredAbilities(host));
    assert.equal(next.events.some(e => e.payload.kind === "CARD_MOVED" && [host, ...s.objects.cards[host].attachments].includes(e.payload.cardInstanceId) || e.payload.kind === "DELAYED_EFFECT_CREATED"), false);
});
test("field Legend cannot be CALLed or spent as a Legends-area payment source", () => {
    const view = new RulesView(replay.fieldEntry, context); assert.equal(view.listPaymentSources(actor).some(p => p.cardInstanceId === host), false); assert.equal(view.canCallLegend(actor, host), false);
    assert.equal(actions(replay.fieldEntry, context).some(a => (a.action.kind === "CALL_LEGEND" || a.action.kind === "GO_SOLO") && a.action.cardInstanceId === host), false);
});
test("multiple pre-equipped Gear retain power, inherited Blocker and Satori text after entry", () => {
    let state = removeGear(replay.beforeGoSolo);
    for (const id of [MANTIS, SATORI, MANDIBULAR]) state = addGear(state, id).state;
    const view = new RulesView(state, context), ids = state.objects.cards[host].attachments;
    assert.equal(ids.length, 3); assert.ok(view.getEffectiveKeywords(host).includes("BLOCKER")); assert.equal(view.isBlockerEligible(actor, host), false);
    const entered = enter(state).state, after = new RulesView(entered, context);
    assert.deepEqual(entered.objects.cards[host].attachments, ids); assert.equal(after.getEffectivePower(host), view.getEffectivePower(host));
    assert.equal(after.getApplicableCharacteristicModifiers(host).length, 3); assert.equal(after.getEffectiveTriggeredAbilities(host).filter(b => b.kind === "WHEN_FIGHT_WON").length, 1);
    assert.ok(ids.every(id => entered.objects.cards[id].zone.zone === "BATTLEFIELD"));
});
test("pre-equip and post-equip compose identical current power/capability sources", () => {
    const base = removeGear(replay.beforeGoSolo), pre = addGear(base, MANDIBULAR), a = enter(pre.state).state;
    const b = addGear(enter(base).state, MANDIBULAR).state;
    assert.deepEqual(a.objects.cards[host].attachments, b.objects.cards[host].attachments);
    assert.deepEqual(new RulesView(a, context).getEffectiveCapabilities(host), new RulesView(b, context).getEffectiveCapabilities(host));
    assert.equal(new RulesView(a, context).getEffectivePower(host), new RulesView(b, context).getEffectivePower(host));
});
test("same inherited Mandibular Blocker is unavailable in LEGENDS and becomes usable on FIELD", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), MANDIBULAR).state;
    const legendsReact = rivalReact(prepared); assert.equal(actions(legendsReact, context).some(a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === host), false);
    const fieldReact = rivalReact(enter(prepared).state);
    const blocked = take(fieldReact, context, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === host);
    assert.equal(blocked.state.objects.cards[host].readiness, "SPENT"); assert.ok(blocked.events.some(e => e.payload.kind === "BLOCKER_DECLARED" && e.payload.cardInstanceId === host));
    assert.deepEqual(new RulesView(fieldReact, context).getEffectiveCapabilities(host), new RulesView(prepared, context).getEffectiveCapabilities(host));
});
test("pre-equipped Kiroshi ATTACK activates after entry and retains private-look boundaries", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), KIROSHI), view = new RulesView(prepared.state, context);
    assert.equal(view.getEffectivePower(host), 9); assert.equal(view.getEffectiveTriggeredAbilities(host).length, 1); assert.equal(view.isAttackEligible(actor, host), false);
    const entry = enter(prepared.state).state, attack = take(entry, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host), done = finishChoices(attack.state, context);
    assert.ok(done.state.privateKnowledge?.length); assert.equal(done.state.timing.step, "RIVAL_REACT");
    assert.ok(done.events.some(e => e.payload.kind === "LEGEND_LOOKED_AT"));
    assert.equal(JSON.stringify(unwrap(observe(done.state, rival, context))).includes('"rememberedContent"'), false);
    assert.ok(JSON.stringify(unwrap(observe(done.state, actor, context))).includes('"rememberedContent"'));
});
test("pre-equipped Satori triggers from the field Legend's ordinary fight victory", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), SATORI), entry = enter(prepared.state).state;
    const m = new TurnMutation(entry, context), defender = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === DELAMAIN)!;
    moveCardLocation(m, defender.id, "BATTLEFIELD"); defender.readiness = "SPENT";
    const beforeHand = m.state.players[actor].zones.HAND.length, done = fight(m.state, defender.id);
    assert.ok(done.events.some(e => e.payload.kind === "FIGHT_RESULT" && e.payload.winnerId === host && e.payload.attackerPower === 10));
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === prepared.gear)); assert.equal(done.state.players[actor].zones.HAND.length, beforeHand + 1);
    assert.equal(done.state.objects.cards[defender.id].zone.zone, "TRASH"); assert.deepEqual(done.state.objects.cards[host].attachments, [prepared.gear]);
});
test("first real V-positive Dying Night branch registers after ATTACK and readies two at end turn", () => {
    const d = replay.registeredDuringReact.delayedEffects![0]; assert.equal(d.subjectId, host); assert.equal(d.subject.cardId, V); assert.deepEqual(d.subjectTypesAtCreation, ["LEGEND", "UNIT"]);
    assert.equal(testCondition(replay.beforeGoSolo, actor, { kind: "SUBJECT_IS_UNIT_NAMED", identity: "V" }, context, host), false);
    assert.equal(testCondition(replay.fieldEntry, actor, { kind: "SUBJECT_IS_UNIT_NAMED", identity: "V" }, context, host), true);
    const endIndex = replay.steps.findIndex(s => s.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.effectId === d.id)); assert.ok(endIndex > 0);
    const facts = replay.steps.slice(endIndex).flatMap(s => s.events).map(e => e.payload);
    assert.ok(facts.some(e => e.kind === "CONDITION_EVALUATED" && e.effectId === d.id && e.met)); assert.equal(facts.filter(e => e.kind === "CARD_READIED" && replay.beforeEndTurn.players[actor].zones.EDDIES.includes(e.cardInstanceId)).length, 2);
    assert.equal(replay.pendingEndTurn.timing.step, "EDDIE_READY_SELECTION"); assert.equal(readyCount(replay.pendingEndTurn), 0); assert.equal(readyCount(replay.finalState), 2); assert.equal(replay.finalState.delayedEffects, undefined); assert.equal(replay.finalState.timing.turn, 6);
});
test("real field V loses a fight: Gear stays in Trash, V is removed, and Dying uses last-valid Unit information", () => {
    const m = new TurnMutation(replay.fieldEntry, context), defender = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === V)!;
    // Trusted opposing ordinary entry with two real Gears creates a stronger legal effective Unit; no revision mutation.
    defender.face = "UP";
    let state = addGear(unwrap(validateState(m.state, context)), MANTIS, rival, defender.id).state;
    state = addGear(state, SATORI, rival, defender.id).state;
    const n = new TurnMutation(state, context);
    // The low-level semantic entry primitive is exercised through the same movement operation as the action.
    const other = n.state.objects.cards[defender.id];
    unwrap(moveLegendToFieldWithAttachments(n, defender.id, "PLAY")); other.readiness = "SPENT";
    const done = fight(unwrap(validateState(n.state, context)), defender.id), gear = replay.fieldEntry.objects.cards[host].attachments[0];
    assert.ok(done.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === host));
    assert.equal(done.state.objects.cards[host].zone.zone, "REMOVED"); assert.equal(done.state.objects.cards[gear].zone.zone, "TRASH"); assert.deepEqual(done.state.objects.cards[host].attachments, []); assert.deepEqual(done.state.objects.cards[host].statuses, []);
    assert.deepEqual(new RulesView(done.state, context).getEffectiveCardTypes(host), ["LEGEND"]);
    const moves = done.events.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.cardInstanceId === host).map(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone); assert.deepEqual(moves, ["TRASH", "REMOVED"]);
    const ended = end(done.state, context), finished = finishChoices(ended.state, context);
    assert.ok(ended.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met)); assert.equal(readyCount(finished.state), 2); assert.ok(validateState(finished.state, context).ok);
});
for (const mode of ["GO_SOLO", "PLAY_CARD"] as const) test(`${mode} counts as first Blue Unit play for Jackie; attached Gear movement does not count again`, () => {
    const s = GameStateSchema.parse(replay.beforeGoSolo), id = s.players[actor].zones.LEGENDS.find(id => id !== host && s.objects.cards[id].cardId === "dev-legend-red")!, jackie = context.content.cards.find(c => c.id === JACKIE)!;
    Object.assign(s.objects.cards[id], { cardId: jackie.id, revision: jackie.revision, face: "UP" }); s.turnHistory!.blueUnitOrGearPlays[actor] = 0;
    const next = enter(s, mode); assert.equal(next.state.turnHistory!.blueUnitOrGearPlays[actor], 1);
    assert.ok(next.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === id)); assert.equal(next.state.resolution.triggerContinuation?.origin.kind, "PLAY"); assert.equal(next.state.resolution.choice?.kind, "OPTIONAL");
    assert.ok(validateState(finishChoices(next.state, context).state, context).ok);
});
for (const mutation of ["missing-policy", "extra-ability", "extra-modifier", "extra-keyword", "wrong-cost", "wrong-power", "wrong-ram", "wrong-scope", "unreviewed"] as const) test(`full V admission rejects ${mutation}`, () => {
    const r = CardRevisionSnapshotSchema.parse(fieldLegend), ruleset = structuredClone(context.content.ruleset);
    if (mutation === "missing-policy") delete ruleset.gameplay!.turnSlice!.fieldLegends;
    if (mutation === "extra-ability") r.mechanics.abilities.push({ id: "unreviewed", trigger: "WHEN_PLAYED", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "DRAW", count: 1 }] });
    if (mutation === "extra-modifier") r.mechanics.modifiers.push({ kind: "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN", amount: 2 });
    if (mutation === "extra-keyword") r.mechanics.keywords.push("BLOCKER");
    if (mutation === "wrong-cost") r.printedCost = { kind: "EDDIES", amount: 4 };
    if (mutation === "wrong-power") r.power = 9;
    if (mutation === "wrong-ram") r.ram = { BLUE: 3 };
    if (mutation === "wrong-scope") r.execution!.scope = "NONCOMBAT_SLICE_V1";
    if (mutation === "unreviewed") r.provenance.reviewed = false;
    if (mutation === "unreviewed") { assert.equal(supportsFieldLegend(r, context).ok, false); assert.throws(() => createContentBundle(ruleset, context.content.cards.map(c => c.id === V ? r : c), context.content.manifest.engine)); return; }
    const ctx = { content: createContentBundle(ruleset, context.content.cards.map(c => c.id === V ? r : c), context.content.manifest.engine) };
    assert.equal(supportsFieldLegend(r, ctx).ok, false);
    // The existing CALL-only scope remains intentionally valid for legacy Legends; it cannot perform field entry.
    if (mutation !== "wrong-scope") assert.equal(createGameWithEvents(fieldLegendInput("reject"), ctx).ok, false);
});
for (const mutation of ["gear-location", "duplicate-host", "face-down-field", "legacy-field", "unknown-payment", "wrong-choice", "duplicate-payment", "dual-continuation", "missing-last-valid-types"] as const) test(`state validation rejects ${mutation}`, () => {
    const s = GameStateSchema.parse(mutation.includes("payment") || mutation === "wrong-choice" || mutation === "dual-continuation" ? replay.pendingEntry : mutation === "missing-last-valid-types" ? replay.registeredDuringReact : replay.fieldEntry);
    if (mutation === "gear-location") s.objects.cards[s.objects.cards[host].attachments[0]].zone.zone = "LEGENDS";
    if (mutation === "duplicate-host") s.players[actor].zones.LEGENDS.push(host);
    if (mutation === "face-down-field") s.objects.cards[host].face = "DOWN";
    if (mutation === "legacy-field") { const royce = context.content.cards.find(r => r.id === ROYCE)!; s.objects.cards[host].cardId = royce.id; s.objects.cards[host].revision = royce.revision; }
    if (mutation === "unknown-payment") s.resolution.legendEntryContinuation!.actorId = rival;
    if (mutation === "wrong-choice") s.resolution.choice!.options.pop();
    if (mutation === "duplicate-payment") { const p = new RulesView(s, context).listPaymentSources(actor)[0]; s.resolution.legendEntryContinuation!.selectedSources = [p, p]; }
    if (mutation === "dual-continuation") s.resolution.callContinuation = { actorId: actor, legendId: host, remainingCost: 1, selectedSources: [] };
    if (mutation === "missing-last-valid-types") delete s.delayedEffects![0].subjectTypesAtCreation;
    assert.equal(validateState(s, context).ok, false);
});
test("payment continuation exact options, semantic identity and transport-invariant hashes", () => {
    assert.deepEqual(legendEntryChoice(replay.pendingEntry, context), replay.pendingEntry.resolution.choice);
    const s = GameStateSchema.parse(replay.pendingEntry); s.match.version = GameStateVersionSchema.parse(999); s.match.eventSequence = GameEventSequenceSchema.parse(999);
    assert.equal(hashPosition(s), hashPosition(replay.pendingEntry)); assert.notEqual(hashReplayState(s), hashReplayState(replay.pendingEntry)); assert.deepEqual(actions(s, context), actions(replay.pendingEntry, context));
    assert.notEqual(hashPosition(replay.beforeGoSolo), hashPosition(replay.fieldEntry)); assert.notEqual(hashReplayState(replay.beforeGoSolo), hashReplayState(replay.fieldEntry));
    for (const viewer of [actor, rival]) assert.notEqual(hashObservation(unwrap(observe(replay.beforeGoSolo, viewer, context))), hashObservation(unwrap(observe(replay.fieldEntry, viewer, context))));
});
test("both viewers see field Legend types/power/Gear/readiness and no hidden identity leakage", () => {
    for (const viewer of [actor, rival]) {
        const o = unwrap(observe(replay.fieldEntry, viewer, context)), card = o.players.flatMap(p => p.cards).find(c => c.publicId === host)!;
        assert.deepEqual(card.effectiveTypes, ["LEGEND", "UNIT"]); assert.equal(card.content?.cardId, V); assert.equal(card.effectivePower, 10); assert.equal(card.readiness, "READY"); assert.equal(card.goSolo, true); assert.equal(card.lagging, true); assert.equal(card.attachments?.length, 1);
    }
});
test("strategic Go Solo, payment, field attack and ready2 are ordinary wire/training actionId choices", () => {
    for (const s of [replay.beforeGoSolo, replay.pendingEntry, replay.fieldEntry, replay.pendingEndTurn]) {
        const legal = actions(s, context), position = unwrap(generatePosition(s, s.timing.actingPlayer, context, "field-wire"));
        assert.ok(legal.length > 1); assert.ok(validateTrainingPosition(position, context).ok); const prompt = JSON.stringify(modelInput(position)); assert.equal(prompt.includes(s.rng.seed), false);
        const selected = legal.find(a => a.action.kind === "GO_SOLO") ?? legal[0]; unwrap(resolveActionId(s, s.timing.actingPlayer, selected.actionId, context));
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: context.content, state: s, actorId: s.timing.actingPlayer, actionId: selected.actionId });
        assert.ok(response.ok && response.value.kind === "transition"); assert.deepEqual(response.value.state, unwrap(applyAction(s, { actorId: selected.actorId, action: selected.action }, context)).state);
    }
});
test("constructed remains 40–50 main and three Legends; exact demo size still fails", () => {
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 });
    const input = fieldLegendInput("format"); assert.ok(input.decks.every(d => d.main.length === 42 && d.legends.length === 3));
    for (const deck of [{ ...input.decks[0], main: input.decks[0].main.slice(0, 27) }, { ...input.decks[0], legends: input.decks[0].legends.slice(0, 2) }]) assert.equal(createGameWithEvents({ ...input, decks: [deck, input.decks[1]] }, context).ok, false);
});
test("new replay golden is exact and only strategic boundaries generate training positions", () => {
    assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/field-legends-replay.v1.json", import.meta.url), "utf8")), replay);
    assert.ok(replay.positions.every(p => p.legalActions.length > 1)); assert.ok(replay.positions.some(p => p.legalActions.some(a => a.action.kind === "GO_SOLO")));
});

test("Go Solo may follow CALL in the same turn, while a partial payment leaves host and Gear unmoved/unspent", () => {
    const s = GameStateSchema.parse(stockEddies(replay.calledLegend, context, 6));
    for (const id of s.players[actor].zones.EDDIES) s.objects.cards[id].readiness = "READY";
    assert.equal(s.players[actor].economy.callsThisTurn, 1); assert.ok(canEnterField(s, actor, host, context));
    const pending = take(s, context, a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === host).state;
    const once = choose(pending, context).state; assert.ok(once.resolution.legendEntryContinuation);
    assert.deepEqual(once.objects.cards, pending.objects.cards); assert.deepEqual(once.players[actor].zones, pending.players[actor].zones);
    assert.equal(pay(once).state.objects.cards[host].zone.zone, "BATTLEFIELD");
});
test("ordinary field-play Lag clears at end turn and V can attack on its next own MAIN", () => {
    const ordinary = enter(replay.beforeGoSolo, "PLAY_CARD").state;
    const ended = end(ordinary, context); assert.ok(ended.events.some(e => e.payload.kind === "LAG_REMOVED" && e.payload.cardInstanceId === host));
    let state = take(ended.state, context, a => a.action.kind === "ROLL_GIG").state;
    state = end(state, context).state; state = take(state, context, a => a.action.kind === "ROLL_GIG").state;
    assert.equal(state.objects.cards[host].readiness, "READY"); assert.equal(state.objects.cards[host].statuses.includes("GO_SOLO"), false); assert.ok(new RulesView(state, context).isAttackEligible(actor, host));
});
