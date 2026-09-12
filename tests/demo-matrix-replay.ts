import assert from "node:assert/strict";
import { type GameState, type DeepReadonly, type LegalAction } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation, type EngineContext, type PlayerObservation } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { demoStarterContext, demoStarterInput } from "./demo-starter-fixture";
import { demoReferences, referenceCompositionHash } from "./demo-format-fixture";
import { createDemoMatchPolicy } from "./demo-matrix-policy";
import { DEMO_MATRIX_CONFIG, coordinateId, type MatrixCoordinate } from "./demo-matrix-config";
import { auditDemoObservation, auditDemoModelInput, publicPolicyActions } from "./demo-match-audit";
import { hashCanonical } from "@tcg/domain";
import { assertNoSuppressedDemoInteraction } from "./demo-match-replay";
import { unwrap } from "./turn-replay";
export type MatrixFailure = { classification: "KNOWN_UNSUPPORTED" | "ENGINE_ERROR" | "POLICY_DEADLOCK" | "DEFENSIVE_CAP"; category: string; code: string; message: string; turn: number; actorSeat: number; phase: string | undefined; positionHash: string; observation: DeepReadonly<PlayerObservation>; legalActions: ReturnType<typeof publicPolicyActions>; chosenAction: ReturnType<typeof publicPolicyActions>[number] | null };
/** Ignore opaque choice IDs; the descriptor and selected options carry choice semantics. */
export class PolicyCycleDetector {
    private readonly seen = new Set<string>();
    record(state: GameState, selected: DeepReadonly<LegalAction>) {
        const action=selected.action.kind==="CHOOSE"?{kind:"CHOOSE",label:selected.descriptor.label,optionIndices:selected.action.optionIndices}:selected.action;
        const key=hashCanonical({positionHash:hashPosition(state),actor:state.players[state.timing.actingPlayer].seat,action});
        if(this.seen.has(key))throw new Error("POLICY_DEADLOCK repeated PositionHash + actor + semantic action");
        this.seen.add(key);
    }
}
export function demoMatrixReplay(coordinate: MatrixCoordinate, options: { setupOnly?: boolean; context?: EngineContext } = {}) {
    const seed=coordinate.seed, choose=createDemoMatchPolicy(coordinate), context=options.context??demoStarterContext();
    const initialization={...demoStarterInput(seed),matchId:"00000000-0000-4000-a000-00000000d003"};
    if(coordinate.seats === "B") initialization.decks.reverse();
    const bundleBefore=hashCanonical(context.content), cycles=new PolicyCycleDetector();
    let failure: MatrixFailure | null = null;
    const hashes=["7ef234191430bce642888161bcad4127c138faddb41c826a0f7b8b68fd90a386","c0551a2293a54080e44cbf45afbd7daf96d9b8b33ef9b113037647004991c38e"];
    demoReferences.forEach((m,i)=>assert.equal(referenceCompositionHash(m),hashes[i]));
    assert.equal(context.content.cards.length,29);assert.ok(context.content.cards.every(c=>c.revision===1&&demoReferences.some(m=>m.entries.some(e=>e.cardId===c.id))));
    const initialized=unwrap(createGameWithEvents(initialization,context));let state:GameState=initialized.state;
    const steps: (ReturnType<typeof import("./turn-replay").turnReplay>["steps"][number] & { state:GameState; beforeTurn:number; observations: DeepReadonly<PlayerObservation>[] })[]=[],positions:TrainingPosition[]=[];
    try { while(!state.match.outcome && !(options.setupOnly && !state.setup)){
        if(steps.length>=DEMO_MATRIX_CONFIG.limits.actions||state.timing.turn>DEMO_MATRIX_CONFIG.limits.turns)throw new Error(`DEFENSIVE_CAP seed=${seed} actions=${steps.length} turn=${state.timing.turn}`);
        assertNoSuppressedDemoInteraction(state,context);
        const actorId=state.timing.actingPlayer,legalActions=unwrap(listLegalActions(state,actorId,context)),observation=unwrap(observe(state,actorId,context));
        const observations=state.match.playerOrder.map(id=>auditDemoObservation(state,id,context));
        if(!legalActions.length)throw new Error(`NONTERMINAL_NO_ACTION seed=${seed} step=${state.timing.step} turn=${state.timing.turn}`);
        // The policy sees the exact public model action projection, never actorId/action payloads or GameState.
        const policyActions=legalActions.map(({actionId,descriptor})=>({actionId,descriptor}));
        const chosenId=choose(observation,policyActions),selected=legalActions.find(a=>a.actionId===chosenId)!;assert.ok(selected);
        assert.equal(chosenId,choose(observation,[...policyActions].reverse()));
        cycles.record(state,selected);
        if(legalActions.length>1 && observation.step!=="CUT_DECISION") {
            const position=unwrap(generatePosition(state,actorId,context,`${coordinateId(coordinate)}-${steps.length}`,{generator:`DEMO_MATCH_POLICY_${coordinate.chooseFirstOrSecond}_V1`,revision:"1",seed}));
            auditDemoModelInput(position,context);positions.push(position);
        }
        const previous=hashReplayState(state), action={actorId,action:selected.action},beforeTurn=state.timing.turn,next=unwrap(applyAction(state,action,context));
        assert.equal(hashReplayState(state),previous);state=next.state;
        steps.push({actorId,action,actionId:selected.actionId,legalActions,observation,observations,beforeTurn,events:next.events,state,stateHash:hashReplayState(state),positionHash:hashPosition(state),observationHash:hashObservation(unwrap(observe(state,state.timing.actingPlayer,context))),step:state.timing.step});
    }
    } catch(error) {
        const message=error instanceof Error?error.message:String(error), actor=state.timing.actingPlayer;
        const legalResult=listLegalActions(state,actor,context), legal=legalResult.ok?publicPolicyActions(legalResult.value):[];
        const observation=unwrap(observe(state,actor,context));
        const classification=message.startsWith("POLICY_DEADLOCK")?"POLICY_DEADLOCK":message.startsWith("DEFENSIVE_CAP")?"DEFENSIVE_CAP":"ENGINE_ERROR";
        let chosenAction: MatrixFailure["chosenAction"]=null;
        if(legal.length) { try { const id=choose(observation,legal);chosenAction=legal.find(a=>a.actionId===id)??null; } catch { /* Preserve the original policy/engine failure. */ } }
        failure={classification,category:classification==="ENGINE_ERROR"?"VALIDATION_FAILURE":classification,code:message.split("\n")[0],message,turn:state.timing.turn,actorSeat:state.players[actor].seat,phase:observation.step,positionHash:hashPosition(state),observation,legalActions:legal,chosenAction};
    }
    assert.equal(hashCanonical(context.content),bundleBefore);
    for(const id of state.match.playerOrder)auditDemoObservation(state,id,context);
    if(!failure && !options.setupOnly) { assert.equal(state.timing.step,"FINISHED");assert.equal(state.resolution.current,null);assert.equal(state.resolution.choice,null);assert.deepEqual(state.resolution.pending,[]);
    for(const actor of state.match.playerOrder)assert.deepEqual(unwrap(listLegalActions(state,actor,context)),[]);
    assert.equal(steps.flatMap(s=>s.events).filter(e=>e.payload.kind==="GAME_ENDED").length,1);
    }
    return {schemaVersion:1,coordinate,failure,purpose:options.setupOnly?"SETUP_AUDIT":"MATCH",note:"Exact physical Demo matrix coordinate. Full trusted diagnostic replay; policy receives only observation and descriptors.",policy:{id:`DEMO_MATCH_POLICY_${coordinate.chooseFirstOrSecond}_V1`,seed,limits:DEMO_MATRIX_CONFIG.limits},seatManifests:(coordinate.seats==="A"?demoReferences:[...demoReferences].reverse()).map((m,seat)=>({seat,id:m.id,compositionHash:m.compositionHash})),content:context.content,initialization,initialized,positions,steps,finalState:state,finalStateHash:hashReplayState(state)};
}
