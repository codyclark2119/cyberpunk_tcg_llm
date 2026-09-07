import { Pool } from "pg";

declare global {
  var __cyberpunkPgPool: Pool | undefined;
}

export function getPostgresPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!global.__cyberpunkPgPool) {
    global.__cyberpunkPgPool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
  }

  return global.__cyberpunkPgPool;
}
