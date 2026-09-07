import type { Filter } from "mongodb";
import { getContentDb } from "@/lib/db/mongo";
import { cardDocumentToDomain } from "./mapper";
import type { CardDocument, CardFilter, CardRepository } from "./types";

export class MongoCardRepository implements CardRepository {
  private async collection() {
    const db = await getContentDb();
    return db.collection<CardDocument>("cards");
  }

  async find(filter?: CardFilter) {
    const collection = await this.collection();
    const query: Filter<CardDocument> = { status: { $ne: "RETIRED" } };

    if (filter?.type) query["index.type"] = filter.type;
    if (filter?.color) query["index.colors"] = filter.color;
    if (filter?.setCode) query["index.setCode"] = filter.setCode;
    if (filter?.search?.trim()) {
      query.$text = { $search: filter.search.trim() };
    }

    const documents = await collection
      .find(query)
      .sort({ "index.setCode": 1, "index.cardNumber": 1 })
      .toArray();

    return documents.map(cardDocumentToDomain);
  }

  async findById(id: string) {
    const collection = await this.collection();
    const document = await collection.findOne({ _id: id });
    return document ? cardDocumentToDomain(document) : null;
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const collection = await this.collection();
    const documents = await collection.find({ _id: { $in: [...new Set(ids)] } }).toArray();
    return documents.map(cardDocumentToDomain);
  }
}
