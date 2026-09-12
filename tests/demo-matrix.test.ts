import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { hashCanonical, GameStateSchema } from "@tcg/domain";
import { createGameWithEvents, applyAction, observe, listLegalActions, resolveActionId, hashReplayState, hashPosition, validateState } from "@tcg/engine";
import { demoStarterContext, demoStarterInput } from "./demo-starter-fixture";
import { DEMO_MATRIX_CONFIG, matrixCoordinates, coordinateId } from "./demo-matrix-config";
import { createDemoMatchPolicy } from "./demo-matrix-policy";
import { chooseDemoMatchAction } from "./demo-match-policy";
import { demoMatrixReplay, PolicyCycleDetector } from "./demo-matrix-replay";
import { auditDemoObservation, publicPolicyActions } from "./demo-match-audit";
import { assertNoSuppressedDemoInteraction } from "./demo-match-replay";
import { aggregateMatrix, summarizeMatrixTrace, type MatrixTrace } from "./demo-matrix-metrics";
import { unwrap } from "./turn-replay";
const load=(family:string):MatrixTrace=>JSON.parse(readFileSync(`tests/fixtures/${family}.v1.json`,"utf8"));
import historicalReview from "./fixtures/reboot-multiplicity-source-review.v1.json";
const matrix=JSON.parse(readFileSync("tests/fixtures/demo-match-matrix.v1.json","utf8"));
test("matrix configuration and exact canonical result identity pin every attempted coordinate",()=>{
    assert.equal(matrixCoordinates("base").length,64);assert.equal(matrixCoordinates("variant").length,128);
    assert.equal(new Set(matrixCoordinates("base").map(coordinateId)).size,64);
    assert.deepEqual(matrix.config,DEMO_MATRIX_CONFIG);
    const {matrixHash,...identity}=matrix;assert.equal(hashCanonical(identity),matrixHash);
    assert.equal(matrix.policyHash,hashCanonical(["tests/demo-match-policy.ts","tests/demo-matrix-policy.ts"].map(p=>readFileSync(p,"utf8"))));
    assert.deepEqual(matrix.records.map((r:{coordinate:unknown})=>r.coordinate),matrixCoordinates("base").slice(0,9));
    assert.equal(matrix.records.filter((r:{status:string})=>r.status==="SUPPORTED_TERMINAL").length,6);
    assert.equal(matrix.records.filter((r:{status:string})=>r.status==="KNOWN_UNSUPPORTED").length,3);
    assert.equal(matrix.unattempted.base,55);assert.equal(matrix.unattempted.variant,128);
});
test("all sixteen setup preferences select the actual first player and per-seat mulligans deterministically",()=>{
    const context=demoStarterContext(),before=hashCanonical(context.content);
    for(const record of matrix.setupAudit){const replay=demoMatrixReplay(record.coordinate,{setupOnly:true,context});
        assert.equal(replay.failure,null);assert.equal(replay.finalState.setup,undefined);assert.equal(hashReplayState({...replay.finalState,match:{...replay.finalState.match,engineVersion:historicalReview.runtime.engine.version,engineArtifactHash:historicalReview.runtime.engine.artifactHash,contentManifestHash:historicalReview.runtime.contentManifestHash}}),record.finalHash);
        assert.deepEqual(summarizeMatrixTrace(replay).setup,record.setup);
    }
    assert.equal(hashCanonical(context.content),before);
});
test("variant chooser has only public arguments and delegates unchanged gameplay ranking",()=>{
    const source=ts.createSourceFile("policy.ts",readFileSync("tests/demo-matrix-policy.ts","utf8"),ts.ScriptTarget.Latest,true);
    const forbidden=new Set(["GameState","state","EngineContext","rng","seed","process","globalThis","require","Date","eval","optionIndices"]);
    function visit(node:ts.Node){if(ts.isIdentifier(node))assert.ok(!forbidden.has(node.text),node.text);ts.forEachChild(node,visit);}visit(source);
    for(const statement of source.statements)if(ts.isImportDeclaration(statement)){
        const path=(statement.moduleSpecifier as ts.StringLiteral).text;
        assert.ok(statement.importClause?.isTypeOnly||path==="./demo-match-policy");
    }
    const trace=load("demo-matrix-overlap-replay");
    for(const step of trace.steps.filter(s=>!["CHOOSE_FIRST_PLAYER","MULLIGAN_DECISION"].includes(s.observation.step!)))
        for(const first of ["FIRST","SECOND"] as const){const choose=createDemoMatchPolicy({chooseFirstOrSecond:first,mulligan:[true,true]}),publicActions=publicPolicyActions(step.legalActions);
            assert.equal(choose(step.observation,publicActions),chooseDemoMatchAction(step.observation,publicActions));
            assert.equal(choose(step.observation,[...publicActions].reverse()),step.actionId);
        }
});
test("historical overlap boundary now enumerates and accepts the affordable second play",()=>{
    const trace=load("demo-matrix-overlap-replay"),state=trace.finalState,context={content:trace.content};
    assert.equal(trace.failure,null);assert.equal(trace.steps.length,206);assert.equal(state.match.outcome,undefined);
    assert.ok(validateState(state,context).ok);const before=hashReplayState(state);
    assert.doesNotThrow(()=>assertNoSuppressedDemoInteraction(state,context));
    assert.equal(hashReplayState(state),before);assert.equal(state.fightPreventions?.length,1);
    const reboot=state.players[state.timing.actingPlayer].zones.HAND.find(id=>trace.content.cards.find(c=>c.id===state.objects.cards[id].cardId)?.displayName==="Reboot Optics")!;
    assert.ok(reboot);assert.equal(unwrap(listLegalActions(state,state.timing.actingPlayer,context)).some(a=>a.action.kind==="PLAY_CARD"&&a.action.cardInstanceId===reboot),true);
    const attempted=applyAction(state,{actorId:state.timing.actingPlayer,action:{kind:"PLAY_CARD",cardInstanceId:reboot}},context);
    assert.equal(attempted.ok,true);
});
test("matrix coverage detects actual empty draw, overtime and bounded legal branching",()=>{
    const traces=[load("demo-matrix-empty-draw-replay"),load("demo-matrix-overtime-replay"),load("demo-matrix-overlap-replay")];
    const summary=aggregateMatrix(traces.map(summarizeMatrixTrace));assert.equal(summary.completed,2);assert.equal(summary.terminals.EMPTY_DRAW,1);assert.equal(summary.terminals.OVERTIME_GIGS,1);
    assert.equal(summary.mechanics.find(m=>m.mechanic==="yorinobuTrigger")!.totalOccurrences,9);
    assert.equal(summary.cards.length,29);assert.ok(summary.legal.max>1);assert.ok(summary.modelBytes.max>summary.observationBytes.max);
});
test("interleaved independent games preserve state, content and RNG; unrelated match action IDs reject",()=>{
    const context=demoStarterContext(),contentBefore=hashCanonical(context.content);
    const a=load("demo-matrix-empty-draw-replay"),b=load("demo-matrix-overtime-replay");
    const states=[unwrap(createGameWithEvents(a.initialization,context)).state,unwrap(createGameWithEvents(b.initialization,context)).state];
    const traces=[a,b];
    for(let i=0;i<12;i++)for(let seat=0;seat<2;seat++){
        const before=hashReplayState(states[1-seat]),rngBefore=hashCanonical(states[1-seat].rng),step=traces[seat].steps[i];
        states[seat]=unwrap(applyAction(states[seat],step.action,context)).state;
        assert.deepEqual(states[seat],step.state);assert.equal(hashReplayState(states[1-seat]),before);assert.equal(hashCanonical(states[1-seat].rng),rngBefore);
    }
    const unrelated=b.steps[100].state,foreign=a.steps[100];
    assert.equal(resolveActionId(unrelated,unrelated.timing.actingPlayer,foreign.actionId,context).ok,false);
    assert.equal(hashCanonical(context.content),contentBefore);
    const fresh=unwrap(createGameWithEvents(a.initialization,context));assert.deepEqual(fresh,a.initialized);
    // Existing IDs bind an observation/seat, not match identity: identical views deliberately share IDs.
    const input=demoStarterInput("matrix-same-view"),one=unwrap(createGameWithEvents(input,context)).state;
    const two=unwrap(createGameWithEvents({...input,matchId:"00000000-0000-4000-a000-00000000d099"},context)).state;
    assert.deepEqual(unwrap(observe(one,one.timing.actingPlayer,context)),unwrap(observe(two,two.timing.actingPlayer,context)));
    assert.deepEqual(publicPolicyActions(unwrap(listLegalActions(one,one.timing.actingPlayer,context))),publicPolicyActions(unwrap(listLegalActions(two,two.timing.actingPlayer,context))));
});
test("PositionHash excludes replay identity counters; policy loop detector must not use ReplayStateHash",()=>{
    const trace=load("demo-matrix-overlap-replay"),state=trace.finalState;
    const clone=structuredClone(state),changed=GameStateSchema.parse({...clone,match:{...clone.match,version:clone.match.version+1,eventSequence:clone.match.eventSequence+1}});
    assert.notEqual(hashReplayState(state),hashReplayState(changed));assert.equal(hashPosition(state),hashPosition(changed));
    const selected=unwrap(listLegalActions(state,state.timing.actingPlayer,{content:trace.content}))[0],detector=new PolicyCycleDetector();
    detector.record(state,selected);assert.throws(()=>detector.record(changed,selected),/POLICY_DEADLOCK/);
});
test("variant decisions ignore rival hidden hand/deck order under the same public observation",()=>{
    const trace=load("demo-matrix-overtime-replay"),context={content:trace.content};
    const step=trace.steps.find(s=>s.observation.step==="MAIN"&&s.observation.players.find(p=>p.seat!==s.observation.viewerSeat)!.counts.HAND>1)!;
    const state=trace.steps[trace.steps.indexOf(step)-1].state,altered=structuredClone(state),actor=state.timing.actingPlayer,rival=state.match.playerOrder.find(id=>id!==actor)!;
    const privatePlayer=altered.players[rival];
    const changed={...altered,players:{...altered.players,[rival]:{...privatePlayer,zones:{...privatePlayer.zones,HAND:[...privatePlayer.zones.HAND].reverse(),DECK:[...privatePlayer.zones.DECK].reverse()}}}};
    assert.ok(validateState(changed,context).ok);
    const original=auditDemoObservation(state,actor,context),counterfactual=auditDemoObservation(changed,actor,context);assert.deepEqual(original,counterfactual);
    const choose=createDemoMatchPolicy({chooseFirstOrSecond:"SECOND",mulligan:[true,true]});
    assert.equal(choose(original,publicPolicyActions(unwrap(listLegalActions(state,actor,context)))),choose(counterfactual,publicPolicyActions(unwrap(listLegalActions(changed,actor,context)))));
});
