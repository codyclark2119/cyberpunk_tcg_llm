import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameStateSchema, RulesetSchema, hashCanonical, type GameState } from "@tcg/domain";
import { applyAction, hashPosition, hashReplayState, hashObservation, observe, listLegalActions, validateState, transferGigControl, RulesView } from "@tcg/engine";
import { areBothFixersEmpty, controlledGigCount } from "../packages/engine/src/overtime";
import { TurnMutation } from "../packages/engine/src/turn";
import { overtimeContext } from "./overtime-fixture";
import { overtimeReplay } from "./overtime-replay";
import { arrangeGigs, repinOvertime, overtimeChoose, overtimeEnd, overtimeFinishChoices, overtimeEndCase, overtimeMultiStealState, overtimeAttackToSteal, overtimeTake } from "./overtime-focused";
import { demoStarterContext } from "./demo-starter-fixture";
import { demoSetupReplay } from "./demo-setup-replay";
import { attackPowerContext } from "./attack-condition-power-fixture";
import { attackConditionPowerReplay } from "./attack-condition-power-replay";
import { preventionExpirationReplay } from "./combat-restrictions-replay";
import { unwrap } from "./turn-replay";
const trace = overtimeReplay(), context = overtimeContext(), b = trace.boundaries, [p0,p1] = trace.finalState.match.playerOrder;
const kinds = (events: typeof trace.steps[number]["events"]) => events.map(e => e.payload.kind);
function terminal(s: GameState) {
    assert.ok(validateState(s, context).ok); assert.equal(s.timing.step,"FINISHED"); assert.equal(s.timing.combat.stage,"NONE");
    assert.deepEqual(s.resolution,{stage:"DECISION",current:null,pending:[],discovered:[],choice:null});
    for(const id of s.match.playerOrder) assert.deepEqual(unwrap(listLegalActions(s,id,context)),[]);
}
test("overtime exact rule nodes are individually hashed; FAQ review is narrow and explicit",()=>{
    const f=JSON.parse(readFileSync("tests/fixtures/overtime-rules.v1.json","utf8")); assert.equal(f.rules.length,76);
    for(const r of f.rules) assert.equal(hashCanonical(r),f.ruleHashes[r.display_number]);
    for(const n of ["1.10","1.11.1","1.11.2","1.13.1","8.16.1","8.16.2","8.17","8.18","9.23.5.1"]) assert.ok(f.rules.some((r:{display_number:string})=>r.display_number===n));
    assert.equal(f.faqEvidence.faqs.length,3); assert.equal(f.faqEvidence.overtimeSearch.matches,0);
});
test("legal constructed overtime replay is deterministic and ends on its seventh Gig",()=>{
    assert.deepEqual(overtimeReplay(),trace); assert.deepEqual(trace,JSON.parse(readFileSync("tests/fixtures/overtime-replay.v1.json","utf8"))); assert.equal(trace.steps.length,55); assert.equal(trace.positions.length,51);
    assert.equal(trace.initialization.format,"CONSTRUCTED"); assert.equal(trace.finalState.timing.turn,27);
    assert.deepEqual(trace.finalState.match.overtime,{startedAfterTurn:14}); assert.equal(trace.finalState.match.outcome?.reason,"OVERTIME_GIGS");
    assert.equal(controlledGigCount(trace.finalState,p0),7); terminal(trace.finalState);
    assert.equal(trace.steps.flatMap(s=>s.events).filter(e=>e.payload.kind==="OVERTIME_STARTED").length,1);
    assert.deepEqual(context.content.cards,attackPowerContext().content.cards);
});
test("Fixers empty before qualification; actual consecutive starts 13 and 14 precede entry after14",()=>{
    let state: GameState=trace.initialized.state; let emptyAt12=false;
    for(const step of trace.steps){ state=unwrap(applyAction(state,step.action,context)).state;
        if(state.timing.turn===12 && areBothFixersEmpty(state)){emptyAt12=true;assert.equal(state.timing.emptyFixerStarts,0);}
    }
    assert.ok(emptyAt12); assert.equal(b.progress1.timing.turn,13); assert.equal(b.progress1.timing.emptyFixerStarts,1);
    assert.equal(b.entryPending.timing.turn,14); assert.equal(b.entryPending.timing.emptyFixerStarts,2); assert.equal(b.entryPending.match.overtime,undefined);
    const r=overtimeEnd(b.entryPending,context), k=kinds(r.events);
    assert.ok(k.indexOf("TURN_ENDED")<k.indexOf("OVERTIME_STARTED")); assert.ok(k.indexOf("OVERTIME_STARTED")<k.indexOf("TURN_STARTED"));
    assert.equal(r.state.timing.turn,15); assert.equal(r.state.timing.step,"MAIN"); assert.equal(r.state.timing.emptyFixerStarts,undefined);
});
test("qualification queries original Fixers independently of controllers and Street Cred",()=>{
    const s=arrangeGigs(b.progress1,5); assert.ok(areBothFixersEmpty(s)); assert.equal(controlledGigCount(s,p0),5); assert.equal(controlledGigCount(s,p1),7);
    for(const g of Object.values(s.objects.gigs)) if(g.roll.kind==="ROLLED")g.roll.currentValue=1;
    assert.ok(areBothFixersEmpty(s)); assert.equal(controlledGigCount(s,p0),5);
});
test("nonqualifying next start resets progress using a trusted future-restoration board",()=>{
    const s=arrangeGigs(b.progress1,6,true); assert.ok(validateState(s,context).ok); assert.equal(areBothFixersEmpty(s),false);
    const r=overtimeEnd(s,context); assert.equal(r.state.timing.emptyFixerStarts,0); assert.equal(r.state.match.overtime,undefined);
    assert.equal(r.state.timing.step,"MAIN"); // rival Fixer empty: automatic draw then MAIN, even while ours is nonempty.
});
for(const kind of ["Delamain","Dying Night"] as const)test(`${kind} pending end-turn choices complete before entry; no turn-number shortcut`,()=>{
    const c=overtimeEndCase(kind), r=overtimeEnd(c.state,c.context); assert.equal(c.state.timing.turn,5);
    assert.equal(r.state.match.overtime,undefined); assert.equal(r.state.resolution.choice?.kind,"READY_EDDIE");
    assert.equal(kinds(r.events).includes("OVERTIME_STARTED"),false);
    const done=overtimeFinishChoices(r.state,c.context), k=kinds(done.events);
    assert.ok(k.lastIndexOf("EFFECT_RESOLVED")<k.indexOf("OVERTIME_STARTED")); assert.ok(k.indexOf("LAG_REMOVED")<k.indexOf("OVERTIME_STARTED"));
    assert.deepEqual(done.state.match.overtime,{startedAfterTurn:5}); assert.equal(done.state.timing.turn,6);
});
test("this-turn power and unused Reboot expire before overtime entry",()=>{
    const power=attackConditionPowerReplay(), s=arrangeGigs(repinOvertime(power.afterAttack,context)); s.timing.emptyFixerStarts=2;
    assert.ok(s.temporaryModifiers?.length); const done=overtimeEnd(s,context); assert.equal(done.state.temporaryModifiers,undefined);
    const k=kinds(done.events); assert.ok(k.indexOf("POWER_MODIFIER_EXPIRED")>=0); assert.ok(k.indexOf("POWER_MODIFIER_EXPIRED")<k.indexOf("OVERTIME_STARTED"));
    const old=preventionExpirationReplay(), base={content:old.content}, nextContext=overtimeContext(base); let state:GameState=old.initialized.state, found=false;
    for(const step of old.steps){
        if(step.action.action.kind==="END_TURN" && state.fightPreventions?.length){
            const trusted=arrangeGigs(repinOvertime(state,nextContext)); trusted.timing.emptyFixerStarts=2;
            const result=overtimeEnd(trusted,nextContext), e=kinds(result.events); assert.equal(result.state.fightPreventions,undefined);
            assert.ok(e.indexOf("FIGHT_PREVENTION_EXPIRED")>=0); assert.ok(e.indexOf("FIGHT_PREVENTION_EXPIRED")<e.indexOf("OVERTIME_STARTED")); found=true;break;
        } state=unwrap(applyAction(state,step.action,base)).state;
    } assert.ok(found);
});
test("existing seven at entry wins before the next turn starts",()=>{
    const s=arrangeGigs(b.entryPending,5), r=overtimeEnd(s,context), k=kinds(r.events); terminal(r.state);
    assert.equal(r.state.match.outcome?.winnerId,p1); assert.equal(r.state.timing.turn,14);
    assert.ok(k.indexOf("TURN_ENDED")<k.indexOf("OVERTIME_STARTED")); assert.ok(k.indexOf("OVERTIME_STARTED")<k.indexOf("GAME_ENDED")); assert.equal(k.includes("TURN_STARTED"),false);
});
test("six-to-seven steal records movement and stolen history before immediate terminal cleanup",()=>{
    const r=overtimeChoose(b.beforeSteal,context), k=kinds(r.events);terminal(r.state);
    assert.ok(k.indexOf("GIG_CONTROL_CHANGED")<k.indexOf("GIG_STOLEN"));assert.ok(k.indexOf("GIG_STOLEN")<k.indexOf("GAME_ENDED"));
    assert.equal(k.includes("ATTACK_ENDED"),false); assert.ok(!r.events.some(e=>e.payload.kind==="PHASE_CHANGED" && e.payload.step==="MAIN"));
    assert.ok(Object.values(r.state.turnHistory?.gigsStolenByUnit??{}).reduce((n,v)=>n+v,0)>0);
});
test("normal six-to-seven waits for own start, before Ready or empty draw",()=>{
    const s=GameStateSchema.parse(b.beforeSteal); delete s.match.overtime;s.timing.emptyFixerStarts=0;
    let r=overtimeChoose(s,context); assert.equal(r.state.match.outcome,undefined);assert.equal(r.state.timing.step,"MAIN");
    r=overtimeEnd(r.state,context);assert.equal(r.state.match.outcome,undefined);
    const before=GameStateSchema.parse(r.state);for(const id of before.players[p0].zones.DECK){before.objects.cards[id].zone.zone="TRASH";before.objects.cards[id].face="UP";before.players[p0].zones.TRASH.push(id);}before.players[p0].zones.DECK=[];
    r=overtimeEnd(before,context);assert.equal(r.state.match.outcome?.reason,"START_TURN_GIGS");assert.equal(r.state.match.outcome.winnerId,p0);
    assert.ok(!r.events.some(e=>e.payload.kind==="PHASE_CHANGED" && ["READY","DRAW"].includes(e.payload.step)));
});
for(const count of [6,5])test(`two-Gig selection from ${count} transfers simultaneously, then terminates`,()=>{
    // Five vs seven is already terminal; five vs six plus a returned D20 is explicitly trusted supplemental coverage.
    const arranged=count===5?arrangeGigs(b.beforeAttack,5,true):b.beforeAttack;
    const s=overtimeMultiStealState(arranged,context), unit=s.players[p0].zones.BATTLEFIELD.find(id=>s.objects.cards[id].cardId==="emergency-atlus")!;
    assert.equal(new RulesView(s,context).getGigStealAllowance(unit),2);
    const pending=overtimeAttackToSteal(s,context), first=overtimeChoose(pending,context);
    assert.equal(controlledGigCount(first.state,p0),count);assert.equal(first.state.match.outcome,undefined);assert.ok(first.state.resolution.choice);
    assert.equal(kinds(first.events).includes("GIG_CONTROL_CHANGED"),false);
    const final=overtimeChoose(first.state,context);assert.equal(controlledGigCount(final.state,p0),count+2);terminal(final.state);
    assert.equal(final.events.filter(e=>e.payload.kind==="GIG_CONTROL_CHANGED").length,2);
});
test("five vs seven is already won in overtime; an extra fourteen-die pool is malformed",()=>{
    assert.equal(validateState(arrangeGigs(b.beforeAttack,5),context).ok,false);
    const s=GameStateSchema.parse(b.active), gs=Object.values(s.objects.gigs);
    for(const g of gs.slice(0,2)){const id=`${g.id}-extra` as typeof g.id;s.objects.gigs[id]={...g,id};s.players[g.controllerId].gigs.GIGS.push(id);}
    assert.equal(validateState(s,context).ok,false);
});
test("generic transfer and a trusted restored-die roll use the same immediate count check",()=>{
    const id=b.active.players[p1].gigs.GIGS[0], r=unwrap(transferGigControl(b.active,id,p0,context));terminal(r.state);
    assert.equal(transferGigControl(r.state,id,p1,context).ok,false);
    const s=arrangeGigs(b.beforeAttack,6,true);s.timing.step="CHOOSE_GIG";s.timing.window="CHOOSE_GIG";s.resolution.stage="DECISION";
    assert.ok(validateState(s,context).ok);const rolled=overtimeTake(s,context,a=>a.action.kind==="ROLL_GIG");terminal(rolled.state);
    assert.ok(!rolled.events.some(e=>e.payload.kind==="PHASE_CHANGED"&&e.payload.step==="MAIN"));
});
test("overtime empty-draw loss remains immediate; terminal states cannot advance progress",()=>{
    const s=GameStateSchema.parse(b.active), next=s.match.playerOrder.find(id=>id!==s.timing.activePlayer)!;
    for(const id of s.players[next].zones.DECK){s.objects.cards[id].zone.zone="TRASH";s.objects.cards[id].face="UP";s.players[next].zones.TRASH.push(id);}s.players[next].zones.DECK=[];
    const r=overtimeEnd(s,context);assert.equal(r.state.match.outcome?.reason,"EMPTY_DRAW");terminal(r.state);
    const mutation=new TurnMutation(r.state,context), before=hashReplayState(mutation.state);assert.equal(mutation.startTurn().ok,false);assert.equal(hashReplayState(mutation.state),before);
});
test("public progress and active phase affect both observation hashes and POSITION_V2",()=>{
    const zero=GameStateSchema.parse(b.progress1);zero.timing.emptyFixerStarts=0;
    const two=GameStateSchema.parse(b.progress1);two.timing.emptyFixerStarts=2;
    const active=GameStateSchema.parse(b.progress1);delete active.timing.emptyFixerStarts;active.match.overtime={startedAfterTurn:12};
    const states=[zero,b.progress1,two,active];assert.equal(new Set(states.map(hashPosition)).size,4);assert.equal(new Set(states.map(hashReplayState)).size,4);
    for(const id of [p0,p1]){
        const observations=states.map(s=>unwrap(observe(s,id,context)));assert.equal(new Set(observations.map(hashObservation)).size,4);
        assert.deepEqual(observations.map(o=>o.overtime),[{status:"NORMAL",qualifyingTurnStarts:0},{status:"NORMAL",qualifyingTurnStarts:1},{status:"NORMAL",qualifyingTurnStarts:2},{status:"ACTIVE"}]);
    }
});
test("private rival hand/deck order cannot change public overtime action identities",()=>{
    const s=GameStateSchema.parse(b.beforeSteal);s.players[p1].zones.HAND.reverse();s.players[p1].zones.DECK.reverse();
    assert.ok(validateState(s,context).ok);assert.deepEqual(unwrap(observe(s,p0,context)),unwrap(observe(b.beforeSteal,p0,context)));
    assert.deepEqual(unwrap(listLegalActions(s,p0,context)),unwrap(listLegalActions(b.beforeSteal,p0,context)));
});
test("Demo setup remains turn0; a trusted later Demo boundary inherits standard overtime",()=>{
    const demo=demoSetupReplay(), c=demoStarterContext();assert.equal(demo.steps.length,6);assert.equal(demo.finalState.timing.turn,0);
    assert.equal(c.content.ruleset.gameplay?.turnSlice?.overtime,"STANDARD_OVERTIME_V1");assert.equal(unwrap(observe(demo.finalState,demo.finalState.timing.actingPlayer,c)).overtime,undefined);
    let s=GameStateSchema.parse(overtimeChoose(demo.finalState,c).state);
    // Explicit policy-routing smoke only: no exact Demo match or gameplay replay is claimed.
    if(s.timing.step==="CHOOSE_GIG")s=GameStateSchema.parse(overtimeTake(s,c,a=>a.action.kind==="ROLL_GIG").state);
    s=arrangeGigs(s);s.timing.turn=3;s.timing.emptyFixerStarts=2;
    for(const p of Object.values(s.players))p.economy.usageTurn=3;if(s.turnHistory)s.turnHistory.turn=3;
    assert.ok(validateState(s,c).ok);const r=overtimeEnd(s,c);assert.deepEqual(r.state.match.overtime,{startedAfterTurn:3});assert.equal(r.state.match.outcome,undefined);
});
test("strict overtime shape/policy/history contradictions reject without mutating input",()=>{
    const variants: unknown[]=[];
    for(const count of [-1,0.5,3,undefined]){const s=GameStateSchema.parse(b.progress1);s.timing.emptyFixerStarts=count;variants.push(s);}
    for(const turn of [0,1,100]){const s=GameStateSchema.parse(b.active);s.match.overtime={startedAfterTurn:turn};variants.push(s);}
    const pending=GameStateSchema.parse(trace.finalState);pending.resolution.returnTo={kind:"MAIN"};variants.push(pending);
    const mixed=GameStateSchema.parse(b.active);mixed.timing.emptyFixerStarts=2;variants.push(mixed);
    const partial=JSON.parse(JSON.stringify(b.active));partial.match.overtime={};variants.push(partial);
    const setup=GameStateSchema.parse(trace.initialized.state);setup.match.overtime={startedAfterTurn:2};variants.push(setup);
    for(const s of variants){const before=JSON.stringify(s);assert.equal(validateState(s as GameState,context).ok,false);assert.equal(JSON.stringify(s),before);}
    const old=attackPowerContext(), legacy=repinOvertime(b.active,old);assert.equal(validateState(legacy,old).ok,false);
    const policy=JSON.parse(JSON.stringify(context.content.ruleset));delete policy.gameplay.turnSlice.overtime;assert.equal(RulesetSchema.safeParse(policy).success,false);
    const wrong=GameStateSchema.parse(trace.finalState);delete wrong.match.overtime;wrong.timing.emptyFixerStarts=2;assert.equal(validateState(wrong,context).ok,false);
});
