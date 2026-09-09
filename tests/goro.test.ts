import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, type CardInstanceId, type GameState } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, observe, resolveActionId, RulesView, validateState, type EngineContext } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { goroContext, goroInput, goro, GORO } from "./goro-fixture";
import { fieldLegendContext, V } from "./field-legends-fixture";
import { goroReplay } from "./goro-replay";
import { vDyingNightReplay } from "./field-legends-replay";
import { actions, take, choose, end, finishChoices, stockEddies } from "./delayed-effects-focused";
import { KIROSHI } from "./private-information-fixture";
import { MANDIBULAR } from "./gear-capabilities-fixture";
import { MANTIS } from "./gear-fixture";
import { JACKIE, SATORI } from "./combat-triggers-fixture";
import { DYING_NIGHT } from "./delayed-effects-fixture";
import { BOMBUS } from "./react-fixture";
import { PSYCHO, CORPO, FLATHEAD } from "./combat-restrictions-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, moveLegendToFieldWithAttachments, attachPlayedGear, processDeparture } from "../packages/engine/src/card-movement";
import { canEnterField, legendEntryChoice } from "../packages/engine/src/legend-entry";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { testCondition } from "../packages/engine/src/conditions";
import { grantLegendKnowledge } from "../packages/engine/src/private-knowledge";
import { unwrap } from "./turn-replay";
import source from "./fixtures/goro-card-source.v1.json";
import rules from "./fixtures/goro-rules.v1.json";
const context = goroContext(), replay = goroReplay(), host = replay.legend, actor = replay.beforeGoSolo.timing.activePlayer, rival = replay.beforeGoSolo.match.playerOrder.find(p => p !== actor)!;
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

