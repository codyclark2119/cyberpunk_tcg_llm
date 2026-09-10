import { z } from "zod";
import { CardInstanceIdSchema, GigInstanceIdSchema, PlayerIdSchema } from "./identity";
export const GameAreaSchema = z.enum(["DECK", "HAND", "BATTLEFIELD", "TRASH", "EDDIES", "LEGENDS", "REMOVED"]);
// Technical object location, explicitly NOT a game area or Removed from Play (4.14.2).
export const ZoneSchema = z.enum([...GameAreaSchema.options, "RESOLVING_PROGRAM"]);
export const ZoneRefSchema = z.strictObject({ playerId: PlayerIdSchema, zone: ZoneSchema });
export const KeywordSchema = z.enum(["GO_SOLO", "QUICK", "BLOCKER", "ADRENALINE"]);
export const TriggerSchema = z.enum(["WHEN_SOLD", "WHEN_CALLED", "WHEN_PLAYED", "WHEN_ATTACKING", "WHEN_DEFEATED", "WHEN_FIGHT_WON", "WHEN_CARD_PLAYED", "WHEN_OWN_TURN_ENDS", "WHEN_UNIT_ATTACKS"]);
export const EquipTargetSchema = z.strictObject({ kind: z.literal("FRIENDLY_UNIT_OR_FACE_UP_LEGEND") });
export const TargetRelationshipSchema = z.enum(["CONTROLLED", "RIVAL", "ANY"]);
export const TargetSelectorSchema = z.discriminatedUnion("kind", [
    EquipTargetSchema,
    z.strictObject({ kind: z.literal("SELF") }),
    z.strictObject({ kind: z.literal("CARDS"), zone: ZoneSchema, relation: TargetRelationshipSchema, keyword: KeywordSchema.optional() }),
    z.strictObject({ kind: z.literal("GIGS"), relation: TargetRelationshipSchema })
]);
export const NamedUnitConditionSchema = z.strictObject({ kind: z.literal("SUBJECT_IS_UNIT_NAMED"), identity: z.literal("V") });
export const ConditionSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("STREET_CRED_IS_EVEN") }),
    z.strictObject({ kind: z.literal("STREET_CRED_LESS_THAN_VALUE"), value: z.number().int().nonnegative() }),
    NamedUnitConditionSchema,
    z.strictObject({ kind: z.literal("SUBJECT_STOLE_GIG_THIS_TURN") }),
    z.strictObject({ kind: z.literal("STREET_CRED_DIFFERENCE_AT_LEAST"), minimum: z.literal(10) }),
    z.strictObject({ kind: z.literal("STREET_CRED_LESS_THAN_RIVAL") }),
    z.strictObject({ kind: z.literal("STREET_CRED_GREATER_THAN_RIVAL") }),
    z.strictObject({ kind: z.literal("SOURCE_POWER_AT_LEAST"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_VALUE_AT_LEAST"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_COUNT"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DISTINCT_GIG_DIE_TYPES"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DISTINCT_GIG_VALUES"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("STREET_CRED"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_VALUE"), value: z.number().int() })
]);
export const CombatRestrictionSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("CANNOT_ATTACK") }),
    z.strictObject({ kind: z.literal("CANNOT_BE_BLOCKED"), condition: z.strictObject({ kind: z.literal("STREET_CRED_LESS_THAN_RIVAL") }) })
]);
export type CombatRestriction = z.infer<typeof CombatRestrictionSchema>;
export const CostSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("EDDIES"), amount: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DASH") }), z.strictObject({ kind: z.literal("NONE") })
]);
export const PaymentSourceSchema = z.strictObject({ kind: z.enum(["EDDIE", "LEGEND"]), cardInstanceId: CardInstanceIdSchema });
export const AttackTargetSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("CARD"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GIG_AREA"), playerId: PlayerIdSchema })
]);
export type AttackTarget = z.infer<typeof AttackTargetSchema>;
export const ChoiceOptionSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("EDDIE_SLOT"), slot: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("LEGEND_SLOT"), slot: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("ATTACK_TARGET"), target: AttackTargetSchema }),
    z.strictObject({ kind: z.literal("CARD"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GIG"), gigInstanceId: GigInstanceIdSchema }),
    z.strictObject({ kind: z.literal("MODE"), mode: z.string().min(1) }),
    z.strictObject({ kind: z.literal("AMOUNT"), amount: z.number().int() }),
    z.strictObject({ kind: z.literal("EFFECT"), effectId: z.string().min(1) }),
    z.strictObject({ kind: z.literal("PAYMENT"), source: PaymentSourceSchema }),
    z.strictObject({ kind: z.literal("CONFIRM"), confirmed: z.boolean() })
]);
export const PendingChoiceSchema = z.strictObject({
    id: z.string().min(1), actorId: PlayerIdSchema,
    kind: z.enum(["CARD", "TARGET", "MODE", "AMOUNT", "ORDER", "ROLL_GIG", "MODIFY_GIG", "STEAL_GIGS", "PAYMENT", "OPTIONAL", "DISCARD", "READY_EDDIE"]),
    options: z.array(ChoiceOptionSchema), min: z.number().int().nonnegative(), max: z.number().int().nonnegative(),
    ordered: z.boolean(), continuationId: z.string().min(1)
}).refine(c => c.min <= c.max && c.max <= c.options.length, "Invalid choice bounds");
export const DiscardCardsEffectSchema = z.strictObject({
    kind: z.literal("DISCARD_CARDS"), player: z.literal("CONTROLLER"), count: z.literal(1),
    selection: z.literal("CHOSEN_BY_AFFECTED_PLAYER"),
    when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: ConditionSchema }).optional()
});
export type DiscardCardsEffect = z.infer<typeof DiscardCardsEffectSchema>;
export const ReadyEddiesEffectSchema = z.strictObject({ kind: z.literal("READY_EDDIES"), player: z.literal("CONTROLLER"), count: z.union([z.literal(1), z.literal(2)]),
    when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: NamedUnitConditionSchema }).optional() });
