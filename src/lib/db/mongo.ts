import { MongoClient, ServerApiVersion, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE ?? "cyberpunk_tcg_content";

declare global {
  var __cyberpunkMongoClientPromise: Promise<MongoClient> | undefined;
}

function createClient() {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  return new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: false,
      deprecationErrors: true
    }
  });
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!global.__cyberpunkMongoClientPromise) {
    const client = createClient();
    global.__cyberpunkMongoClientPromise = client.connect().catch(async (cause: unknown) => {
      global.__cyberpunkMongoClientPromise = undefined;
      await client.close();
      throw new Error(
        "MongoDB connection failed while MONGODB_URI is configured. Start MongoDB with npm run infra:up and check its connection settings. For fixture-only development, unset MONGODB_URI and restart Next.js.",
        { cause }
      );
    });
  }
  return global.__cyberpunkMongoClientPromise;
}

export async function getContentDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(databaseName);
}
