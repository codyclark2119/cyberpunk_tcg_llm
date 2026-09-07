import { MongoClient, MongoServerError, type Db } from "mongodb";
import { z } from "zod";
import { CardSchema, RulesetSchema, hashCardContent, hashRulesetContent, type Card, type Ruleset, type CardId, type CardRevision, type RulesetId, type RulesetVersion, type CardRepository, type RulesetRepository, type CardPageRequest, type PublishResult } from "@tcg/domain";
import type { Environment } from "./environment";
export function connectMongo(env: Environment): { db: () => Promise<Db>; close: () => Promise<void> } {
  let client: MongoClient | undefined;
  let connection: Promise<MongoClient> | undefined;
  return {
    async db() {
      if (!env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");
      if (!connection) {
        client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        const current = client;
        connection = current.connect().catch(async (cause: unknown) => {
          connection = undefined;
          await current.close();
          throw new Error("MongoDB connection failed while MONGODB_URI is configured. Run npm run infra:up and check connection settings. Unset MONGODB_URI and restart for fixture mode.", { cause });
        });
      }
      return (await connection).db(env.MONGODB_DATABASE);
    },
    async close() { await client?.close(); connection = undefined; }
  };
}
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const CardDocumentSchema = z.object({ _id: z.string(), cardId: z.string(), revision: z.number().int().positive(), schemaVersion: z.literal(1), contentHash: hashSchema, content: CardSchema });
export type CardDocument = z.infer<typeof CardDocumentSchema>;
export function cardToDocument(card: Card): CardDocument {
  return { _id: JSON.stringify([card.id, card.revision]), cardId: card.id, revision: card.revision, schemaVersion: 1, contentHash: hashCardContent(card), content: card };
}
export function cardFromDocument(raw: unknown): Card {
  const doc = CardDocumentSchema.parse(raw);
  if (doc.cardId !== doc.content.id || doc.revision !== doc.content.revision || doc.contentHash !== hashCardContent(doc.content)) throw new Error("Corrupt card snapshot identity/hash");
  return doc.content;
}
const RulesetDocumentSchema = z.object({ _id: z.string(), rulesetId: z.string(), version: z.string(), schemaVersion: z.literal(1), contentHash: hashSchema, content: RulesetSchema });
export async function createMongoIndexes(db: Db): Promise<void> {
  const cards = db.collection("cards");
  await cards.createIndex({ "index.cardNumber": 1 }, { unique: true });
  await cards.createIndex({ "index.setCode": 1, "index.cardNumber": 1 });
  await cards.createIndex({ "index.type": 1 });
  await cards.createIndex({ "index.colors": 1 });
  await cards.createIndex({ "index.name": "text", "index.cardNumber": "text", "index.searchText": "text", "data.rulesText": "text", "data.tags": "text" }, { name: "card_search" });
  await db.collection("card_revisions").createIndex({ cardId: 1, revision: 1 }, { unique: true });
  await db.collection("ruleset_revisions").createIndex({ rulesetId: 1, version: 1 }, { unique: true });
}
const duplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
export class MongoCardRepository implements CardRepository {
  constructor(private readonly getDb: () => Promise<Db>) {}
  async publish(card: Card): Promise<PublishResult> {
    const db = await this.getDb();
    const revisions = db.collection<CardDocument>("card_revisions");
    const snapshot = cardToDocument(card);
    let status: "PUBLISHED" | "REPLAY" = "PUBLISHED";
    try { await revisions.insertOne(snapshot); }
    catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await revisions.findOne({ cardId: card.id, revision: card.revision });
      if (!existing || hashCardContent(cardFromDocument(existing)) !== snapshot.contentHash) return { status: "CONFLICT" };
      status = "REPLAY";
    }
    const latestRaw = await revisions.find({ cardId: card.id }).sort({ revision: -1 }).limit(1).next();
    if (!latestRaw) throw new Error("Published revision disappeared");
    const latest = cardFromDocument(latestRaw);
    const projection = { ...cardToDocument(latest), _id: card.id,
      index: { cardNumber: latest.cardNumber, name: latest.name, setCode: latest.setCode, type: latest.type, colors: latest.colors },
      data: { rulesText: latest.rulesText, tags: latest.tags }
    };
    // Insert immutable content first. Replay repairs a projection after a crash.
    // Atomic pipeline prevents an older concurrent publisher moving the pointer backwards.
    await db.collection<CardDocument>("cards").updateOne({ _id: card.id }, [{ $replaceWith: { $cond: [
      { $lte: [{ $ifNull: ["$revision", 0] }, latest.revision] }, { $literal: projection }, "$$ROOT"
    ] } }], { upsert: true });
    return { status };
  }
  async list({ first, afterId, filter }: CardPageRequest) {
    const db = await this.getDb();
    const query = { "content.status": { $ne: "RETIRED" },
      ...(afterId ? { _id: { $gt: afterId } } : {}),
      ...(filter?.type ? { "index.type": filter.type } : {}),
      ...(filter?.color ? { "index.colors": filter.color } : {}),
      ...(filter?.setCode ? { "index.setCode": filter.setCode } : {}),
      ...(filter?.search?.trim() ? { $text: { $search: filter.search.trim() } } : {})
    };
    try {
      const docs = await db.collection<CardDocument>("cards").find(query).sort({ _id: 1 }).limit(first + 1).toArray();
      return { cards: docs.slice(0, first).map(cardFromDocument), hasNextPage: docs.length > first };
    } catch (cause) {
      if (cause instanceof MongoServerError && (cause.code === 27 || cause.code === 26)) throw new Error("Mongo card search indexes are missing. Run npm run mongo:indexes against the app's configured Mongo database.", { cause });
      throw cause;
    }
  }
  async findById(id: CardId) {
    const db = await this.getDb(); const raw = await db.collection<CardDocument>("cards").findOne({ _id: id });
    return raw ? cardFromDocument(raw) : null;
  }
  async findByIds(ids: CardId[]) {
    const db = await this.getDb(); return (await db.collection<CardDocument>("cards").find({ _id: { $in: ids } }).toArray()).map(cardFromDocument);
  }
  async findRevision(cardId: CardId, revision: CardRevision) {
    const db = await this.getDb(); const raw = await db.collection<CardDocument>("card_revisions").findOne({ cardId, revision });
    return raw ? cardFromDocument(raw) : null;
  }
}
export class MongoRulesetRepository implements RulesetRepository {
  constructor(private readonly getDb: () => Promise<Db>) {}
  async findVersion(id: RulesetId, version: RulesetVersion): Promise<Ruleset | null> {
    const db = await this.getDb(); const raw = await db.collection("ruleset_revisions").findOne({ rulesetId: id, version });
    if (!raw) return null;
    const doc = RulesetDocumentSchema.parse(raw);
    if (doc.rulesetId !== doc.content.id || doc.version !== doc.content.version || doc.contentHash !== hashRulesetContent(doc.content)) throw new Error("Corrupt ruleset snapshot identity/hash");
    return doc.content;
  }
  async publish(ruleset: Ruleset): Promise<PublishResult> {
    const db = await this.getDb(); const contentHash = hashRulesetContent(ruleset);
    try {
      await db.collection<z.infer<typeof RulesetDocumentSchema>>("ruleset_revisions").insertOne({ _id: JSON.stringify([ruleset.id, ruleset.version]), rulesetId: ruleset.id, version: ruleset.version, schemaVersion: 1, contentHash, content: ruleset });
      return { status: "PUBLISHED" };
    } catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.findVersion(ruleset.id, ruleset.version);
      return { status: existing && hashRulesetContent(existing) === contentHash ? "REPLAY" : "CONFLICT" };
    }
  }
}
