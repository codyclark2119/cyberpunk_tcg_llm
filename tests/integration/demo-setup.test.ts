import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { Pool } from "pg";
import { GameStateSchema, RulesetSchema, hashRulesetContent, type DeepReadonly } from "@tcg/domain";
import { MongoRulesetRepository, PostgresMatchRepository } from "@tcg/persistence";
import { applyAction, hashReplayState, hashPosition, hashObservation, listLegalActions, observe, resolveActionId, validateState, type PlayerObservation } from "@tcg/engine";
import { demoStarterContext } from "../demo-starter-fixture";
import { demoSetupReplay } from "../demo-setup-replay";
import { unwrap } from "../turn-replay";
// Explicit dev URLs only; cleanup is limited to these randomized test-owned namespaces.
const mongoUrl = process.env.TEST_MONGODB_URI, postgresUrl = process.env.TEST_DATABASE_URL;
test("Mongo Demo ruleset publication: immutable new policy, replay and exact pins without republishing cards", { skip: !mongoUrl }, async () => {
    const client = new MongoClient(mongoUrl!, { serverSelectionTimeoutMS: 5000 });
    const db = client.db(`tcg_demo_test_${randomUUID().replaceAll("-", "")}`);
    let connected = false;
    try {
        await client.connect(); connected = true; assert.equal((await db.command({ ping: 1 })).ok, 1);
        const rules = RulesetSchema.parse(demoStarterContext().content.ruleset), repo = new MongoRulesetRepository(async () => db);
        assert.equal((await repo.publish(rules)).status, "PUBLISHED");
        assert.equal((await repo.publish(rules)).status, "REPLAY");
        const loaded = await repo.findVersion(rules.id, rules.version);
        assert.deepEqual(loaded, rules); assert.equal(hashRulesetContent(loaded!), hashRulesetContent(rules));
        assert.equal(loaded!.demoStarter!.firstPlayerMethod, "OPPOSED_D20");
        assert.equal((await repo.publish({ ...rules, deckbuilding: { ...rules.deckbuilding, maxCopies: 2 } })).status, "CONFLICT");
        assert.equal(await db.collection("card_revisions").countDocuments(), 0);
        assert.equal(await db.collection("cards").countDocuments(), 0);
    } finally { try { if (connected) await db.dropDatabase(); } finally { await client.close(); } }
});
test("Postgres Demo: reload and resume every exact setup action with immutable format/rolls and complete events", { skip: !postgresUrl }, async () => {
    const admin = new Pool({ connectionString: postgresUrl }), schema = `tcg_demo_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: postgresUrl, options: `-c search_path=${schema},public` });
    try {
        assert.equal((await pool.query("SELECT 1 AS ready")).rows[0].ready, 1);
        for (const name of ["0001_platform.sql", "0002_phase1_foundations.sql", "0003_normalized_state.sql"])
            await pool.query(await readFile(`db/postgres/migrations/${name}`, "utf8"));
        const context = demoStarterContext(), trace = demoSetupReplay(), repo = new PostgresMatchRepository(pool);
        for (const id of trace.initialized.state.match.playerOrder) await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Demo setup integration')", [id]);
        assert.equal((await repo.create(trace.initialized.state)).ok, false);
        assert.equal((await repo.create(trace.initialized.state, trace.initialized.events)).ok, true);
        let expected = trace.initialized.state;
        const events = [...trace.initialized.events];
        async function reload() {
            const loaded = await repo.find(expected.match.id); assert.ok(loaded);
            assert.deepEqual(loaded, expected); assert.ok(validateState(loaded, context).ok);
            assert.equal(loaded.match.format, "DEMO_STARTER_V1"); assert.deepEqual(loaded.firstPlayerRolls, [[20, 20], [12, 11]]);
            assert.equal(hashReplayState(loaded), hashReplayState(expected)); assert.equal(hashPosition(loaded), hashPosition(expected));
            assert.deepEqual(await repo.history(loaded.match.id), events);
            for (const actor of loaded.match.playerOrder) {
                const observation: DeepReadonly<PlayerObservation> = unwrap(observe(loaded, actor, context));
                assert.deepEqual(observation, unwrap(observe(expected, actor, context)));
                assert.equal(hashObservation(observation), hashObservation(unwrap(observe(expected, actor, context))));
                assert.deepEqual(unwrap(listLegalActions(loaded, actor, context)), unwrap(listLegalActions(expected, actor, context)));
            }
            return loaded;
        }
        for (const step of trace.steps) {
            const loaded = await reload();
            assert.deepEqual(unwrap(listLegalActions(loaded, step.actorId, context)), step.legalActions);
            assert.deepEqual(unwrap(observe(loaded, step.actorId, context)), step.observation);
            const action = unwrap(resolveActionId(loaded, step.actorId, step.actionId, context));
            const next = unwrap(applyAction(loaded, action, context));
            assert.deepEqual(next.events, step.events); assert.equal(hashReplayState(next.state), step.stateHash);
            assert.equal((await repo.save(next.state, loaded.match.version)).ok, false);
            for (const kind of ["format", "rolls"] as const) {
                const forged = GameStateSchema.parse(next.state);
                if (kind === "format") delete forged.match.format; else forged.firstPlayerRolls![0] = [1, 1];
                assert.equal((await repo.save(forged, loaded.match.version, next.events)).ok, false);
            }
            assert.deepEqual(await repo.history(loaded.match.id), events);
            assert.equal((await repo.save(next.state, loaded.match.version, next.events)).ok, true);
            events.push(...next.events); expected = next.state;
        }
        const final = await reload();
        assert.deepEqual(final, trace.finalState); assert.equal(final.timing.turn, 0);
        assert.equal(final.setup!.stage, "MULLIGAN"); assert.equal(final.setup!.completed, 1);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM match_content_revisions")).rows[0].n, 29);
        assert.equal(Object.keys(final.objects.cards).length, 60);
    } finally { await pool.end(); try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); } }
});
