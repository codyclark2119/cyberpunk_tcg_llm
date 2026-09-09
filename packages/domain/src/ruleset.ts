import { z } from "zod";
import { RulesetIdSchema, RulesetVersionSchema } from "./identity";
export const DeckFormatSchema = z.enum(["CONSTRUCTED", "SEALED_LIMITED"]);
export const FormatPolicySchema = z.strictObject({
    mainDeck: z.strictObject({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).refine(x => x.max >= x.min),
    legendCount: z.number().int().nonnegative(), maxCopies: z.number().int().positive(),
    legendUniqueness: z.enum(["CARD_ID", "DECKBUILDING_IDENTITY"])
});
export const TurnSlicePolicySchema = z.strictObject({
    fieldLegends: z.literal("FIELD_LEGENDS_V1").optional(),
    cardPlay: z.literal("NONCOMBAT_PLAY_V1").optional(),
    combat: z.literal("COMBAT_ATTACK_V1").optional(),
    react: z.literal("COMBAT_REACT_V1").optional(),
    combatRestrictions: z.literal("COMBAT_RESTRICTIONS_V1").optional(),
    gearCapabilities: z.literal("GEAR_CAPABILITIES_V1").optional(),
    combatTriggers: z.literal("COMBAT_TRIGGERS_V1").optional(),
    combatResolution: z.strictObject({
        version: z.literal("COMBAT_RESOLUTION_V1"),
        negativeReferences: z.literal("ZERO"),
        temporaryModifierIdentity: z.literal("PHYSICAL_CARD_UNTIL_HIDDEN_OR_TURN_END"),
        gigSteal: z.strictObject({ nonPositive: z.literal(0), positiveDivisor: z.literal(10), positiveBase: z.literal(1) })
    }).optional(),
            gear: z.literal("REVIEWED_GEAR_V1").optional(),
    schemaVersion: z.literal(1), rulesSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    drawPerTurn: z.number().int().positive(), callLimitPerTurn: z.number().int().nonnegative(), callCost: z.number().int().nonnegative().max(1000),
    readyZones: z.array(z.enum(["LEGENDS", "BATTLEFIELD", "EDDIES"])),
    firstTurnSpentLegendsStaySpent: z.boolean(),
    d20Eligibility: z.literal("ORIGINAL_OTHER_DICE_ROLLED"),
    emptyFixer: z.literal("SKIP"), emptyDraw: z.enum(["LOSE", "UNSUPPORTED"]),
    startTurnGigWinCount: z.number().int().positive(),
    setup: z.enum(["AGREED_FIRST_PLAYER_DECLINED_MULLIGANS_AND_CUTS", "ENGINE_SETUP_V1"]),
    callEffects: z.enum(["SINGLE_UNCONDITIONAL_DRAW", "REVIEWED_CALL_V1"]),
    overtime: z.literal("UNSUPPORTED")
});
export const GameplayPolicySchema = z.strictObject({
    initialization: z.enum(["UNSUPPORTED", "ORDERED_FIXTURE", "TURN_SLICE_V1"]),
    turnSlice: TurnSlicePolicySchema.optional(),
    firstPlayerSpentLegends: z.number().int().nonnegative(), openingHand: z.number().int().nonnegative(),
    sellLimitPerTurn: z.number().int().nonnegative(), legendPaymentValue: z.number().int().nonnegative().nullable(),
    gigValueBounds: z.union([z.literal("UNSUPPORTED"), z.literal("DIE_FACES_V1"), z.strictObject({ min: z.number().int(), max: z.number().int() }).refine(x => x.min <= x.max)]),
    triggerOrdering: z.enum(["UNSUPPORTED", "CONTROLLER_CHOICE"]),
    win: z.union([z.literal("UNSUPPORTED"), z.strictObject({ streetCred: z.number().int().positive(), timing: z.literal("STABLE_DECISION"), simultaneous: z.literal("UNSUPPORTED") })])
});
export const RulesetSchema = z.strictObject({
    id: RulesetIdSchema, version: RulesetVersionSchema, schemaVersion: z.union([z.literal(1), z.literal(2)]),
    formats: z.partialRecord(DeckFormatSchema, FormatPolicySchema).optional(),
    gameplay: GameplayPolicySchema.optional(),
    deckbuilding: z.strictObject({
        mainDeck: z.strictObject({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
            .refine((x) => x.max >= x.min, "Maximum must be at least minimum"),
        legendCount: z.number().int().nonnegative(), maxCopies: z.number().int().positive()
    })
}).superRefine((rules, ctx) => {
    if (rules.gameplay?.initialization === "TURN_SLICE_V1" && !rules.gameplay.turnSlice)
        ctx.addIssue({ code: "custom", message: "Turn slice requires explicit policies" });
    if (rules.schemaVersion === 2 && (!rules.formats?.CONSTRUCTED || !rules.formats.SEALED_LIMITED || !rules.gameplay))
        ctx.addIssue({ code: "custom", message: "Schema 2 requires both format policies and explicit gameplay policies" });
    if (rules.schemaVersion === 1 && (rules.formats || rules.gameplay))
        ctx.addIssue({ code: "custom", message: "Publish a new schema 2 ruleset to add policies; do not rewrite legacy snapshots" });
});
export type Ruleset = z.infer<typeof RulesetSchema>;
export const defaultRuleset = RulesetSchema.parse({
    id: "beta", version: "0.3.0", schemaVersion: 1,
    deckbuilding: { mainDeck: { min: 40, max: 50 }, legendCount: 3, maxCopies: 3 }
});
export type RulesetSnapshot = Ruleset;
export type DeckFormat = z.infer<typeof DeckFormatSchema>;
