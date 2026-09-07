import { z } from "zod";
import { CardReferenceSchema } from "./card";
import { MatchIdSchema, PlayerIdSchema, RulesetIdSchema, RulesetVersionSchema, GameStateVersionSchema, GameEventSequenceSchema, CommandIdSchema } from "./identity";
export const GameStateSchema = z.strictObject({
  schemaVersion: z.literal(1), matchId: MatchIdSchema, version: GameStateVersionSchema,
  eventSequence: GameEventSequenceSchema, rulesetId: RulesetIdSchema, rulesetVersion: RulesetVersionSchema,
  players: z.array(PlayerIdSchema).min(1).refine((x) => new Set(x).size === x.length, "Duplicate players"),
  actingPlayer: PlayerIdSchema, cards: z.array(CardReferenceSchema).refine((cards) => new Set(cards.map((card) => card.cardId)).size === cards.length, "A match pins one revision per stable card ID"), phase: z.literal("UNIMPLEMENTED")
}).refine((x) => x.players.includes(x.actingPlayer), "Acting player must belong to the match");
export type GameState = z.infer<typeof GameStateSchema>;
export const GameActionSchema = z.strictObject({
  commandId: CommandIdSchema, actorId: PlayerIdSchema,
  expectedStateVersion: GameStateVersionSchema, type: z.literal("UNIMPLEMENTED")
});
export type GameAction = z.infer<typeof GameActionSchema>;
export type GameEvent = { sequence: z.infer<typeof GameEventSequenceSchema>; commandId: z.infer<typeof CommandIdSchema>; type: string };
