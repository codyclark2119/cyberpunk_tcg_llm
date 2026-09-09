import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, CardInstanceIdSchema, HashSchema, createContentBundle, hashCanonical, type GameState } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, observe, resolveActionId, RulesView, validateState, moveCardForEffect } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { delayedContext, delayedInput, dyingNight, DYING_NIGHT } from "./delayed-effects-fixture";
import { dyingNightReplay } from "./delayed-effects-replay";
import { positiveFixture, trustedV, actions, take, choose, end, register, mainAfterAttack, finishChoices, stockEddies } from "./delayed-effects-focused";
import { DELAMAIN } from "./end-turn-history-fixture";
import { ROYCE } from "./gear-fixture";
import { KIROSHI } from "./private-information-fixture";
import { EVELYN } from "./attack-ordered-effects-fixture";
import { DEXTER, SATORI } from "./combat-triggers-fixture";
import { FLOOR_IT } from "./react-fixture";
import { REBOOT } from "./combat-restrictions-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, processDeparture, attachPlayedGear } from "../packages/engine/src/card-movement";
import { defeatCards, defeatBatch } from "../packages/engine/src/defeat";
import { testCondition } from "../packages/engine/src/conditions";
import { supportsDelayedAttackGear } from "../packages/engine/src/delayed-effect-support";
import { triggerChoice } from "../packages/engine/src/trigger-queries";
import { grantLegendKnowledge } from "../packages/engine/src/private-knowledge";
import { preventionId } from "../packages/engine/src/fight-prevention";
import { unwrap } from "./turn-replay";
import source from "./fixtures/delayed-effects-card-source.v1.json";
import rules from "./fixtures/delayed-effects-rules.v1.json";
const context = delayedContext(), replay = dyingNightReplay(), actor = replay.beforeAttack.timing.activePlayer;
const p = positiveFixture(), registered = register(p.state, p.context), main = mainAfterAttack(registered.state, p.context).state;
const positiveEnd = (count: number) => end(stockEddies(main, p.context, count), p.context);
const readyCount = (s: GameState) => s.players[actor].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "READY").length;

