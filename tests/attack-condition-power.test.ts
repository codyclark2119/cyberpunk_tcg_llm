import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, RulesetSchema, createContentBundle, canonicalSerialize, hashCanonical, type CardInstanceId, type GameState } from "@tcg/domain";
import { createGameWithEvents, hashObservation, hashPosition, hashReplayState, observe, RulesView, validateState } from "@tcg/engine";
import { generatePosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { attackPowerContext, attackPowerInput, losing, LOSING } from "./attack-condition-power-fixture";
import { attackConditionPowerReplay } from "./attack-condition-power-replay";
import { spendContext } from "./targeted-spend-fixture";
import { SABURO } from "./saburo-fixture";
import { YORINOBU } from "./yorinobu-fixture";
import { DYING_NIGHT } from "./delayed-effects-fixture";
import { KIROSHI } from "./private-information-fixture";
import { supportsAttackConditionPowerCard } from "../packages/engine/src/attack-condition-power-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { friendlyLegends, areAllFriendlyLegendsFaceUp } from "../packages/engine/src/legend-face-condition";
import { testCondition } from "../packages/engine/src/conditions";
import { effectiveCardTypes } from "../packages/engine/src/characteristics";
import { HandlerRegistry } from "../packages/engine/src/effects";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation, moveCardForEffect } from "../packages/engine/src/card-movement";
import { grantLegendKnowledge } from "../packages/engine/src/private-knowledge";
import { actions, take, choose, end, finishChoices } from "./delayed-effects-focused";
import { bare, declare, finishAttack, readyAgain } from "./yorinobu-focused";
import { unwrap } from "./turn-replay";
import source from "./fixtures/attack-condition-power-card-source.v1.json";
import rules from "./fixtures/attack-condition-power-rules.v1.json";
const context = attackPowerContext(), trace = attackConditionPowerReplay(), base = trace.beforeAttack, actor = trace.actor, rival = trace.rival, host = trace.source;
const view = (s: GameState) => new RulesView(s, context);
const power = (s: GameState) => view(s).getEffectivePower(host);
const card = (s: GameState, id: string) => Object.values(s.objects.cards).find(c => c.cardId === id && c.controllerId === actor)!;
const payloads = (r: ReturnType<typeof take>) => r.events.map(e => e.payload);
function face(s: GameState, id: CardInstanceId, up: boolean) { const x = GameStateSchema.parse(s); x.objects.cards[id].face = up ? "UP" : "DOWN"; return unwrap(validateState(x, context)); }
/** Trusted exact-revision arrangements for focused interactions, never imported by headline. */
function reviewed(s: GameState, id: string, player = actor, area: "BATTLEFIELD" | "HAND" = "BATTLEFIELD") {
    const m = new TurnMutation(s, context), c = Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.zone.zone === "DECK" && c.cardId.startsWith("slice-card-"))!, r = context.content.cards.find(r => r.id === id)!;
    assert.ok(c && r); c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, area); c.readiness = "READY"; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
function equip(s: GameState, id: string, target = host) {
    const x = reviewed(s, id, s.objects.cards[target].controllerId, "HAND"), m = new TurnMutation(x.state, context); unwrap(attachPlayedGear(m, x.id, target)); return { state: unwrap(validateState(m.state, context)), id: x.id };
}
function attack(s = base, target?: CardInstanceId) { const d = declare(s, host, context, target), f = finishChoices(d.state, context); return { state: f.state, events: [...d.events, ...f.events] }; }
function leave(s: GameState, id: CardInstanceId, zone: "TRASH" | "REMOVED" | "HAND") { return unwrap(moveCardForEffect(s, id, zone, context, zone === "TRASH" ? [id, ...s.objects.cards[id].attachments] : undefined)); }

