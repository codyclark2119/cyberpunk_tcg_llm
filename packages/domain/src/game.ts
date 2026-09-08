import { z } from "zod";
import { CardReferenceSchema } from "./card";
import { MatchIdSchema, PlayerIdSchema, RulesetIdSchema, RulesetVersionSchema, GameStateVersionSchema, GameEventSequenceSchema, CommandIdSchema, CardInstanceIdSchema, GigInstanceIdSchema } from "./identity";
import { ZoneSchema, ZoneRefSchema, EffectSchema, PendingChoiceSchema, PaymentSourceSchema } from "./mechanics";
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const DieTypeSchema = z.enum(["D4", "D6", "D8", "D10", "D12", "D20"]);
export const CardInstanceStateSchema = CardReferenceSchema.extend({
    id: CardInstanceIdSchema, ownerId: PlayerIdSchema, controllerId: PlayerIdSchema, zone: ZoneRefSchema,
    face: z.enum(["UP", "DOWN"]), readiness: z.enum(["READY", "SPENT"]), damage: z.number().int().nonnegative(),
    counters: z.record(z.string(), z.number().int()), statuses: z.array(z.enum(["GO_SOLO", "CANNOT_SELL"])), attachments: z.array(CardInstanceIdSchema)
});
export const GigInstanceStateSchema = z.strictObject({
    id: GigInstanceIdSchema, ownerId: PlayerIdSchema, controllerId: PlayerIdSchema,
    location: z.strictObject({ playerId: PlayerIdSchema, zone: z.enum(["FIXER", "GIGS"]) }), dieType: DieTypeSchema,
    roll: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("UNROLLED") }), z.strictObject({ kind: z.literal("ROLLED"), initialValue: z.number().int().positive(), currentValue: z.number().int() })])
}).refine(g => g.roll.kind === "UNROLLED" || g.roll.initialValue <= Number(g.dieType.slice(1)), "Initial roll exceeds die faces");
export const PlayerStateSchema = z.strictObject({
    id: PlayerIdSchema, seat: z.number().int().nonnegative(), zones: z.record(ZoneSchema, z.array(CardInstanceIdSchema)),
    economy: z.strictObject({ sellsThisTurn: z.number().int().nonnegative(), callsThisTurn: z.number().int().nonnegative().optional(), usageTurn: z.number().int().nonnegative().optional() }),
    gigs: z.strictObject({ FIXER: z.array(GigInstanceIdSchema), GIGS: z.array(GigInstanceIdSchema) }), statuses: z.array(z.enum(["CANNOT_SELL"]))
});
export const CombatStateSchema = z.discriminatedUnion("stage", [
    z.strictObject({ stage: z.literal("NONE") }),
    z.strictObject({ stage: z.enum(["ATTACK_DECLARED", "ATTACK_EFFECTS", "TARGET_LOCKED", "RIVAL_REACT", "COMBAT_RESOLUTION", "GIG_STEAL"]), attackerId: CardInstanceIdSchema, targetId: CardInstanceIdSchema.nullable(), blockerId: CardInstanceIdSchema.nullable() })
]);
export const TurnStepSchema = z.enum(["TURN_START", "READY", "DRAW", "CHOOSE_GIG", "ROLL_GIG", "MAIN", "PAYMENT_SELECTION", "CALL_EFFECT", "TURN_END", "FINISHED"]);
export const TimingStateSchema = z.strictObject({
    turn: z.number().int().nonnegative(), activePlayer: PlayerIdSchema, actingPlayer: PlayerIdSchema,
    emptyFixerStarts: z.number().int().nonnegative().optional(),
    step: TurnStepSchema.optional(), firstPlayer: PlayerIdSchema.optional(),
    window: z.enum(["SETUP", "MAIN", "CHOOSE_GIG", "PAYMENT_SELECTION", "RIVAL_REACT", "RESOLVING", "FINISHED"]), combat: CombatStateSchema
});
export const PendingEffectSchema = z.strictObject({ id: z.string().min(1), controllerId: PlayerIdSchema, sourceId: CardInstanceIdSchema.nullable(), effect: EffectSchema, causedBySequence: z.number().int().nonnegative() });
export const ResolutionStateSchema = z.strictObject({
    stage: z.enum(["DECISION", "RESOLVE_EFFECT", "STATE_BASED_CHECKS", "DISCOVER_TRIGGERS", "ORDER_TRIGGERS", "CHOICE", "UNSUPPORTED"]),
    callContinuation: z.strictObject({ actorId: PlayerIdSchema, legendId: CardInstanceIdSchema, remainingCost: z.number().int().nonnegative(), selectedSources: z.array(PaymentSourceSchema) }).optional(),
    current: PendingEffectSchema.nullable(), pending: z.array(PendingEffectSchema), discovered: z.array(PendingEffectSchema), choice: PendingChoiceSchema.nullable()
});
export const RngStateSchema = z.strictObject({ algorithm: z.literal("SHA256_COUNTER_V1"), seed: z.string().min(1), counter: z.number().int().nonnegative() });
export const GameStateSchema = z.strictObject({
    schemaVersion: z.literal(2),
    match: z.strictObject({ id: MatchIdSchema, version: GameStateVersionSchema, eventSequence: GameEventSequenceSchema,
        outcome: z.strictObject({ winnerId: PlayerIdSchema, loserId: PlayerIdSchema, reason: z.enum(["EMPTY_DRAW", "START_TURN_GIGS"]) }).optional(),
        rulesetId: RulesetIdSchema, rulesetVersion: RulesetVersionSchema, rulesetHash: HashSchema, contentManifestHash: HashSchema,
        engineVersion: z.string().min(1), engineArtifactHash: HashSchema, cards: z.array(CardReferenceSchema), playerOrder: z.array(PlayerIdSchema).min(1) }),
    timing: TimingStateSchema, players: z.record(PlayerIdSchema, PlayerStateSchema),
    objects: z.strictObject({ cards: z.record(CardInstanceIdSchema, CardInstanceStateSchema), gigs: z.record(GigInstanceIdSchema, GigInstanceStateSchema) }),
    resolution: ResolutionStateSchema, rng: RngStateSchema
});
export type DeepReadonly<T> = T extends string | number | boolean | null | undefined ? T : T extends object ? {
    readonly [K in keyof T]: DeepReadonly<T[K]>;
} : T;
export type GameState = DeepReadonly<z.infer<typeof GameStateSchema>>;
export type CardInstanceState = DeepReadonly<z.infer<typeof CardInstanceStateSchema>>;
export type GigInstanceState = DeepReadonly<z.infer<typeof GigInstanceStateSchema>>;
export type PendingEffect = DeepReadonly<z.infer<typeof PendingEffectSchema>>;
export const ActionPayloadSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("SELL_CARD"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.enum(["PLAY_CARD", "CALL_LEGEND", "GO_SOLO", "DECLARE_ATTACK", "DECLARE_BLOCKER"]), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("ROLL_GIG"), gigInstanceId: GigInstanceIdSchema }),
    z.strictObject({ kind: z.literal("CHOOSE"), choiceId: z.string().min(1), optionIndices: z.array(z.number().int().nonnegative()) }),
    z.strictObject({ kind: z.literal("END_TURN") }),
    z.strictObject({ kind: z.literal("PASS_REACT") })
]);
export const GameActionSchema = z.strictObject({ actorId: PlayerIdSchema, action: ActionPayloadSchema });
export const GameCommandSchema = GameActionSchema.extend({ commandId: CommandIdSchema, idempotencyKey: z.string().min(1).max(200), expectedStateVersion: GameStateVersionSchema });
export const LegalActionSchema = GameActionSchema.extend({ actionId: HashSchema, descriptor: z.strictObject({ kind: z.enum(["SELL_CARD", "ROLL_GIG", "CHOOSE", "PLAY_CARD", "CALL_LEGEND", "GO_SOLO", "DECLARE_ATTACK", "DECLARE_BLOCKER", "PASS_REACT", "END_TURN"]), label: z.string() }) });
export const ModelChoiceSchema = z.strictObject({ actionId: HashSchema });
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;
export type GameAction = z.infer<typeof GameActionSchema>;
export type GameCommand = z.infer<typeof GameCommandSchema>;
export type LegalAction = z.infer<typeof LegalActionSchema>;
export const EventPayloadSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("TURN_STARTED"), playerId: PlayerIdSchema, turn: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("TURN_ENDED"), playerId: PlayerIdSchema, turn: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("PHASE_CHANGED"), step: TurnStepSchema }),
    z.strictObject({ kind: z.literal("CARD_READIED"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("LEGEND_CALLED"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("EFFECT_PENDING"), effectId: z.string(), sourceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("EFFECT_RESOLVED"), effectId: z.string() }),
    z.strictObject({ kind: z.literal("GAME_ENDED"), winnerId: PlayerIdSchema, loserId: PlayerIdSchema, reason: z.enum(["EMPTY_DRAW", "START_TURN_GIGS"]) }),
    z.strictObject({ kind: z.literal("CARD_MOVED"), cardInstanceId: CardInstanceIdSchema, from: ZoneRefSchema, to: ZoneRefSchema }),
    z.strictObject({ kind: z.literal("CARD_SOLD"), cardInstanceId: CardInstanceIdSchema, value: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("PAYMENT_MADE"), sources: z.array(PaymentSourceSchema) }),
    z.strictObject({ kind: z.literal("GIG_DIE_ROLLED"), gigInstanceId: GigInstanceIdSchema, dieType: DieTypeSchema, rawValue: z.number().int().positive(), rngCounter: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_VALUE_CHANGED"), gigInstanceId: GigInstanceIdSchema, previous: z.number().int(), current: z.number().int() }),
    z.strictObject({ kind: z.literal("GIG_CONTROL_CHANGED"), gigInstanceId: GigInstanceIdSchema, previous: PlayerIdSchema, current: PlayerIdSchema })
]);
export const GameEventSchema = z.strictObject({ sequence: GameEventSequenceSchema, payload: EventPayloadSchema });
export type GameEvent = z.infer<typeof GameEventSchema>;
export const ReplayStateHashSchema = HashSchema.brand<"ReplayStateHash">();
export const ObservationHashSchema = HashSchema.brand<"ObservationHash">();
export const PositionHashSchema = HashSchema.brand<"PositionHash">();
export type ReplayStateHash = z.infer<typeof ReplayStateHashSchema>;
export type ObservationHash = z.infer<typeof ObservationHashSchema>;
export type PositionHash = z.infer<typeof PositionHashSchema>;
export type MatchState = GameState["match"];
export type TimingState = GameState["timing"];
export type PlayerState = DeepReadonly<z.infer<typeof PlayerStateSchema>>;
export type PlayerZoneState = PlayerState["zones"];
export type ResolutionState = GameState["resolution"];
export type RngState = GameState["rng"];
