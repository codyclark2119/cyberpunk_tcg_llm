export type PlayerId = string;
export type CardInstanceId = string;
export type GigDie = "D4" | "D6" | "D8" | "D10" | "D12" | "D20";

export type Zone = "DECK" | "HAND" | "FIELD" | "LEGENDS" | "EDDIES" | "TRASH" | "FIXER" | "GIGS";
export type Phase = "START" | "MAIN" | "REACTION" | "RESOLUTION" | "END" | "GAME_OVER";

export type CardInstance = {
  instanceId: CardInstanceId;
  cardId: string;
  ownerId: PlayerId;
  controllerId: PlayerId;
  zone: Zone;
  ready: boolean;
};

export type GamePlayerState = {
  playerId: PlayerId;
  deck: CardInstanceId[];
  hand: CardInstanceId[];
  field: CardInstanceId[];
  legends: CardInstanceId[];
  eddies: CardInstanceId[];
  trash: CardInstanceId[];
  fixer: GigDie[];
  gigs: { die: GigDie; value: number }[];
};

export type GameState = {
  id: string;
  turnNumber: number;
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  phase: Phase;
  players: Record<PlayerId, GamePlayerState>;
  cards: Record<CardInstanceId, CardInstance>;
  winnerId?: PlayerId;
  log: GameLogEntry[];
};

export type GameAction =
  | { type: "END_TURN"; playerId: PlayerId }
  | { type: "PLAY_CARD"; playerId: PlayerId; cardInstanceId: CardInstanceId }
  | { type: "SELL_CARD"; playerId: PlayerId; cardInstanceId: CardInstanceId }
  | { type: "CALL_LEGEND"; playerId: PlayerId; cardInstanceId: CardInstanceId }
  | { type: "DECLARE_ATTACK"; playerId: PlayerId; attackerId: CardInstanceId; targetId?: CardInstanceId; target: "UNIT" | "GIGS" };

export type GameLogEntry = {
  sequence: number;
  type: string;
  playerId?: PlayerId;
  message: string;
  createdAt: string;
};
