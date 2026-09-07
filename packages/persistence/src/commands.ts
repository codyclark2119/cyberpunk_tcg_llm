import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { canonicalSerialize, CommandIdSchema, type CommandRequest, type CommandBegin, type CommandRepository, type CommandExecution } from "@tcg/domain";
const RowSchema = z.object({ command_id: CommandIdSchema, request_hash: z.string(), status: z.enum(["STARTED", "COMPLETED", "FAILED"]), response: z.unknown() });

/** All operation effects must use the provided client. No external side effects inside this transaction. */
export class PostgresCommandRepository<T> implements CommandRepository<T, PoolClient> {
  constructor(private readonly pool: Pool, private readonly responseSchema: z.ZodType<T>) {}
  async begin(request: CommandRequest): Promise<CommandBegin<T>> {
    const inserted = await this.pool.query(
      `INSERT INTO commands(command_id,actor_id,idempotency_key,request_hash,status)
       VALUES($1,$2,$3,$4,'STARTED') ON CONFLICT DO NOTHING RETURNING command_id`,
      [request.commandId, request.actorId, request.idempotencyKey, request.requestHash]);
    if (inserted.rowCount === 1) return { status: "STARTED", commandId: request.commandId };
    const result = await this.pool.query("SELECT * FROM commands WHERE actor_id=$1 AND idempotency_key=$2", [request.actorId, request.idempotencyKey]);
    if (!result.rows[0]) return { status: "CONFLICT" }; // command ID reused under another key
    const row = RowSchema.parse(result.rows[0]);
    if (row.request_hash !== request.requestHash) return { status: "CONFLICT" };
    if (row.status === "COMPLETED") return { status: "REPLAY", response: this.responseSchema.parse(row.response) };
    if (row.status === "FAILED") {
      const retry = await this.pool.query("UPDATE commands SET status='STARTED' WHERE command_id=$1 AND status='FAILED' RETURNING command_id", [row.command_id]);
      if (retry.rowCount === 1) return { status: "STARTED", commandId: row.command_id };
    }
    return { status: "IN_PROGRESS" };
  }
  async execute(request: CommandRequest, operation: (transaction: PoolClient) => Promise<T>): Promise<CommandExecution<T>> {
    const claim = await this.begin(request);
    if (claim.status !== "STARTED") return claim;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT command_id FROM commands WHERE command_id=$1 FOR UPDATE", [claim.commandId]);
      const response = this.responseSchema.parse(await operation(client));
      const serialized = canonicalSerialize(response);
      await client.query("UPDATE commands SET status='COMPLETED', response=$2::jsonb, completed_at=now() WHERE command_id=$1", [claim.commandId, serialized]);
      await client.query("COMMIT");
      return { status: "COMPLETED", response };
    } catch (error) {
      await client.query("ROLLBACK");
      // A lost COMMIT acknowledgement must not overwrite a committed response.
      await client.query("UPDATE commands SET status='FAILED' WHERE command_id=$1 AND status='STARTED'", [claim.commandId]);
      throw error;
    } finally { client.release(); }
  }
}
