import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, MatchIdSchema, createContentBundle, hashCanonical, type GameState } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, validateState, observe, hashObservation, hashPosition, hashReplayState, resolveActionId, RulesView } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { targetedContext, targetedInput, targetedCards, MINOTAUR, OVER_THE_EDGE } from "./targeted-defeat-fixture";
import { minotaurReplay, overTheEdgeReplay } from "./targeted-defeat-replay";
import { valueContext } from "./value-conditions-fixture";
import { withGigs, placeCard, playCard, pick } from "./value-conditions-focused";
import { clearField, fund, field, equip, reduced, payOnly, finishOrder } from "./targeted-defeat-focused";
import { take, actions, end } from "./delayed-effects-focused";
import { declare } from "./yorinobu-focused";
import { unwrap } from "./turn-replay";
import { DEXTER } from "./combat-triggers-fixture";
import { GORO } from "./goro-fixture";
import { SABURO } from "./saburo-fixture";
import { YORINOBU } from "./yorinobu-fixture";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { TurnMutation } from "../packages/engine/src/turn";
import { transferGigs } from "../packages/engine/src/gig-transfer";
import { moveCardLocation, moveLegendToFieldWithAttachments } from "../packages/engine/src/card-movement";
import sources from "./fixtures/targeted-defeat-card-sources.v1.json";
import rules from "./fixtures/targeted-defeat-rules.v1.json";
const context = targetedContext(), mino = minotaurReplay(), edge = overTheEdgeReplay(), { actor, rival } = mino;
const minCard = targetedCards.find(c => c.id === MINOTAUR)!, edgeCard = targetedCards.find(c => c.id === OVER_THE_EDGE)!;
const minEffect = minCard.mechanics.abilities[0].effects[0], edgeEffect = edgeCard.mechanics.abilities[0].effects[0];
assert.ok(minEffect.kind === "DEFEAT_UNIT" && edgeEffect.kind === "DEFEAT_UNIT");
const minTarget = minEffect.target, edgeTarget = edgeEffect.target;
const base = fund(clearField(mino.beforeSource, context), context);
const targets = (s: GameState, mode: "MINOTAUR" | "OVER_THE_EDGE" = "MINOTAUR") => new RulesView(s, context).listDefeatableUnits(actor, mode === "MINOTAUR" ? minTarget : edgeTarget);
const payloads = (r: ReturnType<typeof playCard>) => r.events.map(e => e.payload);
const draws = (r: ReturnType<typeof playCard>) => payloads(r).filter(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK" && e.to.zone === "HAND");
const defeats = (r: ReturnType<typeof playCard>) => payloads(r).filter(e => e.kind === "CARD_DEFEATED");
const gigId = (s: GameState, name: string) => Object.values(s.objects.gigs).find(g => g.id === name)!.id;
const d20 = (n: number) => ({ "p0-D4": 1, "p0-D6": 1, "p0-D8": 1, "p0-D10": 1, "p0-D12": 1, "p0-D20": n, "p1-D4": 1 });
const withSource = (s: GameState, id: string) => Object.values(s.objects.cards).some(c => c.controllerId === actor && c.cardId === id && c.zone.zone === "HAND") ? s : placeCard(s, context, id).state;
function resolve(s: GameState, id: string, targetId?: string) {
    let result = playCard(withSource(s, id), context, id);
    if (result.state.resolution.targetedDefeatContinuation?.phase === "TARGET") { const next = pick(result.state, context, o => o.kind === "CARD" && (!targetId || o.cardInstanceId === targetId)); result = { state: next.state, events: [...result.events, ...next.events] }; }
    const ordered = finishOrder(result.state, context); return { state: ordered.state, events: [...result.events, ...ordered.events] };
}
test("complete Minotaur/Over the Edge records, eight printings, all errata and exact normalization are pinned", () => {
    assert.equal(minCard.rulesText, "{Play} If you have more ☆ (Street Cred) than a Rival, defeat a rival Unit with power 5 or less.");
    assert.equal(edgeCard.rulesText, "Defeat a Unit with power equal to or less than the value of a friendly d20.");
    assert.equal(minCard.power, 9); assert.deepEqual(minCard.ram, { RED: 2 }); assert.equal(minCard.sellProfile.allowed, false); assert.deepEqual(minCard.tags, ["Arasaka", "Drone", "Militech"]);
    assert.equal(edgeCard.power, undefined); assert.equal(edgeCard.sellProfile.allowed, true); assert.deepEqual(edgeCard.tags, ["Merc"]);
    assert.equal(minCard.printings.length, 3); assert.equal(edgeCard.printings.length, 5); assert.equal(sources.errata.length, 4);
    for (const card of targetedCards) { assert.ok(supportsTargetedDefeatCard(card, context).ok); assert.equal(card.provenance.sourceHash, hashCanonical(sources.records.find(r => r.record.slug === card.id)!.record)); assert.deepEqual(card.provenance.errata, []); }
    assert.ok(edgeCard.printings.some(p => p.collectorNumber === "10")); // Preserve the captured retail starter number, not a guessed zero-padding edit.
});
test("rules/FAQ pin mandatory defeat, own targets, no-D20 play, negative references and post-movement pending timing", () => {
    for (const id of ["2.10.1", "2.10.2", "3.17.2", "4.14.2", "5.9.4.1", "5.10.3", "6.1.2", "6.1.4", "6.3", "9.19.1.1", "10.2.3", "10.2.4", "10.14", "11.19.2"]) assert.ok(rules.rules.some(r => r.id === id), id);
    for (const id of ["a6bfa127-ff5b-4aed-a261-fac2be6a71c5", "1528eec2-100f-4436-9874-d45f3589e9af", "3aec4fa6-6b30-466a-a4a8-7449ce7ab078", "6b61f796-5665-4ae0-bb6a-4b607cb20b28", "00b41165-2bad-41c3-8a4a-be0c6747f4d7"]) assert.ok(rules.faqs.some(f => f.id === id));
});
for (const [own, other, expected] of [[null, null, false], [null, 2, false], [2, null, true], [2, 2, false], [3, 2, true], [1, 2, false]] as const) test(`Minotaur current Street Cred ${own}>${other} is ${expected} through real PLAY`, () => {
    const values = { ...(own === null ? {} : { "p0-D4": own }), ...(other === null ? {} : { "p1-D4": other }) }, arranged = field(withGigs(base, context, values), context, "emergency-atlus", rival), result = resolve(arranged.state, MINOTAUR);
    assert.equal(defeats(result).length, expected ? 1 : 0); assert.ok(payloads(result).some(e => e.kind === "CONDITION_EVALUATED" && e.met === expected));
    assert.equal(result.state.timing.step, "MAIN"); assert.equal(result.state.resolution.choice, null);
    const source = Object.values(result.state.objects.cards).find(c => c.controllerId === actor && c.cardId === MINOTAUR && c.zone.zone === "BATTLEFIELD")!;
    assert.equal(source.readiness, "READY"); assert.ok(source.statuses.includes("LAG")); assert.equal(new RulesView(result.state, context).getEffectivePower(source.id), 9);
});
for (const [card, expected] of [["emergency-atlus", true], ["kerry-eurodyne-the-last-rockerboy", true], ["psycho-squad", false]] as const) test("Minotaur current simple power boundary: " + card, () => { const x = field(base, context, card, rival); assert.equal(targets(x.state).includes(x.id), expected); });
test("Minotaur lists rival low-power Units and excludes friendly low-power Units", () => {
    const own = field(base, context, "corpo-security", actor), other = field(own.state, context, "emergency-atlus", rival); assert.deepEqual(targets(other.state), [other.id]);
});
test("Minotaur condition true with no rival target finishes Unit play, with no fake choice", () => { const x = field(withGigs(base, context, { "p0-D4": 3, "p1-D4": 1 }), context, "corpo-security", actor), result = resolve(x.state, MINOTAUR); assert.equal(defeats(result).length, 0); assert.equal(result.state.timing.step, "MAIN"); assert.equal(result.state.resolution.choice, null); });
test("one Minotaur target is forced; multiple targets require the source controller and offer no pass", () => {
    const one = field(base, context, "emergency-atlus", rival), forced = resolve(one.state, MINOTAUR); assert.ok(payloads(forced).some(e => e.kind === "DEFEAT_TARGET_SELECTED" && e.forced));
    const two = field(one.state, context, "corpo-security", rival), paused = playCard(two.state, context, MINOTAUR).state;
    assert.equal(paused.timing.step, "TARGET_SELECTION"); assert.equal(paused.timing.actingPlayer, actor); assert.ok(actions(paused, context).length > 1); assert.ok(paused.resolution.choice!.options.every(o => o.kind === "CARD"));
    assert.deepEqual(unwrap(listLegalActions(paused, rival, context)), []);
});
for (const flip of [false, true]) test("Minotaur checks current condition after payment, changed to " + flip, () => {
    const arranged = field(withGigs(base, context, { "p0-D4": flip ? 1 : 3, "p1-D4": 2 }), context, "emergency-atlus", rival), started = take(arranged.state, context, a => a.action.kind === "PLAY_CARD" && arranged.state.objects.cards[a.action.cardInstanceId].cardId === MINOTAUR).state;
    assert.equal(started.resolution.choice?.kind, "PAYMENT");
    const changed = withGigs(started, context, { "p0-D4": flip ? 3 : 1, "p1-D4": 2 }), result = payOnly(changed, context); assert.equal(defeats(result).length, flip ? 1 : 0);
});
test("Minotaur uses controlled stolen Gig for current advantage rather than owner", () => {
    const s = withGigs(base, context, { "p0-D4": 1, "p1-D12": 9 }), m = new TurnMutation(s, context); unwrap(transferGigs(m, [gigId(s, "p1-D12")], actor));
    const x = field(unwrap(validateState(m.state, context)), context, "emergency-atlus", rival); assert.equal(defeats(resolve(x.state, MINOTAUR)).length, 1);
});
test("Floor It changes printed6 to reference5; Gear changes printed5 to7 for Minotaur targeting", () => {
    const six = field(base, context, "psycho-squad", rival); assert.equal(targets(six.state).includes(six.id), false);
    const five = reduced(six.state, context, six.id); assert.equal(new RulesView(five, context).getEffectivePower(six.id), 5); assert.equal(targets(five).includes(six.id), true); assert.equal(defeats(resolve(five, MINOTAUR)).length, 1);
    const printedFive = field(base, context, "kerry-eurodyne-the-last-rockerboy", rival), seven = equip(printedFive.state, context, "mantis-blades", printedFive.id); assert.equal(new RulesView(seven.state, context).getEffectivePower(printedFive.id), 7); assert.equal(targets(seven.state).includes(printedFive.id), false);
});
test("negative current power is retained but referenced as0; no Null-power Unit admission is invented", () => {
    const x = field(base, context, "secondhand-bombus", rival), s = reduced(x.state, context, x.id); assert.equal(new RulesView(s, context).getEffectivePower(x.id), -1); assert.ok(targets(s).includes(x.id));
    assert.equal(defeats(resolve(s, MINOTAUR)).length, 1);
    assert.ok(context.content.cards.filter(c => c.type === "UNIT").every(c => c.power !== undefined));
    const nullMin = CardRevisionSnapshotSchema.parse(minCard); delete nullMin.power; assert.equal(supportsTargetedDefeatCard(nullMin, context).ok, false);
});
for (const [card, expected] of [["psycho-squad", true], ["mt0d12-flathead", true], ["minotaur", false]] as const) test("Over the Edge uses current D20=7 against " + card, () => { const x = field(withGigs(base, context, d20(7)), context, card, rival); assert.equal(targets(x.state, "OVER_THE_EDGE").includes(x.id), expected); });
test("Over the Edge excludes effective8 at D20=7, then Floor It makes7 eligible", () => {
    const x = field(withGigs(base, context, d20(7)), context, "psycho-squad", rival), eight = equip(x.state, context, "mantis-blades", x.id); assert.equal(new RulesView(eight.state, context).getEffectivePower(x.id), 8); assert.equal(targets(eight.state, "OVER_THE_EDGE").includes(x.id), false);
    const seven = reduced(eight.state, context, x.id); assert.equal(targets(seven, "OVER_THE_EDGE").includes(x.id), true);
});
test("Over the Edge observes additive Gear power, including5+2+1=8 exceeding D20=7", () => {
    const x = field(withGigs(base, context, d20(7)), context, "kerry-eurodyne-the-last-rockerboy", rival), satori = equip(x.state, context, "satori-sword-of-saburo", x.id), kiroshi = equip(satori.state, context, "kiroshi-optics", x.id); assert.equal(new RulesView(kiroshi.state, context).getEffectivePower(x.id), 8); assert.equal(targets(kiroshi.state, "OVER_THE_EDGE").includes(x.id), false);
});
test("Over the Edge simultaneously lists friendly and rival Units; own Unit may actually be defeated", () => {
    const own = field(withGigs(base, context, d20(7)), context, "corpo-security", actor), other = field(own.state, context, "emergency-atlus", rival), s = withSource(other.state, OVER_THE_EDGE), paused = playCard(s, context, OVER_THE_EDGE).state;
    assert.deepEqual(new Set(paused.resolution.choice!.options.map(o => o.kind === "CARD" && o.cardInstanceId)), new Set([own.id, other.id]));
    const result = pick(paused, context, o => o.kind === "CARD" && o.cardInstanceId === own.id); assert.equal(result.state.objects.cards[own.id].zone.playerId, actor); assert.equal(result.state.objects.cards[own.id].zone.zone, "TRASH"); assert.equal(result.state.objects.cards[other.id].zone.zone, "BATTLEFIELD");
});
for (const label of ["no Gigs", "unrolled D20", "rival D20 only"] as const) test("Over the Edge may play with " + label + " but cannot defeat even power0", () => {
    const values: Record<string, number> = label === "no Gigs" ? {} : label === "unrolled D20" ? { "p0-D12": 12 } : { "p1-D4": 1, "p1-D6": 1, "p1-D8": 1, "p1-D10": 1, "p1-D12": 1, "p1-D20": 20 };
    const x = field(withGigs(base, context, values), context, "secondhand-bombus", rival), result = resolve(x.state, OVER_THE_EDGE); assert.equal(targets(x.state, "OVER_THE_EDGE").length, 0); assert.equal(defeats(result).length, 0); assert.equal(result.state.timing.step, "MAIN");
});
test("D20 die type and current face determine threshold; neither initial roll nor a D12 is substituted", () => {
    const x = field(withGigs(base, context, d20(3)), context, "emergency-atlus", rival); assert.equal(targets(x.state, "OVER_THE_EDGE").includes(x.id), false);
    const s = GameStateSchema.parse(x.state), g = s.objects.gigs[gigId(s, "p0-D20")]; assert.ok(g.roll.kind === "ROLLED"); g.roll.initialValue = 20; assert.equal(targets(unwrap(validateState(s, context)), "OVER_THE_EDGE").includes(x.id), false);
    g.roll.currentValue = 4; assert.equal(targets(unwrap(validateState(s, context)), "OVER_THE_EDGE").includes(x.id), true);
});
test("multiple current controlled D20s provide existential eligibility without a D20 choice", () => {
    const s = withGigs(base, context, { ...d20(2), "p1-D6": 1, "p1-D8": 1, "p1-D10": 1, "p1-D12": 1, "p1-D20": 9 }), m = new TurnMutation(s, context), id = gigId(s, "p1-D20"); unwrap(transferGigs(m, [id], actor));
    const x = field(unwrap(validateState(m.state, context)), context, "mt0d12-flathead", rival); assert.deepEqual(new RulesView(x.state, context).getControlledD20Values(actor).sort((a,b)=>a-b), [2,9]);
    const result = resolve(x.state, OVER_THE_EDGE); assert.equal(defeats(result).length, 1); assert.equal(result.events.some(e => e.payload.kind === "GIG_TARGET_SELECTED"), false); assert.equal(result.state.objects.gigs[id].ownerId, rival);
});
for (const trace of [mino, edge]) test(trace.mode + " legal headline preserves cross-controller owner order and real Dexter DEFEATED draw", () => {
    assert.equal(trace.pendingTarget.timing.actingPlayer, actor); assert.equal(trace.pendingOrder.timing.actingPlayer, rival); assert.equal(trace.pendingOrder.timing.combat.stage, "NONE");
    assert.equal(trace.pendingOrder.resolution.current?.sourceId, trace.source); assert.equal(trace.pendingOrder.objects.cards[trace.target].zone.zone, "BATTLEFIELD");
    const final = trace.finalState; assert.equal(final.objects.cards[trace.target].zone.zone, "TRASH"); assert.equal(final.objects.cards[trace.gear].zone.zone, "TRASH"); assert.deepEqual(final.objects.cards[trace.target].attachments, []); assert.equal(final.timing.actingPlayer, actor);
    const p = trace.steps.at(-1)!.events.map(e=>e.payload), defeated = p.findIndex(e=>e.kind === "CARD_DEFEATED"), moved = p.findIndex(e=>e.kind === "CARD_MOVED" && e.cardInstanceId===trace.target), pending=p.findIndex(e=>e.kind === "EFFECT_PENDING" && e.sourceId===trace.target), sourceDone=p.findIndex(e=>e.kind === "EFFECT_RESOLVED" && e.effectId===trace.pendingOrder.resolution.current!.id), draw=p.findIndex(e=>e.kind === "CARD_MOVED" && e.from.zone === "DECK");
    assert.ok(defeated < moved && moved < pending && pending < sourceDone && sourceDone < draw); assert.equal(p.filter(e=>e.kind === "CARD_MOVED" && e.from.zone === "DECK").length, 2);
    assert.ok(p.some(e=>e.kind === "CARD_DEFEATED" && e.defeatedBy===trace.source)); assert.equal(p.some(e=>e.kind === "FIGHT_RESULT" || e.kind === "ATTACK_ENDED"), false);
    if(trace.mode === "OVER_THE_EDGE") { const trash=p.findIndex(e=>e.kind === "CARD_MOVED" && e.cardInstanceId===trace.source && e.to.zone === "TRASH"); assert.ok(sourceDone < trash && trash < draw); }
    else { assert.ok(final.objects.cards[trace.source].statuses.includes("LAG")); assert.equal(final.objects.cards[trace.source].readiness,"READY"); }
});
for (const source of [MINOTAUR, OVER_THE_EDGE]) test(source + " uses existing ordinary Unit+Mantis movement and victim owner's Trash order", () => {
    const x=field(withGigs(base,context,d20(8)),context,"swordwise-huscle",rival), gear=equip(x.state,context,"mantis-blades",x.id), s=withSource(gear.state,source), paused=playCard(s,context,source).state;
    assert.equal(paused.timing.step,"DEFEAT_ORDER_SELECTION"); assert.equal(paused.timing.actingPlayer,rival); assert.equal(unwrap(listLegalActions(paused,actor,context)).length,0);
    const result=finishOrder(paused,context); assert.equal(result.state.objects.cards[x.id].zone.playerId,rival); assert.equal(result.state.objects.cards[gear.id].zone.zone,"TRASH"); assert.ok(payloads(result).some(e=>e.kind === "GEAR_DETACHED"));
});
for (const legend of [GORO, "v-corporate-exile"]) test("targeted defeat of field " + legend + " moves host/Gear to Trash then removes Legend", () => {
    const m=new TurnMutation(withGigs(base,context,d20(20)),context), id=m.state.players[actor].zones.LEGENDS.find(id=>m.state.objects.cards[id].cardId===GORO)!; const revision=context.content.cards.find(c=>c.id===legend)!;
    m.state.objects.cards[id].cardId=revision.id; m.state.objects.cards[id].revision=revision.revision; m.state.objects.cards[id].face="UP"; unwrap(moveLegendToFieldWithAttachments(m,id,"GO_SOLO"));
    const equipped=equip(unwrap(validateState(m.state,context)),context,"mantis-blades",id); assert.ok(targets(equipped.state,"OVER_THE_EDGE").includes(id));
    const result=resolve(equipped.state,OVER_THE_EDGE,id), p=payloads(result); assert.equal(result.state.objects.cards[id].zone.zone,"REMOVED"); assert.equal(result.state.objects.cards[equipped.id].zone.zone,"TRASH"); assert.deepEqual(result.state.objects.cards[id].attachments,[]);
    const defeat=p.findIndex(e=>e.kind === "CARD_DEFEATED" && e.cardInstanceId===id), trash=p.findIndex(e=>e.kind === "CARD_MOVED" && e.cardInstanceId===id && e.to.zone === "TRASH"), removed=p.findIndex(e=>e.kind === "CARD_MOVED" && e.cardInstanceId===id && e.to.zone === "REMOVED"); assert.ok(defeat<trash && trash<removed);
});
test("Minotaur rival selector includes a reduced field Goro effective Unit", () => {
    const m=new TurnMutation(base,context), id=m.state.players[rival].zones.LEGENDS[0], revision=context.content.cards.find(c=>c.id===GORO)!; m.state.objects.cards[id].cardId=revision.id; m.state.objects.cards[id].revision=revision.revision; m.state.objects.cards[id].face="UP"; unwrap(moveLegendToFieldWithAttachments(m,id,"GO_SOLO"));
    const s=reduced(reduced(unwrap(validateState(m.state,context)),context,id),context,id); assert.equal(new RulesView(s,context).getEffectivePower(id),5); assert.ok(targets(s).includes(id)); const defeated=resolve(s,MINOTAUR,id).state; assert.equal(defeated.objects.cards[id].zone.zone,"REMOVED"); assert.equal(defeated.temporaryModifiers?.length,2); assert.equal(targets(defeated).includes(id),false); const ended=end(defeated,context); assert.equal(ended.state.temporaryModifiers,undefined); assert.equal(ended.events.filter(e=>e.payload.kind === "POWER_MODIFIER_EXPIRED").length,2);
});
test("Over the Edge self-defeats Dexter with the same DEFEATED behavior", () => { const x=field(withGigs(base,context,d20(10)),context,DEXTER,actor), result=resolve(x.state,OVER_THE_EDGE,x.id); assert.equal(defeats(result).length,1); assert.equal(draws(result).length,2); });
for (const source of [MINOTAUR, OVER_THE_EDGE]) test(source + " respects terminal Dexter EMPTY_DRAW and does not force MAIN", () => {
    const x=field(withGigs(base,context,d20(10)),context,DEXTER,rival), m=new TurnMutation(x.state,context); for(const id of [...m.state.players[rival].zones.DECK])moveCardLocation(m,id,"TRASH");
    const result=resolve(unwrap(validateState(m.state,context)),source); assert.equal(result.state.match.outcome?.reason,"EMPTY_DRAW"); assert.equal(result.state.match.outcome?.loserId,rival); assert.equal(result.state.timing.step,"FINISHED"); assert.equal(result.state.resolution.current,null); assert.equal(result.state.resolution.targetedDefeatContinuation,undefined);
    assert.equal(Object.values(result.state.objects.cards).some(c=>c.zone.zone === "RESOLVING_PROGRAM"),false);
});
test("Minotaur later attacks through exact Arasaka/Yorinobu/Saburo queries, with power9→10", () => {
    let s=mino.finalState; s=end(s,context).state; s=take(s,context,a=>a.action.kind === "ROLL_GIG").state; s=end(s,context).state; s=take(s,context,a=>a.action.kind === "ROLL_GIG").state;
    const m=new TurnMutation(s,context); for(const id of m.state.players[actor].zones.LEGENDS)if([SABURO,YORINOBU].includes(m.state.objects.cards[id].cardId))m.state.objects.cards[id].face="UP";
    s=unwrap(validateState(m.state,context)); assert.equal(new RulesView(s,context).getEffectivePower(mino.source),9); const result=declare(s,mino.source,context);
    assert.equal(new RulesView(result.state,context).getEffectivePower(mino.source),10); assert.ok(result.events.some(e=>e.payload.kind === "EFFECT_PENDING" && result.state.objects.cards[e.payload.sourceId].cardId===YORINOBU)); assert.equal(result.state.turnHistory?.firstArasakaAttacks?.[actor].count,1);
    const values = Object.fromEntries(Object.values(result.state.objects.gigs).filter(g => g.roll.kind === "ROLLED").map(g => [g.id, g.roll.kind === "ROLLED" ? g.roll.currentValue : 1]));
    values["p0-D20"] = 9;
    const query=withGigs(result.state, context, values); // Trusted query-only D20 boundary; neither Program gains Quick timing.
    assert.equal(targets(query,"OVER_THE_EDGE").includes(mino.source),false); const noAura=GameStateSchema.parse(query), source=Object.values(noAura.objects.cards).find(c=>c.cardId===SABURO)!; source.face="DOWN"; assert.equal(targets(noAura,"OVER_THE_EDGE").includes(mino.source),true);
    assert.equal(actions(result.state,context).some(a=>a.action.kind === "PLAY_CARD" && result.state.objects.cards[a.action.cardInstanceId].cardId===OVER_THE_EDGE),false);
});
for (const card of targetedCards) for (const defect of ["policy","scope","status","unreviewed","extra-effect","missing-effect","relationship","filter","condition","trigger","activation","cost","power","ram","tags","color","sell","keyword","modifier"] as const) test(card.id + " full-shape rejection: " + defect, () => {
    const changed=CardRevisionSnapshotSchema.parse(card), policy=structuredClone(context.content.ruleset), a=changed.mechanics.abilities[0];
    if(defect === "policy")delete policy.gameplay!.turnSlice!.targetedDefeat;
    if(defect === "scope")changed.execution!.scope="VALUE_CONDITIONS_V1";
    if(defect === "status")changed.execution!.status="UNSUPPORTED";
    if(defect === "unreviewed")changed.provenance.reviewed=false;
    if(defect === "extra-effect")a.effects.push({kind:"DRAW",count:1});
    if(defect === "missing-effect")a.effects=[];
    if(defect === "relationship" && a.effects[0].kind === "DEFEAT_UNIT")a.effects[0].target.relation=changed.type === "UNIT"?"ANY":"RIVAL";
    if(defect === "filter" && a.effects[0].kind === "DEFEAT_UNIT")a.effects[0].target.power=changed.type === "UNIT"?{kind:"CONTROLLED_GIG_VALUE",dieType:"D20"}:{kind:"AT_MOST",value:5};
    if(defect === "condition" && a.effects[0].kind === "DEFEAT_UNIT"){ if(changed.type === "UNIT")delete a.effects[0].when; else a.effects[0].when={timing:"RESOLUTION",condition:{kind:"STREET_CRED_GREATER_THAN_RIVAL"}}; }
    if(defect === "trigger")a.trigger="WHEN_ATTACKING";
    if(defect === "activation")a.activation={timing:"MAIN",conditionTiming:"ACTIVATION_AND_RESOLUTION",costs:[{kind:"SPEND_SOURCE"}]};
    if(defect === "cost")changed.printedCost={kind:"EDDIES",amount:1};
    if(defect === "power")changed.power=0;
    if(defect === "ram")changed.ram={RED:1};
    if(defect === "tags")changed.tags=["Corpo"];
    if(defect === "color")changed.colors=["BLUE"];
    if(defect === "sell")changed.sellProfile.allowed=!changed.sellProfile.allowed;
    if(defect === "keyword")changed.mechanics.keywords=["QUICK"];
    if(defect === "modifier")changed.mechanics.modifiers=[{kind:"GRANT_PRINTED_POWER_TO_HOST"}];
    if (defect === "unreviewed") { assert.equal(supportsTargetedDefeatCard(changed, context).ok, false); assert.throws(() => createContentBundle(policy, [changed], context.content.manifest.engine)); return; }
    const ctx={content:createContentBundle(policy,context.content.cards.map(c=>c.id===changed.id?changed:c),context.content.manifest.engine)};
    assert.equal(supportsTargetedDefeatCard(changed,ctx).ok,false); assert.equal(supportsPlay(changed,ctx).ok,false); assert.equal(createGameWithEvents(targetedInput("bad"),ctx).ok,false);
});
for (const trace of [mino,edge]) for (const defect of ["missing-continuation","wrong-phase","target-left","power-increased","wrong-target","wrong-source","wrong-owner","order-duplicate","order-foreign","fight-proof","condition-or-d20"] as const) test(trace.mode + " rejects external defeat continuation: " + defect, () => {
    const s=GameStateSchema.parse(trace.pendingOrder), c=s.resolution.defeatContinuation!, target=s.objects.cards[trace.target];
    if(defect === "missing-continuation")delete s.resolution.targetedDefeatContinuation;
    if(defect === "wrong-phase")s.resolution.targetedDefeatContinuation!.phase="TARGET";
    if(defect === "target-left"){s.players[rival].zones.BATTLEFIELD=s.players[rival].zones.BATTLEFIELD.filter(id=>id!==target.id);s.players[rival].zones.TRASH.push(target.id);target.zone.zone="TRASH";}
    if(defect === "power-increased"){target.cardId=minCard.id;target.revision=minCard.revision;}
    if(defect === "wrong-target")c.defeats[0].targetId=trace.source;
    if(defect === "wrong-source")c.defeats[0].defeatedBy=trace.target;
    if(defect === "wrong-owner"){s.timing.actingPlayer=actor;s.resolution.choice!.actorId=actor;}
    if(defect === "order-duplicate")c.orders[0].cardIds=[trace.target,trace.target];
    if(defect === "order-foreign")c.orders[0].cardIds=[trace.source];
    if(defect === "fight-proof")c.fightResult={kind:"FIGHT_RESULT",attackerId:trace.source,defenderId:trace.target,attackerPower:9,defenderPower:4,attackerComparisonPower:9,defenderComparisonPower:4,winnerId:trace.source,loserIds:[trace.target]};
    if(defect === "condition-or-d20")for(const g of Object.values(s.objects.gigs))if(g.controllerId===actor && g.roll.kind === "ROLLED")g.roll.currentValue=1;
    const before=JSON.stringify(s); assert.equal(validateState(s,context).ok,false); assert.equal(applyAction(s,{actorId:s.timing.actingPlayer,action:actions(trace.pendingOrder,context)[0].action},context).ok,false); assert.equal(JSON.stringify(s),before);
});
test("pending current Street Cred changes invalidate old action IDs even when the target stays eligible", () => {
    const s=GameStateSchema.parse(mino.pendingTarget), g=s.objects.gigs[gigId(s,"p0-D12")]; assert.ok(g.roll.kind === "ROLLED"); g.roll.currentValue=g.roll.currentValue===1?2:g.roll.currentValue-1;
    const old=actions(mino.pendingTarget,context)[0]; assert.notEqual(hashPosition(s),hashPosition(mino.pendingTarget)); assert.equal(resolveActionId(s,actor,old.actionId,context).ok,false);
});
test("no interleaving or source-controller submission during victim owner's Trash order", () => {
    for(const s of [mino.pendingOrder,edge.pendingOrder]){ assert.equal(applyAction(s,{actorId:actor,action:actions(s,context)[0].action},context).ok,false); assert.ok(actions(s,context).every(a=>a.action.kind === "CHOOSE")); }
});
test("all49 prior revisions and unchanged constructed size/RAM/copy/Legend constraints remain", () => {
    const old=valueContext(); assert.equal(old.content.cards.length,49); assert.equal(context.content.cards.length,51); for(const c of old.content.cards)assert.deepEqual(context.content.cards.find(x=>x.id===c.id),c);
    const input=targetedInput("format"); assert.ok(createGameWithEvents(input,context).ok);
    for(const deck of [{...input.decks[0],main:input.decks[0].main.slice(0,27)},{...input.decks[0],main:[...input.decks[0].main,MINOTAUR]},{...input.decks[0],legends:input.decks[0].legends.slice(0,2)},{...input.decks[0],main:["psycho-squad",...input.decks[0].main.slice(1)]}])assert.equal(createGameWithEvents({...input,decks:[deck,input.decks[1]]},context).ok,false);
});
test("target/order positions survive JSON, wire and training; transport counters do not define action IDs", () => {
    for(const s of [mino.pendingTarget,mino.pendingOrder,edge.pendingTarget,edge.pendingOrder]){
        const who=s.timing.actingPlayer, position=unwrap(generatePosition(s,who,context,"targeted-contract")); assert.ok(validateTrainingPosition(position,context).ok); assert.ok(modelInput(position).legalActions.length>1);
        assert.deepEqual(unwrap(validateState(JSON.parse(JSON.stringify(s)),context)),s);
        const changed=GameStateSchema.parse(s);changed.match.id=MatchIdSchema.parse(randomUUID());changed.match.version=GameStateVersionSchema.parse(s.match.version+99);changed.match.eventSequence=GameEventSequenceSchema.parse(s.match.eventSequence+100);
        assert.equal(hashPosition(changed),hashPosition(s));assert.notEqual(hashReplayState(changed),hashReplayState(s));assert.deepEqual(actions(changed,context).map(a=>a.actionId),actions(s,context).map(a=>a.actionId));
        const response=handleRequest({schemaVersion:1,requestId:randomUUID(),op:"listLegalActions",state:s,actorId:who,content:context.content}); assert.ok(response.ok && response.value.kind === "actions"); if(response.ok && response.value.kind === "actions") assert.deepEqual(response.value.actions, actions(s,context));
    }
});
test("public current power/D20 changes alter both observations, without leaking private rival cards", () => {
    const s=GameStateSchema.parse(edge.pendingTarget), g=s.objects.gigs[gigId(s,"p0-D20")];assert.ok(g.roll.kind === "ROLLED");g.roll.currentValue--;
    for(const viewer of s.match.playerOrder)assert.notEqual(hashObservation(unwrap(observe(s,viewer,context))),hashObservation(unwrap(observe(edge.pendingTarget,viewer,context))));
    const hidden=GameStateSchema.parse(edge.pendingTarget), deck=hidden.players[rival].zones.DECK;[deck[0],deck[1]]=[deck[1],deck[0]]; assert.deepEqual(actions(hidden,context).map(a=>a.actionId),actions(edge.pendingTarget,context).map(a=>a.actionId));
});
for(const [name,trace] of [["minotaur",mino],["over-the-edge",edge]] as const)test(name+" legal headline golden includes only strategic decisions",()=>{assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/"+name+"-replay.v1.json",import.meta.url),"utf8")),trace);assert.ok(trace.positions.every(p=>p.legalActions.length>1));assert.ok(trace.steps.every(s=>s.action.action.kind!=="GO_SOLO"));});

for (const trace of [mino,edge]) test(trace.mode + " current target power invalidates old action IDs while preserving eligibility", () => {
    const changed = reduced(trace.pendingTarget, context, trace.target);
    assert.ok(targets(changed,trace.mode).includes(trace.target));
    assert.equal(new RulesView(changed,context).getEffectivePower(trace.target),3);
    for(const action of actions(trace.pendingTarget,context)) assert.equal(resolveActionId(changed,actor,action.actionId,context).ok,false);
    for(const viewer of changed.match.playerOrder) assert.notEqual(hashObservation(unwrap(observe(changed,viewer,context))),hashObservation(unwrap(observe(trace.pendingTarget,viewer,context))));
});
for (const trace of [mino,edge]) for(const defect of ["left", "too-powerful", "control", "condition-or-d20"] as const) test(trace.mode + " pending target rejects current " + defect, () => {
    const s=GameStateSchema.parse(trace.pendingTarget), card=s.objects.cards[trace.target];
    if(defect === "left") {s.players[rival].zones.BATTLEFIELD=s.players[rival].zones.BATTLEFIELD.filter(id=>id!==card.id); s.players[rival].zones.TRASH.push(card.id); card.zone.zone="TRASH";}
    if(defect === "too-powerful") {card.cardId=minCard.id;card.revision=minCard.revision;}
    if(defect === "control") {card.controllerId=actor;}
    if(defect === "condition-or-d20") for(const g of Object.values(s.objects.gigs)) if(g.controllerId===actor && g.roll.kind === "ROLLED") g.roll.currentValue=1;
    const before=JSON.stringify(s); assert.equal(validateState(s,context).ok,false); assert.equal(resolveActionId(s,actor,actions(trace.pendingTarget,context)[0].actionId,context).ok,false); assert.equal(JSON.stringify(s),before);
});
