import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { Pool } from "pg";
import { GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, RulesetSchema, hashRulesetContent, type GameEvent, type GameState } from "@tcg/domain";
import { MongoRulesetRepository, PostgresMatchRepository } from "@tcg/persistence";
import { applyAction, hashReplayState, hashPosition, hashObservation, listLegalActions, observe, resolveActionId, validateState, type EngineContext } from "@tcg/engine";
import { overtimeContext } from "../overtime-fixture";
import { overtimeReplay } from "../overtime-replay";
import { overtimeEndCase } from "../overtime-focused";
import { unwrap } from "../turn-replay";
const mongoUrl=process.env.TEST_MONGODB_URI, postgresUrl=process.env.TEST_DATABASE_URL;
test("Mongo overtime ruleset is immutable and publishes no card revisions",{skip:!mongoUrl},async()=>{
    const client=new MongoClient(mongoUrl!,{serverSelectionTimeoutMS:5000}), db=client.db(`tcg_overtime_test_${randomUUID().replaceAll("-","")}`);let connected=false;
    try{
        await client.connect();connected=true;assert.equal((await db.command({ping:1})).ok,1);
        const rules=RulesetSchema.parse(overtimeContext().content.ruleset),repo=new MongoRulesetRepository(async()=>db);
        assert.equal((await repo.publish(rules)).status,"PUBLISHED");assert.equal((await repo.publish(rules)).status,"REPLAY");
        const loaded=await repo.findVersion(rules.id,rules.version);assert.deepEqual(loaded,rules);assert.equal(hashRulesetContent(loaded!),hashRulesetContent(rules));
        assert.equal((await repo.publish({...rules,deckbuilding:{...rules.deckbuilding,maxCopies:2}})).status,"CONFLICT");
        assert.equal(await db.collection("card_revisions").countDocuments(),0);assert.equal(await db.collection("cards").countDocuments(),0);
    }finally{try{if(connected)await db.dropDatabase();}finally{await client.close();}}
});
test("Postgres overtime reloads every legal action plus pending end-turn effects; rejects forged entry batches",{skip:!postgresUrl},async()=>{
    const admin=new Pool({connectionString:postgresUrl}), schema=`tcg_overtime_test_${randomUUID().replaceAll("-","")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:postgresUrl,options:`-c search_path=${schema},public`});
    try{
        assert.equal((await pool.query("SELECT 1 AS ready")).rows[0].ready,1);
        for(const name of ["0001_platform.sql","0002_phase1_foundations.sql","0003_normalized_state.sql"])await pool.query(await readFile(`db/postgres/migrations/${name}`,"utf8"));
        const trace=overtimeReplay(), context=overtimeContext(), repo=new PostgresMatchRepository(pool);
        for(const id of trace.initialized.state.match.playerOrder)await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Overtime integration')",[id]);
        async function reload(expected:GameState,c:EngineContext,history:GameEvent[]){
            const loaded=await repo.find(expected.match.id);assert.ok(loaded);assert.deepEqual(loaded,expected);assert.ok(validateState(loaded,c).ok);
            assert.equal(hashReplayState(loaded),hashReplayState(expected));assert.equal(hashPosition(loaded),hashPosition(expected));assert.deepEqual(await repo.history(loaded.match.id),history);
            for(const id of loaded.match.playerOrder){assert.deepEqual(unwrap(observe(loaded,id,c)),unwrap(observe(expected,id,c)));assert.equal(hashObservation(unwrap(observe(loaded,id,c))),hashObservation(unwrap(observe(expected,id,c))));assert.deepEqual(unwrap(listLegalActions(loaded,id,c)),unwrap(listLegalActions(expected,id,c)));}
            return loaded;
        }
        assert.ok((await repo.create(trace.initialized.state,trace.initialized.events)).ok);let expected=trace.initialized.state;const history=[...trace.initialized.events], seen=new Set<string>();
        for(const step of trace.steps){
            const loaded=await reload(expected,context,history);seen.add(loaded.match.overtime?"ACTIVE":String(loaded.timing.emptyFixerStarts));seen.add(loaded.timing.step!);
            assert.deepEqual(unwrap(listLegalActions(loaded,step.actorId,context)),step.legalActions);
            const action=unwrap(resolveActionId(loaded,step.actorId,step.actionId,context)), next=unwrap(applyAction(loaded,action,context));
            assert.deepEqual(next.events,step.events);assert.equal(hashReplayState(next.state),step.stateHash);
            if(next.events.some(e=>e.payload.kind==="OVERTIME_STARTED")){
                const forged=GameStateSchema.parse(next.state);forged.match.overtime!.startedAfterTurn--;
                assert.equal((await repo.save(forged,loaded.match.version,next.events)).ok,false);
                const altered=structuredClone(next.events);const event=altered.find(e=>e.payload.kind==="OVERTIME_STARTED")!;if(event.payload.kind==="OVERTIME_STARTED")event.payload.turn--;
                assert.equal((await repo.save(next.state,loaded.match.version,altered)).ok,false);
                const missing=GameStateSchema.parse(next.state);delete missing.match.overtime;assert.equal((await repo.save(missing,loaded.match.version,next.events)).ok,false);
            }else if(loaded.match.overtime){
                const forged=GameStateSchema.parse(next.state);delete forged.match.overtime;assert.equal((await repo.save(forged,loaded.match.version,next.events)).ok,false);
                const duplicate=structuredClone(next.events);duplicate[0]={sequence:duplicate[0].sequence,payload:{kind:"OVERTIME_STARTED",turn:loaded.match.overtime.startedAfterTurn}};
                assert.equal((await repo.save(next.state,loaded.match.version,duplicate)).ok,false);
            }
            assert.ok((await repo.save(next.state,loaded.match.version,next.events)).ok);history.push(...next.events);expected=next.state;
        }
        const final=await reload(expected,context,history);assert.deepEqual(final,trace.finalState);assert.equal(final.match.outcome?.reason,"OVERTIME_GIGS");
        for(const key of ["0","1","2","ACTIVE","GIG_STEAL_SELECTION"])assert.ok(seen.has(key),key);
        // Explicit trusted checkpoint: its prior history is not claimed as a generated match.
        // All newly persisted end-turn choices, entry and future events are exact engine transitions.
        const edge=overtimeEndCase("Delamain"), start=GameStateSchema.parse(edge.state);start.match.id=randomUUID() as typeof start.match.id;start.match.version=GameStateVersionSchema.parse(0);start.match.eventSequence=GameEventSequenceSchema.parse(0);
        assert.ok((await repo.create(start)).ok);let state:GameState=start;const edgeHistory:GameEvent[]=[];let choices=0;
        for(let guard=0;!state.match.overtime;guard++){
            assert.ok(guard<30);const loaded=await reload(state,edge.context,edgeHistory), legal=unwrap(listLegalActions(loaded,loaded.timing.actingPlayer,edge.context));
            const selected=legal.find(a=>state.resolution.choice?a.action.kind==="CHOOSE"&&a.action.optionIndices[0]===0:a.action.kind==="END_TURN");assert.ok(selected);
            if(state.resolution.choice)choices++;const next=unwrap(applyAction(loaded,{actorId:selected.actorId,action:selected.action},edge.context));
            assert.ok((await repo.save(next.state,loaded.match.version,next.events)).ok);edgeHistory.push(...next.events);state=next.state;
        }
        assert.ok(choices>0);await reload(state,edge.context,edgeHistory);
    }finally{await pool.end();try{await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}
});
