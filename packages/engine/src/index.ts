import { failure, success, type Result, type GameState, type GameAction, type GameEvent, type PlayerId, type Ruleset } from "@tcg/domain";

export type EngineContext = { readonly ruleset: Ruleset };
export type ActionResult = { state: GameState; events: GameEvent[] };

export function validateState(state: GameState, context: EngineContext): Result<GameState> {
  if (state.rulesetId !== context.ruleset.id || state.rulesetVersion !== context.ruleset.version) {
    return failure("RULESET_MISMATCH", "The exact pinned ruleset is required");
  }
  if (!state.players.includes(state.actingPlayer)) return failure("INVALID_ACTOR", "Acting player is not in this match");
  return success(state);
}
export function listLegalActions(state: GameState, actor: PlayerId, context: EngineContext): Result<GameAction[]> {
  const valid = validateState(state, context);
  if (!valid.ok) return valid;
  if (!state.players.includes(actor)) return failure("UNKNOWN_PLAYER", "Player is not in this match");
  // No Cyberpunk gameplay has been implemented. Do not fabricate legal moves.
  return success([]);
}
export function validateAction(state: GameState, action: GameAction, context: EngineContext): Result<GameAction> {
  const valid = validateState(state, context);
  if (!valid.ok) return valid;
  if (action.expectedStateVersion !== state.version) return failure("STALE_STATE", "Expected state version does not match");
  if (action.actorId !== state.actingPlayer) return failure("INVALID_ACTOR", "Actor does not have priority");
  return failure("UNSUPPORTED_ACTION", "Gameplay actions are not implemented in Phase 1");
}
export function applyAction(state: GameState, action: GameAction, context: EngineContext): Result<ActionResult> {
  const valid = validateAction(state, action, context);
  if (!valid.ok) return valid;
  return failure("UNSUPPORTED_ACTION", "Gameplay actions are not implemented in Phase 1");
}
