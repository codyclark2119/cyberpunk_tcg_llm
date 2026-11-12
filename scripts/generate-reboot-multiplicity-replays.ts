import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { hashCanonical, GameActionSchema } from "@tcg/domain";
import { applyAction, listLegalActions, observe } from "@tcg/engine";
import { demoMatrixReplay } from "../tests/demo-matrix-replay";
import { createDemoMatchPolicy } from "../tests/demo-matrix-policy";
import { demoStarterContext } from "../tests/demo-starter-fixture";
import { summarizeMatrixTrace } from "../tests/demo-matrix-metrics";
import { unwrap } from "../tests/turn-replay";
import prefixes from "../tests/fixtures/reboot-multiplicity-reproducers.v1.json";
import { compactArtifactWriter, matrixTraceDir, matrixTracePath } from "./lib/generated-artifacts";
import { coordinateId } from "../tests/demo-matrix-config";
import { eventsMatchHashUpToLagOrder } from "./lib/lag-order";
const check=process.argv.includes("--check");
matrixTraceDir({create:true});
const context=demoStarterContext();
// Fixtures are written (or checked) only after every assertion below has passed.
const pending:[path:string,value:unknown][]=[];
const records=[];
for(const prefix of prefixes.records){
    const coordinate={...prefix.coordinate,branch:"base",seats:prefix.coordinate.seats as "A"|"B",chooseFirstOrSecond:"FIRST",mulligan:[false,false]} as const;
    const trace=demoMatrixReplay(coordinate,{context});
    assert.deepEqual(trace.initialization,prefix.initialization,"Original exact initialization/decks unchanged");
    assert.ok(trace.steps.length>prefix.steps.length,JSON.stringify(trace.failure));
    for(const [i,original] of prefix.steps.entries()){
        assert.deepEqual(trace.steps[i].action,GameActionSchema.parse(original.action),`original action ${i}`);
        assert.ok(eventsMatchHashUpToLagOrder(trace.steps[i].events,original.eventsHash),`original events ${i} (LAG_REMOVED runs compared by card id)`);
        assert.equal(hashCanonical(trace.steps[i].observations),original.observationsHash);
    }
    const before=trace.steps[prefix.steps.length-1].state,step=trace.steps[prefix.steps.length];
    assert.equal(before.fightPreventions!.length,1);
    const legal=unwrap(listLegalActions(before,before.timing.actingPlayer,context));
    assert.ok(legal.some(a=>a.action.kind==="PLAY_CARD"&&a.action.cardInstanceId===prefix.secondSourceId));
    assert.equal(createDemoMatchPolicy(coordinate)(unwrap(observe(before,before.timing.actingPlayer,context)),legal.map(({actionId,descriptor})=>({actionId,descriptor}))),step.actionId);
    assert.equal(step.action.action.kind,"PLAY_CARD");
    if(step.action.action.kind==="PLAY_CARD")assert.equal(step.action.action.cardInstanceId,prefix.secondSourceId);
    assert.ok(applyAction(before,step.action,context).ok);
    const two=trace.steps.findIndex((s,i)=>i>=prefix.steps.length&&s.state.fightPreventions?.length===2);
    assert.ok(two>=0,"second real Program resolved with two independent occurrences");
    const consumed=trace.steps.findIndex((s,i)=>i>two&&s.events.filter(e=>e.payload.kind==="FIGHT_PREVENTION_CONSUMED").length===2);
    const expired=trace.steps.findIndex((s,i)=>i>two&&s.events.filter(e=>e.payload.kind==="FIGHT_PREVENTION_EXPIRED").length===2);
    assert.ok(consumed>=0||expired>=0,"both occurrences consumed together or independently expired");
    if(consumed>=0)assert.equal(trace.steps[consumed].state.fightPreventions,undefined);
    const summary=summarizeMatrixTrace(trace);
    records.push({coordinate,prefixActions:prefix.steps.length,secondPlayAction:prefix.steps.length+1,twoOutstandingAfterAction:two+1,consumedAfterAction:consumed<0?null:consumed+1,expiredAfterAction:expired<0?null:expired+1,summary});
    writeFileSync(matrixTracePath(coordinateId(coordinate)),JSON.stringify(trace));
    if(coordinate.seats==="A"&&coordinate.seed==="demo-matrix-003"){
        assert.ok(consumed>=0,"primary exact acceptance must reach the qualifying fight");
        pending.push(["tests/fixtures/reboot-multiplicity-replay.v1.json",trace]);
        // Current-engine traversal of the original stopping prefix; its original actions/hashes remain in the frozen source-review fixture.
        pending.push(["tests/fixtures/demo-matrix-overlap-replay.v1.json",{...trace,failure:null,purpose:"HISTORICAL_PREFIX",note:"Original 206-action source-blocked prefix under current pins. Second Reboot is now legal; this is not a current engine failure.",positions:trace.positions.slice(0,171),steps:trace.steps.slice(0,prefix.steps.length),finalState:before,finalStateHash:trace.steps[prefix.steps.length-1].stateHash}]);
    }
    console.log(JSON.stringify({coordinate,actions:trace.steps.length,failure:trace.failure?.code,terminal:trace.finalState.match.outcome,secondPlay:prefix.steps.length+1,two:two+1,consumed:consumed+1,expired:expired+1}));
    assert.equal(trace.failure,null,JSON.stringify(trace.failure));
}
assert.equal(pending.length,2,"primary exact acceptance coordinate (demo-matrix-003, seats A) must be among the reproducers");
pending.push(["tests/fixtures/reboot-multiplicity-acceptance.v1.json",{schemaVersion:1,ruling:"reboot-multiplicity-ruling.v1.json",records}]);
const artifact=compactArtifactWriter(check);
for(const [path,value] of pending)artifact(path,value);
