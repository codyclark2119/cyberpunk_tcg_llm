import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { RulesetSchema, hashRulesetContent } from "@tcg/domain";
import { MongoRulesetRepository } from "@tcg/persistence";
import { overtimeContext } from "../overtime-fixture";
const mongoUrl=process.env.TEST_MONGODB_URI;
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
