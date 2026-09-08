import { turnContext, turnInput } from "../turn-fixture";
import { createGameWithEvents } from "@tcg/engine";
import { fixtureContext, fixtureState } from "../contract-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { Pool } from "pg";
import { z } from "zod";
import { cards } from "@tcg/domain/fixtures";
import { CardRevisionSchema, CommandIdSchema, PlayerIdSchema, GameStateVersionSchema, hashCommandRequest, defaultRuleset, StoredDeckSchema, type CommandRequest } from "@tcg/domain";
import { MongoCardRepository, MongoRulesetRepository, createMongoIndexes, PostgresCommandRepository, PostgresMatchRepository, PostgresDeckRepository } from "@tcg/persistence";
// Explicit URLs required. Tests only remove their own randomized database/schema.
const mongoUrl = process.env.TEST_MONGODB_URI;
const postgresUrl = process.env.TEST_DATABASE_URL;
test("Mongo revisions: concurrent replay, conflict, history, projection ordering, search", { skip: !mongoUrl }, async () => {
    const client = new MongoClient(mongoUrl!, { serverSelectionTimeoutMS: 5000 });
    const db = client.db(`tcg_test_${randomUUID().replaceAll("-", "")}`);
    let connected = false;
    try {
        await client.connect();
        connected = true;
        await db.collection("cards").createIndex({ "index.cardNumber": 1 }, { unique: true });
        await createMongoIndexes(db);
        await createMongoIndexes(db); // Forward index migration is repeatable.
        assert.notEqual((await db.collection("cards").indexes()).find(i => i.name === "index.cardNumber_1")?.unique, true);
        const repo = new MongoCardRepository(async () => db);
        const published = await Promise.all(Array.from({ length: 8 }, () => repo.publish(cards[0])));
        assert.equal(published.filter(r => r.status === "PUBLISHED").length, 1);
        assert.equal(published.filter(r => r.status === "REPLAY").length, 7);
        assert.equal((await repo.publish({ ...cards[0], name: "Conflicting" })).status, "CONFLICT");
        await Promise.all([repo.publish({ ...cards[0], revision: CardRevisionSchema.parse(2), name: "Second Red" }), repo.publish(cards[0])]);
        assert.equal((await repo.findById(cards[0].id))?.revision, 2);
        assert.equal((await repo.findRevision(cards[0].id, cards[0].revision))?.name, cards[0].name);
        // A crash after immutable insert is recoverable by replaying the publish.
        await db.collection("cards").deleteMany({});
        await repo.publish(cards[0]);
        assert.equal((await repo.findById(cards[0].id))?.revision, 2);
        assert.equal((await repo.list({ first: 10, filter: { search: "red" } })).cards.length, 1);
        assert.equal((await repo.publish({ ...cards[1], cardNumber: cards[0].cardNumber })).status, "PUBLISHED");
        const rich = { ...fixtureContext().content.cards[0], revision: CardRevisionSchema.parse(3) };
        assert.equal((await repo.publish(rich)).status, "PUBLISHED");
        assert.equal((await repo.findRevision(cards[0].id, cards[0].revision))?.schemaVersion, 1);
        assert.deepEqual(await repo.findRevision(rich.id, rich.revision), rich);
        const rules = new MongoRulesetRepository(async () => db);
        assert.equal((await rules.publish(defaultRuleset)).status, "PUBLISHED");
        assert.equal((await rules.publish(defaultRuleset)).status, "REPLAY");
        assert.equal((await rules.publish({ ...defaultRuleset, deckbuilding: { ...defaultRuleset.deckbuilding, maxCopies: 9 } })).status, "CONFLICT");
        assert.deepEqual(await rules.findVersion(defaultRuleset.id, defaultRuleset.version), defaultRuleset);
    }
    finally {
        try {
            if (connected)
                await db.dropDatabase();
        }
        finally {
            await client.close();
        }
    }
});
test("Postgres ledger: running, conflict, replay, transactional rollback and stale state", { skip: !postgresUrl }, async () => {
    const admin = new Pool({ connectionString: postgresUrl });
    const schema = `tcg_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: postgresUrl, options: `-c search_path=${schema},public` });
    try {
        for (const name of ["0001_platform.sql", "0002_phase1_foundations.sql"])
            await pool.query(await readFile(`db/postgres/migrations/${name}`, "utf8"));
        const legacyId = randomUUID();
        const legacy = { schemaVersion: 1, matchId: legacyId, version: 0, rulesetId: "beta", rulesetVersion: "0.3.0" };
        await pool.query("INSERT INTO matches(id,game_version,ruleset_id,ruleset_version,state) VALUES($1,'phase1','beta','0.3.0',$2::jsonb)", [legacyId, JSON.stringify(legacy)]);
        await pool.query(await readFile("db/postgres/migrations/0003_normalized_state.sql", "utf8"));
        assert.deepEqual((await pool.query("SELECT state FROM matches WHERE id=$1", [legacyId])).rows[0].state, legacy);
        const actor = PlayerIdSchema.parse(randomUUID());
        await pool.query("INSERT INTO users(id,display_name) VALUES($1,'test')", [actor]);
        await pool.query("CREATE TABLE effects(value integer NOT NULL)");
        const ledger = new PostgresCommandRepository(pool, z.object({ count: z.number() }));
        const request: CommandRequest = { commandId: CommandIdSchema.parse(randomUUID()), actorId: actor, idempotencyKey: "test", requestHash: hashCommandRequest({ action: "test" }) };
        let release = () => { };
        const wait = new Promise<void>(resolve => { release = resolve; });
        let started = () => { };
        const entered = new Promise<void>(resolve => { started = resolve; });
        const execution = ledger.execute(request, async (client) => { await client.query("INSERT INTO effects VALUES(1)"); started(); await wait; return { count: 1 }; });
        await entered;
        assert.equal((await ledger.begin({ ...request, commandId: CommandIdSchema.parse(randomUUID()) })).status, "IN_PROGRESS");
        assert.equal((await ledger.begin({ ...request, requestHash: hashCommandRequest({ action: "other" }) })).status, "CONFLICT");
        release();
        assert.equal((await execution).status, "COMPLETED");
        assert.deepEqual(await ledger.execute(request, async () => { throw new Error("Must not execute replay"); }), { status: "REPLAY", response: { count: 1 } });
        assert.equal((await pool.query("SELECT count(*)::integer AS count FROM effects")).rows[0].count, 1);
        const failed = { ...request, commandId: CommandIdSchema.parse(randomUUID()), idempotencyKey: "rollback" };
        await assert.rejects(ledger.execute(failed, async (client) => { await client.query("INSERT INTO effects VALUES(2)"); throw new Error("rollback"); }), /rollback/);
        assert.equal((await pool.query("SELECT count(*)::integer AS count FROM effects")).rows[0].count, 1);
        assert.equal((await ledger.execute(failed, async (client) => { await client.query("INSERT INTO effects VALUES(3)"); return { count: 2 }; })).status, "COMPLETED");
        const decks = new PostgresDeckRepository(pool);
        const deck = StoredDeckSchema.parse({ id: randomUUID(), ownerId: actor, name: "Owned", version: 0, rulesetId: defaultRuleset.id, rulesetVersion: defaultRuleset.version, entries: [{ cardId: cards[0].id, revision: 1, quantity: 1, zone: "LEGEND" }] });
        assert.equal((await decks.create(deck)).ok, true);
        assert.deepEqual(await decks.find(deck.id, actor), deck);
        assert.equal(await decks.find(deck.id, PlayerIdSchema.parse(randomUUID())), null);
        const updatedDeck = { ...deck, name: "Updated", version: GameStateVersionSchema.parse(1) };
        assert.equal((await decks.save(updatedDeck, deck.version)).ok, true);
        assert.equal((await decks.save(updatedDeck, deck.version)).ok, false);
        assert.deepEqual(await decks.find(deck.id, actor), updatedDeck);
        const match = new PostgresMatchRepository(pool);
        const state = fixtureState(fixtureContext(), [actor]);
        assert.equal((await match.create(state)).ok, true);
        const next = { ...state, match: { ...state.match, version: GameStateVersionSchema.parse(1) } };
        const concurrent = await Promise.all([match.save(next, state.match.version), match.save(next, state.match.version)]);
        assert.equal(concurrent.filter(r => r.ok).length, 1);
        assert.deepEqual(await match.find(state.match.id), next);
        assert.equal((await pool.query("SELECT count(*)::integer AS count FROM match_content_revisions")).rows[0].count, 4);
        const otherActor = PlayerIdSchema.parse(randomUUID());
        await pool.query("INSERT INTO users(id,display_name) VALUES($1,'turn-slice-test')", [otherActor]);
        const initialized = createGameWithEvents({...turnInput(),matchId:randomUUID(),players:[actor,otherActor]},turnContext());
        assert.equal(initialized.ok,true);
        if (initialized.ok) {
            assert.ok(initialized.value.state.match.eventSequence > 0);
            assert.equal((await match.create(initialized.value.state)).ok,true);
            assert.deepEqual(await match.find(initialized.value.state.match.id),initialized.value.state);
        }
    }
    finally {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});