export const RegisterEndTurnEffectSchema = z.strictObject({ kind: z.literal("REGISTER_END_TURN_EFFECT"),
    effect: ReadyEddiesEffectSchema.extend({ count: z.literal(2), when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: NamedUnitConditionSchema }) }) });
export const SpendUnitTargetSchema = z.strictObject({ kind: z.literal("UNITS"), relation: TargetRelationshipSchema, costAtMost: z.literal(4) });
export type SpendUnitTarget = z.infer<typeof SpendUnitTargetSchema>;
export const SpendUnitEffectSchema = z.strictObject({ kind: z.literal("SPEND_UNIT"), target: SpendUnitTargetSchema });
export const DefeatUnitTargetSchema = z.strictObject({ kind: z.literal("UNITS"), relation: TargetRelationshipSchema,
    power: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("AT_MOST"), value: z.literal(5) }), z.strictObject({ kind: z.literal("CONTROLLED_GIG_VALUE"), dieType: z.literal("D20") })]) });
export type DefeatUnitTarget = z.infer<typeof DefeatUnitTargetSchema>;
export const DefeatUnitEffectSchema = z.strictObject({ kind: z.literal("DEFEAT_UNIT"), target: DefeatUnitTargetSchema,
    when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: z.strictObject({ kind: z.literal("STREET_CRED_GREATER_THAN_RIVAL") }) }).optional() });
