import { CombatRestrictionSchema, EquipTargetSchema, CostSchema, KeywordSchema, AbilitySchema, ContinuousModifierSchema } from "./mechanics";
import { z } from "zod";
import { CardIdSchema, CardRevisionSchema, CardPrintingIdSchema } from "./identity";
export const CARD_COLORS = ["RED", "BLUE", "GREEN", "YELLOW", "NEUTRAL"] as const;
export const CARD_TYPES = ["LEGEND", "UNIT", "GEAR", "PROGRAM"] as const;
export const CardColorSchema = z.enum(CARD_COLORS);
export const CardTypeSchema = z.enum(CARD_TYPES);
export type CardColor = z.infer<typeof CardColorSchema>;
export type CardType = z.infer<typeof CardTypeSchema>;
const LegacyCardSchema = z.strictObject({
    id: CardIdSchema, schemaVersion: z.literal(1), revision: CardRevisionSchema,
    status: z.enum(["ACTIVE", "PREVIEW", "RETIRED"]),
    cardNumber: z.string().min(1), name: z.string().trim().min(1), type: CardTypeSchema,
    colors: z.array(CardColorSchema).min(1), rarity: z.string().optional(),
    setCode: z.string().min(1), setName: z.string().min(1),
    cost: z.number().int().nonnegative().optional(), power: z.number().int().optional(),
    ram: z.partialRecord(CardColorSchema, z.number().int().nonnegative()).optional(),
    rulesText: z.string(), flavorText: z.string().optional(), tags: z.array(z.string()),
    keywords: z.array(z.string()), imageUrl: z.url().optional()
});
// Schema 1 remains byte-preserving for already-published immutable revisions.
// New executable revisions use schema 2. Legacy cost is display-only, never executable.
export const SellProfileSchema = z.strictObject({ allowed: z.boolean(), baseEddieValue: z.number().int().nonnegative() });
export type SellProfile = z.infer<typeof SellProfileSchema>;
export const CardRevisionSnapshotSchema = LegacyCardSchema.extend({
    schemaVersion: z.literal(2),
    deckbuildingIdentity: z.string().min(1), subtitle: z.string(), displayName: z.string().min(1),
    printedCost: CostSchema,
    sellProfile: SellProfileSchema,
    sourceMarkup: z.string(),
    execution: z.strictObject({ scope: z.enum(["NONCOMBAT_SLICE_V1", "NONCOMBAT_PLAY_V1", "COMBAT_ATTACK_V1", "COMBAT_REACT_V1", "COMBAT_RESTRICTIONS_V1", "COMBAT_TRIGGERS_V1", "GEAR_CAPABILITIES_V1", "GEAR_PRIVATE_LOOK_V1", "ATTACK_ORDERED_EFFECTS_V1", "END_TURN_HISTORY_V1", "GEAR_DELAYED_ATTACK_V1", "FIELD_LEGENDS_V1", "FIRST_ATTACK_HISTORY_V1", "ATTACKING_AURA_V1", "ATTACK_PREVENTION_V1", "VALUE_CONDITIONS_V1", "MIN_GIG_PROGRAM_V1", "ATTACK_CONDITION_POWER_V1", "TARGETED_SPEND_V1", "TARGETED_DEFEAT_V1", "TARGETED_GEAR_DEFEAT_V1"]), status: z.enum(["SUPPORTED", "UNSUPPORTED"]) }).optional(),
    mechanics: z.strictObject({ restrictions: z.array(CombatRestrictionSchema).optional(), equip: EquipTargetSchema.optional(), keywords: z.array(KeywordSchema), abilities: z.array(AbilitySchema), modifiers: z.array(ContinuousModifierSchema) }),
    printings: z.array(z.strictObject({ id: CardPrintingIdSchema, setCode: z.string().min(1), collectorNumber: z.string().min(1), source: z.string().min(1) })),
    provenance: z.strictObject({ source: z.string().min(1), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), effectiveAt: z.string().min(1), errata: z.array(z.string()), reviewed: z.boolean() })
}).superRefine((card, context) => {
    if (new Set(card.printings.map(p => p.id)).size !== card.printings.length)
        context.addIssue({ code: "custom", message: "Printing IDs must be unique within a snapshot" });
    if (card.cost !== undefined && (card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== card.cost))
        context.addIssue({ code: "custom", message: "Legacy display cost must agree with executable printed cost" });
});
export const CardSchema = z.discriminatedUnion("schemaVersion", [LegacyCardSchema, CardRevisionSnapshotSchema]);
export type CardRevisionSnapshot = z.infer<typeof CardRevisionSnapshotSchema>;
export type Card = z.infer<typeof CardSchema>;
export const CardFilterSchema = z.strictObject({
    search: z.string().max(200).nullish(), type: CardTypeSchema.nullish(),
    color: CardColorSchema.nullish(), setCode: z.string().max(100).nullish()
});
export type CardFilter = z.infer<typeof CardFilterSchema>;
export const CardReferenceSchema = z.strictObject({ cardId: CardIdSchema, revision: CardRevisionSchema });
export type CardReference = z.infer<typeof CardReferenceSchema>;
