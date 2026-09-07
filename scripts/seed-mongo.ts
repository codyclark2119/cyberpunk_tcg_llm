import { loadEnvConfig } from "@next/env";
import { cards } from "@tcg/domain/fixtures";
import { defaultRuleset } from "@tcg/domain";
import { parseEnvironment, connectMongo, createMongoIndexes, MongoCardRepository, MongoRulesetRepository } from "@tcg/persistence";
async function main() {
  loadEnvConfig(process.cwd(), true);
  const mongo = connectMongo(parseEnvironment(process.env));
  try {
    await createMongoIndexes(await mongo.db());
    const cardRepo = new MongoCardRepository(mongo.db);
    for (const card of cards) {
      const result = await cardRepo.publish(card);
      if (result.status === "CONFLICT") throw new Error(`Conflicting fixture revision: ${card.id}`);
      console.log(card.id, result.status);
    }
    const rules = await new MongoRulesetRepository(mongo.db).publish(defaultRuleset);
    if (rules.status === "CONFLICT") throw new Error("Conflicting fixture ruleset version");
    console.log("Fixture ruleset", rules.status);
  } finally { await mongo.close(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
