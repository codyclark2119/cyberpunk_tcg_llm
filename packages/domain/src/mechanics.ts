import { z } from "zod";
import { CardInstanceIdSchema, GigInstanceIdSchema, PlayerIdSchema } from "./identity";
export const ZoneSchema = z.enum(["DECK", "HAND", "BATTLEFIELD", "TRASH", "EDDIES", "LEGENDS", "REMOVED"]);
export const ZoneRefSchema = z.strictObject({ playerId: PlayerIdSchema, zone: ZoneSchema });
export const KeywordSchema = z.enum(["GO_SOLO", "QUICK", "BLOCKER", "ADRENALINE"]);
export const TriggerSchema = z.enum(["WHEN_SOLD", "WHEN_CALLED", "WHEN_PLAYED", "WHEN_ATTACKING", "WHEN_DEFEATED"]);
export const TargetSelectorSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("SELF") }),
    z.strictObject({ kind: z.literal("CARDS"), zone: ZoneSchema, relation: z.enum(["CONTROLLED", "RIVAL", "ANY"]), keyword: KeywordSchema.optional() }),
    z.strictObject({ kind: z.literal("GIGS"), relation: z.enum(["CONTROLLED", "RIVAL", "ANY"]) })
]);
export const ConditionSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("GIG_COUNT"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DISTINCT_GIG_DIE_TYPES"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DISTINCT_GIG_VALUES"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("STREET_CRED"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_VALUE"), value: z.number().int() })
]);
export const CostSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("EDDIES"), amount: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DASH") }), z.strictObject({ kind: z.literal("NONE") })
]);
export const PaymentSourceSchema = z.strictObject({ kind: z.enum(["EDDIE", "LEGEND"]), cardInstanceId: CardInstanceIdSchema });
export const ChoiceOptionSchema = z.discriminatedUnion("kind", [
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
    kind: z.enum(["CARD", "TARGET", "MODE", "AMOUNT", "ORDER", "ROLL_GIG", "MODIFY_GIG", "STEAL_GIGS", "PAYMENT", "OPTIONAL"]),
    options: z.array(ChoiceOptionSchema), min: z.number().int().nonnegative(), max: z.number().int().nonnegative(),
    ordered: z.boolean(), continuationId: z.string().min(1)
}).refine(c => c.min <= c.max && c.max <= c.options.length, "Invalid choice bounds");
export const EffectSchema = z.discriminatedUnion("kind", [
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
export const AbilitySchema = z.strictObject({ id: z.string().min(1), trigger: TriggerSchema.optional(), conditions: z.array(ConditionSchema), cost: CostSchema, effects: z.array(EffectSchema) });
export const ContinuousModifierSchema = z.discriminatedUnion("kind", [
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
