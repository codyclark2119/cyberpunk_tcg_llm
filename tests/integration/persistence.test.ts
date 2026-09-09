import { fieldLegendContext, fieldLegend } from "../field-legends-fixture";
import { vDyingNightReplay } from "../field-legends-replay";
import { delayedContext, dyingNight } from "../delayed-effects-fixture";
import { dyingNightReplay } from "../delayed-effects-replay";
import { positiveFixture, stockEddies } from "../delayed-effects-focused";
import { endTurnContext, delamain } from "../end-turn-history-fixture";
import { delamainReplay } from "../end-turn-history-replay";
import { orderedContext, evelyn } from "../attack-ordered-effects-fixture";
import { evelynReplay } from "../attack-ordered-effects-replay";
import { privateContext, kiroshi } from "../private-information-fixture";
import { kiroshiReplay } from "../private-information-replay";
import { capabilitiesContext, mandibular } from "../gear-capabilities-fixture";
import { mandibularReplay } from "../gear-capabilities-replay";
import { triggersContext, triggerCards } from "../combat-triggers-fixture";
import { satoriReplay, defeatedReplay, firstBlueReplay } from "../combat-triggers-replay";
import { resolutionContext } from "../combat-resolution-fixture";
import { restrictionsContext, restrictionCards } from "../combat-restrictions-fixture";
import { preventionReplay, preventionExpirationReplay, permissionsReplay, vanillaReplay } from "../combat-restrictions-replay";
import { fightReplay, gigStealReplay } from "../combat-resolution-replay";
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
import { createGameWithEvents, applyAction, listLegalActions, hashReplayState, hashPosition, hashObservation, observe, RulesView, validateState, type PlayerObservation } from "@tcg/engine";
import { fixtureContext, fixtureState } from "../contract-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { Pool } from "pg";
import { z } from "zod";
import { cards } from "@tcg/domain/fixtures";
import { CardRevisionSchema, GameStateSchema, GameEventSequenceSchema, MatchIdSchema, type GameEvent, type GameState, CommandIdSchema, PlayerIdSchema, GameStateVersionSchema, hashCommandRequest, defaultRuleset, StoredDeckSchema, type CommandRequest, type DeepReadonly } from "@tcg/domain";
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
        for (const revision of [...restrictionCards, ...triggerCards, mandibular, kiroshi, evelyn, delamain, dyingNight, fieldLegend]) {
            assert.equal((await repo.publish(revision)).status, "PUBLISHED");
            assert.deepEqual(await repo.findRevision(revision.id, revision.revision), revision);
            assert.equal((await repo.publish(revision)).status, "REPLAY");
        }
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
        // Complete both combat branches through the same durable state + event transaction.
        for (const trace of [fightReplay(), gigStealReplay()]) {
            const ctx = resolutionContext();
            const initial = unwrap(createGameWithEvents({ ...trace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, ctx));
            assert.equal((await match.create(initial.state, initial.events)).ok, true);
            let state = initial.state;
            const events = [...initial.events];
            for (const step of trace.steps) {
                const transition = unwrap(applyAction(state, { actorId: state.timing.actingPlayer, action: step.action.action }, ctx));
                assert.equal((await match.save(transition.state, state.match.version, transition.events)).ok, true);
                state = transition.state; events.push(...transition.events);
                const stored = await match.find(state.match.id);
                assert.deepEqual(stored, state); assert.ok(stored);
                assert.equal(hashReplayState(stored), hashReplayState(state)); assert.equal(hashPosition(stored), step.positionHash);
                assert.deepEqual(await match.history(state.match.id), events);
            }
            assert.equal(state.timing.combat.stage, "NONE"); assert.equal(state.timing.window, "MAIN");
            assert.deepEqual(events.map(e => e.sequence), Array.from({ length: events.length }, (_, i) => i + 1));
            assert.deepEqual(state.temporaryModifiers, trace.finalState.temporaryModifiers);
            for (const seat of [0, 1]) {
                const currentView = new RulesView(state, ctx), expectedView = new RulesView(trace.finalState, ctx);
                assert.equal(currentView.getStreetCred(state.match.playerOrder[seat]), expectedView.getStreetCred(trace.finalState.match.playerOrder[seat]));
            }
            if (trace.steps.some(s => s.events.some(e => e.payload.kind === "CARD_DEFEATED"))) {
                assert.ok(events.some(e => e.payload.kind === "CARD_DEFEATED"));
                assert.deepEqual(state.objects.cards[trace.attackerId].attachments, trace.finalState.objects.cards[trace.attackerId].attachments);
            } else assert.ok(events.some(e => e.payload.kind === "GIG_STOLEN"));
        }
        // Three new families plus a legal unused-prevention expiration branch, with unchanged JSON state storage.
        const restrictionCtx = restrictionsContext();
        for (const trace of [preventionReplay(), permissionsReplay(), vanillaReplay(), preventionExpirationReplay()]) {
            const initial = unwrap(createGameWithEvents({ ...trace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, restrictionCtx));
            assert.equal((await match.create(initial.state, initial.events)).ok, true);
            let state = initial.state;
            const events = [...initial.events];
            for (const step of trace.steps) {
                const legal = unwrap(listLegalActions(state, state.timing.actingPlayer, restrictionCtx));
                assert.deepEqual(legal.map(a => a.actionId), step.legalActions.map(a => a.actionId));
                const transition = unwrap(applyAction(state, { actorId: state.timing.actingPlayer, action: step.action.action }, restrictionCtx));
                assert.equal((await match.save(transition.state, state.match.version, transition.events)).ok, true);
                events.push(...transition.events); state = transition.state;
                const stored = await match.find(state.match.id);
                assert.deepEqual(stored, state); assert.ok(stored);
                assert.equal(hashReplayState(stored), hashReplayState(state)); assert.equal(hashPosition(stored), step.positionHash);
                assert.deepEqual(unwrap(listLegalActions(stored, stored.timing.actingPlayer, restrictionCtx)), unwrap(listLegalActions(state, state.timing.actingPlayer, restrictionCtx)));
                assert.deepEqual(await match.history(state.match.id), events);
            }
            assert.equal(state.timing.combat.stage, "NONE"); assert.equal(state.timing.window, "MAIN");
            assert.equal(state.fightPreventions, undefined);
            assert.deepEqual(events.map(e => e.sequence), Array.from({ length: events.length }, (_, i) => i + 1));
            for (const kind of ["FIGHT_PREVENTION_CREATED", "FIGHT_PREVENTION_CONSUMED", "FIGHT_PREVENTION_EXPIRED", "FIGHT_DEFEAT_PREVENTED", "FIGHT_RESULT", "CARD_DEFEATED"])
                assert.equal(events.filter(e => e.payload.kind === kind).length, trace.steps.flatMap(s => s.events).filter(e => e.payload.kind === kind).length);
        }
        // Trigger queues, source snapshots, first-play history and complete event batches use the existing JSON storage.
        const triggerCtx = triggersContext();
        for (const trace of [satoriReplay(), defeatedReplay(), firstBlueReplay()]) {
            const initial = unwrap(createGameWithEvents({ ...trace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, triggerCtx));
            assert.equal((await match.create(initial.state, initial.events)).ok, true);
            let state = initial.state;
            const events = [...initial.events];
            for (const step of trace.steps) {
                const legal = unwrap(listLegalActions(state, state.timing.actingPlayer, triggerCtx));
                assert.deepEqual(legal.map(a => a.actionId), step.legalActions.map(a => a.actionId));
                const transition = unwrap(applyAction(state, { actorId: state.timing.actingPlayer, action: step.action.action }, triggerCtx));
                assert.equal((await match.save(transition.state, state.match.version, transition.events)).ok, true);
                events.push(...transition.events); state = transition.state;
                const stored = await match.find(state.match.id);
                assert.deepEqual(stored, state); assert.ok(stored);
                assert.equal(hashReplayState(stored), hashReplayState(state)); assert.equal(hashPosition(stored), step.positionHash);
                assert.deepEqual(unwrap(listLegalActions(stored, stored.timing.actingPlayer, triggerCtx)), unwrap(listLegalActions(state, state.timing.actingPlayer, triggerCtx)));
                assert.deepEqual(await match.history(state.match.id), events);
            }
            assert.equal(state.timing.combat.stage, "NONE"); assert.equal(state.timing.window, "MAIN");
            assert.equal(state.fightPreventions, undefined);
            assert.deepEqual(events.map(e => e.sequence), Array.from({ length: events.length }, (_, i) => i + 1));
            for (const kind of ["TRIGGER_ORDER_SELECTED", "OPTIONAL_TRIGGER_ACCEPTED", "QUALIFYING_PLAY_RECORDED", "EFFECT_PENDING", "FIGHT_RESULT", "CARD_DEFEATED"])
                assert.equal(events.filter(e => e.payload.kind === kind).length, trace.steps.flatMap(s => s.events).filter(e => e.payload.kind === kind).length);
        }
        // Inherited Blocker remains derived from persisted physical Gear/host and immutable content.
        const capabilityCtx = capabilitiesContext();
        for (const trace of [mandibularReplay()]) {
            const initial = unwrap(createGameWithEvents({ ...trace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, capabilityCtx));
            assert.equal((await match.create(initial.state, initial.events)).ok, true);
            let state = initial.state;
            const events = [...initial.events];
            for (const step of trace.steps) {
                const legal = unwrap(listLegalActions(state, state.timing.actingPlayer, capabilityCtx));
                assert.deepEqual(legal.map(a => a.actionId), step.legalActions.map(a => a.actionId));
                const transition = unwrap(applyAction(state, { actorId: state.timing.actingPlayer, action: step.action.action }, capabilityCtx));
                assert.equal((await match.save(transition.state, state.match.version, transition.events)).ok, true);
                events.push(...transition.events); state = transition.state;
                const stored = await match.find(state.match.id);
                assert.deepEqual(stored, state); assert.ok(stored);
                assert.equal(hashReplayState(stored), hashReplayState(state)); assert.equal(hashPosition(stored), step.positionHash);
                assert.deepEqual(unwrap(listLegalActions(stored, stored.timing.actingPlayer, capabilityCtx)), unwrap(listLegalActions(state, state.timing.actingPlayer, capabilityCtx)));
                assert.deepEqual(await match.history(state.match.id), events);
            }
            assert.equal(state.timing.combat.stage, "NONE"); assert.equal(state.timing.window, "MAIN");
            assert.equal(state.fightPreventions, undefined);
            assert.deepEqual(events.map(e => e.sequence), Array.from({ length: events.length }, (_, i) => i + 1));
            for (const kind of ["GEAR_ATTACHED", "BLOCKER_SPENT", "BLOCKER_DECLARED", "FIGHT_RESULT", "CARD_DEFEATED", "COMBAT_CLEANED_UP"])
                assert.equal(events.filter(e => e.payload.kind === kind).length, trace.steps.flatMap(s => s.events).filter(e => e.payload.kind === kind).length);
        }
        // Full private-look/CALL trace: trusted state and exact history persist in the existing JSON transaction.
        const privateCtx = privateContext(), privateTrace = kiroshiReplay();
        const privateInitial = unwrap(createGameWithEvents({ ...privateTrace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, privateCtx));
        assert.equal((await match.create(privateInitial.state, privateInitial.events)).ok, true);
        let privateState = privateInitial.state;
        const privateEvents = [...privateInitial.events];
        let rememberedBoundaries = 0;
        for (const step of privateTrace.steps) {
            const transition = unwrap(applyAction(privateState, { actorId: privateState.timing.actingPlayer, action: step.action.action }, privateCtx));
            assert.equal((await match.save(transition.state, privateState.match.version, transition.events)).ok, true);
            privateState = transition.state; privateEvents.push(...transition.events);
            const stored = await match.find(privateState.match.id); assert.ok(stored); assert.deepEqual(stored, privateState);
            assert.equal(hashReplayState(stored), hashReplayState(privateState)); assert.equal(hashPosition(stored), step.positionHash);
            assert.deepEqual(unwrap(listLegalActions(stored, stored.timing.actingPlayer, privateCtx)), unwrap(listLegalActions(privateState, privateState.timing.actingPlayer, privateCtx)));
            for (const viewer of stored.match.playerOrder) {
                const actual: DeepReadonly<PlayerObservation> = unwrap(observe(stored, viewer, privateCtx));
                const expected: DeepReadonly<PlayerObservation> = unwrap(observe(privateState, viewer, privateCtx));
                assert.deepEqual(actual, expected); assert.equal(hashObservation(actual), hashObservation(expected));
            }
            assert.deepEqual(await match.history(stored.match.id), privateEvents);
            if (stored.privateKnowledge) { rememberedBoundaries++; assert.equal(stored.objects.cards[stored.privateKnowledge[0].cardInstanceId].face, "DOWN"); }
        }
        assert.ok(rememberedBoundaries >= 2); assert.equal(privateState.privateKnowledge, undefined);
        const called = privateState.objects.cards[privateTrace.learned.cardInstanceId];
        assert.equal(called.face, "UP"); assert.equal(called.cardId, privateTrace.learned.content.cardId);
        assert.ok(privateEvents.some(e => e.payload.kind === "LEGEND_LOOKED_AT"));
        // Ordered ATTACK trace includes a persisted strategic own-hand discard.
        const orderedCtx = orderedContext(), orderedTrace = evelynReplay();
        const orderedInitial = unwrap(createGameWithEvents({ ...orderedTrace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, orderedCtx));
        assert.equal((await match.create(orderedInitial.state, orderedInitial.events)).ok, true);
        let orderedState = orderedInitial.state;
        const orderedEvents = [...orderedInitial.events];
        let discardBoundaries = 0;
        for (const step of orderedTrace.steps) {
            const transition = unwrap(applyAction(orderedState, { actorId: orderedState.timing.actingPlayer, action: step.action.action }, orderedCtx));
            assert.equal((await match.save(transition.state, orderedState.match.version, transition.events)).ok, true);
            orderedState = transition.state; orderedEvents.push(...transition.events);
            const stored = await match.find(orderedState.match.id); assert.ok(stored); assert.deepEqual(stored, orderedState);
            assert.equal(hashReplayState(stored), hashReplayState(orderedState)); assert.equal(hashPosition(stored), step.positionHash);
            assert.deepEqual(unwrap(listLegalActions(stored, stored.timing.actingPlayer, orderedCtx)), unwrap(listLegalActions(orderedState, orderedState.timing.actingPlayer, orderedCtx)));
            for (const viewer of stored.match.playerOrder) {
                const actual: DeepReadonly<PlayerObservation> = unwrap(observe(stored, viewer, orderedCtx));
                const expected: DeepReadonly<PlayerObservation> = unwrap(observe(orderedState, viewer, orderedCtx));
                assert.deepEqual(actual, expected); assert.equal(hashObservation(actual), hashObservation(expected));
            }
            assert.deepEqual(await match.history(stored.match.id), orderedEvents);
            if (stored.timing.step === "DISCARD_SELECTION") {
                discardBoundaries++; assert.equal(stored.resolution.choice?.kind, "DISCARD");
                assert.equal(stored.resolution.choice?.actorId, stored.timing.activePlayer);
                assert.equal(stored.resolution.current?.primitiveIndex, 1);
                assert.equal(stored.timing.combat.stage, "TRIGGER_RESOLUTION");
                // Submit the next action from the reloaded pending state, never the in-memory copy.
            }
            orderedState = stored;
        }
        assert.equal(discardBoundaries, 1); assert.equal(orderedState.timing.step, "MAIN");
        assert.ok(orderedEvents.some(e => e.payload.kind === "CARD_DISCARDED"));
        // End-turn trace resumes each action from PostgreSQL, including Eddie choice and next-turn cleanup.
        const endCtx = endTurnContext(), endTrace = delamainReplay();
        const endInitial = unwrap(createGameWithEvents({ ...endTrace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, endCtx));
        assert.equal((await match.create(endInitial.state, endInitial.events)).ok, true);
        let endState = endInitial.state;
        const endEvents = [...endInitial.events];
        let readyBoundaries = 0;
        for (const step of endTrace.steps) {
            const transition = unwrap(applyAction(endState, { actorId: endState.timing.actingPlayer, action: step.action.action }, endCtx));
            assert.equal((await match.save(transition.state, endState.match.version, transition.events)).ok, true);
            endState = transition.state; endEvents.push(...transition.events);
            const stored = await match.find(endState.match.id); assert.ok(stored); assert.deepEqual(stored, endState);
            assert.equal(hashReplayState(stored), hashReplayState(endState)); assert.equal(hashPosition(stored), step.positionHash);
            assert.deepEqual(unwrap(listLegalActions(stored, stored.timing.actingPlayer, endCtx)), unwrap(listLegalActions(endState, endState.timing.actingPlayer, endCtx)));
            for (const viewer of stored.match.playerOrder) {
                const actual: DeepReadonly<PlayerObservation> = unwrap(observe(stored, viewer, endCtx));
                const expected: DeepReadonly<PlayerObservation> = unwrap(observe(endState, viewer, endCtx));
                assert.deepEqual(actual, expected); assert.equal(hashObservation(actual), hashObservation(expected));
            }
            assert.deepEqual(await match.history(stored.match.id), endEvents);
            if (stored.timing.step === "EDDIE_READY_SELECTION") {
                readyBoundaries++; assert.equal(stored.resolution.choice?.kind, "READY_EDDIE");
                assert.equal(stored.resolution.choice?.actorId, stored.timing.activePlayer);
                assert.equal(stored.resolution.triggerContinuation?.origin.kind, "END_TURN");
                assert.ok(stored.turnHistory?.gigsStolenByUnit);
                assert.equal(stored.resolution.choice?.options.length, 2);
                // Submit the next action from the reloaded pending state, never the in-memory copy.
            }
            endState = stored;
        }
        assert.equal(readyBoundaries, 1); assert.equal(endState.timing.step, "CHOOSE_GIG");
        assert.equal(endState.timing.turn, 6); assert.equal(endState.turnHistory?.gigsStolenByUnit, undefined);
        assert.ok(endTrace.steps.at(-1)!.events.some(e => e.payload.kind === "CARD_READIED"));
        // Dying Night legal trace: registered combat/MAIN, shared end-turn batch, removal, next turn.
        const delayedCtx = delayedContext(), delayedTrace = dyingNightReplay();
        const delayedInitial = unwrap(createGameWithEvents({ ...delayedTrace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, delayedCtx));
        assert.equal((await match.create(delayedInitial.state, delayedInitial.events)).ok, true);
        let delayedState = delayedInitial.state;
        const delayedEvents = [...delayedInitial.events];
        let delayedReadyBoundaries = 0;
        for (const step of delayedTrace.steps) {
            const transition = unwrap(applyAction(delayedState, { actorId: delayedState.timing.actingPlayer, action: step.action.action }, delayedCtx));
            assert.equal((await match.save(transition.state, delayedState.match.version, transition.events)).ok, true);
            delayedState = transition.state; delayedEvents.push(...transition.events);
            const stored = await match.find(delayedState.match.id); assert.ok(stored); assert.deepEqual(stored, delayedState);
            assert.equal(hashReplayState(stored), hashReplayState(delayedState)); assert.equal(hashPosition(stored), step.positionHash);
            assert.deepEqual(unwrap(listLegalActions(stored, stored.timing.actingPlayer, delayedCtx)), unwrap(listLegalActions(delayedState, delayedState.timing.actingPlayer, delayedCtx)));
            for (const viewer of stored.match.playerOrder) {
                const actual: DeepReadonly<PlayerObservation> = unwrap(observe(stored, viewer, delayedCtx));
                const expected: DeepReadonly<PlayerObservation> = unwrap(observe(delayedState, viewer, delayedCtx));
                assert.deepEqual(actual, expected); assert.equal(hashObservation(actual), hashObservation(expected));
            }
            assert.deepEqual(await match.history(stored.match.id), delayedEvents);
            if (stored.timing.step === "EDDIE_READY_SELECTION") {
                delayedReadyBoundaries++; assert.equal(stored.resolution.choice?.kind, "READY_EDDIE");
                assert.equal(stored.resolution.choice?.actorId, stored.timing.activePlayer);
                assert.equal(stored.resolution.triggerContinuation?.origin.kind, "END_TURN");
                assert.ok(stored.turnHistory?.gigsStolenByUnit);
                assert.equal(stored.resolution.choice?.options.length, 2);
                // Submit the next action from the reloaded pending state, never the in-memory copy.
            }
            delayedState = stored;
        }
        assert.equal(delayedReadyBoundaries, 1); assert.equal(delayedState.timing.step, "CHOOSE_GIG");
        assert.equal(delayedState.timing.turn, 6); assert.equal(delayedState.turnHistory?.gigsStolenByUnit, undefined);
        assert.ok(delayedTrace.steps.at(-1)!.events.some(e => e.payload.kind === "CARD_READIED"));
        // Trusted synthetic V-positive bootstrap, explicitly not a real-card legal headline.
        // Persist every subsequent action, including both stages of the unchanged spent-Eddie set.
        const positive = positiveFixture();
        const bootstrap = GameStateSchema.parse(stockEddies(positive.state, positive.context, 4));
        bootstrap.match.id = MatchIdSchema.parse(randomUUID()); bootstrap.match.version = GameStateVersionSchema.parse(0); bootstrap.match.eventSequence = GameEventSequenceSchema.parse(0);
        for (const id of bootstrap.match.playerOrder) await pool.query("INSERT INTO users(id,display_name) VALUES($1,'trusted delayed fixture') ON CONFLICT(id) DO NOTHING", [id]);
        assert.equal((await match.create(bootstrap)).ok, true);
        let positiveState: GameState = unwrap(validateState(bootstrap, positive.context));
        const positiveEvents: GameEvent[] = []; let positiveChoices = 0, registeredMain = false;
        for (let n = 0; positiveState.timing.turn === bootstrap.timing.turn; n++) {
            assert.ok(n < 30);
            const stored = await match.find(positiveState.match.id); assert.ok(stored); assert.deepEqual(stored, positiveState);
            assert.equal(hashReplayState(stored), hashReplayState(positiveState)); assert.equal(hashPosition(stored), hashPosition(positiveState));
            const legal = unwrap(listLegalActions(stored, stored.timing.actingPlayer, positive.context));
            assert.deepEqual(legal, unwrap(listLegalActions(positiveState, positiveState.timing.actingPlayer, positive.context)));
            for (const viewer of stored.match.playerOrder) {
                const actual: DeepReadonly<PlayerObservation> = unwrap(observe(stored, viewer, positive.context));
                const expected: DeepReadonly<PlayerObservation> = unwrap(observe(positiveState, viewer, positive.context));
                assert.deepEqual(actual, expected); assert.equal(hashObservation(actual), hashObservation(expected));
            }
            if (stored.timing.step === "EDDIE_READY_SELECTION") {
                positiveChoices++; assert.equal(stored.players[positive.actor].zones.EDDIES.filter(id => stored.objects.cards[id].readiness === "SPENT").length, 4);
                assert.equal(stored.resolution.choice!.options.length, positiveChoices === 1 ? 4 : 3);
                assert.equal(stored.resolution.triggerContinuation?.selectedEddieSlots?.length ?? 0, positiveChoices - 1);
            }
            if (stored.timing.step === "MAIN" && stored.delayedEffects) registeredMain = true;
            const selected = legal.find(a => stored.resolution.choice ? a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0 : stored.timing.step === "RIVAL_REACT" ? a.action.kind === "PASS_REACT" : stored.delayedEffects ? a.action.kind === "END_TURN" : a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === positive.host);
            assert.ok(selected);
            const command = { actorId: selected.actorId, action: selected.action };
            const actual = unwrap(applyAction(stored, command, positive.context)), expected = unwrap(applyAction(positiveState, command, positive.context));
            assert.deepEqual(actual, expected); assert.equal((await match.save(actual.state, stored.match.version, actual.events)).ok, true);
            positiveState = actual.state; positiveEvents.push(...actual.events); assert.deepEqual(await match.history(stored.match.id), positiveEvents);
        }
        assert.equal(positiveChoices, 2); assert.ok(registeredMain); assert.equal(positiveState.delayedEffects, undefined);
        assert.equal(positiveState.players[positive.actor].zones.EDDIES.filter(id => positiveState.objects.cards[id].readiness === "READY").length, 2);
        assert.deepEqual(await match.find(positiveState.match.id), positiveState);
        // First real V-positive path: legal CALL/pre-equip/Go Solo/payment/combat/delayed ready2.
        const fieldCtx = fieldLegendContext(), fieldTrace = vDyingNightReplay();
        const fieldInitial = unwrap(createGameWithEvents({ ...fieldTrace.initialization, matchId: randomUUID(), players: [actor, otherActor] }, fieldCtx));
        assert.equal((await match.create(fieldInitial.state, fieldInitial.events)).ok, true);
        let fieldState = fieldInitial.state;
        const fieldEvents = [...fieldInitial.events]; let entryPayments = 0, readyTwoChoices = 0;
        for (const step of fieldTrace.steps) {
            const stored = await match.find(fieldState.match.id); assert.ok(stored); assert.deepEqual(stored, fieldState);
            const transition = unwrap(applyAction(stored, { actorId: stored.timing.actingPlayer, action: step.action.action }, fieldCtx));
            assert.equal((await match.save(transition.state, stored.match.version, transition.events)).ok, true);
            fieldState = transition.state; fieldEvents.push(...transition.events);
            const reloaded = await match.find(fieldState.match.id); assert.ok(reloaded); assert.deepEqual(reloaded, fieldState);
            assert.equal(hashReplayState(reloaded), hashReplayState(fieldState)); assert.equal(hashPosition(reloaded), step.positionHash);
            assert.deepEqual(unwrap(listLegalActions(reloaded, reloaded.timing.actingPlayer, fieldCtx)), unwrap(listLegalActions(fieldState, fieldState.timing.actingPlayer, fieldCtx)));
            for (const viewer of reloaded.match.playerOrder) {
                const a: DeepReadonly<PlayerObservation> = unwrap(observe(reloaded, viewer, fieldCtx));
                const b: DeepReadonly<PlayerObservation> = unwrap(observe(fieldState, viewer, fieldCtx));
                assert.deepEqual(a, b); assert.equal(hashObservation(a), hashObservation(b));
            }
            if (reloaded.resolution.legendEntryContinuation) entryPayments++;
            if (reloaded.timing.step === "EDDIE_READY_SELECTION") readyTwoChoices++;
            const v = reloaded.objects.cards[fieldTrace.legend];
            assert.ok(v.attachments.every(id => reloaded.objects.cards[id].zone.zone === v.zone.zone));
            assert.deepEqual(await match.history(reloaded.match.id), fieldEvents); fieldState = reloaded;
        }
        assert.ok(entryPayments > 0); assert.equal(readyTwoChoices, 2); assert.equal(fieldState.timing.turn, 6);
        assert.equal(fieldState.players[actor].zones.EDDIES.filter(id => fieldState.objects.cards[id].readiness === "READY").length, 2);
        assert.ok(fieldEvents.some(e => e.payload.kind === "GO_SOLO_ACTIVATED")); assert.ok(fieldEvents.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met));
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
