import { loadEnvConfig } from "@next/env";
import { MongoClient, ServerApiVersion } from "mongodb";

async function main() {
  loadEnvConfig(process.cwd(), true);

  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE ?? "cyberpunk_tcg_content";

  if (!uri) throw new Error("Set MONGODB_URI before running npm run mongo:indexes");

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: true }
  });

  try {
    await client.connect();
    const cards = client.db(databaseName).collection("cards");

    await cards.createIndex({ "index.cardNumber": 1 }, { unique: true });
    await cards.createIndex({ "index.setCode": 1, "index.cardNumber": 1 });
    await cards.createIndex({ "index.type": 1 });
    await cards.createIndex({ "index.colors": 1 });
    await cards.createIndex(
      {
        "index.name": "text",
        "index.cardNumber": "text",
        "index.searchText": "text",
        "data.rulesText": "text",
        "data.tags": "text"
      },
      { name: "card_search" }
    );

    const rulesets = client.db(databaseName).collection("rulesets");
    await rulesets.createIndex({ rulesetId: 1, version: 1 }, { unique: true });
    await rulesets.createIndex({ rulesetId: 1, status: 1 });

    console.log(`MongoDB indexes ready in ${databaseName}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error("MongoDB index creation failed. Check MONGODB_URI and run npm run infra:up.", error);
  process.exitCode = 1;
});