test("complete Losing His Way source, three printings, all errata and exact supported normalization", () => {
    assert.equal(source.record.id, "08e6a687-56b7-4ac1-982f-8a8d6d0c0bc5"); assert.equal(source.record.rules_text, "{Attack} If all friendly Legends are face-up, this Unit has +5 power this turn.");
    assert.equal(source.record.printings.length, 3); assert.equal(source.errata.length, 4); assert.equal(source.errata.some(e => e.card_id === LOSING), false);
    assert.equal(losing.provenance.sourceHash, hashCanonical(source.record)); assert.equal(losing.revision, 1); assert.equal(losing.type, "UNIT"); assert.equal(losing.power, 4); assert.deepEqual(losing.printedCost, { kind: "EDDIES", amount: 4 }); assert.equal(losing.sellProfile.allowed, false); assert.deepEqual(losing.ram, { GREEN: 3 }); assert.ok(supportsAttackConditionPowerCard(losing, context).ok);
});
test("review pins the declaration FAQ and current-resolution, lifetime, stacking and area rules", () => {
    assert.equal(rules.rules.length, 362); assert.equal(rules.faqs.length, 3); assert.equal(rules.faqs.find(f => f.id === "0c5b038a-705c-44ba-bff6-95403c35f032")?.answer, "No.");
    for (const n of ["1.7.2.1", "3.4.1", "3.17.2", "4.2.1", "4.4", "5.13.2", "5.3.2.2", "8.16.2", "9.29", "10.3.3", "10.15.1", "10.16.3", "11.21.2"]) assert.ok(rules.rules.some(r => r.display_number === n), n);
});
test("all friendly Legends includes actual field Hands Unclean and excludes rival hidden Legends", () => {
    assert.equal(friendlyLegends(base, actor, context).length, 3); assert.ok(friendlyLegends(base, actor, context).some(c => c.id === trace.fieldLegend)); assert.deepEqual(effectiveCardTypes(base, trace.fieldLegend, context), ["LEGEND", "UNIT"]); assert.ok(view(base).areAllFriendlyLegendsFaceUp(actor)); assert.equal(areAllFriendlyLegendsFaceUp(base, rival, context), false);
});
for (const id of [SABURO, YORINOBU]) test("one face-down " + id + " prevents ATTACK pending and buff", () => {
    const s = face(base, card(base, id).id, false); assert.equal(view(s).areAllFriendlyLegendsFaceUp(actor), false); const a = attack(s);
    assert.equal(a.state.temporaryModifiers, undefined); assert.equal(payloads(a).some(e => e.kind === "EFFECT_PENDING" && e.sourceId === host), false); assert.equal(payloads(a).some(e => e.kind === "POWER_MODIFIER_APPLIED"), false); assert.equal(a.state.timing.step, "RIVAL_REACT");
});
test("face-up SPENT Legends, including the field Legend, satisfy the condition", () => {
    const s = GameStateSchema.parse(base); for (const c of friendlyLegends(s, actor, context)) s.objects.cards[c.id].readiness = "SPENT";
    assert.ok(validateState(s, context).ok); assert.ok(areAllFriendlyLegendsFaceUp(s, actor, context)); assert.equal(power(attack(s).state), 12);
});
test("friendly uses current control, not owner; query-only transfer changes the qualifying set", () => {
    const s = GameStateSchema.parse(base), c = s.objects.cards[card(s, SABURO).id]; c.ownerId = rival; assert.ok(areAllFriendlyLegendsFaceUp(s, actor, context));
    c.controllerId = rival; c.zone.playerId = rival; c.face = "DOWN"; assert.ok(areAllFriendlyLegendsFaceUp(s, actor, context));
    const other = s.objects.cards[s.players[rival].zones.LEGENDS[0]]; other.controllerId = actor; other.zone.playerId = actor; assert.equal(areAllFriendlyLegendsFaceUp(s, actor, context), false);
});
for (const zone of ["TRASH", "REMOVED", "HAND", "DECK", "EDDIES"] as const) test("query excludes printed Legends in " + zone + ", which is not a valid controlled Legend area", () => {
    const s = GameStateSchema.parse(base), c = s.objects.cards[card(s, SABURO).id]; c.zone.zone = zone; c.face = "DOWN"; assert.equal(friendlyLegends(s, actor, context).some(x => x.id === c.id), false); assert.ok(areAllFriendlyLegendsFaceUp(s, actor, context));
});
test("actual public field Legend removal excludes it without changing other Legend faces", () => {
    const s = leave(base, trace.fieldLegend, "TRASH").state; assert.equal(s.objects.cards[trace.fieldLegend].zone.zone, "REMOVED"); assert.equal(friendlyLegends(s, actor, context).length, 2); assert.ok(areAllFriendlyLegendsFaceUp(s, actor, context));
});
test("universal empty-set query is deliberate and does not admit a zero-Legend deck", () => {
    const m = new TurnMutation(base, context); for (const c of friendlyLegends(base, actor, context)) moveCardLocation(m, c.id, "REMOVED"); const s = m.state;
    assert.equal(validateState(s, context).ok, false); // In particular, this scope does not admit Yorinobu leaving LEGENDS.
    assert.equal(friendlyLegends(s, actor, context).length, 0); assert.equal(areAllFriendlyLegendsFaceUp(s, actor, context), true);
    const input = attackPowerInput("empty"); input.decks[0].legends = []; assert.equal(createGameWithEvents(input, context).ok, false);
});
test("face-down field Legend is queried as down but external impossible state is rejected", () => {
    const s = GameStateSchema.parse(base); s.objects.cards[trace.fieldLegend].face = "DOWN"; assert.equal(areAllFriendlyLegendsFaceUp(s, actor, context), false); assert.equal(validateState(s, context).ok, false);
});
test("Legend-area Gear leaves actual face/readiness semantics unchanged", () => {
    const s = equip(base, "mantis-blades", card(base, SABURO).id).state; assert.ok(view(s).areAllFriendlyLegendsFaceUp(actor)); assert.equal(s.objects.cards[card(s, SABURO).id].zone.zone, "LEGENDS"); assert.equal(power(attack(s).state), 12);
});
test("actual Kiroshi ATTACK look keeps known friendly Legend DOWN and cannot retroactively trigger Losing", () => {
    const down = face(base, card(base, SABURO).id, false), equipped = equip(down, KIROSHI), a = attack(equipped.state);
    assert.equal(a.state.objects.cards[card(base, SABURO).id].face, "DOWN"); assert.ok(a.events.some(e => e.payload.kind === "LEGEND_LOOKED_AT"));
    assert.equal(areAllFriendlyLegendsFaceUp(a.state, actor, context), false); assert.equal(a.state.temporaryModifiers, undefined); assert.equal(a.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === host), false);
});
test("private known marker is not equivalent to reveal", () => {
    const down = face(base, card(base, SABURO).id, false), m = new TurnMutation(down, context), slot = m.state.players[actor].zones.LEGENDS.indexOf(card(down, SABURO).id);
    unwrap(grantLegendKnowledge(m, actor, slot)); assert.ok(validateState(m.state, context).ok); assert.equal(testCondition(m.state, actor, { kind: "ALL_FRIENDLY_LEGENDS_FACE_UP" }, context), false);
});
test("legal CALL of final Legend makes a later attack qualify", () => {
    let s = face(base, card(base, SABURO).id, false); const m = new TurnMutation(s, context); const eddie = m.state.players[actor].zones.EDDIES[0]; m.state.objects.cards[eddie].readiness = "READY"; s = unwrap(validateState(m.state, context));
    s = take(s, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === card(s, SABURO).id).state; s = finishChoices(s, context).state;
    assert.ok(view(s).areAllFriendlyLegendsFaceUp(actor)); assert.equal(power(attack(s).state), 12);
});
test("condition is checked at declaration and again against current state during resolution", () => {
    const pending = trace.pendingAttack; assert.ok(pending.resolution.pending.some(e => e.sourceId === host));
    const m = new TurnMutation(pending, context), e = m.state.resolution.pending.find(e => e.sourceId === host)!; m.state.resolution.pending = m.state.resolution.pending.filter(x => x.id !== e.id); m.state.resolution.current = e;
    m.state.objects.cards[card(base, SABURO).id].face = "DOWN";
    // Trusted future-resolution probe: current admitted ATTACK primitives cannot flip faces.
    assert.equal(validateState(m.state, context).ok, false); unwrap(new HandlerRegistry().resolve(m, e.effect)); assert.equal(m.state.temporaryModifiers, undefined); assert.ok(m.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
});
test("all-face-up positive uses same source/subject, automatic +5 and no target choice", () => {
    const a = attack(); assert.equal(power(a.state), 12); const m = a.state.temporaryModifiers![0]; assert.equal(m.amount, 5); assert.equal(m.sourceId, host); assert.equal(m.targetId, host);
    assert.ok(a.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met)); assert.equal(a.state.resolution.choice, null); assert.equal(a.state.timing.step, "RIVAL_REACT");
});
test("Mantis plus Saburo:12 attacking,11 in MAIN,6 after normal turn expiry", () => {
    assert.equal(power(trace.beforeAttack), 6); assert.equal(power(trace.beforeReact), 12); assert.equal(power(trace.afterAttack), 11); assert.equal(power(trace.finalState), 6); assert.deepEqual(trace.afterAttack.objects.cards[host], { ...trace.beforeAttack.objects.cards[host], readiness: "SPENT" });
    assert.deepEqual(trace.finalState.objects.cards[trace.gear], trace.beforeAttack.objects.cards[trace.gear]); assert.equal(losing.power, 4);
});
test("without Gear/Saburo:4→9 on attack, remains9 in MAIN, returns4 next turn", () => {
    const s = leave(bare(base, host, context), card(base, SABURO).id, "REMOVED").state, a = attack(s), done = finishAttack(a.state, context);
    assert.equal(power(a.state), 9); assert.equal(power(done.state), 9); assert.equal(power(end(done.state, context).state), 4);
});
test("two successful same-turn ATTACK occurrences stack +10 with distinct deterministic origins", () => {
    const s = readyAgain(trace.afterAttack, host, context), a = attack(s), modifiers = a.state.temporaryModifiers!;
    assert.equal(modifiers.length, 2); assert.ok(modifiers.every(m => m.amount === 5)); assert.notEqual(modifiers[0].amount === 5 && modifiers[0].origin.effectId, modifiers[1].amount === 5 && modifiers[1].origin.effectId); assert.equal(power(a.state), 17);
    assert.deepEqual(attack(s).state.temporaryModifiers, modifiers); const done = finishAttack(a.state, context); assert.equal(power(done.state), 16); assert.equal(end(done.state, context).state.temporaryModifiers, undefined);
});
test("multiple physical Losing Units own independent buffs", () => {
    const second = reviewed(base, LOSING), firstAttack = attack(second.state), done = finishAttack(firstAttack.state, context), secondAttack = declare(done.state, second.id, context), resolved = finishChoices(secondAttack.state, context);
    assert.equal(resolved.state.temporaryModifiers?.length, 2); assert.equal(view(resolved.state).getEffectivePower(second.id), 10); assert.equal(power(resolved.state), 11); assert.equal(new Set(resolved.state.temporaryModifiers?.map(m => m.targetId)).size, 2);
});
test("Floor It uses the same modifier store:12→11 React,10 MAIN,6 after expiry", () => {
    const x = reviewed(base, "floor-it", rival, "HAND"), m = new TurnMutation(x.state, context), payment = m.state.players[rival].zones.LEGENDS[0]; m.state.objects.cards[payment].readiness = "READY";
    const a = attack(unwrap(validateState(m.state, context))), played = take(a.state, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === x.id);
    let s = played.state; while (s.resolution.choice) { const i = s.resolution.choice.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === host); s = choose(s, context, Math.max(i, 0)).state; }
    assert.equal(power(s), 11); assert.deepEqual(s.temporaryModifiers?.map(m => m.amount).sort((a,b)=>a-b), [-1,5]); const done = finishAttack(s, context); assert.equal(power(done.state), 10); assert.equal(power(end(done.state, context).state), 6);
});
test("Satori actual Fight outcome changes from loss to win, then inherited draw resolves", () => {
    const equipped = equip(bare(base, host, context), "satori-sword-of-saburo"), defender = reviewed(equipped.state, "minotaur", rival), s = GameStateSchema.parse(defender.state); s.objects.cards[defender.id].readiness = "SPENT";
    const positive = attack(s, defender.id), won = finishAttack(positive.state, context); const result = won.events.find(e => e.payload.kind === "FIGHT_RESULT")?.payload;
    assert.ok(result?.kind === "FIGHT_RESULT"); assert.equal(result.winnerId, host); assert.equal(won.state.objects.cards[defender.id].zone.zone, "TRASH"); assert.ok(won.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === equipped.id));
    const negative = attack(face(s, card(base, YORINOBU).id, false), defender.id), lost = finishAttack(negative.state, context); assert.equal(lost.state.objects.cards[host].zone.zone, "TRASH"); assert.equal(lost.state.objects.cards[defender.id].zone.zone, "BATTLEFIELD");
});
test("actual Steal allowance is2 with+5 and1 without it", () => {
    const a = attack(), yes = take(a.state, context, a => a.action.kind === "PASS_REACT"); assert.equal(yes.state.resolution.gigStealContinuation?.remaining, 2);
    const no = attack(face(base, card(base, YORINOBU).id, false)), pass = take(no.state, context, a => a.action.kind === "PASS_REACT"); assert.equal(pass.state.resolution.gigStealContinuation?.remaining, 1);
    const yesDone = finishChoices(yes.state, context), noDone = finishChoices(pass.state, context); assert.equal(yesDone.state.players[actor].gigs.GIGS.length - base.players[actor].gigs.GIGS.length, 2); assert.equal(noDone.state.players[actor].gigs.GIGS.length - base.players[actor].gigs.GIGS.length, 1);
});
test("Losing, Yorinobu, Kiroshi and Dying share one ATTACK batch; Saburo is continuous", () => {
    const k = equip(base, KIROSHI), d = equip(k.state, DYING_NIGHT), a = declare(d.state, host, context), c = a.state.resolution.triggerContinuation!;
    assert.equal(c.bindings.length, 4); assert.ok(c.bindings.some(b => b.sourceId === host && b.subjectId === host)); assert.ok(c.bindings.some(b => b.sourceId === k.id && b.subjectId === host)); assert.ok(c.bindings.some(b => b.sourceId === d.id && b.subjectId === host)); assert.ok(c.bindings.some(b => b.sourceId === card(base, YORINOBU).id)); assert.equal(c.bindings.some(b => b.sourceId === card(base, SABURO).id), false);
    assert.equal(a.state.turnHistory!.firstArasakaAttacks![actor].count, 1);
    for (const order of [0, c.bindings.length-1]) { const selected = choose(a.state, context, order), done = finishChoices(selected.state, context); assert.equal(done.state.timing.step, "RIVAL_REACT"); assert.equal(done.state.temporaryModifiers?.length, 1); assert.equal(done.state.delayedEffects?.length, 1); assert.equal(done.state.turnHistory!.firstArasakaAttacks![actor].count, 1); }
});
test("+5 remains through pending Delamain end-turn effects and expires only during cleanup", () => {
    const x = reviewed(trace.afterAttack, "delamain-cab"), s = GameStateSchema.parse(x.state); (s.turnHistory!.gigsStolenByUnit ??= {})[x.id] = 1;
    const e = end(unwrap(validateState(s, context)), context); assert.equal(e.state.timing.step, "EDDIE_READY_SELECTION"); assert.equal(power(e.state), 11); assert.ok(e.state.temporaryModifiers?.length); assert.equal(e.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED"), false);
    const done = finishChoices(e.state, context); assert.equal(done.state.temporaryModifiers, undefined); const kinds = done.events.map(e => e.payload.kind); assert.ok(kinds.indexOf("EFFECT_RESOLVED") < kinds.indexOf("POWER_MODIFIER_EXPIRED")); assert.ok(kinds.indexOf("POWER_MODIFIER_EXPIRED") < kinds.indexOf("TURN_ENDED"));
});
for (const destination of ["TRASH", "HAND"] as const) test("self+5 physical lifetime on trusted departure to " + destination, () => {
    const moved = leave(trace.afterAttack, host, destination); assert.equal(Boolean(moved.state.temporaryModifiers), destination === "TRASH"); assert.ok(validateState(moved.state, context).ok);
    if (destination === "TRASH") { assert.equal(power(moved.state), 9); assert.equal(end(moved.state, context).state.temporaryModifiers, undefined); }
    else assert.ok(moved.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED" && e.payload.reason === "HIDDEN_AREA"));
});
test("actual defeat after +5 preserves modifier in public Trash until cleanup", () => {
    const d = reviewed(base, "minotaur", rival), geared = equip(d.state, "mantis-blades", d.id), s = GameStateSchema.parse(geared.state); s.objects.cards[d.id].readiness = "SPENT";
    // Bare Losing+Saburo=10 versus real Minotaur+Mantis=11.
    const a = attack(bare(s, host, context), d.id), done = finishAttack(a.state, context); assert.equal(done.state.objects.cards[host].zone.zone, "TRASH"); assert.equal(done.state.temporaryModifiers?.length, 1); assert.equal(power(done.state), 9); assert.equal(end(done.state, context).state.temporaryModifiers, undefined);
});
for (const defect of ["policy","status","scope","trigger","condition","missing-condition","amount","target","extra-effect","activation","inherited","guard","ability-cost","card-type","cost","power","ram","colors","tags","sell","keywords","modifiers","unreviewed"] as const) test("complete-shape rejects "+defect, () => {
    const c = CardRevisionSnapshotSchema.parse(losing), rules = RulesetSchema.parse(context.content.ruleset), a = c.mechanics.abilities[0];
    if (defect === "policy") delete rules.gameplay!.turnSlice!.attackConditionPower;
    if (defect === "status") c.execution!.status = "UNSUPPORTED";
    if (defect === "scope") c.execution!.scope = "COMBAT_ATTACK_V1";
    if (defect === "trigger") a.trigger = "WHEN_PLAYED";
    if (defect === "condition") a.conditions = [{ kind: "STREET_CRED_IS_EVEN" }];
    if (defect === "missing-condition") a.conditions = [];
    if (defect === "amount" && a.effects[0].kind === "POWER_UNTIL_END_OF_TURN") a.effects[0].amount = 4;
    if (defect === "target" && a.effects[0].kind === "POWER_UNTIL_END_OF_TURN") a.effects[0].target.kind = "RIVAL_UNIT";
    if (defect === "extra-effect") a.effects.push({ kind: "DRAW", count: 1 });
    if (defect === "activation") a.activation = { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] };
    if (defect === "inherited") a.inherited = "EQUIPPED_HOST";
    if (defect === "guard") a.guard = "FIRST_FRIENDLY_ARASAKA_UNIT_ATTACK_PER_TURN";
    if (defect === "ability-cost") a.cost = { kind: "EDDIES", amount: 1 };
    if (defect === "card-type") c.type = "LEGEND";
    if (defect === "cost") c.printedCost = { kind: "EDDIES", amount: 3 };
    if (defect === "power") c.power = 5;
    if (defect === "ram") c.ram = { GREEN: 2 };
    if (defect === "colors") c.colors = ["RED"];
    if (defect === "tags") c.tags = ["Corpo"];
    if (defect === "sell") c.sellProfile.allowed = true;
    if (defect === "keywords") c.mechanics.keywords = ["ADRENALINE"];
    if (defect === "modifiers") c.mechanics.modifiers = [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }];
    if (defect === "unreviewed") { c.provenance.reviewed = false; assert.equal(supportsAttackConditionPowerCard(c, context).ok, false); assert.throws(() => createContentBundle(rules,[c],context.content.manifest.engine)); return; }
    const ctx = { content: createContentBundle(rules, context.content.cards.map(x => x.id === LOSING ? c : x), context.content.manifest.engine) }; assert.equal(supportsAttackConditionPowerCard(c,ctx).ok, false); assert.equal(supportsPlay(c,ctx).ok, false); assert.equal(createGameWithEvents(attackPowerInput("invalid"),ctx).ok, false);
});
for (const defect of ["duplicate","amount","target","source","origin-missing","origin-id","origin-ability","origin-ordinal","future-turn","hidden","unresolved"]) test("external temporary+5 rejects "+defect, () => {
    const s = GameStateSchema.parse(trace.afterAttack); const m = s.temporaryModifiers![0]; assert.ok(m.amount === 5);
    if (defect === "duplicate") s.temporaryModifiers!.push(structuredClone(m));
    if (defect === "target") m.targetId = trace.fieldLegend;
    if (defect === "source") m.sourceId = trace.fieldLegend;
    if (defect === "origin-id") m.origin.effectId = "0".repeat(64);
    if (defect === "origin-ability") m.origin.abilityId = "forged@1";
    if (defect === "origin-ordinal") m.origin.ordinal += 10;
    if (defect === "future-turn") m.expires.turn++;
    if (defect === "hidden") { s.players[actor].zones.BATTLEFIELD = s.players[actor].zones.BATTLEFIELD.filter(id=>id!==host); s.players[actor].zones.HAND.push(host); s.objects.cards[host].zone.zone = "HAND"; s.objects.cards[host].face = "DOWN"; }
    if (defect === "amount" || defect === "origin-missing") { const bad = { ...s, temporaryModifiers: [{ ...m, ...(defect === "amount" ? { amount: 6 } : { origin: undefined }) }] }; assert.equal(validateState(bad,context).ok,false); return; }
    if (defect === "unresolved") { const bad = GameStateSchema.parse(trace.pendingAttack); bad.temporaryModifiers = s.temporaryModifiers; assert.equal(validateState(bad,context).ok,false); return; }
    assert.equal(validateState(s,context).ok,false);
});
for (const defect of ["source","subject","controller","effect","drop-binding","extra-binding","condition-down","target-choice"] as const) test("external ATTACK continuation rejects "+defect, () => {
    const s = GameStateSchema.parse(trace.pendingAttack), c = s.resolution.triggerContinuation!, b = c.bindings.find(b=>b.sourceId===host)!, e = s.resolution.pending.find(e=>e.sourceId===host)!;
    if (defect === "source") b.sourceId = trace.fieldLegend;
    if (defect === "subject") b.subjectId = trace.fieldLegend;
    if (defect === "controller") b.controllerId = rival;
    if (defect === "effect") e.effect = {kind:"DRAW",count:1};
    if (defect === "drop-binding") c.bindings = c.bindings.filter(b=>b.sourceId!==host);
    if (defect === "extra-binding") c.bindings.push(structuredClone(b));
    if (defect === "condition-down") s.objects.cards[card(base,SABURO).id].face = "DOWN";
    if (defect === "target-choice") c.phase = "TARGET";
    assert.equal(validateState(s,context).ok,false);
});
test("modifier/face changes affect canonical and observation hashes; transport counters do not affect IDs", () => {
    assert.notEqual(hashPosition(trace.beforeAttack),hashPosition(trace.afterAttack)); assert.notEqual(hashReplayState(trace.beforeAttack),hashReplayState(trace.afterAttack));
    for(const viewer of [actor,rival]) { const a=unwrap(observe(trace.beforeAttack,viewer,context)),b=unwrap(observe(trace.afterAttack,viewer,context)); assert.notEqual(hashObservation(a),hashObservation(b)); assert.deepEqual(b.temporaryModifiers,trace.afterAttack.temporaryModifiers); }
    const s=GameStateSchema.parse(base); s.match.version=GameStateVersionSchema.parse(s.match.version+90); s.match.eventSequence=GameEventSequenceSchema.parse(s.match.eventSequence+90); assert.deepEqual(actions(s,context).map(a=>a.actionId),actions(base,context).map(a=>a.actionId)); assert.equal(hashPosition(s),hashPosition(base));
});
test("rival hidden Legend identities do not leak into own action IDs or observations",()=>{
    const s=GameStateSchema.parse(base),ids=s.players[rival].zones.LEGENDS,[a,b]=ids;[s.objects.cards[a].cardId,s.objects.cards[b].cardId]=[s.objects.cards[b].cardId,s.objects.cards[a].cardId];assert.ok(validateState(s,context).ok);assert.deepEqual(unwrap(observe(s,actor,context)),unwrap(observe(base,actor,context)));assert.deepEqual(actions(s,context),actions(base,context));
});
test("pending power survives wire/JSON/training with no automatic application decision",()=>{
    const position=unwrap(generatePosition(trace.pendingAttack,actor,context,"attack-power-contract")); assert.ok(position.legalActions.length>1); assert.equal(position.observation.choice?.kind,"ORDER"); assert.equal(trace.positions.some(p=>p.state.resolution.current?.effect.kind==="POWER_UNTIL_END_OF_TURN"&&p.state.resolution.current.effect.target.kind==="SOURCE_SUBJECT"),false);
    const state=JSON.parse(JSON.stringify(trace.afterAttack)) as unknown;assert.ok(validateState(state,context).ok);
    assert.ok(handleRequest({schemaVersion:1,requestId:"power",op:"validateState",content:context.content,state,actorId:actor}).ok);
});
test("previous52 immutable revisions and constructed40–50/3 Legends policies are unchanged",()=>{
    const old=spendContext(); assert.equal(old.content.cards.length,52);assert.equal(context.content.cards.length,53);for(const r of old.content.cards)assert.equal(canonicalSerialize(context.content.cards.find(x=>x.id===r.id&&x.revision===r.revision)),canonicalSerialize(r));assert.deepEqual(context.content.ruleset.formats,old.content.ruleset.formats);
    for(const size of [27,39,51]) { const input=attackPowerInput("size");input.decks[0].main=Array.from({length:size},(_,i)=>input.decks[0].main[i%42]);assert.equal(createGameWithEvents(input,context).ok,false); }
});
test("legal headline exactly regenerates declared power, real field Legend, steal and expiry",()=>{
    const golden=JSON.parse(readFileSync(new URL("./fixtures/attack-condition-power-replay.v1.json",import.meta.url),"utf8")) as unknown;assert.deepEqual(golden,trace);assert.equal(trace.finalState.timing.turn,10);assert.equal(trace.steps.length,55);assert.equal(trace.positions.length,53);assert.equal(trace.steps.filter(s=>s.action.action.kind==="CALL_LEGEND").length,3);assert.ok(trace.steps.some(s=>s.action.action.kind==="GO_SOLO"));
    const e=trace.steps.flatMap(s=>s.events.map(e=>e.payload));assert.ok(e.some(e=>e.kind==="POWER_MODIFIER_APPLIED"));assert.ok(e.findIndex(e=>e.kind==="ATTACK_ENDED")<e.findIndex(e=>e.kind==="POWER_MODIFIER_EXPIRED"));
});

