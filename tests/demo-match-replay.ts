import assert from "node:assert/strict";
import { type GameState, type DeepReadonly } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation, type EngineContext, type PlayerObservation } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { paymentCandidates } from "../packages/engine/src/payment";
import { createsFightPrevention } from "../packages/engine/src/restriction-support";
import { isReactDecision } from "../packages/engine/src/react-support";
import { demoStarterContext, demoStarterInput } from "./demo-starter-fixture";
import { demoReferences, referenceCompositionHash } from "./demo-format-fixture";
import { chooseDemoMatchAction, DEMO_MATCH_POLICY } from "./demo-match-policy";
import { unwrap } from "./turn-replay";
export const DEMO_MATCH_SEED = "exact-demo-match-0";
export const DEMO_MATCH_LIMITS = { actions: 1200, turns: 100 } as const;
/** Diagnostic only; never selects an action or feeds information to the policy.
 * Every otherwise affordable additional prevention must be enumerated. Fail on a legality regression before the chooser can bypass it. */
export function assertNoSuppressedDemoInteraction(state:GameState,context:EngineContext) {
    if(!state.fightPreventions?.length)return;
    const actor=state.timing.actingPlayer, main=state.timing.window==="MAIN"&&state.resolution.stage==="DECISION";
    const react=isReactDecision(state,actor,context);
    if(!main&&!react)return;
    for(const id of state.players[actor].zones.HAND){
        const c=state.objects.cards[id],r=context.content.cards.find(r=>r.id===c.cardId&&r.revision===c.revision)!;
        if(!createsFightPrevention(r)||(!main&&!r.mechanics.keywords.includes("QUICK")))continue;
        if(r.printedCost.kind==="EDDIES"&&(r.printedCost.amount===0||paymentCandidates(state,actor,context,r.printedCost.amount,[]).length))
            assert.ok(unwrap(listLegalActions(state,actor,context)).some(a=>a.action.kind==="PLAY_CARD"&&a.action.cardInstanceId===id), `MISSING_LEGAL_FIGHT_PREVENTION_PLAY turn=${state.timing.turn} source=${id}`);
    }
}
export function demoMatchReplay(seed=DEMO_MATCH_SEED, collectPositions=true) {
    const context=demoStarterContext(), initialization={...demoStarterInput(seed),matchId:"00000000-0000-4000-a000-00000000d002"};
    const hashes=["7ef234191430bce642888161bcad4127c138faddb41c826a0f7b8b68fd90a386","c0551a2293a54080e44cbf45afbd7daf96d9b8b33ef9b113037647004991c38e"];
    demoReferences.forEach((m,i)=>assert.equal(referenceCompositionHash(m),hashes[i]));
    assert.equal(context.content.cards.length,29);assert.ok(context.content.cards.every(c=>c.revision===1&&demoReferences.some(m=>m.entries.some(e=>e.cardId===c.id))));
    const initialized=unwrap(createGameWithEvents(initialization,context));let state:GameState=initialized.state;
    const steps: (ReturnType<typeof import("./turn-replay").turnReplay>["steps"][number] & { state:GameState; beforeTurn:number; observations: DeepReadonly<PlayerObservation>[] })[]=[],positions:TrainingPosition[]=[];
    while(!state.match.outcome){
        if(steps.length>=DEMO_MATCH_LIMITS.actions||state.timing.turn>DEMO_MATCH_LIMITS.turns)throw new Error(`POLICY_CAP seed=${seed} actions=${steps.length} turn=${state.timing.turn}`);
        assertNoSuppressedDemoInteraction(state,context);
        const actorId=state.timing.actingPlayer,legalActions=unwrap(listLegalActions(state,actorId,context)),observation=unwrap(observe(state,actorId,context));
        const observations=state.match.playerOrder.map(id=>unwrap(observe(state,id,context)));
        if(!legalActions.length)throw new Error(`NONTERMINAL_NO_ACTION seed=${seed} step=${state.timing.step} turn=${state.timing.turn}`);
        // The policy sees the exact public model action projection, never actorId/action payloads or GameState.
        const policyActions=legalActions.map(({actionId,descriptor})=>({actionId,descriptor}));
        const chosenId=chooseDemoMatchAction(observation,policyActions),selected=legalActions.find(a=>a.actionId===chosenId)!;assert.ok(selected);
        if(collectPositions && legalActions.length>1 && !["CUT_DECISION"].includes(observation.step!))
            positions.push(unwrap(generatePosition(state,actorId,context,`exact-demo-${steps.length}`,{generator:DEMO_MATCH_POLICY,revision:"1",seed})));
        const action={actorId,action:selected.action},beforeTurn=state.timing.turn,next=unwrap(applyAction(state,action,context));state=next.state;
        steps.push({actorId,action,actionId:selected.actionId,legalActions,observation,observations,beforeTurn,events:next.events,state,stateHash:hashReplayState(state),positionHash:hashPosition(state),observationHash:hashObservation(unwrap(observe(state,state.timing.actingPlayer,context))),step:state.timing.step});
    }
    assert.equal(state.timing.step,"FINISHED");assert.equal(state.resolution.current,null);assert.equal(state.resolution.choice,null);assert.deepEqual(state.resolution.pending,[]);
    for(const actor of state.match.playerOrder)assert.deepEqual(unwrap(listLegalActions(state,actor,context)),[]);
    assert.equal(steps.flatMap(s=>s.events).filter(e=>e.payload.kind==="GAME_ENDED").length,1);
    return {schemaVersion:1,note:"One exact physical Demo match. Observation/descriptor-only deterministic test policy; no state/RNG/card patches, training or gold.",policy:{id:DEMO_MATCH_POLICY,seed,limits:DEMO_MATCH_LIMITS},seatManifests:demoReferences.map((m,seat)=>({seat,id:m.id,compositionHash:m.compositionHash})),content:context.content,initialization,initialized,positions,steps,finalState:state,finalStateHash:hashReplayState(state)};
}
