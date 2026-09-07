import { z } from "zod";
import { CardIdSchema, CardRevisionSchema } from "./identity";
export const CARD_COLORS = ["RED", "BLUE", "GREEN", "YELLOW", "NEUTRAL"] as const;
export const CARD_TYPES = ["LEGEND", "UNIT", "GEAR", "PROGRAM"] as const;
export const CardColorSchema = z.enum(CARD_COLORS);
export const CardTypeSchema = z.enum(CARD_TYPES);
export type CardColor = z.infer<typeof CardColorSchema>;
export type CardType = z.infer<typeof CardTypeSchema>;
export const CardSchema = z.strictObject({
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
export type Card = z.infer<typeof CardSchema>;
export const CardFilterSchema = z.strictObject({
  search: z.string().max(200).nullish(), type: CardTypeSchema.nullish(),
  color: CardColorSchema.nullish(), setCode: z.string().max(100).nullish()
});
export type CardFilter = z.infer<typeof CardFilterSchema>;
export const CardReferenceSchema = z.strictObject({ cardId: CardIdSchema, revision: CardRevisionSchema });
export type CardReference = z.infer<typeof CardReferenceSchema>;