test("a resolved+5 is not a continuous all-face-up aura; later failure prevents only the next occurrence",()=>{
    const s=readyAgain(face(trace.afterAttack,card(base,SABURO).id,false),host,context),a=attack(s);assert.equal(a.state.temporaryModifiers?.length,1);assert.equal(power(a.state),11);assert.equal(a.events.some(e=>e.payload.kind==="POWER_MODIFIER_APPLIED"),false);
});
test("a new own turn can create a fresh+5 after the previous occurrence expired",()=>{
    const s=leave(bare(base,host,context),card(base,SABURO).id,"REMOVED").state,a=attack(s),done=finishAttack(a.state,context),next=end(done.state,context).state;
    const rivalMain=take(next,context,a=>a.action.kind==="ROLL_GIG").state,own=end(rivalMain,context).state,main=take(own,context,a=>a.action.kind==="ROLL_GIG").state;
    assert.equal(main.temporaryModifiers,undefined);assert.equal(power(main),4);const fresh=attack(main);assert.equal(fresh.state.temporaryModifiers?.length,1);assert.equal(power(fresh.state),9);assert.equal(fresh.state.temporaryModifiers![0].expires.turn,11);
});
test("public Legend face changes reject stale action IDs without changing transport semantics",()=>{
    const old=actions(base,context).find(a=>a.action.kind==="DECLARE_ATTACK"&&a.action.cardInstanceId===host)!;
    const s=face(base,card(base,SABURO).id,false);assert.ok(actions(s,context).some(a=>a.action.kind==="DECLARE_ATTACK"&&a.action.cardInstanceId===host));
    const request={schemaVersion:1,requestId:"stale-face",op:"applyAction",content:context.content,state:s,actorId:actor,actionId:old.actionId};assert.equal(handleRequest(request).ok,false);
    const current=actions(s,context).find(a=>a.action.kind==="DECLARE_ATTACK"&&a.action.cardInstanceId===host)!;assert.notEqual(current.actionId,old.actionId);assert.ok(handleRequest({...request,actionId:current.actionId}).ok);
});
test("Floor It admission remains exact after the shared power primitive expands",()=>{
    const floor=CardRevisionSnapshotSchema.parse(context.content.cards.find(c=>c.id==="floor-it"));const effect=floor.mechanics.abilities[0].effects[0];assert.ok(effect.kind==="POWER_UNTIL_END_OF_TURN");
    for(const change of ["amount","subject"]){const copy=CardRevisionSnapshotSchema.parse(floor),e=copy.mechanics.abilities[0].effects[0];assert.ok(e.kind==="POWER_UNTIL_END_OF_TURN");if(change==="amount")e.amount=5;else e.target.kind="SOURCE_SUBJECT";assert.equal(supportsPlay(copy,context).ok,false);}
});