test("exact full Dying Night source, all printings, paragraph image and supplemental rulings are pinned", () => {
    assert.equal(dyingNight.rulesText, '(Equip to a friendly Unit or face-up Legend.)\n{Attack} Decrease a Gig by up to 2. At the end of your turn, if this Unit is named "V", ready 2 Eddies.');
    assert.equal(dyingNight.power, 2); assert.deepEqual(dyingNight.printedCost, { kind: "EDDIES", amount: 2 }); assert.deepEqual(dyingNight.ram, { BLUE: 2 });
    assert.equal(dyingNight.printings.length, 5); assert.ok(dyingNight.printings.some(x => x.collectorNumber === "013")); assert.equal(source.errata.length, 4);
    assert.equal(dyingNight.provenance.sourceHash, hashCanonical(source.record)); assert.ok(supportsDelayedAttackGear(dyingNight, context).ok);
    assert.equal(createHash("sha256").update(readFileSync(new URL("./fixtures/dying-night-demo013.webp", import.meta.url))).digest("hex"), "416a9c9c49bec4e666f4bd6e93c9f6f749d8ce8aa8809dc044fdf5abb1ea0e86");
    assert.equal(dyingNight.mechanics.abilities.length, 1); assert.equal(dyingNight.mechanics.abilities[0].effects.length, 2); assert.equal(dyingNight.mechanics.abilities[0].trigger, "WHEN_ATTACKING");
    for (const id of ["10.1.1", "10.1.2", "10.2.3", "10.3.3", "10.6.2", "10.10.1", "10.16.2", "10.16.3", "10.31.2", "3.9.2", "3.10.2", "4.12.2", "8.16.1", "8.16.2", "5.8.3.1"]) assert.ok(rules.rules.some(r => r.id === id), id);
    assert.ok(rules.supplemental.items.some(i => i.id === "881c635b-268e-4855-8617-a84587951a8f")); assert.ok(rules.supplemental.items.some(i => i.id === "5f960b7a-2008-4b2c-bbfd-ec852848651f"));
});
test("legal headline pays/equips power2, decreases2, registers after adjustment, resumes React and MAIN before end turn", () => {
    const host = replay.registeredDuringReact.delayedEffects![0].subjectId, gear = replay.registeredDuringReact.delayedEffects![0].sourceId;
    assert.equal(replay.beforeAttack.objects.cards[gear].cardId, DYING_NIGHT); assert.ok(replay.beforeAttack.objects.cards[host].attachments.includes(gear));
    assert.equal(new RulesView(replay.beforeAttack, context).getEffectivePower(host), 6);
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "PAYMENT_MADE" && e.payload.sources.length === 2)));
    const batch = replay.steps.find(s => s.events.some(e => e.payload.kind === "DELAYED_EFFECT_CREATED"))!.events.map(e => e.payload);
    assert.ok(batch.findIndex(e => e.kind === "GIG_VALUE_CHANGED") < batch.findIndex(e => e.kind === "DELAYED_EFFECT_CREATED"));
    assert.ok(batch.findIndex(e => e.kind === "DELAYED_EFFECT_CREATED") < batch.findIndex(e => e.kind === "EFFECT_RESOLVED"));
    assert.equal(replay.registeredDuringReact.resolution.current, null); assert.deepEqual(replay.registeredDuringReact.resolution.pending, []);
    assert.equal(replay.registeredDuringReact.timing.step, "RIVAL_REACT"); assert.equal(replay.registeredDuringMain.timing.step, "MAIN");
    assert.deepEqual(replay.beforeEndTurn.delayedEffects, replay.registeredDuringReact.delayedEffects);
    assert.equal(replay.pendingEndTurn.delayedEffects, undefined); assert.equal(replay.pendingEndTurn.resolution.pending.length, 2);
    assert.equal(replay.finalState.delayedEffects, undefined); assert.equal(replay.finalState.timing.turn, 6);
    const finalFacts = replay.steps.flatMap(s => s.events).filter(e => e.payload.kind === "CONDITION_EVALUATED");
    assert.ok(finalFacts.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
});
test("Dying on a Legends-area host grants power and ATTACK text without enabling attacks or triggering on payment", () => {
    // Trusted host arrangement using an existing reviewed Royce revision; no Go Solo or Faceplate admission.
    const m = new TurnMutation(replay.beforeAttack, context), owner = m.state.timing.activePlayer;
    const legend = m.state.players[owner].zones.LEGENDS[0], royce = context.content.cards.find(c => c.id === ROYCE)!;
    Object.assign(m.state.objects.cards[legend], { cardId: royce.id, revision: royce.revision, face: "UP", readiness: "READY" });
    const gear = Object.values(m.state.objects.cards).find(c => c.cardId === DYING_NIGHT && c.zone.zone === "BATTLEFIELD")!;
    unwrap(processDeparture(m, gear.id, "HAND"));
    const before = new RulesView(unwrap(validateState(m.state, context)), context);
    assert.ok(before.getLegalTargets(gear.id, { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }).some(id => id === legend));
    assert.equal(before.getEffectivePower(legend), 6);
    unwrap(attachPlayedGear(m, gear.id, legend));
    // Force a real single-source CALL payment from this already face-up, sell-tagged Legend.
    for (const source of new RulesView(m.state, context).listPaymentSources(owner)) if (source.cardInstanceId !== legend) m.state.objects.cards[source.cardInstanceId].readiness = "SPENT";
    const state = unwrap(validateState(m.state, context)), view = new RulesView(state, context);
    assert.deepEqual(view.getEffectiveCardTypes(legend), ["LEGEND"]);
    assert.equal(view.getEffectivePower(legend), 10); // Base6 + Dying2 + Royce's own-turn2 per Gear.
    assert.ok(view.getApplicableCharacteristicModifiers(legend).some(modifier => modifier.sourceId === gear.id && modifier.kind === "GRANT_PRINTED_POWER_TO_HOST" && modifier.amount === 2));
    const inherited = view.getEffectiveTriggeredAbilities(legend).filter(binding => binding.sourceId === gear.id);
    assert.equal(inherited.length, 1); assert.equal(inherited[0].kind, "WHEN_ATTACKING"); assert.equal(inherited[0].subjectId, legend);
    assert.equal(view.isAttackEligible(owner, legend), false); assert.equal(view.isBlockerEligible(owner, legend), false);
    assert.equal(actions(state, context).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === legend), false);
    const observed = unwrap(observe(state, owner, context)).players.find(player => player.seat === state.players[owner].seat)!.cards.find(card => card.publicId === legend)!;
    assert.equal(observed.zone, "LEGENDS"); assert.equal(observed.effectivePower, 10); assert.deepEqual(observed.attachments, [gear.id]);
    const target = state.players[owner].zones.LEGENDS.find(id => id !== legend && state.objects.cards[id].cardId === "dev-legend-red")!;
    const paid = take(state, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === target);
    assert.deepEqual(paid.state.objects.cards[legend], { ...state.objects.cards[legend], readiness: "SPENT" });
    assert.deepEqual(paid.state.objects.cards[gear.id], state.objects.cards[gear.id]);
    assert.ok(paid.events.some(e => e.payload.kind === "PAYMENT_MADE" && e.payload.sources.length === 1 && e.payload.sources[0].kind === "LEGEND" && e.payload.sources[0].cardInstanceId === legend));
    assert.equal(paid.events.some(e => e.payload.kind === "DELAYED_EFFECT_CREATED"), false); assert.equal(paid.state.delayedEffects, undefined);
    const after = new RulesView(paid.state, context); assert.equal(after.getEffectivePower(legend), 10); assert.deepEqual(after.getEffectiveTriggeredAbilities(legend), inherited);
});
for (const count of [0, 1, 2, 3, 4, 5]) test(`ready2 with ${count} spent Eddies selects a complete set before mutation`, () => {
    const start = positiveEnd(count); assert.equal(start.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met), true);
    if (count <= 2) { assert.equal(start.state.timing.turn, main.timing.turn + 1); assert.equal(readyCount(start.state), count); }
    else {
        assert.equal(start.state.timing.step, "EDDIE_READY_SELECTION"); assert.equal(actions(start.state, p.context).length, count);
        const first = choose(start.state, p.context, 1); assert.equal(readyCount(first.state), 0); assert.deepEqual(first.state.resolution.triggerContinuation!.selectedEddieSlots, [1]);
        assert.equal(first.events.some(e => e.payload.kind === "CARD_READIED"), false); assert.equal(actions(first.state, p.context).length, count - 1);
        assert.ok(first.state.resolution.choice!.options.every(o => o.kind === "EDDIE_SLOT" && o.slot !== 1));
        const second = choose(first.state, p.context); assert.equal(readyCount(second.state), 2); assert.equal(second.state.timing.turn, main.timing.turn + 1);
        assert.equal(second.events.filter(e => e.payload.kind === "CARD_READIED" && second.state.players[actor].zones.EDDIES.includes(e.payload.cardInstanceId)).length >= 2, true);
        assert.equal(second.state.resolution.triggerContinuation, undefined); assert.equal(second.state.delayedEffects, undefined);
    }
});
test("either order of choosing the same two slots commits the identical canonical set and final state", () => {
    const start = positiveEnd(4).state;
    const a = choose(choose(start, p.context, 0).state, p.context, 0), b = choose(choose(start, p.context, 1).state, p.context, 0);
    assert.deepEqual(a.state, b.state); assert.deepEqual(a.events.filter(e => e.payload.kind === "CARD_READIED"), b.events.filter(e => e.payload.kind === "CARD_READIED"));
});
test("zero decrease preserves future registration and is not a Gig adjustment", () => {
    assert.equal(registered.events.some(e => e.payload.kind === "GIG_VALUE_CHANGED"), false); assert.equal(registered.state.delayedEffects!.length, 1);
    assert.equal(registered.events.some(e => e.payload.kind === "CONDITION_EVALUATED"), false);
});
test("no legal Gig target resolves remaining instructions and still registers", () => {
    const s = GameStateSchema.parse(p.state);
    for (const player of Object.values(s.players)) for (const id of [...player.gigs.GIGS]) {
        const g = s.objects.gigs[id]; player.gigs.GIGS.splice(player.gigs.GIGS.indexOf(id), 1); player.gigs.FIXER.push(id); g.location.zone = "FIXER"; g.roll = { kind: "UNROLLED" };
    }
    const m = new TurnMutation(s, p.context), rivalUnit = Object.values(s.objects.cards).find(c => c.cardId === DELAMAIN && c.controllerId === p.rival)!; moveCardLocation(m, rivalUnit.id, "BATTLEFIELD"); m.state.objects.cards[rivalUnit.id].readiness = "SPENT";
    const result = register(unwrap(validateState(m.state, p.context)), p.context); assert.equal(result.state.delayedEffects!.length, 1); assert.equal(result.events.some(e => e.payload.kind === "GIG_VALUE_CHANGED"), false);
});
test("targets include both rolled Gig areas, exclude Fixer, and amounts never cross the floor", () => {
    const targets = replay.pendingAttack.resolution.choice!.options;
    assert.ok(targets.some(o => o.kind === "GIG" && replay.pendingAttack.objects.gigs[o.gigInstanceId].controllerId === actor));
    assert.ok(targets.some(o => o.kind === "GIG" && replay.pendingAttack.objects.gigs[o.gigInstanceId].controllerId !== actor));
    for (let i = 0; i < targets.length; i++) {
        const o = targets[i]; assert.ok(o.kind === "GIG"); const g = replay.pendingAttack.objects.gigs[o.gigInstanceId]; assert.equal(g.location.zone, "GIGS"); assert.ok(g.roll.kind === "ROLLED");
        const result = choose(replay.pendingAttack, context, i).state;
        if (g.roll.currentValue === 1) assert.equal(result.timing.step, "RIVAL_REACT");
        else assert.deepEqual(result.resolution.choice!.options, Array.from({ length: Math.min(2, g.roll.currentValue - 1) + 1 }, (_, amount) => ({ kind: "AMOUNT", amount })));
    }
});
for (const departure of ["gear", "host"] as const) test(`registered benefit survives ${departure} Trash departure and attachment loss`, () => {
    const m = new TurnMutation(stockEddies(main, p.context, 2), p.context), d = m.state.delayedEffects![0];
    if (departure === "gear") unwrap(processDeparture(m, d.sourceId, "TRASH"));
    else { unwrap(defeatCards(m, [{ targetId: p.host, defeatedBy: d.sourceId }], [{ targetId: p.host, cardIds: defeatBatch(m.state, p.host) }])); m.state.resolution.stage = "DECISION"; }
    assert.equal(m.state.objects.cards[p.host].attachments.length, 0); assert.equal(m.state.objects.cards[d.sourceId].zone.zone, "TRASH");
    const next = end(unwrap(validateState(m.state, p.context)), p.context); assert.equal(readyCount(next.state), 2); assert.equal(next.state.delayedEffects, undefined);
});
test("detachment and reattachment to another host do not rebind an existing instruction", () => {
    const m = new TurnMutation(stockEddies(main, p.context, 2), p.context), d = m.state.delayedEffects![0];
    unwrap(processDeparture(m, d.sourceId, "TRASH"));
    const other = Object.values(m.state.objects.cards).find(c => c.controllerId === actor && c.cardId === DELAMAIN)!; moveCardLocation(m, other.id, "BATTLEFIELD");
    moveCardLocation(m, d.sourceId, "HAND"); unwrap(attachPlayedGear(m, d.sourceId, other.id));
    assert.equal(m.state.delayedEffects![0].subjectId, p.host); assert.equal(readyCount(end(m.state, p.context).state), 2);
});
test("Gear absent before ATTACK registers nothing", () => {
    const m = new TurnMutation(p.state, p.context), gear = m.state.objects.cards[p.host].attachments[0]; unwrap(processDeparture(m, gear, "TRASH"));
    assert.equal(register(m.state, p.context, p.host).state.delayedEffects, undefined);
});
for (const mode of ["two-copies", "repeated-attack"] as const) test(`${mode} retains independent semantic delayed occurrences and end-turn ordering`, () => {
    const m = new TurnMutation(p.state, p.context);
    if (mode === "two-copies") { const gear = Object.values(m.state.objects.cards).find(c => c.cardId === DYING_NIGHT && c.controllerId === actor && !m.state.objects.cards[p.host].attachments.includes(c.id))!; moveCardLocation(m, gear.id, "HAND"); unwrap(attachPlayedGear(m, gear.id, p.host)); }
    let result = register(m.state, p.context), after = mainAfterAttack(result.state, p.context).state;
    if (mode === "repeated-attack") { const s = GameStateSchema.parse(after); s.objects.cards[p.host].readiness = "READY"; result = register(s, p.context); after = mainAfterAttack(result.state, p.context).state; }
    assert.equal(after.delayedEffects!.length, 2); assert.equal(new Set(after.delayedEffects!.map(d => d.id)).size, 2);
    assert.equal(new Set(after.delayedEffects!.map(d => mode === "two-copies" ? d.sourceId : d.originOrdinal)).size, 2);
    const order = end(stockEddies(after, p.context, 4), p.context).state; assert.equal(order.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(order.resolution.pending.length, 2);
    const done = finishChoices(order, p.context); assert.equal(readyCount(done.state), 4); assert.equal(done.events.filter(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met).length, 2); assert.equal(done.state.delayedEffects, undefined);
});
for (const delayedFirst of [true, false]) test(`Dying ready2 ${delayedFirst ? "before" : "after"} Delamain ready1 recomputes options`, () => {
    const m = new TurnMutation(stockEddies(main, p.context, 3), p.context);
    const cab = Object.values(m.state.objects.cards).find(c => c.controllerId === actor && c.cardId === DELAMAIN)!; moveCardLocation(m, cab.id, "BATTLEFIELD"); m.state.turnHistory!.gigsStolenByUnit = { [cab.id]: 1 };
    const order = end(unwrap(validateState(m.state, p.context)), p.context).state; assert.equal(order.resolution.pending.length, 2);
    const i = order.resolution.choice!.options.findIndex(o => o.kind === "EFFECT" && order.resolution.pending.some(e => e.id === o.effectId && Boolean(e.trigger?.delayedId) === delayedFirst));
    const pending = choose(order, p.context, i).state; assert.equal(pending.resolution.current!.effect.kind, "READY_EDDIES");
    assert.equal(pending.resolution.current!.effect.kind === "READY_EDDIES" && pending.resolution.current!.effect.count, delayedFirst ? 2 : 1);
    const done = finishChoices(pending, p.context); assert.equal(readyCount(done.state), 3); assert.equal(done.state.timing.turn, 6);
    assert.equal(done.events.filter(e => e.payload.kind === "CARD_READIED" && m.state.players[actor].zones.EDDIES.includes(e.payload.cardInstanceId)).length, 3);
});
for (const first of [0, 1]) test(`Kiroshi and Dying inherited ATTACK order ${first} completes before React`, () => {
    const m = new TurnMutation(p.state, p.context), gear = Object.values(m.state.objects.cards).find(c => c.cardId === KIROSHI && c.controllerId === actor)!;
    moveCardLocation(m, gear.id, "HAND"); unwrap(attachPlayedGear(m, gear.id, p.host));
    const order = take(m.state, p.context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === p.host).state;
    assert.equal(order.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(order.resolution.pending.length, 2);
    const selected = choose(order, p.context, first).state; assert.notEqual(selected.timing.step, "RIVAL_REACT");
    const done = finishChoices(selected, p.context).state; assert.equal(done.timing.step, "RIVAL_REACT"); assert.ok(done.privateKnowledge); assert.equal(done.delayedEffects!.length, 1);
});
for (const cardId of [EVELYN, DEXTER]) test(`Dying and ${cardId} use one ATTACK scheduler`, () => {
    const s = GameStateSchema.parse(replay.beforeAttack), host = s.players[actor].zones.BATTLEFIELD.find(id => s.objects.cards[id].attachments.length)!, r = context.content.cards.find(r => r.id === cardId)!; s.objects.cards[host].cardId = r.id; s.objects.cards[host].revision = r.revision;
    const order = take(unwrap(validateState(s, context)), context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host).state;
    assert.equal(order.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(order.resolution.pending.length, 2);
    const done = finishChoices(order, context).state; assert.equal(done.timing.step, "RIVAL_REACT"); assert.equal(done.delayedEffects!.length, 1);
});
test("Name excludes subtitle; exact immutable identity and Unit type are required", () => {
    const condition = { kind: "SUBJECT_IS_UNIT_NAMED" as const, identity: "V" as const };
    for (const [identity, type, subtitle, expected] of [["V", "UNIT", "Corporate Exile fixture", true], ["V", "UNIT", "Different subtitle fixture", true], ["Viper", "UNIT", "", false], ["V", "LEGEND", "", false]] as const) {
        const r = CardRevisionSnapshotSchema.parse({ ...trustedV, deckbuildingIdentity: identity, type, subtitle });
        const ctx = { content: createContentBundle(p.context.content.ruleset, p.context.content.cards.map(c => c.id === trustedV.id ? r : c), p.context.content.manifest.engine) };
        assert.equal(testCondition(p.state, actor, condition, ctx, p.host), expected);
    }
    assert.equal(context.content.cards.some(c => c.id === "v-corporate-exile"), false);
});
test("Floor It, Reboot, Lag, turn history and private memory survive both selection stages until cleanup", () => {
    const m = new TurnMutation(stockEddies(main, p.context, 4), p.context), floor = Object.values(m.state.objects.cards).find(c => c.cardId === FLOOR_IT && c.controllerId === actor)!, reboot = Object.values(m.state.objects.cards).find(c => c.cardId === REBOOT && c.controllerId === actor)!;
    moveCardLocation(m, floor.id, "TRASH"); moveCardLocation(m, reboot.id, "TRASH"); unwrap(grantLegendKnowledge(m, actor, 0)); m.state.objects.cards[p.host].statuses.push("LAG");
    m.state.temporaryModifiers = [{ kind: "POWER", sourceId: floor.id, targetId: p.host, amount: -1, expires: { kind: "END_OF_TURN", turn: main.timing.turn } }];
    m.state.fightPreventions = [{ kind: "PREVENT_NEXT_RIVAL_FIGHT_DEFEAT", id: preventionId(m.state, reboot.id, actor, main.timing.turn), sourceId: reboot.id, controllerId: actor, createdTurn: main.timing.turn, expires: { kind: "END_OF_TURN", turn: main.timing.turn } }];
    const first = choose(end(m.state, p.context).state, p.context).state;
    assert.deepEqual(first.temporaryModifiers, m.state.temporaryModifiers); assert.deepEqual(first.fightPreventions, m.state.fightPreventions); assert.deepEqual(first.turnHistory, { ...m.state.turnHistory, triggeredBatches: m.state.turnHistory!.triggeredBatches + 1 }); assert.ok(first.objects.cards[p.host].statuses.includes("LAG"));
    const done = choose(first, p.context), kinds = done.events.map(e => e.payload.kind);
    assert.ok(kinds.indexOf("LAG_REMOVED") > kinds.indexOf("EFFECT_RESOLVED")); assert.ok(kinds.indexOf("POWER_MODIFIER_EXPIRED") > kinds.indexOf("EFFECT_RESOLVED"));
    assert.equal(done.state.temporaryModifiers, undefined); assert.equal(done.state.fightPreventions, undefined); assert.deepEqual(done.state.privateKnowledge, m.state.privateKnowledge);
});
for (const defect of ["duplicate", "id", "turn", "ordinal", "source", "subject", "sourceRef", "subjectRef", "controller", "ability", "hidden", "sourceHidden", "controlChange"] as const) test(`malformed delayed ${defect} rejects without mutation`, () => {
    const s = GameStateSchema.parse(main), d = s.delayedEffects![0];
    if (defect === "duplicate") s.delayedEffects!.push(d);
    if (defect === "id") d.id = HashSchema.parse("0".repeat(64));
    if (defect === "turn") d.createdTurn--;
    if (defect === "ordinal") d.originOrdinal++;
    if (defect === "source") d.sourceId = CardInstanceIdSchema.parse("missing-source");
    if (defect === "subject") d.subjectId = CardInstanceIdSchema.parse("missing-subject");
    if (defect === "sourceRef") d.source.cardId = trustedV.id;
    if (defect === "subjectRef") d.subject.cardId = dyingNight.id;
    if (defect === "controller") d.controllerId = p.rival;
    if (defect === "ability") d.abilityId = "wrong";
    if (defect === "hidden" || defect === "sourceHidden") { const id = defect === "hidden" ? d.subjectId : d.sourceId; s.objects.cards[id].face = "DOWN"; }
    if (defect === "controlChange") s.objects.cards[d.subjectId].controllerId = p.rival;
    const before = JSON.stringify(s); assert.equal(validateState(s, p.context).ok, false); assert.equal(applyAction(s, { actorId: actor, action: { kind: "END_TURN" } }, p.context).ok, false); assert.equal(JSON.stringify(s), before);
});
for (const defect of ["doubleTransfer", "orphanBinding", "missingCaptured", "duplicateSlot", "readySlot", "outOfRange", "emptySelection"] as const) test(`malformed pending delayed ${defect} rejects`, () => {
    const s = GameStateSchema.parse(choose(positiveEnd(4).state, p.context).state), c = s.resolution.triggerContinuation!;
    assert.ok(c.origin.kind === "END_TURN");
    if (defect === "doubleTransfer") s.delayedEffects = c.origin.delayedEffects;
    if (defect === "orphanBinding") c.bindings[0].delayedId = HashSchema.parse("0".repeat(64));
    if (defect === "missingCaptured") delete c.origin.delayedEffects;
    if (defect === "duplicateSlot") c.selectedEddieSlots!.push(c.selectedEddieSlots![0]);
    if (defect === "readySlot") s.objects.cards[s.players[actor].zones.EDDIES[c.selectedEddieSlots![0]]].readiness = "READY";
    if (defect === "outOfRange") c.selectedEddieSlots![0] = 99;
    if (defect === "emptySelection") c.selectedEddieSlots = [];
    assert.equal(validateState(s, p.context).ok, false);
});
test("duplicate and stale Eddie submissions, wrong actor and second END_TURN reject atomically", () => {
    const start = positiveEnd(4).state, old = actions(start, p.context)[0], first = choose(start, p.context).state;
    assert.equal(resolveActionId(first, actor, old.actionId, p.context).ok, false);
    const forged = GameStateSchema.parse(first); forged.resolution.choice!.options[0] = { kind: "EDDIE_SLOT", slot: 0 }; const snapshot = JSON.stringify(forged);
    assert.equal(applyAction(forged, { actorId: actor, action: actions(first, p.context)[0].action }, p.context).ok, false); assert.equal(JSON.stringify(forged), snapshot);
    const changed = GameStateSchema.parse(start); changed.objects.cards[changed.players[actor].zones.EDDIES[0]].readiness = "READY"; changed.resolution.choice = triggerChoice(changed, p.context);
    assert.ok(validateState(changed, p.context).ok); assert.equal(resolveActionId(changed, actor, old.actionId, p.context).ok, false);
    assert.equal(applyAction(start, { actorId: p.rival, action: old.action }, p.context).ok, false); assert.equal(applyAction(start, { actorId: actor, action: { kind: "END_TURN" } }, p.context).ok, false);
});
test("public future work changes position/observation hashes; registration identity ignores transport counters", () => {
    const absent = GameStateSchema.parse(main); delete absent.delayedEffects; assert.deepEqual(absent.objects, main.objects); assert.notEqual(hashPosition(absent), hashPosition(main));
    for (const viewer of main.match.playerOrder) {
        const obs = unwrap(observe(main, viewer, p.context)); assert.notEqual(hashObservation(obs), hashObservation(unwrap(observe(absent, viewer, p.context))));
        assert.equal(obs.delayedEffects!.length, 1); assert.equal(JSON.stringify(obs.delayedEffects).includes(main.delayedEffects![0].id), false);
    }
    const counter = GameStateSchema.parse(p.state); counter.match.version = GameStateVersionSchema.parse(999); counter.match.eventSequence = GameEventSequenceSchema.parse(999);
    assert.deepEqual(actions(p.state, p.context), actions(counter, p.context)); assert.deepEqual(register(counter, p.context).state.delayedEffects, registered.state.delayedEffects);
});
test("ready2 hides Eddie contents in both observation and model actions, including partial selection", () => {
    for (const state of [positiveEnd(4).state, choose(positiveEnd(4).state, p.context).state]) {
        const changed = GameStateSchema.parse(state), id = changed.players[actor].zones.EDDIES[0];
        const replacement = changed.players[actor].zones.DECK.find(cid => { const r = p.context.content.cards.find(r => r.id === changed.objects.cards[cid].cardId)!; return r.sellProfile.allowed && r.id !== changed.objects.cards[id].cardId; })!;
        [changed.objects.cards[id].cardId, changed.objects.cards[replacement].cardId] = [changed.objects.cards[replacement].cardId, changed.objects.cards[id].cardId];
        [changed.objects.cards[id].revision, changed.objects.cards[replacement].revision] = [changed.objects.cards[replacement].revision, changed.objects.cards[id].revision];
        assert.notEqual(hashReplayState(state), hashReplayState(changed)); assert.deepEqual(actions(state, p.context), actions(changed, p.context));
        for (const viewer of state.match.playerOrder) assert.deepEqual(unwrap(observe(state, viewer, p.context)), unwrap(observe(changed, viewer, p.context)));
        const position = unwrap(generatePosition(state, actor, p.context, "ready-two")), prompt = JSON.stringify(modelInput(position)); assert.ok(validateTrainingPosition(position, p.context).ok);
        for (const cid of state.players[actor].zones.EDDIES) assert.equal(prompt.includes(cid), false); assert.equal(prompt.includes(state.rng.seed), false);
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: p.context.content, state, actorId: actor, actionId: actions(state, p.context)[0].actionId });
        assert.ok(response.ok && response.value.kind === "transition"); assert.deepEqual(response.value.state, choose(state, p.context).state);
    }
});
test("strict admission rejects old scopes, partial paragraphs, altered metadata and recurring misnormalization", () => {
    const a = dyingNight.mechanics.abilities[0];
    for (const input of [
        { ...dyingNight, execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" } },
        { ...dyingNight, execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" } },
        { ...dyingNight, power: 3 }, { ...dyingNight, printedCost: { kind: "EDDIES", amount: 1 } },
        { ...dyingNight, mechanics: { ...dyingNight.mechanics, abilities: [{ ...a, effects: a.effects.slice(0,1) }] } },
        { ...dyingNight, mechanics: { ...dyingNight.mechanics, abilities: [{ ...a, effects: [a.effects[0]] }, { ...a, id: "wrong-recurring", trigger: "WHEN_OWN_TURN_ENDS", effects: [a.effects[1]] }] } }
    ]) {
        const parsed = CardRevisionSnapshotSchema.safeParse(input); assert.ok(parsed.success);
        const ctx = { content: createContentBundle(context.content.ruleset, context.content.cards.map(c => c.id === DYING_NIGHT ? parsed.data : c), context.content.manifest.engine) };
        assert.equal(supportsDelayedAttackGear(parsed.data, ctx).ok, false); assert.equal(createGameWithEvents(delayedInput("reject"), ctx).ok, false);
    }
});
test("constructed format, copy limits and absent real V remain unchanged; headline golden is exact", () => {
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 }); const input = delayedInput("format"); assert.ok(input.decks.every(d => d.main.length === 42 && d.legends.length === 3));
    for (const deck of [{ ...input.decks[0], main: input.decks[0].main.slice(0,27) }, { ...input.decks[0], main: [...input.decks[0].main, DYING_NIGHT, DYING_NIGHT] }, { ...input.decks[0], legends: input.decks[0].legends.slice(0,2) }]) assert.equal(createGameWithEvents({ ...input, decks: [deck,input.decks[1]] }, context).ok, false);
    assert.ok(replay.positions.every(position => position.legalActions.length > 1)); assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/dying-night-replay.v1.json", import.meta.url), "utf8")), replay);
});

test("Satori fight-win timing is separate from Dying ATTACK registration and later end turn", () => {
    const m = new TurnMutation(p.state, p.context), satori = Object.values(m.state.objects.cards).find(c => c.cardId === SATORI && c.controllerId === actor)!;
    moveCardLocation(m, satori.id, "HAND"); unwrap(attachPlayedGear(m, satori.id, p.host));
    const defender = Object.values(m.state.objects.cards).find(c => c.cardId === DELAMAIN && c.controllerId === p.rival)!;
    moveCardLocation(m, defender.id, "BATTLEFIELD"); m.state.objects.cards[defender.id].readiness = "SPENT";
    let s = take(m.state, p.context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === p.host).state;
    assert.equal(s.timing.step, "ATTACK_TARGET_SELECTION");
    const i = s.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === defender.id); assert.ok(i >= 0);
    s = finishChoices(choose(s, p.context, i).state, p.context).state; assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.delayedEffects!.length, 1);
    const result = mainAfterAttack(s, p.context); const facts = result.events.map(e => e.payload);
    assert.ok(facts.some(e => e.kind === "FIGHT_RESULT" && e.winnerId === p.host)); assert.ok(facts.some(e => e.kind === "EFFECT_PENDING" && e.sourceId === satori.id));
    assert.equal(result.state.objects.cards[defender.id].zone.zone, "TRASH"); assert.equal(result.state.delayedEffects!.length, 1);
    assert.equal(readyCount(end(stockEddies(result.state, p.context, 2), p.context).state), 2);
});
test("hidden-zone departures reject at the trusted movement boundary; game end removes future work", () => {
    for (const id of [p.host, main.delayedEffects![0].sourceId]) {
        const before = JSON.stringify(main); assert.equal(moveCardForEffect(main, id, "HAND", p.context).ok, false); assert.equal(JSON.stringify(main), before);
    }
    const m = new TurnMutation(main, p.context); m.finish(p.rival, actor, "EMPTY_DRAW"); assert.equal(m.state.delayedEffects, undefined); assert.ok(validateState(m.state, p.context).ok);
});
test("delayed support works without Delamain history admission or Kiroshi privacy admission", () => {
    const ctx = { content: createContentBundle(p.context.content.ruleset, p.context.content.cards.filter(c => ![DELAMAIN, KIROSHI, EVELYN].includes(c.id)), p.context.content.manifest.engine) };
    const s = GameStateSchema.parse(p.state);
    for (const c of Object.values(s.objects.cards)) if ([DELAMAIN, KIROSHI, EVELYN].includes(c.cardId)) { c.cardId = trustedV.id; c.revision = trustedV.revision; }
    s.match.contentManifestHash = ctx.content.manifestHash; s.match.cards = ctx.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    const registered = register(unwrap(validateState(s, ctx)), ctx), after = mainAfterAttack(registered.state, ctx).state;
    assert.equal(after.turnHistory?.gigsStolenByUnit, undefined); const pending = end(stockEddies(after, ctx, 4), ctx).state;
    const changed = GameStateSchema.parse(pending), id = changed.players[actor].zones.EDDIES[0], other = changed.players[actor].zones.DECK.find(cid => changed.objects.cards[cid].cardId !== changed.objects.cards[id].cardId && ctx.content.cards.find(r => r.id === changed.objects.cards[cid].cardId)!.sellProfile.allowed)!;
    [changed.objects.cards[id].cardId, changed.objects.cards[other].cardId] = [changed.objects.cards[other].cardId, changed.objects.cards[id].cardId];
    assert.deepEqual(actions(changed, ctx), actions(pending, ctx)); assert.equal(readyCount(finishChoices(pending, ctx).state), 2);
});
