import { reactContext, reactInput } from "../react-fixture";
import { reactReplay } from "../react-replay";
import { noncombatContext, noncombatInput } from "../noncombat-fixture";
import { noncombatReplay } from "../noncombat-replay";
import { gearContext, gearInput, MANTIS } from "../gear-fixture";
import { gearReplay } from "../gear-replay";
import { combatContext, combatInput } from "../combat-fixture";
import { combatReplay } from "../combat-replay";
import { setupContext, setupInput } from "../setup-fixture";
import { unwrap } from "../turn-replay";
import { turnContext, turnInput } from "../turn-fixture";
import { createGameWithEvents, applyAction, listLegalActions, hashReplayState, hashPosition, RulesView } from "@tcg/engine";
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
            assert.equal((await match.create(initialized.value.state, initialized.value.events)).ok,true);
            assert.deepEqual(await match.find(initialized.value.state.match.id),initialized.value.state);
            assert.deepEqual(await match.history(initialized.value.state.match.id), initialized.value.events);
        }
        const setupCtx = setupContext(), setup = unwrap(createGameWithEvents({ ...setupInput(), matchId: randomUUID(), players: [actor, otherActor] }, setupCtx));
        assert.equal((await match.create(setup.state)).ok, false); // Never silently persist partial setup history.
        assert.equal(await match.find(setup.state.match.id), null);
        assert.equal((await match.create(setup.state, setup.events)).ok, true);
        const allEvents = [...setup.events];
        let current = setup.state;
        for (let i = 0; i < 9; i++) {
            const legal = unwrap(listLegalActions(current, current.timing.actingPlayer, setupCtx));
            const action = current.setup ? legal.find(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0)! : legal.find(a => a.action.kind === (i === 7 ? "ROLL_GIG" : "END_TURN"))!;
            const transition = unwrap(applyAction(current, { actorId: action.actorId, action: action.action }, setupCtx));
            assert.equal((await match.save(transition.state, current.match.version)).ok, false);
            assert.deepEqual(await match.find(current.match.id), current);
            assert.deepEqual(await match.history(current.match.id), allEvents);
            const saved = await Promise.all([match.save(transition.state, current.match.version, transition.events), match.save(transition.state, current.match.version, transition.events)]);
            assert.equal(saved.filter(r => r.ok).length, 1);
            allEvents.push(...transition.events);
            current = transition.state;
        }
        assert.deepEqual(await match.history(current.match.id), allEvents);
        assert.deepEqual(await match.find(current.match.id), current);
        // Persist each actual noncombat transition, including intermediate payment/target/amount boundaries.
        const playContext = noncombatContext(), trace = noncombatReplay();
        const playInitial = unwrap(createGameWithEvents({ ...noncombatInput("noncombat-play-34"), matchId: randomUUID(), players: [actor, otherActor] }, playContext));
        assert.equal((await match.create(playInitial.state, playInitial.events)).ok, true);
        let playState = playInitial.state;
        const playEvents = [...playInitial.events];
        for (const step of trace.steps) {
            const transition = unwrap(applyAction(playState, { actorId: playState.timing.actingPlayer, action: step.action.action }, playContext));
            assert.equal((await match.save(transition.state, playState.match.version, transition.events)).ok, true);
            playEvents.push(...transition.events);
            playState = transition.state;
            assert.deepEqual(await match.find(playState.match.id), playState);
        }
        assert.deepEqual(await match.history(playState.match.id), playEvents);
        assert.ok(playEvents.some(e => e.payload.kind === "GIG_VALUE_CHANGED"));
        assert.ok(playEvents.some(e => e.payload.kind === "ABILITY_ACTIVATED"));
        // Persist the complete search -> hand -> play -> payment -> equip sequence, including choices.
        const equipContext = gearContext(), equipTrace = gearReplay();
        const equipInitial = unwrap(createGameWithEvents({ ...gearInput("gear-equip-44"), matchId: randomUUID(), players: [actor, otherActor] }, equipContext));
        assert.equal((await match.create(equipInitial.state, equipInitial.events)).ok, true);
        let equipState = equipInitial.state;
        const equipEvents = [...equipInitial.events];
        for (const step of equipTrace.steps) {
            const transition = unwrap(applyAction(equipState, { actorId: equipState.timing.actingPlayer, action: step.action.action }, equipContext));
            assert.equal((await match.save(transition.state, equipState.match.version, transition.events)).ok, true);
            equipEvents.push(...transition.events);
            equipState = transition.state;
            const stored = await match.find(equipState.match.id);
            assert.deepEqual(stored, equipState);
            assert.ok(stored);
            assert.equal(hashReplayState(stored), hashReplayState(equipState));
            assert.equal(hashPosition(stored), step.positionHash); // Transport UUIDs differ from the replay.
        }
        assert.deepEqual(await match.history(equipState.match.id), equipEvents);
        assert.deepEqual(equipEvents.map(e => e.sequence), Array.from({ length: equipEvents.length }, (_, i) => i + 1));
        const searched = equipEvents.flatMap(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK" && e.payload.to.zone === "HAND" && equipState.objects.cards[e.payload.cardInstanceId].cardId === MANTIS ? [e.payload.cardInstanceId] : []);
        const equipped = equipEvents.flatMap(e => e.payload.kind === "GEAR_ATTACHED" ? [e.payload.gearInstanceId] : []);
        assert.deepEqual(equipped, equipTrace.searchedGear);
        assert.ok(equipped.every(id => searched.includes(id)));
        assert.deepEqual(equipState.objects.cards[equipTrace.royceId].attachments, equipped);
        assert.equal(new RulesView(equipState, equipContext).getEffectivePower(equipTrace.royceId), 14);
        assert.equal(equipState.timing.step, "MAIN");
        // Persist attack selection and the final unresolved React boundary, without advancing combat.
        const attackContext = combatContext(), attackTrace = combatReplay();
        const attackInitial = unwrap(createGameWithEvents({ ...combatInput("combat-attack-46"), matchId: randomUUID(), players: [actor, otherActor] }, attackContext));
        assert.equal((await match.create(attackInitial.state, attackInitial.events)).ok, true);
        let attackState = attackInitial.state;
        const attackEvents = [...attackInitial.events];
        for (const step of attackTrace.steps) {
            const transition = unwrap(applyAction(attackState, { actorId: attackState.timing.actingPlayer, action: step.action.action }, attackContext));
            assert.equal((await match.save(transition.state, attackState.match.version, transition.events)).ok, true);
            attackEvents.push(...transition.events);
            attackState = transition.state;
            const stored = await match.find(attackState.match.id);
            assert.deepEqual(stored, attackState); assert.ok(stored);
            assert.equal(hashReplayState(stored), hashReplayState(attackState));
            assert.equal(hashPosition(stored), step.positionHash);
        }
        assert.deepEqual(await match.history(attackState.match.id), attackEvents);
        assert.deepEqual(attackEvents.map(e => e.sequence), Array.from({ length: attackEvents.length }, (_, i) => i + 1));
        assert.equal(attackState.timing.combat.stage, "RIVAL_REACT");
        assert.deepEqual(unwrap(listLegalActions(attackState, otherActor, attackContext)), []);
        const attackView = new RulesView(attackState, attackContext);
        assert.equal(attackView.getCombatAttacker()?.id, attackTrace.attackerId);
        assert.deepEqual(attackView.getCombatTarget(), attackTrace.finalState.timing.combat.stage === "RIVAL_REACT" ? attackTrace.finalState.timing.combat.target : null);
        assert.deepEqual(attackState.objects.cards[attackTrace.attackerId].attachments, attackTrace.finalState.objects.cards[attackTrace.attackerId].attachments);
        assert.equal(attackView.getEffectivePower(attackTrace.attackerId), 5);
        assert.equal(attackEvents.filter(e => e.payload.kind === "ATTACK_DECLARED").length, 1);
        assert.equal(attackEvents.at(-1)?.payload.kind, "RIVAL_REACT_OPENED");
        // Persist every React action/continuation and the closed unresolved combat boundary.
        const reactCtx = reactContext(), reactTrace = reactReplay();
        const reactInitial = unwrap(createGameWithEvents({ ...reactInput(reactTrace.initialization.seed), matchId: randomUUID(), players: [actor, otherActor] }, reactCtx));
        assert.equal((await match.create(reactInitial.state, reactInitial.events)).ok, true);
        let reactState = reactInitial.state;
        const reactEvents = [...reactInitial.events];
        for (const step of reactTrace.steps) {
            const transition = unwrap(applyAction(reactState, { actorId: reactState.timing.actingPlayer, action: step.action.action }, reactCtx));
            assert.equal((await match.save(transition.state, reactState.match.version, transition.events)).ok, true);
            reactEvents.push(...transition.events); reactState = transition.state;
            const stored = await match.find(reactState.match.id);
            assert.deepEqual(stored, reactState); assert.ok(stored);
            assert.equal(hashReplayState(stored), hashReplayState(reactState));
            assert.equal(hashPosition(stored), step.positionHash);
        }
        assert.deepEqual(await match.history(reactState.match.id), reactEvents);
        assert.deepEqual(reactEvents.map(e => e.sequence), Array.from({ length: reactEvents.length }, (_, i) => i + 1));
        assert.equal(reactState.timing.combat.stage, "COMBAT_RESOLUTION_PENDING");
        assert.deepEqual(new RulesView(reactState, reactCtx).getCombatTarget(), new RulesView(reactTrace.finalState, reactCtx).getCombatTarget());
        assert.deepEqual(reactState.temporaryModifiers, reactTrace.finalState.temporaryModifiers);
        assert.equal(new RulesView(reactState, reactCtx).getEffectivePower(reactTrace.attackerId), 4);
        assert.equal(reactEvents.at(-1)?.payload.kind, "COMBAT_RESOLUTION_PENDING");
        assert.ok(reactEvents.some(e => e.payload.kind === "BLOCKER_DECLARED"));
        assert.deepEqual(unwrap(listLegalActions(reactState, otherActor, reactCtx)), []);
        // Inject an event insert failure AFTER the state UPDATE to verify transaction rollback.
        await pool.query("CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event insert failure'; END $$");
        await pool.query("CREATE TRIGGER reject_test_event BEFORE INSERT ON match_events FOR EACH ROW EXECUTE FUNCTION reject_test_event()");
        const action = unwrap(listLegalActions(current, current.timing.actingPlayer, setupCtx))[0];
        const transition = unwrap(applyAction(current, { actorId: action.actorId, action: action.action }, setupCtx));
        await assert.rejects(match.save(transition.state, current.match.version, transition.events), /event insert failure/);
        assert.deepEqual(await match.find(current.match.id), current);
        assert.deepEqual(await match.history(current.match.id), allEvents);
        await pool.query("DROP TRIGGER reject_test_event ON match_events");
        // A historical row created by the previous API is explicitly detected, not treated as complete.
        await pool.query("DELETE FROM match_events WHERE match_id=$1 AND sequence=1", [current.match.id]);
        await assert.rejects(match.history(current.match.id), /INCOMPLETE_MATCH_HISTORY/);
        assert.equal((await match.save(transition.state, current.match.version, transition.events)).ok, false);
    }
    finally {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});
