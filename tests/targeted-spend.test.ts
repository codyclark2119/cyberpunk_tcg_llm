import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, MatchIdSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, type CardInstanceId, type GameState, type Cost } from "@tcg/domain";
import { createGameWithEvents, applyAction, validateState, listLegalActions, observe, hashPosition, hashObservation, hashReplayState, resolveActionId, RulesView } from "@tcg/engine";
import { generatePosition, validateTrainingPosition, modelInput } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { spendContext, spendInput, surveillance, SURVEILLANCE } from "./targeted-spend-fixture";
import { targetedSpendReplay } from "./targeted-spend-replay";
import { targetedContext } from "./targeted-defeat-fixture";
import { minotaurReplay } from "./targeted-defeat-replay";
import { field, fund, clearField, equip, reduced } from "./targeted-defeat-focused";
import { placeCard, playCard, pick } from "./value-conditions-focused";
import { actions, take, end } from "./delayed-effects-focused";
import { declare, finishAttack } from "./yorinobu-focused";
import { unwrap } from "./turn-replay";
import { DEXTER } from "./combat-triggers-fixture";
import { GORO } from "./goro-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveLegendToFieldWithAttachments, processDeparture } from "../packages/engine/src/card-movement";
import { defeatBatch } from "../packages/engine/src/defeat";
import { effectiveCardTypes } from "../packages/engine/src/characteristics";
import { numericCost, referencedCost } from "../packages/engine/src/cost-value";
import { listSpendUnitTargets } from "../packages/engine/src/targeted-spend-queries";
import { isUnitSpendSubject, spendUnitForEffect } from "../packages/engine/src/unit-spend";
import { supportsTargetedSpendCard } from "../packages/engine/src/targeted-spend-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import source from "./fixtures/targeted-spend-card-source.v1.json";
import rules from "./fixtures/targeted-spend-rules.v1.json";
const context = spendContext(), trace = targetedSpendReplay(), { actor, rival } = trace;
const effect = surveillance.mechanics.abilities[0].effects[0]; assert.ok(effect.kind === "SPEND_UNIT"); const selector = effect.target;
const base = fund(clearField(trace.beforeSource, context), context);
const targets = (s: GameState) => new RulesView(s,context).listSpendUnitTargets(actor,selector);
const payloads = (r: ReturnType<typeof playCard>) => r.events.map(e=>e.payload);
function sourceInHand(s: GameState) { return Object.values(s.objects.cards).some(c=>c.cardId===SURVEILLANCE && c.controllerId===actor && c.zone.zone==="HAND") ? s : placeCard(s,context,SURVEILLANCE,actor).state; }
function resolve(s: GameState, target?: CardInstanceId) {
    const played=playCard(sourceInHand(s),context,SURVEILLANCE);
    if(!played.state.resolution.choice)return played;
    const chosen=pick(played.state,context,o=>o.kind === "CARD" && (!target || o.cardInstanceId===target)); return {state:chosen.state,events:[...played.events,...chosen.events]};
}
function fieldLegend(s: GameState, cardId: string) {
    const m=new TurnMutation(s,context), id=m.state.players[rival].zones.LEGENDS[0], revision=context.content.cards.find(c=>c.id===cardId)!;
    m.state.objects.cards[id].cardId=revision.id; m.state.objects.cards[id].revision=revision.revision; m.state.objects.cards[id].face="UP";
    unwrap(moveLegendToFieldWithAttachments(m,id,"GO_SOLO")); return {state:unwrap(validateState(m.state,context)),id};
}
/** Query-only explicit synthetic revision; never admitted or used by legal replay. Real V/Goro unchanged. */
function queryRevision(s: GameState,id: CardInstanceId,cost: Cost,type: "UNIT" | "LEGEND") {
    const original=context.content.cards.find(c=>c.id===s.objects.cards[id].cardId)!, card=CardRevisionSnapshotSchema.parse({...original,id:"trusted-spend-cost-query",name:"Trusted cost query",displayName:"Trusted cost query",deckbuildingIdentity:"Trusted cost query",type,printedCost:cost,printings:[{id:"trusted-spend-query-print",setCode:"DEV",collectorNumber:"Q1",source:"Synthetic query-only fixture"}],execution:{scope:"TARGETED_SPEND_V1",status:"UNSUPPORTED"},provenance:{...original.provenance,source:"Synthetic query-only metadata; never executable or human gold",sourceHash:hashCanonical({cost,type})}});
    const ctx={content:createContentBundle(context.content.ruleset,[...context.content.cards,card],context.content.manifest.engine)}, state=GameStateSchema.parse(s);
    state.objects.cards[id].cardId=card.id; state.match.contentManifestHash=ctx.content.manifestHash; state.match.cards=ctx.content.manifest.cards.map(({cardId,revision})=>({cardId,revision}));
    assert.equal(validateState(state,ctx).ok,false); return {state,context:ctx,card};
}
test("complete Corporate Surveillance source, five printings and all four errata are pinned",()=>{
    assert.equal(surveillance.rulesText,"Spend a rival Unit with cost 4 or less."); assert.equal(surveillance.id,"corporate-surveillance"); assert.equal(surveillance.revision,1); assert.equal(source.record.id,"71fb410b-b56e-42b2-a793-4c49e935b9f1");
    assert.equal(surveillance.type,"PROGRAM"); assert.deepEqual(surveillance.ram,{GREEN:1}); assert.deepEqual(surveillance.printedCost,{kind:"EDDIES",amount:2}); assert.equal(surveillance.power,undefined); assert.deepEqual(surveillance.tags,["Corpo"]); assert.equal(surveillance.sellProfile.allowed,true); assert.equal(surveillance.printings.length,5); assert.equal(source.errata.length,4); assert.deepEqual(surveillance.provenance.errata,[]); assert.equal(surveillance.provenance.sourceHash,hashCanonical(source.record)); assert.ok(supportsTargetedSpendCard(surveillance,context).ok);
});
test("rules pin Legend-only Null cost reference, payment distinction, Lag and exact spent/no-target FAQs",()=>{
    for(const id of ["2.10.2","3.7","3.11.1.2","3.11.2.3","4.2.1","4.5.3","4.14.2","8.6.3","10.2.1","11.3.1.2","11.15.2"])assert.ok(rules.rules.some(r=>r.id===id),id);
    for(const id of ["4496adf7-0641-4c06-a1f7-6eb120c075bf","00513475-b873-4eec-b582-c8bb969fe1e5"])assert.equal(rules.faqs.find(f=>f.id===id)!.answer,"Yes.");
});
for(const [cardId,cost,eligible] of [["field-operator",3,true],[DEXTER,3,true],["kerry-eurodyne-the-last-rockerboy",4,true],["delamain-cab",4,true],["psycho-squad",4,true],["mt0d12-flathead",5,false],["minotaur",7,false],["corpo-security",2,true]] as const)test(`real ${cardId} cost${cost} spend eligibility is${eligible}`,()=>{
    const x=field(base,context,cardId,rival); assert.equal(new RulesView(x.state,context).getNumericCost(x.id),cost); assert.equal(targets(x.state).includes(x.id),eligible);
    if(eligible){const result=resolve(x.state,x.id); assert.equal(result.state.objects.cards[x.id].readiness,"SPENT");assert.deepEqual(result.state.objects.cards[x.id],{...x.state.objects.cards[x.id],readiness:"SPENT"});}
});
test("rival selection includes both readiness states and excludes friendly Units irrespective of ownership",()=>{
    const own=field(base,context,"corpo-security",actor), other=field(own.state,context,"field-operator",rival), s=GameStateSchema.parse(other.state);
    s.objects.cards[other.id].readiness="SPENT"; assert.deepEqual(targets(s),[other.id]);
    // Query-only ownership/control arrangements do not introduce a transfer action.
    s.objects.cards[other.id].ownerId=actor; assert.ok(listSpendUnitTargets(s,actor,selector,context).includes(other.id));
    s.objects.cards[other.id].controllerId=actor; s.objects.cards[other.id].zone.playerId=actor; assert.equal(listSpendUnitTargets(s,actor,selector,context).includes(other.id),false);
});
test("Program, Gear, Legends-area Legends, hand Units and face-down field Units are not targets",()=>{
    const x=field(base,context,"field-operator",rival), equipped=equip(x.state,context,"mantis-blades",x.id), view=new RulesView(equipped.state,context);
    assert.deepEqual(targets(equipped.state),[x.id]); assert.equal(isUnitSpendSubject(equipped.state,equipped.id,context),false);
    for(const id of equipped.state.players[rival].zones.LEGENDS)assert.equal(view.getEffectiveCardTypes(id).includes("UNIT"),false);
    const s=GameStateSchema.parse(equipped.state);s.objects.cards[x.id].face="DOWN";assert.equal(listSpendUnitTargets(s,actor,selector,context).includes(x.id),false);assert.equal(validateState(s,context).ok,false);
});
for(const cardId of [GORO,"v-corporate-exile"])test(cardId+" is an effective Unit with Gear but real cost5 excludes it",()=>{
    const x=fieldLegend(base,cardId), geared=equip(x.state,context,"mantis-blades",x.id); assert.deepEqual(new RulesView(geared.state,context).getEffectiveCardTypes(x.id),["LEGEND","UNIT"]); assert.ok(isUnitSpendSubject(geared.state,x.id,context)); assert.equal(referencedCost(geared.state,x.id,context),5);assert.equal(targets(geared.state).includes(x.id),false);
    const result=resolve(geared.state);assert.equal(result.state.objects.cards[x.id].readiness,"READY"); assert.deepEqual(result.state.objects.cards[x.id],geared.state.objects.cards[x.id]);assert.equal(payloads(result).some(e=>e.kind === "CARD_SPENT"),false);
});
for(const [kind,amount,type,expected] of [["EDDIES",0,"UNIT",0],["DASH",0,"UNIT",null],["DASH",0,"LEGEND",0],["NONE",0,"LEGEND",null],["EDDIES",4,"LEGEND",4]] as const)test(`trusted query only: ${type} ${kind}${amount} references${expected}`,()=>{
    const x=field(base,context,"field-operator",rival), q=queryRevision(x.state,x.id,kind === "EDDIES"?{kind,amount}:{kind},type);
    assert.equal(referencedCost(q.state,x.id,q.context),expected);assert.equal(numericCost(q.state,x.id,q.context),kind === "EDDIES"?amount:null);assert.equal(listSpendUnitTargets(q.state,actor,selector,q.context).includes(x.id),expected!==null);assert.deepEqual(q.card.printedCost,kind === "EDDIES"?{kind,amount}:{kind});
});
test("real numeric0 Unit is not invented; Null Legends remain unplayable and cost is not payment value",()=>{
    assert.equal(context.content.cards.some(c=>c.type==="UNIT"&&c.printedCost.kind === "EDDIES"&&c.printedCost.amount===0),false);
    const view=new RulesView(base,context); for(const id of base.players[actor].zones.LEGENDS){const r=view.getRevision(id)!;if(r.printedCost.kind === "DASH"){assert.equal(view.getNumericCost(id),null);assert.equal(view.getReferencedCost(id),0);assert.equal(targets(base).includes(id),false);assert.equal(actions(base,context).some(a=>a.action.kind === "GO_SOLO" && a.action.cardInstanceId===id),false);}}
});
test("generic spend transition retains a real field Legend and its Gear; Corporate cost5 filter remains separate",()=>{
    const x=fieldLegend(base,GORO), equipped=equip(x.state,context,"mantis-blades",x.id), m=new TurnMutation(equipped.state,context), sourceId=trace.pendingTarget.resolution.current!.sourceId!;
    // Trusted semantic-operation test, not a claim Corporate can choose cost5.
    assert.deepEqual(unwrap(spendUnitForEffect(m,x.id,sourceId,"trusted-effect")),{changed:true});assert.deepEqual(m.state.objects.cards[x.id],{...equipped.state.objects.cards[x.id],readiness:"SPENT"});assert.deepEqual(m.state.objects.cards[equipped.id],equipped.state.objects.cards[equipped.id]);assert.deepEqual(effectiveCardTypes(m.state,x.id,context),["LEGEND","UNIT"]);assert.equal(m.events.length,1);assert.ok(validateState(m.state,context).ok);
});
test("same target with Gear and Floor It preserves physical identity, cost, power and effective text",()=>{
    const x=field(base,context,"field-operator",rival), geared=equip(x.state,context,"satori-sword-of-saburo",x.id), s=reduced(geared.state,context,x.id), before=new RulesView(s,context), result=resolve(s,x.id), after=new RulesView(result.state,context);
    assert.equal(before.getNumericCost(x.id),3); assert.equal(before.getEffectivePower(x.id),3);assert.deepEqual(after.getEffectiveTriggeredAbilities(x.id),before.getEffectiveTriggeredAbilities(x.id));assert.equal(after.getEffectivePower(x.id),before.getEffectivePower(x.id));assert.deepEqual(result.state.temporaryModifiers,s.temporaryModifiers);assert.deepEqual(result.state.objects.cards[geared.id],s.objects.cards[geared.id]);assert.deepEqual(result.state.objects.cards[x.id],{...s.objects.cards[x.id],readiness:"SPENT"});
});
test("Lagging Field Operator can be spent externally and keeps Lag until normal cleanup",()=>{
    const x=field(base,context,"field-operator",rival), s=GameStateSchema.parse(x.state);s.objects.cards[x.id].statuses=["LAG"];const result=resolve(s,x.id);assert.deepEqual(result.state.objects.cards[x.id].statuses,["LAG"]);assert.equal(result.state.objects.cards[x.id].readiness,"SPENT");
});
for(const label of ["empty board","friendly only","all cost5+"])test(label+": paid Program resolves without target or fake choice",()=>{
    const s=label === "empty board"?base:field(base,context,label === "friendly only"?"corpo-security":"mt0d12-flathead",label === "friendly only"?actor:rival).state,result=resolve(s);
    assert.equal(payloads(result).some(e=>e.kind === "CARD_TARGET_SELECTED" || e.kind === "CARD_SPENT"),false);assert.equal(result.state.resolution.choice,null);assert.equal(result.state.timing.step,"MAIN");assert.ok(payloads(result).some(e=>e.kind === "PAYMENT_MADE"));assert.ok(payloads(result).some(e=>e.kind === "CARD_MOVED" && e.from.zone === "RESOLVING_PROGRAM" && e.to.zone === "TRASH"));
});
test("sole eligible target resolves internally and multiple targets offer only mandatory source-controller choices",()=>{
    const one=field(base,context,"field-operator",rival), forced=resolve(one.state);assert.ok(payloads(forced).some(e=>e.kind === "CARD_TARGET_SELECTED"&&e.forced));assert.equal(forced.state.resolution.choice,null);
    assert.equal(trace.pendingTarget.timing.actingPlayer,actor);assert.ok(actions(trace.pendingTarget,context).length>=2);assert.ok(trace.pendingTarget.resolution.choice!.options.every(o=>o.kind === "CARD"));assert.deepEqual(unwrap(listLegalActions(trace.pendingTarget,rival,context)),[]);assert.equal(applyAction(trace.pendingTarget,{actorId:rival,action:actions(trace.pendingTarget,context)[0].action},context).ok,false);
});
test("already-SPENT real target remains selectable and emits no second spend or trigger",()=>{
    const result=resolve(fund(trace.finalState,context),trace.target), p=payloads(result);assert.ok(p.some(e=>e.kind === "CARD_TARGET_SELECTED"&&e.targetId===trace.target));assert.equal(p.some(e=>e.kind === "CARD_SPENT"),false);assert.deepEqual(result.state.objects.cards[trace.target],trace.finalState.objects.cards[trace.target]);assert.equal(p.some(e=>e.kind === "EFFECT_PENDING" && e.sourceId===trace.target),false);
});
test("spent target remains an eligible sole target instead of being mistaken for no target",()=>{
    const x=field(base,context,"field-operator",rival), s=GameStateSchema.parse(x.state);s.objects.cards[x.id].readiness="SPENT";const result=resolve(s);assert.ok(payloads(result).some(e=>e.kind === "CARD_TARGET_SELECTED"&&e.forced));assert.equal(payloads(result).some(e=>e.kind === "CARD_SPENT"),false);
});
test("real equipped Dexter spend differs from Minotaur semantic defeat",()=>{
    const p=trace.steps.at(-1)!.events.map(e=>e.payload), d=trace.finalState.objects.cards[trace.target];assert.deepEqual(d,{...trace.pendingTarget.objects.cards[trace.target],readiness:"SPENT"});assert.equal(d.zone.zone,"BATTLEFIELD");assert.deepEqual(trace.finalState.objects.cards[trace.gear],trace.pendingTarget.objects.cards[trace.gear]);
    for(const kind of ["CARD_DEFEATED","DEFEAT_TARGET_SELECTED","DEFEAT_TRASH_ORDER_SELECTED","GEAR_DETACHED","EFFECT_PENDING","ATTACKER_SPENT","BLOCKER_SPENT"])assert.equal(p.some(e=>e.kind===kind),false,kind);
    assert.equal(p.some(e=>e.kind === "CARD_MOVED"&&(e.cardInstanceId===trace.target||e.cardInstanceId===trace.gear||e.from.zone === "DECK")),false);
    const defeated=minotaurReplay();assert.equal(defeated.finalState.objects.cards[defeated.target].zone.zone,"TRASH");assert.equal(defeated.steps.at(-1)!.events.filter(e=>e.payload.kind === "CARD_MOVED"&&e.payload.from.zone === "DECK").length,2);
});
test("exact spend event order distinguishes the effect target from Program payment",()=>{
    const p=trace.steps.at(-1)!.events.map(e=>e.payload);assert.deepEqual(p.map(e=>e.kind),["CARD_TARGET_SELECTED","CARD_SPENT","EFFECT_RESOLVED","CARD_MOVED","PHASE_CHANGED"]);
    assert.deepEqual(p[1],{kind:"CARD_SPENT",cardInstanceId:trace.target,cause:{kind:"EFFECT",sourceId:trace.source,effectId:trace.pendingTarget.resolution.current!.id}});
    const all=trace.steps.flatMap(s=>s.events.map(e=>e.payload));assert.ok(all.some(e=>e.kind === "PAYMENT_MADE"));assert.equal(trace.finalState.objects.cards[trace.source].zone.zone,"TRASH");assert.equal(trace.finalState.timing.actingPlayer,actor);assert.deepEqual(trace.finalState.resolution,{stage:"DECISION",current:null,pending:[],discovered:[],choice:null});
});
test("spending Blocker prevents blocking now and normal next-turn readiness restores ordinary actions",()=>{
    const own=field(base,context,"swordwise-huscle",actor), other=field(own.state,context,"corpo-security",rival), spent=resolve(other.state,other.id);
    const before=declare(other.state,own.id,context), after=declare(spent.state,own.id,context);assert.ok(new RulesView(before.state,context).listBlockers(rival).includes(other.id));assert.equal(new RulesView(after.state,context).listBlockers(rival).includes(other.id),false);
    const done=finishAttack(after.state,context).state, next=end(done,context).state;assert.equal(next.objects.cards[other.id].readiness,"READY");assert.deepEqual(next.objects.cards[other.id].statuses,[]);
    const readable=end(trace.finalState,context).state;assert.equal(readable.objects.cards[trace.target].readiness,"READY");const main=take(readable,context,a=>a.action.kind === "ROLL_GIG").state;assert.ok(actions(main,context).some(a=>a.action.kind === "DECLARE_ATTACK"&&a.action.cardInstanceId===trace.target));
});
for(const defect of ["policy","scope-value","scope-defeat","status","unreviewed","missing-effect","extra-effect","relation","wrong-trigger","activation","inherited","guard","condition","ability-cost","type","cost","power","ram","color","classification","sell","keyword","modifier"] as const)test("full-shape rejection: "+defect,()=>{
    const c=CardRevisionSnapshotSchema.parse(surveillance), policy=structuredClone(context.content.ruleset), a=c.mechanics.abilities[0];
    if(defect === "policy")delete policy.gameplay!.turnSlice!.targetedSpend;
    if(defect === "scope-value")c.execution!.scope="VALUE_CONDITIONS_V1";
    if(defect === "scope-defeat")c.execution!.scope="TARGETED_DEFEAT_V1";
    if(defect === "status")c.execution!.status="UNSUPPORTED";
    if(defect === "unreviewed")c.provenance.reviewed=false;
    if(defect === "missing-effect")a.effects=[];
    if(defect === "extra-effect")a.effects.push({kind:"DRAW",count:1});
    if(defect === "relation"&&a.effects[0].kind === "SPEND_UNIT")a.effects[0].target.relation="ANY";
    if(defect === "wrong-trigger")a.trigger="WHEN_ATTACKING";
    if(defect === "activation")a.activation={timing:"MAIN",conditionTiming:"ACTIVATION_AND_RESOLUTION",costs:[{kind:"SPEND_SOURCE"}]};
    if(defect === "inherited")a.inherited="EQUIPPED_HOST";
    if(defect === "guard")a.guard="FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN";
    if(defect === "condition")a.conditions=[{kind:"STREET_CRED_GREATER_THAN_RIVAL"}];
    if(defect === "ability-cost")a.cost={kind:"EDDIES",amount:1};
    if(defect === "type")c.type="UNIT";
    if(defect === "cost")c.printedCost={kind:"EDDIES",amount:3};
    if(defect === "power")c.power=0;
    if(defect === "ram")c.ram={GREEN:2};
    if(defect === "color")c.colors=["RED"];
    if(defect === "classification")c.tags=["Merc"];
    if(defect === "sell")c.sellProfile.allowed=false;
    if(defect === "keyword")c.mechanics.keywords=["QUICK"];
    if(defect === "modifier")c.mechanics.modifiers=[{kind:"GRANT_PRINTED_POWER_TO_HOST"}];
    if(defect === "unreviewed"){assert.equal(supportsTargetedSpendCard(c,context).ok,false);assert.throws(()=>createContentBundle(policy,[c],context.content.manifest.engine));return;}
    const ctx={content:createContentBundle(policy,context.content.cards.map(x=>x.id===c.id?c:x),context.content.manifest.engine)};assert.equal(supportsTargetedSpendCard(c,ctx).ok,false);assert.equal(supportsPlay(c,ctx).ok,false);assert.equal(createGameWithEvents(spendInput("bad"),ctx).ok,false);
});
for(const defect of ["orphan","wrong-source","wrong-effect","wrong-actor","extra-target","missing-target","zero-targets","singleton","left","cost5","friendly","face-down","defeat-phase","defeat-order","gig-target","payment-phase","primitive-index","pending-copy"] as const)test("reject malformed external spend choice: "+defect,()=>{
    const s=GameStateSchema.parse(trace.pendingTarget), c=s.resolution.playContinuation!, target=s.objects.cards[trace.target];
    if(defect === "orphan")delete s.resolution.playContinuation;
    if(defect === "wrong-source")c.sourceId=trace.target;
    if(defect === "wrong-effect")s.resolution.current!.effect={kind:"DRAW",count:1};
    if(defect === "wrong-actor"){s.timing.actingPlayer=rival;s.resolution.choice!.actorId=rival;}
    if(defect === "extra-target")s.resolution.choice!.options.push({kind:"CARD",cardInstanceId:trace.source});
    if(defect === "missing-target")s.resolution.choice!.options.pop();
    if(defect === "zero-targets")s.resolution.choice!.options=[];
    if(defect === "singleton")s.resolution.choice!.options=s.resolution.choice!.options.slice(0,1);
    if(defect === "left"){s.players[rival].zones.BATTLEFIELD=s.players[rival].zones.BATTLEFIELD.filter(id=>id!==target.id);s.players[rival].zones.TRASH.push(target.id);target.zone.zone="TRASH";}
    if(defect === "cost5"){target.cardId=context.content.cards.find(c=>c.id==="mt0d12-flathead")!.id;}
    if(defect === "friendly")target.controllerId=actor;
    if(defect === "face-down")target.face="DOWN";
    if(defect === "defeat-phase")s.resolution.targetedDefeatContinuation={phase:"TARGET"};
    if(defect === "defeat-order")s.resolution.defeatContinuation={defeats:[{targetId:trace.target,defeatedBy:trace.source}],orders:[{targetId:trace.target,cardIds:[]}]};
    if(defect === "gig-target")c.targetGigId=Object.values(s.objects.gigs)[0].id;
    if(defect === "payment-phase")c.phase="PAYMENT";
    if(defect === "primitive-index")s.resolution.current!.primitiveIndex=1;
    if(defect === "pending-copy")s.resolution.pending.push(s.resolution.current!);
    const before=JSON.stringify(s);assert.equal(validateState(s,context).ok,false);assert.equal(resolveActionId(s,actor,actions(trace.pendingTarget,context)[0].actionId,context).ok,false);assert.equal(JSON.stringify(s),before);
});
test("READY→SPENT invalidates old action IDs yet a refreshed spent-target choice is legal per FAQ",()=>{
    const s=GameStateSchema.parse(trace.pendingTarget);s.objects.cards[trace.target].readiness="SPENT";assert.ok(validateState(s,context).ok);assert.ok(targets(s).includes(trace.target));
    for(const a of actions(trace.pendingTarget,context))assert.equal(resolveActionId(s,actor,a.actionId,context).ok,false);
    const refreshed=pick(s,context,o=>o.kind === "CARD"&&o.cardInstanceId===trace.target);assert.equal(payloads(refreshed).some(e=>e.kind === "CARD_SPENT"),false);assert.equal(refreshed.state.timing.step,"MAIN");
});
test("proper target departure invalidates old choice without auto-retarget or partial mutation",()=>{
    const m=new TurnMutation(trace.pendingTarget,context);unwrap(processDeparture(m,trace.target,"TRASH",defeatBatch(m.state,trace.target)));assert.equal(validateState(m.state,context).ok,false);assert.equal(resolveActionId(m.state,actor,actions(trace.pendingTarget,context)[0].actionId,context).ok,false);
});
test("transport counters do not affect IDs; public readiness changes both viewers, private rival deck does not",()=>{
    const s=GameStateSchema.parse(trace.pendingTarget);s.match.id=MatchIdSchema.parse(randomUUID());s.match.version=GameStateVersionSchema.parse(s.match.version+12);s.match.eventSequence=GameEventSequenceSchema.parse(s.match.eventSequence+30);
    assert.equal(hashPosition(s),hashPosition(trace.pendingTarget));assert.notEqual(hashReplayState(s),hashReplayState(trace.pendingTarget));assert.deepEqual(actions(s,context).map(a=>a.actionId),actions(trace.pendingTarget,context).map(a=>a.actionId));
    const hidden=GameStateSchema.parse(trace.pendingTarget),deck=hidden.players[rival].zones.DECK;[deck[0],deck[1]]=[deck[1],deck[0]];assert.deepEqual(actions(hidden,context).map(a=>a.actionId),actions(trace.pendingTarget,context).map(a=>a.actionId));
    for(const viewer of s.match.playerOrder){const before=unwrap(observe(trace.pendingTarget,viewer,context)),after=unwrap(observe(trace.finalState,viewer,context));assert.notEqual(hashObservation(before),hashObservation(after));assert.ok(JSON.stringify(after).includes('"readiness":"SPENT"'));}
});
test("spend target survives JSON/wire/training; automatic resolution creates no forced decision",()=>{
    for(const s of [trace.pendingPayment,trace.pendingTarget,trace.finalState]){assert.deepEqual(unwrap(validateState(JSON.parse(JSON.stringify(s)),context)),s);const response=handleRequest({schemaVersion:1,requestId:randomUUID(),op:"listLegalActions",state:s,actorId:s.timing.actingPlayer,content:context.content});assert.ok(response.ok&&response.value.kind === "actions");}
    const p=unwrap(generatePosition(trace.pendingTarget,actor,context,"spend-contract"));assert.ok(validateTrainingPosition(p,context).ok);assert.ok(modelInput(p).legalActions.every(a=>a.descriptor.label.startsWith("Spend ")));assert.equal(JSON.stringify(modelInput(p)).includes(trace.initialization.seed),false);assert.ok(trace.positions.every(p=>p.legalActions.length>1));
});
test("all51 prior revisions, constructed40–50/3 Legends and RAM/copy constraints are preserved",()=>{
    const old=targetedContext();assert.equal(old.content.cards.length,51);assert.equal(context.content.cards.length,52);for(const c of old.content.cards)assert.deepEqual(context.content.cards.find(x=>x.id===c.id),c);
    const input=spendInput("format");assert.ok(createGameWithEvents(input,context).ok);
    for(const deck of [{...input.decks[0],main:input.decks[0].main.slice(0,27)},{...input.decks[0],main:[...input.decks[0].main,SURVEILLANCE]},{...input.decks[0],legends:input.decks[0].legends.slice(0,2)},{...input.decks[0],main:["psycho-squad",...input.decks[0].main.slice(1)]}])assert.equal(createGameWithEvents({...input,decks:[deck,input.decks[1]]},context).ok,false);
});
test("legal headline golden exactly reproduces setup, multiple targets, equipped Dexter spend and MAIN",()=>{assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/targeted-spend-replay.v1.json",import.meta.url),"utf8")),trace);assert.equal(trace.finalState.timing.turn,7);const other=trace.pendingTarget.resolution.choice!.options.find(o=>o.kind === "CARD"&&o.cardInstanceId!==trace.target)!;assert.ok(other.kind === "CARD");assert.equal(trace.finalState.objects.cards[other.cardInstanceId].readiness,"READY");assert.ok(trace.steps.every(s=>!s.events.some(e=>e.payload.kind === "CARD_DEFEATED")));});
