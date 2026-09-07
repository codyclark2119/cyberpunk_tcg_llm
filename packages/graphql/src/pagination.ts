import { z } from "zod";
import { CardIdSchema, CardFilterSchema, hashCanonical, type CardId, type CardFilter } from "@tcg/domain";
export const PageInputSchema = z.object({ first: z.number().int().min(1).max(100).default(20), after: z.string().max(2000).nullish(), filter: CardFilterSchema.nullish() });
const CursorSchema = z.strictObject({ v: z.literal(1), id: CardIdSchema, filterHash: z.string().regex(/^[a-f0-9]{64}$/) });
function filterHash(filter?: CardFilter | null): string {
  return hashCanonical({ search: filter?.search?.trim() || null, type: filter?.type || null, color: filter?.color || null, setCode: filter?.setCode || null });
}
export function encodeCursor(id: CardId, filter?: CardFilter | null): string {
  return Buffer.from(JSON.stringify({ v: 1, id, filterHash: filterHash(filter) })).toString("base64url");
}
export function decodeCursor(cursor: string, filter?: CardFilter | null): CardId {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 2000) throw new Error("Invalid pagination cursor");
  const decoded = Buffer.from(cursor, "base64url");
  if (decoded.toString("base64url") !== cursor) throw new Error("Invalid pagination cursor encoding");
  const data = CursorSchema.parse(JSON.parse(decoded.toString("utf8")));
  if (data.filterHash !== filterHash(filter)) throw new Error("Cursor belongs to a different filter");
  return data.id;
}
