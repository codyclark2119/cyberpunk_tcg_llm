import { defaultRuleset } from "@tcg/domain";
import { createGraphServer, type GraphContext } from "@tcg/graphql";
import { parseEnvironment, connectMongo, MongoCardRepository, MongoRulesetRepository, FixtureCardRepository, FixtureRulesetRepository } from "@tcg/persistence";
const env = parseEnvironment(process.env);
const mongo = connectMongo(env);
export const graphContext: GraphContext = {
  cards: env.MONGODB_URI ? new MongoCardRepository(mongo.db) : new FixtureCardRepository(),
  rulesets: env.MONGODB_URI ? new MongoRulesetRepository(mongo.db) : new FixtureRulesetRepository(),
  rulesetId: defaultRuleset.id, rulesetVersion: defaultRuleset.version
};
export const apolloServer = createGraphServer();
