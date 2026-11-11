import { losing } from "../attack-condition-power-fixture";
import { surveillance } from "../targeted-spend-fixture";
import { targetedCards } from "../targeted-defeat-fixture";
import { valueCards } from "../value-conditions-fixture";
import { saburo } from "../saburo-fixture";
import { yorinobu } from "../yorinobu-fixture";
import { goro } from "../goro-fixture";
import { fieldLegend } from "../field-legends-fixture";
import { dyingNight } from "../delayed-effects-fixture";
import { delamain } from "../end-turn-history-fixture";
import { evelyn } from "../attack-ordered-effects-fixture";
import { kiroshi } from "../private-information-fixture";
import { mandibular } from "../gear-capabilities-fixture";
import { triggerCards } from "../combat-triggers-fixture";
import { restrictionCards } from "../combat-restrictions-fixture";
import { fixtureContext } from "../contract-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { cards } from "@tcg/domain/fixtures";
import { CardRevisionSchema, defaultRuleset } from "@tcg/domain";
import { MongoCardRepository, MongoRulesetRepository, createMongoIndexes } from "@tcg/persistence";
// Explicit URLs required. Tests only remove their own randomized database.
const mongoUrl = process.env.TEST_MONGODB_URI;
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
        for (const revision of [...restrictionCards, ...triggerCards, mandibular, kiroshi, evelyn, delamain, dyingNight, fieldLegend, goro, yorinobu, saburo, ...valueCards, ...targetedCards, surveillance, losing]) {
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

