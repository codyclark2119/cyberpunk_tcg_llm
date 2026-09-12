import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresMatchRepository } from "@tcg/persistence";
import { applyAction, createGameWithEvents, hashReplayState, hashPosition, hashObservation, listLegalActions, observe, resolveActionId, validateState } from "@tcg/engine";
import { demoStarterContext } from "../demo-starter-fixture";
import { chooseDemoMatchAction } from "../demo-match-policy";
import { auditDemoObservation, publicPolicyActions } from "../demo-match-audit";
import type { demoMatchReplay } from "../demo-match-replay";
import { unwrap } from "../turn-replay";
const postgresUrl=process.env.TEST_DATABASE_URL;
test("Postgres exact physical Demo match reloads and resumes all 244 legal actions and terminal state",{skip:!postgresUrl},async()=>{
    const admin=new Pool({connectionString:postgresUrl}),schema=`tcg_exact_demo_test_${randomUUID().replaceAll("-","")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:postgresUrl,options:`-c search_path=${schema},public`});
    try{
        assert.equal((await pool.query("SELECT 1 AS ready")).rows[0].ready,1);
        for(const name of ["0001_platform.sql","0002_phase1_foundations.sql","0003_normalized_state.sql"])await pool.query(await readFile(`db/postgres/migrations/${name}`,"utf8"));
        const trace:ReturnType<typeof demoMatchReplay>=JSON.parse(await readFile("tests/fixtures/exact-demo-match-replay.v1.json","utf8")),context=demoStarterContext(),repo=new PostgresMatchRepository(pool);
        assert.deepEqual(context.content,trace.content);const initialized=unwrap(createGameWithEvents(trace.initialization,context));assert.deepEqual(initialized,trace.initialized);
        for(const id of initialized.state.match.playerOrder)await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Exact Demo integration')",[id]);
        assert.ok((await repo.create(initialized.state,initialized.events)).ok);let expected=initialized.state;const history=[...initialized.events];let reloadedActions=0;
        async function reload(){
            const loaded=await repo.find(expected.match.id);assert.ok(loaded);assert.ok(validateState(loaded,context).ok);assert.deepEqual(loaded,expected);
            assert.equal(hashReplayState(loaded),hashReplayState(expected));assert.equal(hashPosition(loaded),hashPosition(expected));assert.deepEqual(await repo.history(loaded.match.id),history);
            for(const id of loaded.match.playerOrder){const actual=auditDemoObservation(loaded,id,context),wanted=unwrap(observe(expected,id,context));assert.deepEqual(actual,wanted);assert.equal(hashObservation(actual),hashObservation(wanted));assert.deepEqual(unwrap(listLegalActions(loaded,id,context)),unwrap(listLegalActions(expected,id,context)));}
            return loaded;
        }
        for(const step of trace.steps){
            const loaded=await reload(),actor=loaded.timing.actingPlayer,observation=unwrap(observe(loaded,actor,context)),legal=unwrap(listLegalActions(loaded,actor,context));
            assert.deepEqual(observation,step.observation);assert.deepEqual(legal,step.legalActions);
            for(const id of loaded.match.playerOrder)assert.deepEqual(unwrap(observe(loaded,id,context)),step.observations[loaded.players[id].seat]);
            const selected=chooseDemoMatchAction(observation,publicPolicyActions(legal));assert.equal(selected,step.actionId);
            const action=unwrap(resolveActionId(loaded,actor,selected,context));assert.deepEqual(action,step.action);
            const next=unwrap(applyAction(loaded,action,context));assert.deepEqual(next.events,step.events);assert.deepEqual(next.state,step.state);
            assert.equal(hashReplayState(next.state),step.stateHash);assert.equal(hashPosition(next.state),step.positionHash);
            assert.equal(hashObservation(unwrap(observe(next.state,next.state.timing.actingPlayer,context))),step.observationHash);
            assert.ok((await repo.save(next.state,loaded.match.version,next.events)).ok);expected=next.state;history.push(...next.events);reloadedActions++;
        }
        const final=await reload();assert.equal(reloadedActions,244);assert.deepEqual(final,trace.finalState);assert.equal(hashReplayState(final),trace.finalStateHash);
        assert.equal(final.match.outcome?.reason,"START_TURN_GIGS");assert.equal(history.filter(e=>e.payload.kind==="GAME_ENDED").length,1);assert.equal(history.length,975);
        for(const id of final.match.playerOrder)assert.deepEqual(unwrap(listLegalActions(final,id,context)),[]);
        const last=trace.steps.at(-1)!;assert.equal(resolveActionId(final,last.actorId,last.actionId,context).ok,false);assert.deepEqual(await repo.history(final.match.id),history);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM match_content_revisions")).rows[0].n,29);
    }finally{await pool.end();try{await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}
});
