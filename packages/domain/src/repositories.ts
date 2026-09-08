import { z } from "zod";
import { DeckIdSchema, PlayerIdSchema, GameStateVersionSchema, RulesetIdSchema, RulesetVersionSchema, CommandIdSchema } from "./identity";
import { CardReferenceSchema } from "./card";
import type { Card, CardFilter } from "./card";
import type { CardId, CardRevision, RulesetId, RulesetVersion, PlayerId, DeckId, MatchId, GameStateVersion, CommandId } from "./identity";
import type { Ruleset } from "./ruleset";
import type { GameState, GameEvent } from "./game";
import type { Result } from "./result";
export type CardPageRequest = { first: number; afterId?: CardId; filter?: CardFilter };
export type CardPage = { cards: Card[]; hasNextPage: boolean };
export type PublishResult = { status: "PUBLISHED" | "REPLAY" } | { status: "CONFLICT" };
export interface CardRepository {
  list(request: CardPageRequest): Promise<CardPage>;
  findById(id: CardId): Promise<Card | null>;
  findByIds(ids: CardId[]): Promise<Card[]>;
  findRevision(id: CardId, revision: CardRevision): Promise<Card | null>;
  publish(card: Card): Promise<PublishResult>;
}
export interface RulesetRepository {
  findVersion(id: RulesetId, version: RulesetVersion): Promise<Ruleset | null>;
  publish(ruleset: Ruleset): Promise<PublishResult>;
}
export const StoredDeckSchema = z.strictObject({
  id: DeckIdSchema, ownerId: PlayerIdSchema, name: z.string().trim().min(1), version: GameStateVersionSchema,
  rulesetId: RulesetIdSchema, rulesetVersion: RulesetVersionSchema,
  entries: z.array(CardReferenceSchema.extend({ quantity: z.number().int().positive(), zone: z.enum(["LEGEND", "MAIN"]) }))
}).superRefine((deck, context) => {
  const seen = new Set<string>();
  for (const entry of deck.entries) {
    const key = `${entry.zone}:${entry.cardId}`;
    if (seen.has(key)) context.addIssue({ code: "custom", message: "Duplicate deck entry" });
    if (entry.zone === "LEGEND" && entry.quantity !== 1) context.addIssue({ code: "custom", message: "Legend slots contain one card" });
    seen.add(key);
  }
}).transform((deck) => ({ ...deck, entries: [...deck.entries].sort((a, b) => {
  const left = `${a.zone}:${a.cardId}`; const right = `${b.zone}:${b.cardId}`;
  return left < right ? -1 : left > right ? 1 : 0;
}) }));
export type StoredDeck = z.infer<typeof StoredDeckSchema>;
export interface DeckRepository {
  create(deck: StoredDeck): Promise<Result<StoredDeck>>;
  find(id: DeckId, owner: PlayerId): Promise<StoredDeck | null>;
  save(deck: StoredDeck, expectedVersion: GameStateVersion): Promise<Result<StoredDeck>>;
}
export interface MatchRepository {
  find(id: MatchId): Promise<GameState | null>;
  history(id: MatchId): Promise<GameEvent[]>;
  create(state: GameState, events?: readonly GameEvent[]): Promise<Result<GameState>>;
  save(state: GameState, expectedVersion: GameStateVersion, events?: readonly GameEvent[]): Promise<Result<GameState>>;
}
export const CommandRequestSchema = z.strictObject({
  commandId: CommandIdSchema, idempotencyKey: z.string().min(1).max(200), actorId: PlayerIdSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/)
});
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type CommandBegin<T> = { status: "STARTED"; commandId: CommandId } | { status: "IN_PROGRESS" } | { status: "REPLAY"; response: T } | { status: "CONFLICT" };
export type CommandExecution<T> = Exclude<CommandBegin<T>, { status: "STARTED" }> | { status: "COMPLETED"; response: T };
/** Implementations bind execution and completion to the same DB transaction. */
export interface CommandRepository<T, Transaction> {
  begin(request: CommandRequest): Promise<CommandBegin<T>>;
  execute(request: CommandRequest, operation: (transaction: Transaction) => Promise<T>): Promise<CommandExecution<T>>;
}