export const EffectSchema = z.discriminatedUnion("kind", [
    SpendUnitEffectSchema,
    DefeatUnitEffectSchema,
    ReadyEddiesEffectSchema,
    RegisterEndTurnEffectSchema,
    z.strictObject({ kind: z.literal("DECREASE_GIG_UP_TO"), target: z.strictObject({ kind: z.literal("GIGS"), relation: z.literal("ANY") }), maximum: z.literal(2) }),
    DiscardCardsEffectSchema,
    z.strictObject({ kind: z.literal("LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND") }),
    z.strictObject({ kind: z.literal("OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN"), maximum: z.literal(2), draw: z.literal(1) }),
    z.strictObject({ kind: z.literal("CREATE_NEXT_RIVAL_FIGHT_PREVENTION") }),
    z.strictObject({ kind: z.literal("POWER_UNTIL_END_OF_TURN"), target: z.strictObject({ kind: z.literal("RIVAL_UNIT") }), amount: z.literal(-1) }),
    z.strictObject({ kind: z.literal("ADJUST_GIG_UP_TO"), target: z.strictObject({ kind: z.literal("GIGS"), relation: z.literal("ANY") }), maximum: z.union([z.literal(1), z.literal(4)]), direction: z.literal("INCREASE").optional() }),
    z.strictObject({ kind: z.literal("CONDITIONAL_DRAW"), timing: z.literal("RESOLUTION"), condition: ConditionSchema, count: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("SEARCH_GEAR"), count: z.number().int().positive().max(5), maxCost: z.number().int().nonnegative(), maxTake: z.number().int().positive().max(2) }),
    z.strictObject({ kind: z.literal("DRAW"), count: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("DAMAGE"), target: TargetSelectorSchema, amount: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("MOVE_CARD"), target: TargetSelectorSchema, destination: ZoneSchema }),
    z.strictObject({ kind: z.literal("MODIFY_POWER"), target: TargetSelectorSchema, amount: z.number().int() }),
    z.strictObject({ kind: z.literal("MODIFY_GIG_VALUE"), target: TargetSelectorSchema, amount: z.number().int() }),
    z.strictObject({ kind: z.literal("CREATE_CHOICE"), choice: PendingChoiceSchema }),
    // A named, versioned handwritten implementation; no arbitrary mutation parameters.
    z.strictObject({ kind: z.literal("CUSTOM"), handlerId: z.string().regex(/^[a-z][a-z0-9._-]+@\d+$/) })
]);
export const ActivationCostSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("SPEND_SOURCE") }),
    z.strictObject({ kind: z.literal("PAYMENT_COST"), cost: CostSchema })
]);
export const AbilitySchema = z.strictObject({ id: z.string().min(1), trigger: TriggerSchema.optional(),
    inherited: z.literal("EQUIPPED_HOST").optional(),
    guard: z.enum(["FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN", "FIRST_FRIENDLY_ARASAKA_UNIT_ATTACK_PER_TURN"]).optional(),
    activation: z.strictObject({ timing: z.literal("MAIN"), conditionTiming: z.literal("ACTIVATION_AND_RESOLUTION"), costs: z.array(ActivationCostSchema) }).optional(),
    conditions: z.array(ConditionSchema), cost: CostSchema, effects: z.array(EffectSchema) });
export const ContinuousModifierSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER"), amount: z.literal(1) }),
    z.strictObject({ kind: z.literal("GRANT_KEYWORD_TO_HOST"), keyword: z.literal("BLOCKER") }),
    z.strictObject({ kind: z.literal("GRANT_PRINTED_POWER_TO_HOST") }),
    z.strictObject({ kind: z.literal("POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN"), amount: z.number().int() }),
    z.strictObject({ kind: z.literal("POWER"), target: TargetSelectorSchema, amount: z.number().int(), requiresFaceUp: z.boolean() }),
    z.strictObject({ kind: z.literal("KEYWORD"), target: TargetSelectorSchema, keyword: KeywordSchema, requiresFaceUp: z.boolean() })
]);
export type Keyword = z.infer<typeof KeywordSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type Ability = z.infer<typeof AbilitySchema>;
export type Cost = z.infer<typeof CostSchema>;
export type TargetSelector = z.infer<typeof TargetSelectorSchema>;
export type ContinuousModifier = z.infer<typeof ContinuousModifierSchema>;
export type PaymentSource = z.infer<typeof PaymentSourceSchema>;
export type PendingChoice = z.infer<typeof PendingChoiceSchema>;
