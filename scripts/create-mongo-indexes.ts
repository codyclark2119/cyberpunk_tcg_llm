import { loadEnvConfig } from "@next/env";
import { parseEnvironment, connectMongo, createMongoIndexes } from "@tcg/persistence";
async function main() {
  loadEnvConfig(process.cwd(), true);
  const env = parseEnvironment(process.env);
  const mongo = connectMongo(env);
  try { await createMongoIndexes(await mongo.db()); console.log(`MongoDB indexes ready in ${env.MONGODB_DATABASE}`); }
  finally { await mongo.close(); }
}
main().catch((error: unknown) => { console.error("MongoDB index creation failed:", error); process.exitCode = 1; });