test("complete Goro source has six printings, both normalized keywords and pinned rules/errata", () => {
    assert.equal(goro.rulesText, "{Go Solo} (Pay this Legend's cost to play it as a ready Unit. It can attack this turn. If it leaves the field, remove it from the game.)\n{Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)");
    assert.equal(goro.type, "LEGEND"); assert.deepEqual(goro.ram, { GREEN: 2 }); assert.deepEqual(goro.colors, ["GREEN"]);
    assert.equal(goro.power, 7); assert.deepEqual(goro.printedCost, { kind: "EDDIES", amount: 5 }); assert.equal(goro.sellProfile.allowed, true);
    assert.deepEqual(goro.tags, ["Arasaka", "Corpo"]); assert.deepEqual(goro.mechanics, { keywords: ["GO_SOLO", "BLOCKER"], modifiers: [], abilities: [] });
    assert.equal(goro.printings.length, 6); assert.ok(goro.printings.some(p => p.id === "fd889659-8291-41fd-9197-9cdf7cbf6810" && p.collectorNumber === "008"));
    assert.equal(goro.provenance.sourceHash, hashCanonical(source.record)); assert.equal(source.errata.length, 4); assert.deepEqual(goro.provenance.errata, []);
    for (const id of ["4.4.1", "4.5.1", "4.5.2", "4.12.2", "5.6.4", "5.7.2", "11.3.1.2", "11.24.1", "11.25.1"]) assert.ok(rules.rules.some(r => r.id === id), id);
    assert.ok(rules.faqFindings.some(f => f.id === "9ad7e1cf-9965-4ba0-8503-ac17c897ffbd")); assert.ok(supportsFieldLegend(goro, context).ok);
});
test("legal CALL/pre-equipped Mantis/Go Solo preserves physical host, Gear, classifications and power9", () => {
    const before = replay.beforeGoSolo.objects.cards[host], after = replay.fieldEntry.objects.cards[host], gear = before.attachments[0];
    assert.equal(replay.calledLegend.objects.cards[host].face, "UP"); assert.equal(before.zone.zone, "LEGENDS"); assert.equal(after.zone.zone, "BATTLEFIELD");
    assert.equal(replay.fieldEntry.objects.cards[gear].zone.zone, "BATTLEFIELD");
    for (const k of ["id", "cardId", "revision", "ownerId", "controllerId", "face", "attachments"] as const) assert.deepEqual(before[k], after[k]);
    for (const s of [replay.preEquippedLegend, replay.fieldEntry]) { const view = new RulesView(s, context); assert.equal(view.getEffectivePower(host), 9); assert.deepEqual(view.getRevision(host)!.tags, ["Arasaka", "Corpo"]); }
    const entry = replay.steps.find(s => s.events.some(e => e.payload.kind === "GO_SOLO_ACTIVATED" && e.payload.cardInstanceId === host))!.events.map(e => e.payload);
    assert.deepEqual(entry.filter(e => e.kind === "CARD_MOVED").map(e => e.cardInstanceId), [host, gear]);
    assert.equal(entry.some(e => e.kind === "GEAR_ATTACHED" || e.kind === "GEAR_DETACHED"), false);
    assert.equal(entry.filter(e => e.kind === "CARD_PLAYED").length, 1); assert.equal(entry.some(e => e.kind === "QUALIFYING_PLAY_RECORDED"), false);
    assert.ok(entry.findIndex(e => e.kind === "PAYMENT_MADE") < entry.findIndex(e => e.kind === "CARD_MOVED"));
});
test("one generic entry produces effective Legend+Unit, Lag and same-turn attack; printed revision stays Legend", () => {
    const view = new RulesView(replay.fieldEntry, context);
    assert.deepEqual(view.getEffectiveCardTypes(host), ["LEGEND", "UNIT"]); assert.equal(view.getRevision(host)!.type, "LEGEND");
    assert.deepEqual(new RulesView(replay.beforeGoSolo, context).getEffectiveCardTypes(host), ["LEGEND"]);
    assert.ok(replay.fieldEntry.objects.cards[host].statuses.includes("LAG")); assert.ok(replay.fieldEntry.objects.cards[host].statuses.includes("GO_SOLO"));
    assert.ok(view.isAttackEligible(actor, host)); assert.equal(new RulesView(replay.beforeGoSolo, context).isAttackEligible(actor, host), false);
    assert.ok(replay.steps.some(s => s.action.action.kind === "DECLARE_ATTACK" && s.action.action.cardInstanceId === host));
    assert.equal(replay.afterAttack.timing.step, "MAIN"); assert.equal(replay.afterAttack.objects.cards[host].readiness, "SPENT");
});
test("legal printed Blocker spends Goro, redirects to it, and resolves power10 versus9 fight", () => {
    assert.equal(replay.beforeBlocker.objects.cards[host].readiness, "READY");
    assert.ok(new RulesView(replay.beforeBlocker, context).isBlockerEligible(actor, host));
    assert.equal(replay.afterBlocker.objects.cards[host].readiness, "SPENT");
    assert.ok("target" in replay.afterBlocker.timing.combat);
    assert.deepEqual(replay.afterBlocker.timing.combat.target, { kind: "CARD", cardInstanceId: host });
    assert.equal(new RulesView(replay.afterBlocker, context).isBlockerEligible(actor, host), false);
    const facts = replay.steps.flatMap(s => s.events).map(e => e.payload);
    assert.equal(facts.filter(e => e.kind === "BLOCKER_DECLARED" && e.cardInstanceId === host).length, 1);
    assert.ok(facts.some(e => e.kind === "FIGHT_RESULT" && e.winnerId === replay.enemy && e.attackerPower === 10 && e.defenderPower === 9));
    assert.equal(replay.finalState.timing.step, "MAIN");
});
test("Blocker defeat waits for owner's exact Trash order, then removes Legend and leaves detached Gear in Trash", () => {
    const gear = replay.fieldEntry.objects.cards[host].attachments[0], pending = replay.pendingDefeat;
    assert.equal(pending.timing.step, "DEFEAT_ORDER_SELECTION"); assert.equal(pending.timing.actingPlayer, actor);
    assert.equal(pending.objects.cards[host].zone.zone, "BATTLEFIELD"); assert.equal(pending.objects.cards[gear].zone.zone, "BATTLEFIELD");
    assert.equal(replay.afterDefeat.objects.cards[host].zone.zone, "REMOVED"); assert.equal(replay.afterDefeat.objects.cards[gear].zone.zone, "TRASH");
    assert.deepEqual(replay.afterDefeat.objects.cards[host].attachments, []); assert.deepEqual(replay.afterDefeat.objects.cards[host].statuses, []);
    assert.deepEqual(new RulesView(replay.afterDefeat, context).getEffectiveCardTypes(host), ["LEGEND"]);
    const facts = replay.steps.flatMap(s => s.events).map(e => e.payload);
    assert.ok(facts.some(e => e.kind === "CARD_DEFEATED" && e.cardInstanceId === host));
    const moved = facts.filter(e => e.kind === "CARD_MOVED" && e.cardInstanceId === host);
    assert.deepEqual(moved.slice(-2).map(e => e.kind === "CARD_MOVED" && e.to.zone), ["TRASH", "REMOVED"]);
    assert.ok(validateState(replay.afterDefeat, context).ok);
    // The alternate owner order is a real branch of the same legal replay, not a state preparation.
    const first = choose(pending, context, 1), done = finishChoices(first.state, context);
    assert.equal(done.state.objects.cards[host].zone.zone, "REMOVED"); assert.equal(done.state.objects.cards[gear].zone.zone, "TRASH");
    const mainOrder = replay.steps.flatMap(s => s.events).filter(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "TRASH").map(e => e.payload.kind === "CARD_MOVED" && e.payload.cardInstanceId);
    const alternative = [...first.events, ...done.events].filter(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "TRASH").map(e => e.payload.kind === "CARD_MOVED" && e.payload.cardInstanceId);
    assert.deepEqual(alternative, mainOrder.slice(-2).reverse());
});
test("printed Blocker exists in LEGENDS but is unavailable during an actual rival React window", () => {
    const m = new TurnMutation(replay.beforeBlocker, context);
    for (const id of [host, ...m.state.objects.cards[host].attachments]) moveCardLocation(m, id, "LEGENDS");
    const s = unwrap(validateState(m.state, context)), view = new RulesView(s, context);
    assert.ok(view.getEffectiveKeywords(host).includes("BLOCKER")); assert.deepEqual(view.getEffectiveCardTypes(host), ["LEGEND"]);
    assert.equal(view.isBlockerEligible(actor, host), false);
    assert.equal(actions(s, context).some(a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === host), false);
});
test("Blocker permits Lag independently of Go Solo attack permission, while readiness and controller still apply", () => {
    assert.equal(replay.beforeBlocker.objects.cards[host].statuses.includes("LAG"), false); // Normal prior end-turn cleanup.
    const s = GameStateSchema.parse(replay.beforeBlocker); s.objects.cards[host].statuses = ["LAG"];
    const view = new RulesView(s, context); assert.ok(view.isBlockerEligible(actor, host)); assert.equal(view.isBlockerEligible(rival, host), false);
    const block = take(s, context, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === host);
    assert.equal(block.state.objects.cards[host].readiness, "SPENT"); assert.equal(new RulesView(block.state, context).isBlockerEligible(actor, host), false);
});
test("printed plus Mandibular Blocker retain both physical sources and one semantic host action", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), MANDIBULAR), before = new RulesView(prepared.state, context);
    const sources = before.getEffectiveCapabilities(host).find(c => c.keyword === "BLOCKER")!.sources;
    assert.equal(sources.length, 2); assert.deepEqual(new Set(sources.map(s => s.origin)), new Set(["PRINTED", "EQUIPPED_HOST"]));
    assert.ok(sources.some(s => s.sourceId === host)); assert.ok(sources.some(s => s.sourceId === prepared.gear));
    assert.equal(before.isBlockerEligible(actor, host), false);
    const entered = enter(prepared.state).state;
    assert.deepEqual(new RulesView(entered, context).getEffectiveCapabilities(host), before.getEffectiveCapabilities(host));
    const react = addGear(removeGear(replay.beforeBlocker), MANDIBULAR).state;
    assert.equal(actions(react, context).filter(a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === host).length, 1);
    const block = take(react, context, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === host);
    assert.equal(block.events.filter(e => e.payload.kind === "BLOCKER_DECLARED").length, 1);
    assert.equal(new RulesView(block.state, context).getEffectiveCapabilities(host).find(c => c.keyword === "BLOCKER")!.sources.length, 2);
});
test("Goro, Bombus, Corpo and Mandibular inheritance converge on identical spend/redirect facts", () => {
    const clean = removeGear(replay.beforeBlocker);
    const outcomes = [GORO, BOMBUS, CORPO, PSYCHO].map(id => {
        const s = GameStateSchema.parse(clean), r = context.content.cards.find(c => c.id === id)!;
        Object.assign(s.objects.cards[host], { cardId: r.id, revision: r.revision, statuses: [] });
        const prepared = id === PSYCHO ? addGear(s, MANDIBULAR).state : s, view = new RulesView(prepared, context);
        assert.equal(view.getEffectiveCapabilities(host).find(c => c.keyword === "BLOCKER")!.sources[0].origin, id === PSYCHO ? "EQUIPPED_HOST" : "PRINTED");
        const result = take(prepared, context, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === host);
        return result.events.map(e => e.payload);
    });
    for (const result of outcomes) assert.deepEqual(result, outcomes[0]);
});
test("Goro's printed Blocker respects current cannot-be-blocked attack restrictions", () => {
    const s = GameStateSchema.parse(replay.beforeBlocker), r = context.content.cards.find(c => c.id === FLATHEAD)!;
    Object.assign(s.objects.cards[replay.enemy], { cardId: r.id, revision: r.revision, statuses: [] });
    // Explicit focused current Street Cred arrangement, separate from the untouched legal headline.
    for (const g of Object.values(s.objects.gigs)) if (g.location.zone === "GIGS" && g.roll.kind === "ROLLED") g.roll.currentValue = g.controllerId === rival ? 1 : Number(g.dieType.slice(1));
    assert.ok(new RulesView(s, context).getStreetCred(rival) < new RulesView(s, context).getStreetCred(actor));
    assert.equal(new RulesView(s, context).isBlockerEligible(actor, host), false);
    assert.equal(actions(s, context).some(a => a.action.kind === "DECLARE_BLOCKER"), false);
});
test("multiple pre-equipped Mantis/Satori/Mandibular preserve power11 and inherited abilities without double counting", () => {
    let s = removeGear(replay.beforeGoSolo);
    for (const id of [MANTIS, SATORI, MANDIBULAR]) s = addGear(s, id).state;
    const ids = s.objects.cards[host].attachments, before = new RulesView(s, context), after = enter(s);
    assert.equal(before.getEffectivePower(host), 11); assert.equal(before.isAttackEligible(actor, host), false);
    assert.deepEqual(after.state.objects.cards[host].attachments, ids); const view = new RulesView(after.state, context);
    assert.equal(view.getEffectivePower(host), 11); assert.equal(view.getApplicableCharacteristicModifiers(host).length, 3);
    assert.equal(view.getEffectiveTriggeredAbilities(host).filter(b => b.kind === "WHEN_FIGHT_WON").length, 1);
    assert.equal(view.getEffectiveCapabilities(host).find(c => c.keyword === "BLOCKER")!.sources.length, 2);
    assert.ok(ids.every(id => after.state.objects.cards[id].zone.zone === "BATTLEFIELD"));
    assert.equal(after.events.some(e => e.payload.kind === "GEAR_ATTACHED" || e.payload.kind === "GEAR_DETACHED"), false);
});
test("pre-equipped Satori gives Goro power9 in both areas and draws after a normal fight victory", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), SATORI);
    assert.equal(new RulesView(prepared.state, context).getEffectivePower(host), 9);
    const m = new TurnMutation(enter(prepared.state).state, context), defender = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === PSYCHO)!;
    moveCardLocation(m, defender.id, "BATTLEFIELD"); defender.readiness = "SPENT";
    const hand = m.state.players[actor].zones.HAND.length, done = fight(m.state, defender.id);
    assert.ok(done.events.some(e => e.payload.kind === "FIGHT_RESULT" && e.payload.winnerId === host && e.payload.attackerPower === 9));
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === prepared.gear));
    assert.equal(done.state.players[actor].zones.HAND.length, hand + 1); assert.equal(done.state.objects.cards[defender.id].zone.zone, "TRASH");
    assert.deepEqual(done.state.objects.cards[host].attachments, [prepared.gear]);
});
test("pre-equipped Kiroshi gives power8 and inherits private ATTACK look only when Goro becomes a field Unit", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), KIROSHI), before = new RulesView(prepared.state, context);
    assert.equal(before.getEffectivePower(host), 8); assert.equal(before.getEffectiveTriggeredAbilities(host).length, 1); assert.equal(before.isAttackEligible(actor, host), false);
    const s = enter(prepared.state).state; assert.equal(new RulesView(s, context).getEffectivePower(host), 8);
    const next = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host), done = finishChoices(next.state, context);
    assert.equal(done.state.timing.step, "RIVAL_REACT"); assert.ok(done.events.some(e => e.payload.kind === "LEGEND_LOOKED_AT"));
    assert.ok(JSON.stringify(unwrap(observe(done.state, actor, context))).includes('"rememberedContent"'));
    assert.equal(JSON.stringify(unwrap(observe(done.state, rival, context))).includes('"rememberedContent"'), false);
});
test("Dying registers on real field Goro but its end-turn named-V condition is false", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), DYING_NIGHT);
    assert.equal(new RulesView(prepared.state, context).getEffectivePower(host), 9);
    const entry = enter(prepared.state).state, attack = take(entry, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host), pending = finishChoices(attack.state, context);
    const d = pending.state.delayedEffects![0]; assert.equal(d.subject.cardId, GORO); assert.deepEqual(d.subjectTypesAtCreation, ["LEGEND", "UNIT"]);
    assert.equal(testCondition(pending.state, actor, { kind: "SUBJECT_IS_UNIT_NAMED", identity: "V" }, context, host), false);
    const passed = take(pending.state, context, a => a.action.kind === "PASS_REACT"), main = finishChoices(passed.state, context).state;
    const ready = readyCount(main), ended = end(main, context);
    assert.ok(ended.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.effectId === d.id && !e.payload.met));
    assert.equal(ended.state.delayedEffects, undefined); assert.notEqual(ended.state.timing.step, "EDDIE_READY_SELECTION"); assert.equal(readyCount(ended.state), ready);
});
test("Dying remains false for a defeated Goro using the same last-valid field-Legend metadata", () => {
    const prepared = addGear(removeGear(replay.beforeGoSolo), DYING_NIGHT), m = new TurnMutation(enter(prepared.state).state, context);
    // Real stronger V+Satori from the replay is a trusted focused combat preparation here.
    const enemy = replay.enemy; m.state.objects.cards[enemy].face = "UP";
    const geared = addGear(m.state, SATORI, rival, enemy), n = new TurnMutation(geared.state, context);
    unwrap(moveLegendToFieldWithAttachments(n, enemy, "PLAY")); n.state.objects.cards[enemy].readiness = "SPENT";
    const done = fight(n.state, enemy); assert.equal(done.state.objects.cards[host].zone.zone, "REMOVED");
    const d = done.state.delayedEffects![0], ended = end(done.state, context);
    assert.ok(ended.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.effectId === d.id && !e.payload.met));
    assert.equal(ended.state.delayedEffects, undefined);
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
test("Kiroshi knowledge of a face-down Goro does not grant Go Solo or expose its identity", () => {
    const m = new TurnMutation(replay.calledLegend, context); m.state.objects.cards[host].face = "DOWN"; unwrap(grantLegendKnowledge(m, actor, m.state.players[actor].zones.LEGENDS.indexOf(host)));
    const state = unwrap(validateState(m.state, context)); assert.equal(actions(state, context).some(a => a.action.kind === "GO_SOLO"), false);
    const opponent = JSON.stringify(unwrap(observe(state, rival, context))); assert.equal(opponent.includes('"rememberedContent"'), false);
});
test("Legend ordinary CALL payment preserves pre-equipped topology and inherited text without field movement", () => {
    const s = GameStateSchema.parse(replay.beforeGoSolo); s.players[actor].economy.callsThisTurn = 0;
    for (const p of new RulesView(s, context).listPaymentSources(actor)) s.objects.cards[p.cardInstanceId].readiness = p.cardInstanceId === host ? "READY" : "SPENT";
    const target = s.players[actor].zones.LEGENDS.find(id => id !== host && s.objects.cards[id].cardId === "dev-legend-blue")!;
    const next = take(s, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === target);
    assert.deepEqual(next.state.objects.cards[host], { ...s.objects.cards[host], readiness: "SPENT" });
    assert.deepEqual(new RulesView(next.state, context).getEffectiveTriggeredAbilities(host), new RulesView(s, context).getEffectiveTriggeredAbilities(host));
    assert.equal(next.events.some(e => e.payload.kind === "CARD_MOVED" && [host, ...s.objects.cards[host].attachments].includes(e.payload.cardInstanceId) || e.payload.kind === "DELAYED_EFFECT_CREATED"), false);
});
test("field Legend cannot be CALLed or spent as a Legends-area payment source", () => {
    const view = new RulesView(replay.fieldEntry, context); assert.equal(view.listPaymentSources(actor).some(p => p.cardInstanceId === host), false); assert.equal(view.canCallLegend(actor, host), false);
    assert.equal(actions(replay.fieldEntry, context).some(a => (a.action.kind === "CALL_LEGEND" || a.action.kind === "GO_SOLO") && a.action.cardInstanceId === host), false);
});

for (const mode of ["GO_SOLO", "PLAY_CARD"] as const) test("Green Goro " + mode + " does not increment Jackie first-Blue history", () => {
    const s = GameStateSchema.parse(replay.beforeGoSolo), id = s.players[actor].zones.LEGENDS.find(id => id !== host)!, jackie = context.content.cards.find(c => c.id === JACKIE)!;
    Object.assign(s.objects.cards[id], { cardId: jackie.id, revision: jackie.revision, face: "UP" }); s.turnHistory!.blueUnitOrGearPlays[actor] = 0;
    const done = enter(s, mode);
    assert.equal(done.state.turnHistory!.blueUnitOrGearPlays[actor], 0);
    assert.equal(done.events.some(e => e.payload.kind === "QUALIFYING_PLAY_RECORDED" || e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === id), false);
    assert.equal(done.state.resolution.choice, null);
});
for (const mutation of ["missing-policy", "extra-ability", "extra-modifier", "extra-keyword", "wrong-cost", "wrong-power", "wrong-ram", "wrong-scope", "unreviewed"] as const) test(`full Goro admission rejects ${mutation}`, () => {
    const r = CardRevisionSnapshotSchema.parse(goro), ruleset = structuredClone(context.content.ruleset);
    if (mutation === "missing-policy") delete ruleset.gameplay!.turnSlice!.fieldLegends;
    if (mutation === "extra-ability") r.mechanics.abilities.push({ id: "unreviewed", trigger: "WHEN_PLAYED", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "DRAW", count: 1 }] });
    if (mutation === "extra-modifier") r.mechanics.modifiers.push({ kind: "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN", amount: 2 });
    if (mutation === "extra-keyword") r.mechanics.keywords.push("QUICK");
    if (mutation === "wrong-cost") r.printedCost = { kind: "EDDIES", amount: 4 };
    if (mutation === "wrong-power") r.power = 9;
    if (mutation === "wrong-ram") r.ram = { GREEN: 3 };
    if (mutation === "wrong-scope") r.execution!.scope = "NONCOMBAT_SLICE_V1";
    if (mutation === "unreviewed") r.provenance.reviewed = false;
    if (mutation === "unreviewed") { assert.equal(supportsFieldLegend(r, context).ok, false); assert.throws(() => createContentBundle(ruleset, context.content.cards.map(c => c.id === GORO ? r : c), context.content.manifest.engine)); return; }
    const ctx = { content: createContentBundle(ruleset, context.content.cards.map(c => c.id === GORO ? r : c), context.content.manifest.engine) };
    assert.equal(supportsFieldLegend(r, ctx).ok, false);
    // The existing CALL-only scope remains intentionally valid for legacy Legends; it cannot perform field entry.
    if (mutation !== "wrong-scope") assert.equal(createGameWithEvents(goroInput("reject"), ctx).ok, false);
});

