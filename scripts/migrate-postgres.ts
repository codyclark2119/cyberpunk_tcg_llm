import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { hashCanonical } from "@tcg/domain";
import { createPostgresPool, parseEnvironment } from "@tcg/persistence";
async function schemaDescription(client: PoolClient, schema: string) {
  const columns = await client.query(`SELECT c.relname AS table_name, a.attname AS column_name,
    format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required,
    pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND c.relkind='r' AND c.relname <> 'schema_migrations'
    ORDER BY c.relname,a.attnum`, [schema]);
  const constraints = await client.query(`SELECT c.relname AS table_name, con.conname AS name,
    pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname <> 'schema_migrations' ORDER BY c.relname,con.conname`, [schema]);
  const indexes = await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename <> 'schema_migrations' ORDER BY tablename,indexname", [schema]);
  return JSON.stringify({ columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows }).replaceAll(`${schema}.`, "");
}
async function baselineOriginal(client: PoolClient) {
  const name = "0001_platform.sql";
  if ((await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name])).rowCount) return;
  const sql = await readFile(`db/postgres/migrations/${name}`, "utf8");
  const shadow = `tcg_baseline_${randomUUID().replaceAll("-", "")}`;
  await client.query("BEGIN");
  try {
    await client.query(`CREATE SCHEMA ${shadow}`);
    await client.query(`SET LOCAL search_path TO ${shadow}, public`);
    await client.query(sql);
    const expected = await schemaDescription(client, shadow);
    await client.query("SET LOCAL search_path TO public");
    const actual = await schemaDescription(client, "public");
    if (actual !== expected) throw new Error("Cannot baseline 0001: live schema differs from the original migration. Reconcile it explicitly before proceeding.");
    await client.query(`DROP SCHEMA ${shadow} CASCADE`);
    await client.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, hashCanonical(sql)]);
    await client.query("COMMIT");
    console.log("Verified and baselined", name);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
async function main() {
  loadEnvConfig(process.cwd(), true);
  const pool = createPostgresPool(parseEnvironment(process.env).DATABASE_URL);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(731903)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    if (process.argv.includes("--baseline-0001")) await baselineOriginal(client);
    for (const name of (await readdir("db/postgres/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = await readFile(`db/postgres/migrations/${name}`, "utf8");
      const checksum = hashCanonical(sql);
      const existing = await client.query("SELECT checksum FROM schema_migrations WHERE name=$1", [name]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
        await client.query("COMMIT"); console.log("Applied", name);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { await client.query("SELECT pg_advisory_unlock(731903)"); client.release(); await pool.end(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
