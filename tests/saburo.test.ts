import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, type CardInstanceId, type GameState, type PlayerId } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, observe, resolveActionId, RulesView, validateState, type EngineContext } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { saburoContext, saburoInput, saburo, SABURO } from "./saburo-fixture";
import { saburoReplay } from "./saburo-replay";
import { yorinobuContext, YORINOBU, TRUSTED_ARASAKA } from "./yorinobu-fixture";
import { GORO } from "./goro-fixture";
import { triggersContext } from "./combat-triggers-fixture";
import { satoriReplay } from "./combat-triggers-replay";
import { actions, take, choose, end, finishChoices } from "./delayed-effects-focused";
import { bare, addGear, declare, finishAttack, readyAgain } from "./yorinobu-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, processDeparture, moveLegendToFieldWithAttachments } from "../packages/engine/src/card-movement";
import { supportsAttackingAuraLegend } from "../packages/engine/src/attacking-aura-support";
import { applicablePowerModifiers, effectivePower } from "../packages/engine/src/characteristics";
import { finishAttackEffects } from "../packages/engine/src/combat";
import { unwrap } from "./turn-replay";
import source from "./fixtures/saburo-card-source.v1.json";
import rules from "./fixtures/saburo-rules.v1.json";
const context = saburoContext(), replay = saburoReplay(), { actor, rival, host, legend, yorinobu } = replay;
const before = replay.beforeAttack;
const power = (s: GameState, id = host, ctx: EngineContext = context) => new RulesView(s, ctx).getEffectivePower(id);
const aura = (s: GameState, id = host, ctx: EngineContext = context) => new RulesView(s, ctx).getApplicableCharacteristicModifiers(id).filter(m => m.kind === "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER");
const start = (s = before, id = host) => declare(s, id, context);
const hidden = (s = before, id = legend) => { const d = GameStateSchema.parse(s); d.objects.cards[id].face = "DOWN"; return unwrap(validateState(d, context)); };
/** Trusted focused arrangements only. Reuse immutable pinned revisions; never change a real revision or headline state. */
function place(s: GameState, cardId: string, player: PlayerId = actor, zone: "HAND" | "BATTLEFIELD" = "BATTLEFIELD") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(r => r.id === cardId)!;
    const c = Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.zone.zone === "DECK" && c.cardId === cardId)
        ?? Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.zone.zone === "DECK" && c.cardId.startsWith("slice-card-"))!;
    assert.ok(c && r); c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, zone); c.readiness = "READY"; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
function rivalGoro(s = before, equipped = false) {
    const m = new TurnMutation(s, context), id = m.state.players[rival].zones.LEGENDS.find(id => m.state.objects.cards[id].cardId === GORO)!;
    m.state.objects.cards[id].face = "UP"; unwrap(moveLegendToFieldWithAttachments(m, id, "GO_SOLO")); m.state.objects.cards[id].readiness = "SPENT";
    const state = unwrap(validateState(m.state, context)); return { state: equipped ? addGear(state, id, "mantis-blades", context).state : state, id };
}

