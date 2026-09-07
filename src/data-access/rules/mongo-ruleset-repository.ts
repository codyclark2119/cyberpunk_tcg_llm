import { getContentDb } from "@/lib/db/mongo";
import type { RulesetDocument, RulesetRepository } from "./types";

export class MongoRulesetRepository implements RulesetRepository {
  private async collection() {
    const db = await getContentDb();
    return db.collection<RulesetDocument>("rulesets");
  }

  async findVersion(rulesetId: string, version: string) {
    const collection = await this.collection();
    return collection.findOne({ rulesetId, version });
  }

  async findActive(rulesetId: string) {
    const collection = await this.collection();
    return collection.findOne(
      { rulesetId, status: "ACTIVE" },
      { sort: { effectiveAt: -1, version: -1 } }
    );
  }
}
