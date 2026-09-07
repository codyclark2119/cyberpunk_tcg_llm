import { z } from "zod";
import { GameStateSchema, GameActionSchema, PlayerIdSchema, RulesetIdSchema, RulesetVersionSchema, hashGameState, canonicalSerialize, failure, success, type Result, type GameState, type GameAction, type PlayerId } from "@tcg/domain";
import { listLegalActions, applyAction, type EngineContext } from "@tcg/engine";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const TrainingPositionSchema = z.strictObject({
  schemaVersion: z.literal(1), positionId: hash, stateHash: hash,
  rulesetId: RulesetIdSchema, rulesetVersion: RulesetVersionSchema,
  state: GameStateSchema, actingPlayer: PlayerIdSchema, legalActions: z.array(GameActionSchema),
  chosenAction: GameActionSchema.optional(), resultingStateHash: hash.optional(),
  metadata: z.record(z.string(), z.string())
}).superRefine((position, ctx) => {
  if (hashGameState(position.state) !== position.stateHash || position.positionId !== position.stateHash) ctx.addIssue({ code: "custom", message: "State hash mismatch" });
  if (position.rulesetId !== position.state.rulesetId || position.rulesetVersion !== position.state.rulesetVersion || position.actingPlayer !== position.state.actingPlayer) ctx.addIssue({ code: "custom", message: "Position context mismatch" });
});
export type TrainingPosition = z.infer<typeof TrainingPositionSchema>;
export function generatePosition(state: GameState, actor: PlayerId, context: EngineContext): Result<TrainingPosition> {
  if (actor !== state.actingPlayer) return failure("INVALID_ACTOR", "Position actor must have priority");
  const legal = listLegalActions(state, actor, context);
  if (!legal.ok) return legal;
  const stateHash = hashGameState(state);
  return success({ schemaVersion: 1, positionId: stateHash, stateHash, rulesetId: state.rulesetId, rulesetVersion: state.rulesetVersion, state: structuredClone(state), actingPlayer: actor, legalActions: legal.value, metadata: {} });
}
export function evaluateCandidate(position: TrainingPosition, action: GameAction, context: EngineContext): Result<TrainingPosition> {
  const result = applyAction(position.state, action, context);
  if (!result.ok) return result;
  return success({ ...position, chosenAction: action, resultingStateHash: hashGameState(result.value.state) });
}
export function importPositions(jsonl: string): TrainingPosition[] {
  return jsonl.split("\n").filter((line) => line.trim()).map((line) => TrainingPositionSchema.parse(JSON.parse(line)));
}
export function exportPositions(positions: readonly TrainingPosition[]): string {
  return [...new Map(positions.map((p) => [p.stateHash, p])).values()].map(canonicalSerialize).join("\n") + (positions.length ? "\n" : "");
}