test("Saburo complete six-printing source, all errata, exact metadata and official Fight/Steal FAQ are pinned", () => {
    assert.equal(saburo.rulesText, "Friendly ARASAKA Units have +1 power while attacking.\n(Units steal an extra Gig for every 10 power.)");
    assert.equal(saburo.provenance.sourceHash, hashCanonical(source.record)); assert.equal(source.errata.length, 4); assert.deepEqual(saburo.provenance.errata, []);
    assert.equal(source.record.id, "cf50fa24-bf94-4c35-bcc1-c6d56a6f68d8"); assert.equal(saburo.printings.length, 6);
    assert.ok(saburo.printings.some(p => p.id === "13ba5cd2-5000-4cf8-bcfc-6f1b8afe44ca" && p.collectorNumber === "009"));
    assert.deepEqual(saburo.ram, { GREEN: 2 }); assert.deepEqual(saburo.colors, ["GREEN"]); assert.equal(saburo.power, undefined); assert.deepEqual(saburo.printedCost, { kind: "DASH" });
    assert.deepEqual(saburo.tags, ["Arasaka", "Corpo"]); assert.equal(saburo.sellProfile.allowed, true); assert.deepEqual(saburo.mechanics.abilities, []); assert.deepEqual(saburo.mechanics.keywords, []);
    assert.ok(supportsAttackingAuraLegend(saburo, context).ok);
    assert.ok(rules.faqs.some(f => f.id === "18318e94-6979-4623-9cf5-fee73924d728" && f.answer === "Yes."));
    for (const id of ["1.7.2", "3.4.1", "3.5", "3.6", "3.13.1", "4.2.1", "4.4", "5.7.2", "9.3", "9.4", "9.5", "9.17", "9.23.1", "9.29", "10.22.1", "10.22.2", "10.22.3", "10.23"]) assert.ok(rules.rules.some(r => r.id === id), id);
});
test("legal headline CALLs all three actual Legends, pre-equips Mantis, and Go Solos real Goro", () => {
    assert.equal(replay.calledLegend.objects.cards[legend].face, "UP"); assert.equal(replay.preEquipped.objects.cards[host].zone.zone, "LEGENDS");
    assert.equal(replay.preEquipped.objects.cards[host].attachments.length, 1); assert.equal(new RulesView(replay.preEquipped, context).getEffectiveCardTypes(host).includes("UNIT"), false);
    assert.equal(power(replay.preEquipped), 9); assert.deepEqual(aura(replay.preEquipped), []);
    assert.deepEqual(new RulesView(before, context).getEffectiveCardTypes(host), ["LEGEND", "UNIT"]); assert.ok(new RulesView(before, context).hasClassification(host, "Arasaka"));
    assert.equal(before.objects.cards[host].cardId, GORO); assert.equal(before.objects.cards[yorinobu].face, "UP");
    for (const id of [legend, host, yorinobu]) assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "LEGEND_CALLED" && e.payload.cardInstanceId === id)));
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "GO_SOLO_ACTIVATED" && e.payload.cardInstanceId === host)));
});
test("actual Go Solo payment spends face-up Saburo without disabling continuous text", () => {
    assert.equal(replay.beforeGoSolo.objects.cards[legend].readiness, "READY"); assert.equal(before.objects.cards[legend].readiness, "SPENT"); assert.equal(before.objects.cards[legend].face, "UP");
    const pay = replay.steps.filter(s => s.events.some(e => e.payload.kind === "PAYMENT_MADE"));
    assert.ok(pay.some(s => s.events.some(e => e.payload.kind === "PAYMENT_MADE" && e.payload.sources.some(p => p.cardInstanceId === legend))));
    assert.equal(power(replay.beforeReact), 10); assert.equal(aura(replay.beforeReact)[0].sourceId, legend);
    const ready = GameStateSchema.parse(replay.beforeReact); ready.objects.cards[legend].readiness = "READY"; assert.equal(power(ready), 10);
});
test("Null Saburo has no ordinary play, Go Solo, attack, Blocker or self power", () => {
    const view = new RulesView(before, context); assert.equal(view.getEffectivePower(legend), null); assert.deepEqual(view.getKeywords(legend), []);
    assert.equal(view.isAttackEligible(actor, legend), false); assert.equal(view.isBlockerEligible(actor, legend), false);
    assert.equal(actions(before, context).some(a => ["GO_SOLO", "PLAY_CARD", "DECLARE_ATTACK", "DECLARE_BLOCKER"].includes(a.action.kind) && "cardInstanceId" in a.action && a.action.cardInstanceId === legend), false);
    assert.equal(moveLegendToFieldWithAttachments(new TurnMutation(before, context), legend, "GO_SOLO").ok, false);
    assert.deepEqual(aura(before, legend), []);
});
test("source-aware power query is pure and includes exactly one live contribution", () => {
    const s = replay.beforeReact, hash = hashReplayState(s), mods = new RulesView(s, context).getApplicableCharacteristicModifiers(host);
    assert.deepEqual(aura(s), [{ sourceId: legend, subjectId: host, kind: "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount: 1 }]);
    assert.equal(mods.filter(m => m.kind === "GRANT_PRINTED_POWER_TO_HOST").length, 1);
    for (let i = 0; i < 3; i++) { assert.equal(power(s), 10); assert.deepEqual(new RulesView(s, context).getApplicableCharacteristicModifiers(host), mods); }
    assert.equal(hashReplayState(s), hash); assert.deepEqual(s.temporaryModifiers, before.temporaryModifiers);
});
test("target choice is pre-declaration, so it neither spends nor applies aura", () => {
    const t = rivalGoro(), result = take(t.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host), s = result.state;
    assert.equal(s.timing.step, "ATTACK_TARGET_SELECTION"); assert.equal(new RulesView(s, context).isAttacking(host), false); assert.equal(power(s), 9); assert.deepEqual(aura(s), []);
    assert.equal(s.objects.cards[host].readiness, "READY"); assert.equal(result.events.some(e => e.payload.kind === "ATTACK_DECLARED"), false);
    const i = s.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD"), locked = choose(s, context, i);
    assert.equal(power(locked.state), 10); assert.equal(new RulesView(locked.state, context).isAttacking(host), true); assert.equal(locked.state.objects.cards[host].readiness, "SPENT");
    assert.deepEqual(locked.events.filter(e => ["ATTACKER_SPENT", "ATTACK_DECLARED"].includes(e.payload.kind)).map(e => e.payload.kind), ["ATTACKER_SPENT", "ATTACK_DECLARED"]);
});
for (const [name, s] of [["ATTACK effects", replay.pendingAttack], ["React", replay.beforeReact], ["Steal selection", replay.pendingSteal], ["second Steal selection", replay.selectedFirst]] as const) test("aura remains live through " + name, () => {
    assert.equal(power(s), 10); assert.equal(new RulesView(s, context).isAttacking(host), true); assert.equal(aura(s).length, 1);
});
test("face-down Saburo gives nothing and revealing a trusted source during React starts live contribution", () => {
    const result = finishChoices(start(hidden()).state, context); assert.equal(power(result.state), 9); assert.deepEqual(aura(result.state), []);
    const s = GameStateSchema.parse(result.state); s.objects.cards[legend].face = "UP";
    assert.equal(power(unwrap(validateState(s, context))), 10); assert.equal(aura(s).length, 1); assert.deepEqual(s.temporaryModifiers, result.state.temporaryModifiers);
});
test("trusted source invalidation/removal during React drops power immediately without stored cleanup", () => {
    assert.equal(power(hidden(replay.beforeReact)), 9);
    const m = new TurnMutation(replay.beforeReact, context); moveCardLocation(m, legend, "REMOVED");
    const s = unwrap(validateState(m.state, context)); assert.equal(power(s), 9); assert.deepEqual(aura(s), []);
    const done = finishAttack(s, context); assert.ok(done.events.some(e => e.payload.kind === "GIG_STEAL_STARTED" && e.payload.power === 9 && e.payload.allowance === 1));
});
test("actual steal crosses real Goro7 + Mantis2 threshold from one Gig to two", () => {
    const yes = finishAttack(start().state, context), no = finishAttack(start(hidden()).state, context);
    assert.ok(yes.events.some(e => e.payload.kind === "GIG_STEAL_STARTED" && e.payload.power === 10 && e.payload.allowance === 2 && e.payload.count === 2));
    assert.ok(no.events.some(e => e.payload.kind === "GIG_STEAL_STARTED" && e.payload.power === 9 && e.payload.allowance === 1 && e.payload.count === 1));
    assert.equal(yes.events.filter(e => e.payload.kind === "GIG_STOLEN").length, 2); assert.equal(no.events.filter(e => e.payload.kind === "GIG_STOLEN").length, 1);
    assert.equal(replay.pendingSteal.resolution.gigStealContinuation!.remaining, 2); assert.equal(replay.selectedFirst.resolution.gigStealContinuation!.remaining, 1);
    assert.equal(replay.selectedFirst.resolution.gigStealContinuation!.selected.length, 1);
});
test("cleanup naturally removes aura; no application/expiry event or persistent target list exists", () => {
    const s = replay.finalState; assert.equal(s.timing.combat.stage, "NONE"); assert.equal(s.timing.step, "MAIN"); assert.equal(power(s), 9); assert.equal(new RulesView(s, context).isAttacking(host), false); assert.deepEqual(aura(s), []);
    const events = replay.steps.flatMap(s => s.events); assert.ok(events.some(e => e.payload.kind === "ATTACK_ENDED"));
    assert.equal(events.some(e => e.payload.kind === "POWER_MODIFIER_APPLIED"), false); assert.equal(events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === legend), false);
    assert.equal(JSON.stringify(s).includes("FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER"), false);
});
test("bare Goro's real printed seven becomes eight only while attacking", () => { const s = bare(before, host, context); assert.equal(power(s), 7); assert.equal(power(start(s).state), 8); });
for (const card of ["psycho-squad", "emergency-atlus"]) test("real non-Arasaka " + card + " gets no bonus despite sharing the friendly board", () => {
    const unit = place(before, card), s = start(unit.state, unit.id).state, view = new RulesView(s, context);
    assert.equal(view.hasClassification(unit.id, "Arasaka"), false); assert.equal(view.isAttacking(unit.id), true); assert.deepEqual(aura(s, unit.id), []); assert.equal(power(s, unit.id), view.getRevision(unit.id)!.power);
    assert.equal(power(s), 9);
});
test("printed effective Unit with the exact immutable Arasaka tag qualifies; spelling aliases do not", () => {
    const unit = place(before, TRUSTED_ARASAKA), s = start(unit.state, unit.id).state, view = new RulesView(s, context);
    assert.equal(view.getRevision(unit.id)!.type, "UNIT"); assert.equal(power(s, unit.id), 7); assert.equal(view.hasClassification(unit.id, "ARASAKA"), false); assert.equal(view.hasClassification(unit.id, "arasaka"), false);
});
test("Royce retains its existing own-turn Gear derivation without any Saburo contribution", () => {
    const m = new TurnMutation(before, context), royce = context.content.cards.find(c => c.id === "royce-psycho-on-the-edge")!;
    assert.ok(royce); m.state.objects.cards[yorinobu].cardId = royce.id; m.state.objects.cards[yorinobu].revision = royce.revision;
    const s = addGear(unwrap(validateState(m.state, context)), yorinobu, "satori-sword-of-saburo", context).state, view = new RulesView(s, context);
    assert.equal(view.hasClassification(yorinobu, "Arasaka"), false); assert.deepEqual(aura(s, yorinobu), []); assert.equal(view.getApplicableCharacteristicModifiers(yorinobu).filter(m => m.kind === "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN")[0].amount, 2);
});
test("controller relationship, not target ownership, selects the friendly Saburo in the pure query", () => {
    // Control-transfer actions are unadmitted; this is a trusted query-only separation of owner/controller inputs.
    const s = GameStateSchema.parse(replay.beforeReact); s.objects.cards[host].ownerId = rival;
    assert.equal(effectivePower(s, host, context), 10); assert.equal(applicablePowerModifiers(s, host, context).find(m => m.kind === "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER")!.sourceId, legend);
});
for (const ownSource of [false, true]) test("rival Goro receives only rival's own source, eligible=" + ownSource, () => {
    const next = take(end(before, context).state, context, a => a.action.kind === "ROLL_GIG").state, m = new TurnMutation(next, context);
    const enemy = m.state.players[rival].zones.LEGENDS.find(id => m.state.objects.cards[id].cardId === GORO)!, source = m.state.players[rival].zones.LEGENDS.find(id => m.state.objects.cards[id].cardId === SABURO)!;
    m.state.objects.cards[enemy].face = "UP"; m.state.objects.cards[source].face = ownSource ? "UP" : "DOWN"; unwrap(moveLegendToFieldWithAttachments(m, enemy, "GO_SOLO"));
    const s = start(unwrap(validateState(m.state, context)), enemy).state;
    assert.equal(power(s, enemy), ownSource ? 8 : 7); assert.deepEqual(aura(s, enemy).map(m => m.sourceId), ownSource ? [source] : []); assert.deepEqual(aura(s), []);
});
test("rival Blocker changes target but never the attacking source or aura, and is not itself attacking", () => {
    const t = rivalGoro(), s = GameStateSchema.parse(t.state), otherSaburo = s.players[rival].zones.LEGENDS.find(id => s.objects.cards[id].cardId === SABURO)!;
    s.objects.cards[t.id].readiness = "READY"; s.objects.cards[otherSaburo].face = "UP";
    const react = finishChoices(start(unwrap(validateState(s, context))).state, context).state;
    const blocked = take(react, context, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === t.id).state;
    assert.equal(power(blocked), 10); assert.equal(power(blocked, t.id), 7); assert.deepEqual(aura(blocked, t.id), []); assert.equal(new RulesView(blocked, context).isAttacking(t.id), false);
    assert.equal(new RulesView(blocked, context).getFightDefender()!.id, t.id);
    assert.ok(finishAttack(blocked, context).events.some(e => e.payload.kind === "FIGHT_RESULT" && e.payload.attackerPower === 10 && e.payload.defenderPower === 7));
});
for (const enabled of [false, true]) test("actual Goro+Satori Fight is " + (enabled ? "10 vs9 win with truthful Satori draw" : "9 vs9 tie without Satori win draw"), () => {
    const own = addGear(bare(enabled ? before : hidden(), host, context), host, "satori-sword-of-saburo", context), t = rivalGoro(own.state, true);
    const declared = declare(t.state, host, context, t.id), react = finishChoices(declared.state, context), done = finishAttack(react.state, context), result = done.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload;
    assert.ok(result.kind === "FIGHT_RESULT"); assert.equal(result.attackerPower, enabled ? 10 : 9); assert.equal(result.defenderPower, 9);
    assert.equal(done.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === own.gear), enabled);
    assert.equal(done.state.objects.cards[host].zone.zone, enabled ? "BATTLEFIELD" : "REMOVED"); assert.equal(done.state.objects.cards[t.id].zone.zone, "REMOVED");
    if (enabled) { assert.equal(power(done.state), 9); const p = done.events.map(e => e.payload); assert.ok(p.findIndex(e => e.kind === "FIGHT_RESULT") < p.findIndex(e => e.kind === "EFFECT_PENDING" && e.sourceId === own.gear)); assert.ok(p.some(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK" && e.to.zone === "HAND")); }
});
test("Floor It React composes live as 7+2+1-1=9 and actual Steal uses the reduced allowance", () => {
    const card = place(before, "floor-it", rival, "HAND"), m = new TurnMutation(card.state, context);
    for (const id of m.state.players[rival].zones.LEGENDS) m.state.objects.cards[id].readiness = "READY";
    const pending = start(unwrap(validateState(m.state, context))).state;
    assert.equal(applyAction(pending, { actorId: rival, action: { kind: "PLAY_CARD", cardInstanceId: card.id } }, context).ok, false);
    const react = finishChoices(pending, context).state; assert.equal(power(react), 10);
    const played = take(react, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === card.id), settled = finishChoices(played.state, context).state;
    assert.equal(settled.timing.step, "RIVAL_REACT"); assert.equal(power(settled), 9); assert.equal(aura(settled).length, 1); assert.equal(settled.temporaryModifiers!.length, 1);
    const done = finishAttack(settled, context); assert.ok(done.events.some(e => e.payload.kind === "GIG_STEAL_STARTED" && e.payload.power === 9 && e.payload.allowance === 1));
    assert.equal(power(done.state), 8); assert.equal(done.state.temporaryModifiers!.length, 1); assert.deepEqual(aura(done.state), []);
});
test("Yorinobu first history and Saburo every-attack aura remain independent on a second same-turn attack", () => {
    const first = start(); assert.equal(power(first.state), 10); assert.equal(first.state.turnHistory!.firstArasakaAttacks![actor].count, 1);
    assert.ok(first.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === yorinobu));
    const ended = finishAttack(first.state, context).state, second = start(readyAgain(ended, host, context));
    assert.equal(second.state.turnHistory!.firstArasakaAttacks![actor].count, 2); assert.equal(power(second.state), 10);
    assert.equal(second.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === yorinobu), false); assert.equal(second.state.resolution.current, null);
    const cleaned = finishAttack(second.state, context).state; assert.equal(power(cleaned), 9);
    const next = end(cleaned, context).state; assert.equal(next.turnHistory!.firstArasakaAttacks![actor].count, 0); assert.deepEqual(aura(next), []);
});
test("target invalidation ends attack early and aura vanishes without an expiration mutation", () => {
    const t = rivalGoro(), react = finishChoices(declare(t.state, host, context, t.id).state, context).state, m = new TurnMutation(react, context);
    unwrap(processDeparture(m, t.id, "REMOVED")); unwrap(finishAttackEffects(m)); const done = unwrap(m.result());
    assert.ok(done.events.some(e => e.payload.kind === "ATTACK_ENDED" && e.payload.reason === "TARGET_INVALID")); assert.equal(power(done.state), 9); assert.deepEqual(aura(done.state), []);
});
test("departed attacker cannot keep a live aura before trusted attack invalidation cleanup", () => {
    const s = bare(replay.beforeReact, host, context), m = new TurnMutation(s, context); unwrap(processDeparture(m, host, "REMOVED"));
    assert.equal(applicablePowerModifiers(m.state, host, context).some(m => m.kind === "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER"), false);
    unwrap(finishAttackEffects(m)); const done = unwrap(m.result()); assert.ok(done.events.some(e => e.payload.kind === "ATTACK_ENDED" && e.payload.reason === "ATTACKER_INVALID")); assert.deepEqual(aura(done.state), []);
});
test("both observations expose live public power through attack and cleanup without internal source lists", () => {
    for (const [s, expected] of [[before, 9], [replay.pendingAttack, 10], [replay.beforeReact, 10], [replay.pendingSteal, 10], [replay.finalState, 9]] as const)
        for (const player of [actor, rival]) { const obs = unwrap(observe(s, player, context)), goro = obs.players.flatMap(p => p.cards).find(c => c.content?.cardId === GORO && c.zone === "BATTLEFIELD")!; assert.ok(goro); assert.equal(goro.effectivePower, expected); assert.equal(JSON.stringify(obs).includes("FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER"), false); }
});
test("position hashes distinguish attack/source availability while transport counters leave action IDs unchanged", () => {
    assert.notEqual(hashPosition(before), hashPosition(replay.beforeReact)); assert.notEqual(hashPosition(hidden(replay.beforeReact)), hashPosition(replay.beforeReact));
    const s = GameStateSchema.parse(replay.pendingSteal); s.match.version = GameStateVersionSchema.parse(999); s.match.eventSequence = GameEventSequenceSchema.parse(999);
    assert.equal(hashPosition(s), hashPosition(replay.pendingSteal)); assert.notEqual(hashReplayState(s), hashReplayState(replay.pendingSteal)); assert.deepEqual(actions(s, context), actions(replay.pendingSteal, context));
});
test("strategic existing choices serialize through training and wire; aura does not add a decision", () => {
    for (const s of [replay.pendingAttack, replay.beforeReact, replay.pendingSteal, replay.selectedFirst]) {
        const legal = actions(s, context), p = unwrap(generatePosition(s, s.timing.actingPlayer, context, "saburo-wire")); assert.ok(validateTrainingPosition(p, context).ok);
        assert.equal(JSON.stringify(modelInput(p)).includes(s.rng.seed), false); assert.deepEqual(Object.keys(modelInput(p)).sort(), ["legalActions", "observation"]);
        unwrap(resolveActionId(s, s.timing.actingPlayer, legal[0].actionId, context));
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: context.content, state: s, actorId: s.timing.actingPlayer, actionId: legal[0].actionId }); assert.ok(response.ok && response.value.kind === "transition");
        assert.deepEqual(response.value.state, unwrap(applyAction(s, { actorId: legal[0].actorId, action: legal[0].action }, context)).state);
    }
    assert.equal(replay.positions.length, replay.steps.filter(s => s.legalActions.length > 1).length);
});
for (const change of ["missing-policy", "missing-combat", "wrong-scope", "wrong-status", "extra-ability", "extra-keyword", "raw-keyword", "extra-modifier", "restriction", "equip", "wrong-cost", "wrong-power", "wrong-ram", "missing-ram", "wrong-tags", "wrong-color", "unsellable", "missing-modifier", "unreviewed"] as const) test("full-shape aura admission rejects " + change, () => {
    const card = CardRevisionSnapshotSchema.parse(saburo), ruleset = structuredClone(context.content.ruleset);
    if (change === "missing-policy") delete ruleset.gameplay!.turnSlice!.attackingAura;
    if (change === "missing-combat") delete ruleset.gameplay!.turnSlice!.combatResolution;
    if (change === "wrong-scope") card.execution!.scope = "FIRST_ATTACK_HISTORY_V1";
    if (change === "wrong-status") card.execution!.status = "UNSUPPORTED";
    if (change === "extra-ability") card.mechanics.abilities.push({ id: "extra", trigger: "WHEN_CALLED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] });
    if (change === "extra-keyword") card.mechanics.keywords.push("GO_SOLO");
    if (change === "raw-keyword") card.keywords.push("GO_SOLO");
    if (change === "extra-modifier") card.mechanics.modifiers.push({ kind: "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN", amount: 2 });
    if (change === "restriction") card.mechanics.restrictions = [{ kind: "CANNOT_ATTACK" }];
    if (change === "equip") card.mechanics.equip = { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" };
    if (change === "wrong-cost") card.printedCost = { kind: "EDDIES", amount: 0 };
    if (change === "wrong-power") card.power = 0;
    if (change === "wrong-ram") card.ram = { GREEN: 3 };
    if (change === "missing-ram") delete card.ram;
    if (change === "wrong-tags") card.tags = ["ARASAKA", "Corpo"];
    if (change === "wrong-color") card.colors = ["RED"];
    if (change === "unsellable") card.sellProfile.allowed = false;
    if (change === "missing-modifier") card.mechanics.modifiers = [];
    if (change === "unreviewed") { card.provenance.reviewed = false; assert.equal(supportsAttackingAuraLegend(card, context).ok, false); return; }
    const ctx = { content: createContentBundle(ruleset, context.content.cards.map(c => c.id === SABURO ? card : c), context.content.manifest.engine) };
    assert.equal(supportsAttackingAuraLegend(card, ctx).ok, false); assert.equal(createGameWithEvents(saburoInput("reject"), ctx).ok, false);
    const s = GameStateSchema.parse(before); s.match.contentManifestHash = ctx.content.manifestHash; s.match.rulesetHash = ctx.content.manifest.ruleset.hash;
    const original = JSON.stringify(s); assert.equal(validateState(s, ctx).ok, false); assert.equal(JSON.stringify(s), original);
});
test("continuous modifier schema is narrow: no arbitrary amount, predicate or extra effect fields", () => {
    for (const modifier of [{ kind: "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount: 2 }, { kind: "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount: 1, classification: "Merc" }])
        assert.equal(CardRevisionSnapshotSchema.safeParse({ ...saburo, mechanics: { ...saburo.mechanics, modifiers: [modifier] } }).success, false);
});
for (const defect of ["duplicate", "field", "hand", "control"] as const) test("unsupported physical source " + defect + " is rejected, not silently omitted", () => {
    const m = new TurnMutation(before, context);
    if (defect === "duplicate") { m.state.objects.cards[yorinobu].cardId = saburo.id; m.state.objects.cards[yorinobu].revision = saburo.revision; }
    if (defect === "field") moveCardLocation(m, legend, "BATTLEFIELD");
    if (defect === "hand") moveCardLocation(m, legend, "HAND");
    if (defect === "control") m.state.objects.cards[legend].controllerId = rival;
    const original = JSON.stringify(m.state); assert.equal(validateState(m.state, context).ok, false); assert.equal(JSON.stringify(m.state), original);
});
test("older scope rejects even hidden continuous source and all 46 previous revisions remain immutable", () => {
    const old = yorinobuContext(); assert.equal(supportsAttackingAuraLegend(saburo, old).ok, false); assert.equal(old.content.cards.length, 46); assert.equal(context.content.cards.length, 47);
    for (const c of old.content.cards) assert.deepEqual(context.content.cards.find(r => r.id === c.id && r.revision === c.revision), c);
    const ruleset = structuredClone(context.content.ruleset); delete ruleset.gameplay!.turnSlice!.attackingAura;
    const ctx = { content: createContentBundle(ruleset, context.content.cards, context.content.manifest.engine) }; assert.equal(createGameWithEvents(saburoInput("old"), ctx).ok, false);
});
test("constructed 40–50 main, exact three unique Legends, RAM and copy limits stay strict", () => {
    const input = saburoInput("format"); assert.ok(input.decks.every(d => d.main.length === 42 && d.legends.length === 3)); assert.ok(createGameWithEvents(input, context).ok);
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 });
    for (const deck of [{ ...input.decks[0], main: input.decks[0].main.slice(0, 27) }, { ...input.decks[0], main: [...input.decks[0].main, "mantis-blades"] }, { ...input.decks[0], legends: [SABURO, SABURO, YORINOBU] }, { ...input.decks[0], legends: [SABURO, YORINOBU] }, { ...input.decks[0], main: ["psycho-squad", ...input.decks[0].main.slice(1)] }]) assert.equal(createGameWithEvents({ ...input, decks: [deck, input.decks[1]] }, context).ok, false);
});
test("Saburo replay golden is exact and every recorded training position is a genuine strategic choice", () => {
    assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/saburo-replay.v1.json", import.meta.url), "utf8")), replay);
    assert.ok(replay.positions.every(p => p.legalActions.length > 1)); assert.ok(replay.positions.some(p => p.observation.step === "GIG_STEAL_SELECTION"));
});
/** Independent aura policy: no Yorinobu/history, Goro, or later hidden-information card scopes. */
function independentAura() {
    const base = triggersContext(), ruleset = structuredClone(base.content.ruleset); ruleset.gameplay!.turnSlice!.attackingAura = "ATTACKING_AURA_V1";
    const unit = context.content.cards.find(c => c.id === TRUSTED_ARASAKA)!;
    const ctx: EngineContext = { content: createContentBundle(ruleset, [...base.content.cards, saburo, unit], base.content.manifest.engine) }, s = GameStateSchema.parse(satoriReplay().finalState);
    s.match.contentManifestHash = ctx.content.manifestHash; s.match.rulesetHash = ctx.content.manifest.ruleset.hash; s.match.cards = ctx.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    const player = s.timing.activePlayer, source = s.players[player].zones.LEGENDS.find(id => s.objects.cards[id].cardId === "dev-legend-red")!;
    s.objects.cards[source].cardId = saburo.id; s.objects.cards[source].revision = saburo.revision; s.objects.cards[source].face = "UP";
    const attacker: CardInstanceId = s.players[player].zones.BATTLEFIELD.find(id => s.objects.cards[id].cardId === "swordwise-huscle")!;
    assert.ok(attacker); s.objects.cards[attacker].readiness = "READY"; s.objects.cards[attacker].cardId = unit.id; s.objects.cards[attacker].revision = unit.revision;
    return { context: ctx, state: unwrap(validateState(s, ctx)), source, attacker, player };
}
test("aura alone needs no first-attack history, trigger or pending work and preserves action privacy", () => {
    const f = independentAura(), declared = declare(f.state, f.attacker, f.context), s = declared.state;
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.turnHistory?.firstArasakaAttacks, undefined); assert.equal(s.resolution.current, null); assert.deepEqual(s.resolution.pending, []);
    assert.equal(aura(s, f.attacker, f.context)[0].sourceId, f.source); assert.equal(declared.events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
    const changed = GameStateSchema.parse(s), secretOwner = f.player, hand = changed.players[secretOwner].zones.HAND[0], deck = changed.players[secretOwner].zones.DECK.find(id => changed.objects.cards[id].cardId !== changed.objects.cards[hand].cardId)!;
    [changed.objects.cards[hand].cardId, changed.objects.cards[deck].cardId] = [changed.objects.cards[deck].cardId, changed.objects.cards[hand].cardId];
    [changed.objects.cards[hand].revision, changed.objects.cards[deck].revision] = [changed.objects.cards[deck].revision, changed.objects.cards[hand].revision];
    unwrap(validateState(changed, f.context)); assert.notEqual(hashPosition(changed), hashPosition(s)); assert.deepEqual(actions(changed, f.context), actions(s, f.context));
    assert.equal(hashObservation(unwrap(observe(changed, s.timing.actingPlayer, f.context))), hashObservation(unwrap(observe(s, s.timing.actingPlayer, f.context))));
});
