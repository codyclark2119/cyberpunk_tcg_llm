import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { GameStateSchema, canonicalSerialize, hashCanonical } from "@tcg/domain";
import { applyAction, listLegalActions, resolveActionId, hashReplayState, hashPosition, hashObservation, observe, validateState } from "@tcg/engine";
import { modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { demoStarterContext } from "./demo-starter-fixture";
import { demoReferences, referenceCompositionHash } from "./demo-format-fixture";
import { demoMatchReplay, assertNoSuppressedDemoInteraction } from "./demo-match-replay";
import { chooseDemoMatchAction, DEMO_MATCH_POLICY } from "./demo-match-policy";
import { auditDemoObservation, auditDemoModelInput, publicPolicyActions, demoMatchDiagnostics } from "./demo-match-audit";
import { preventionReplay } from "./combat-restrictions-replay";
import { unwrap } from "./turn-replay";
const trace=demoMatchReplay(),context=demoStarterContext();
test("exact physical match uses the unchanged 29 revision-1 cards and 27+3 manifests",()=>{
    assert.equal(trace.initialization.format,"DEMO_STARTER_V1");assert.equal(trace.content.cards.length,29);
    assert.deepEqual(trace.content,context.content);assert.equal(Object.keys(trace.finalState.objects.cards).length,60);
    demoReferences.forEach((m,seat)=>{
        assert.equal(referenceCompositionHash(m),trace.seatManifests[seat].compositionHash);
        const expected=m.entries.flatMap(e=>Array.from({length:e.quantity},()=>`${e.cardId}@${e.revision}`)).sort();
        const actual=Object.values(trace.initialized.state.objects.cards).filter(c=>c.ownerId===trace.initialized.state.match.playerOrder[seat]).map(c=>`${c.cardId}@${c.revision}`).sort();assert.deepEqual(actual,expected);
        assert.equal(trace.initialization.decks[seat].main.length,27);assert.equal(trace.initialization.decks[seat].legends.length,3);
    });
    assert.equal(trace.initialization.decks[1].main.filter(id=>id==="psycho-squad").length,3);
});
test("first candidate terminates without searching past a gap or altering the engine identity",()=>{
    const search=JSON.parse(readFileSync("tests/fixtures/exact-demo-match-search.v1.json","utf8"));assert.equal(search.attempts.length,1);
    assert.equal(search.attempts[0].seed,trace.policy.seed);assert.equal(search.attempts[0].status,"TERMINATED");assert.equal(search.attempts[0].actions,244);
    const overtime=JSON.parse(readFileSync("tests/fixtures/overtime-replay.v1.json","utf8"));assert.deepEqual(trace.content.manifest.engine,overtime.content.manifest.engine);
    assert.equal(trace.policy.id,DEMO_MATCH_POLICY);assert.equal(trace.policy.limits.actions,1200);assert.equal(trace.policy.limits.turns,100);
});
test("same seed/policy reproduces every stored snapshot, action, event, position and final hash",()=>{
    const expected=JSON.parse(readFileSync("tests/fixtures/exact-demo-match-replay.v1.json","utf8"));assert.deepEqual(trace,expected);
    assert.deepEqual(demoMatchReplay(),trace);assert.equal(trace.steps.length,244);assert.equal(trace.positions.length,195);assert.equal(trace.finalState.match.eventSequence,975);
});
test("every action is entitled, descriptor-chosen and replayed through the public engine API",()=>{
    let state=trace.initialized.state;
    for(const step of trace.steps){
        const before=hashReplayState(state),legal=unwrap(listLegalActions(state,step.actorId,context));assert.deepEqual(legal,step.legalActions);
        const input={observation:unwrap(observe(state,step.actorId,context)),legalActions:publicPolicyActions(legal)};
        assert.equal(chooseDemoMatchAction(input.observation,input.legalActions),step.actionId);
        assert.equal(chooseDemoMatchAction(input.observation,[...input.legalActions].reverse()),step.actionId);
        const action=unwrap(resolveActionId(state,step.actorId,step.actionId,context));assert.deepEqual(action,step.action);
        const next=unwrap(applyAction(state,action,context));assert.equal(hashReplayState(state),before);assert.deepEqual(next.state,step.state);assert.deepEqual(next.events,step.events);
        assert.equal(hashReplayState(next.state),step.stateHash);assert.equal(hashPosition(next.state),step.positionHash);
        assert.equal(hashObservation(unwrap(observe(next.state,next.state.timing.actingPlayer,context))),step.observationHash);state=next.state;
    }assert.deepEqual(state,trace.finalState);
});
test("both viewer projections are privacy-audited at every boundary, including Kiroshi and Eddies",()=>{
    const states=[trace.initialized.state,...trace.steps.map(s=>s.state)];let remembered=0,eddies=0;
    for(const state of states)for(const viewer of state.match.playerOrder){
        const observation=auditDemoObservation(state,viewer,context);remembered+=observation.players.flatMap(p=>p.cards).filter(c=>c.rememberedContent).length;
        eddies+=observation.players.flatMap(p=>p.cards).filter(c=>c.zone==="EDDIES").length;
        const before=trace.steps.find(s=>s.state.match.version===state.match.version+1);if(before)assert.deepEqual(observation,before.observations[state.players[viewer].seat]);
    }assert.ok(remembered>0);assert.ok(eddies>0);
});
test("all 195 strategic model inputs contain only entitled observation and descriptor actions",()=>{
    for(const p of trace.positions){assert.ok(p.legalActions.length>1);assert.notEqual(p.observation.step,"CUT_DECISION");assert.equal(p.provenance.generator,DEMO_MATCH_POLICY);
        assert.ok(validateTrainingPosition(p,context).ok);const input=auditDemoModelInput(p,context);assert.deepEqual(input,modelInput(p));assert.equal(chooseDemoMatchAction(input.observation,input.legalActions),trace.steps[Number(p.positionId.replace("exact-demo-",""))].actionId);
    }
});
test("policy module cannot import runtime state, I/O, engine rules, content or action payloads",()=>{
    const ast=ts.createSourceFile("policy.ts",readFileSync("tests/demo-match-policy.ts","utf8"),ts.ScriptTarget.Latest,true);
    for(const statement of ast.statements)if(ts.isImportDeclaration(statement))assert.ok(statement.importClause?.isTypeOnly);
    function inspect(node:ts.Node){
        if(ts.isIdentifier(node))assert.ok(!["GameState","EngineContext","process","globalThis","require","Date","eval","state","rng","seed","action","optionIndices"].includes(node.text),node.text);
        if(ts.isCallExpression(node))assert.notEqual(node.expression.kind,ts.SyntaxKind.ImportKeyword);
        if(ts.isFunctionDeclaration(node)&&node.name?.text==="chooseDemoMatchAction")assert.equal(node.parameters.length,2);
        ts.forEachChild(node,inspect);
    }inspect(ast);
});
test("irrelevant rival hidden permutations preserve the actor policy decision and action IDs",()=>{
    // Counterfactual privacy probe only. This clone never participates in the generated match.
    const p=trace.positions.find(p=>p.state.privateKnowledge?.length&&p.observation.step==="MAIN")!,s=GameStateSchema.parse(p.state),rival=s.match.playerOrder.find(id=>s.players[id].seat!==p.actingSeat)!;
    s.players[rival].zones.HAND.reverse();s.players[rival].zones.DECK.reverse();assert.ok(validateState(s,context).ok);
    const viewer=s.match.playerOrder[p.actingSeat],original=modelInput(p),observation=unwrap(observe(s,viewer,context)),legalActions=publicPolicyActions(unwrap(listLegalActions(s,viewer,context)));
    assert.deepEqual({observation,legalActions},original);assert.equal(chooseDemoMatchAction(observation,legalActions),chooseDemoMatchAction(original.observation,original.legalActions));
});
test("affordable overlap legality is audited before each decision, without altering the match",()=>{
    for(const s of [trace.initialized.state,...trace.steps.map(s=>s.state)])assertNoSuppressedDemoInteraction(s,context);
    // Separate trusted positive probe built from an existing support position, never the headline.
    const old=preventionReplay(), source=old.positions.find(p=>p.state.fightPreventions?.length&&p.observation.step==="RIVAL_REACT")!;
    assert.ok(source);const s=GameStateSchema.parse(source.state),actor=s.timing.actingPlayer;
    const second=Object.values(s.objects.cards).find(c=>c.cardId==="reboot-optics"&&c.ownerId===actor&&c.id!==s.fightPreventions![0].sourceId)!;
    const zone=s.players[second.zone.playerId].zones[second.zone.zone]!;zone.splice(zone.indexOf(second.id),1);
    second.zone={playerId:actor,zone:"HAND"};second.face="DOWN";s.players[actor].zones.HAND.push(second.id);
    assert.ok(validateState(s,{content:old.content}).ok);const before=hashReplayState(s);
    assert.doesNotThrow(()=>assertNoSuppressedDemoInteraction(s,{content:old.content}));
    assert.ok(unwrap(listLegalActions(s,actor,{content:old.content})).some(a=>a.action.kind==="PLAY_CARD"&&a.action.cardInstanceId===second.id));
    assert.equal(hashReplayState(s),before);
});
test("normal turn-start victory is real, unique and clean; stale actions reject after game end",()=>{
    const s=trace.finalState;assert.equal(s.match.outcome?.reason,"START_TURN_GIGS");assert.equal(s.match.outcome.winnerId,s.match.playerOrder[0]);assert.equal(s.timing.turn,14);
    assert.equal(s.timing.step,"FINISHED");assert.equal(s.timing.combat.stage,"NONE");assert.deepEqual(s.resolution,{stage:"DECISION",current:null,pending:[],discovered:[],choice:null});assert.equal(s.match.overtime,undefined);
    const end=trace.steps.at(-1)!;assert.equal(end.events.filter(e=>e.payload.kind==="GAME_ENDED").length,1);
    for(const id of s.match.playerOrder)assert.deepEqual(unwrap(listLegalActions(s,id,context)),[]);
    assert.equal(resolveActionId(s,end.actorId,end.actionId,context).ok,false);assert.equal(applyAction(s,end.action,context).ok,false);
});
test("standalone setup and overtime goldens retain their separate bounded purpose",()=>{
    const setup=JSON.parse(readFileSync("tests/fixtures/demo-setup-replay.v1.json","utf8")),overtime=JSON.parse(readFileSync("tests/fixtures/overtime-replay.v1.json","utf8"));
    assert.equal(setup.finalState.timing.turn,0);assert.equal(setup.steps.length,6);assert.equal(overtime.steps.length,55);assert.equal(overtime.finalState.match.outcome.reason,"OVERTIME_GIGS");
    assert.equal(hashCanonical(trace.content.cards),hashCanonical(setup.content.cards));
});
test("diagnostics record actual participation and events rather than crediting all present cards",()=>{
    const d=demoMatchDiagnostics(trace);assert.deepEqual(d,JSON.parse(readFileSync("tests/fixtures/exact-demo-match-diagnostics.v1.json","utf8")));assert.equal(d.participation.length,29);assert.equal(d.resources.length,2);assert.equal(d.turns.length,14);
    assert.equal(d.eventCounts.ATTACK_DECLARED,27);assert.equal(d.eventCounts.GO_SOLO_ACTIVATED,2);assert.equal(d.eventCounts.LEGEND_LOOKED_AT,2);
    assert.ok(d.turns.every(t=>t.endEffects.length===0));assert.equal(d.eventCounts.OVERTIME_STARTED,undefined);assert.equal(d.eventCounts.FIGHT_PREVENTION_CREATED,undefined);
    assert.ok(d.participation.some(c=>c.unseenCopies>0));assert.equal(d.resources[0].gigs>=7,true);assert.ok(canonicalSerialize(d).length>0);
});