test("Goro's required printed Blocker, Green color and Arasaka classification cannot be omitted or replaced with V metadata", () => {
    for (const change of [{ mechanics: { ...goro.mechanics, keywords: ["GO_SOLO"] } }, { colors: ["BLUE"] }, { tags: ["Corpo", "Merc"] }, { power: 8 }, { power: undefined }, { ram: { BLUE: 2 } }]) {
        const r = CardRevisionSnapshotSchema.parse({ ...goro, ...change }); assert.equal(supportsFieldLegend(r, context).ok, false);
    }
});
test("both public observations show derived types, power, Gear and Blocker without internal capability provenance", () => {
    for (const viewer of [actor, rival]) for (const s of [replay.beforeGoSolo, replay.fieldEntry]) {
        const c = unwrap(observe(s, viewer, context)).players.flatMap(p => p.cards).find(c => c.publicId === host)!;
        assert.equal(c.content?.cardId, GORO); assert.equal(c.effectivePower, 9); assert.deepEqual(c.attachments, s.objects.cards[host].attachments);
        assert.deepEqual(c.effectiveTypes, s === replay.fieldEntry ? ["LEGEND", "UNIT"] : ["LEGEND"]); assert.ok(c.effectiveKeywords?.includes("BLOCKER"));
        assert.equal("sources" in c, false);
        if (s === replay.fieldEntry) { assert.equal(c.readiness, "READY"); assert.equal(c.goSolo, true); assert.equal(c.lagging, true); }
    }
});
test("Go Solo, payment, attack, Blocker and owner-order decisions round-trip through actionId wire and training", () => {
    for (const s of [replay.beforeGoSolo, replay.pendingEntry, replay.fieldEntry, replay.beforeBlocker, replay.pendingDefeat]) {
        const legal = actions(s, context), position = unwrap(generatePosition(s, s.timing.actingPlayer, context, "goro-wire"));
        assert.ok(legal.length > 1); assert.ok(validateTrainingPosition(position, context).ok); assert.equal(JSON.stringify(modelInput(position)).includes(s.rng.seed), false);
        const selected = legal.find(a => a.action.kind === "GO_SOLO" || a.action.kind === "DECLARE_BLOCKER") ?? legal[0];
        unwrap(resolveActionId(s, s.timing.actingPlayer, selected.actionId, context));
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: context.content, state: s, actorId: s.timing.actingPlayer, actionId: selected.actionId });
        assert.ok(response.ok && response.value.kind === "transition");
        assert.deepEqual(response.value.state, unwrap(applyAction(s, { actorId: selected.actorId, action: selected.action }, context)).state);
    }
});
test("semantic entry changes hashes while transport counters normalize and payment options stay exact", () => {
    assert.deepEqual(legendEntryChoice(replay.pendingEntry, context), replay.pendingEntry.resolution.choice);
    const s = GameStateSchema.parse(replay.pendingEntry); s.match.version = GameStateVersionSchema.parse(999); s.match.eventSequence = GameEventSequenceSchema.parse(999);
    assert.equal(hashPosition(s), hashPosition(replay.pendingEntry)); assert.notEqual(hashReplayState(s), hashReplayState(replay.pendingEntry)); assert.deepEqual(actions(s, context), actions(replay.pendingEntry, context));
    assert.notEqual(hashPosition(replay.beforeGoSolo), hashPosition(replay.fieldEntry));
    for (const viewer of [actor, rival]) assert.notEqual(hashObservation(unwrap(observe(replay.beforeGoSolo, viewer, context))), hashObservation(unwrap(observe(replay.fieldEntry, viewer, context))));
});
test("Green RAM contributes through ordinary constructed rules; sizes, copies and Legend count are unchanged", () => {
    const input = goroInput("format");
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 });
    assert.ok(input.decks.every(d => d.main.length === 42 && d.legends.length === 3)); assert.ok(createGameWithEvents(input, context).ok);
    for (const deck of [
        { ...input.decks[0], main: input.decks[0].main.slice(0, 27) },
        { ...input.decks[0], legends: input.decks[0].legends.slice(0, 2) },
        { ...input.decks[0], main: [...input.decks[0].main, MANTIS] },
        { ...input.decks[0], legends: input.decks[0].legends.map(id => id === GORO ? V : id) }
    ]) assert.equal(createGameWithEvents({ ...input, decks: [deck, input.decks[1]] }, context).ok, false);
});
test("all prior immutable content and V's real Dying positive replay remain unchanged", () => {
    const old = fieldLegendContext().content;
    for (const card of old.cards) assert.deepEqual(context.content.cards.find(c => c.id === card.id && c.revision === card.revision), card);
    const r = vDyingNightReplay(); assert.ok(r.steps.flatMap(s => s.events).some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met));
    assert.equal(r.steps.length, 38); assert.equal(r.finalState.timing.turn, 6);
});
test("Goro replay golden is exact and contains only genuine multi-option training decisions", () => {
    assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/goro-replay.v1.json", import.meta.url), "utf8")), replay);
    assert.ok(replay.positions.every(p => p.legalActions.length > 1));
    for (const kind of ["GO_SOLO", "DECLARE_ATTACK", "DECLARE_BLOCKER"]) assert.ok(replay.positions.some(p => p.legalActions.some(a => a.action.kind === kind)));
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
test("ordinary field-play Lag clears at end turn and Goro can attack on its next own MAIN", () => {
    const ordinary = enter(replay.beforeGoSolo, "PLAY_CARD").state;
    const ended = end(ordinary, context); assert.ok(ended.events.some(e => e.payload.kind === "LAG_REMOVED" && e.payload.cardInstanceId === host));
    let state = take(ended.state, context, a => a.action.kind === "ROLL_GIG").state;
    state = end(state, context).state; state = take(state, context, a => a.action.kind === "ROLL_GIG").state;
    assert.equal(state.objects.cards[host].readiness, "READY"); assert.equal(state.objects.cards[host].statuses.includes("GO_SOLO"), false); assert.ok(new RulesView(state, context).isAttackEligible(actor, host));
});
