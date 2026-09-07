import { z } from "zod";
import { RulesetIdSchema, RulesetVersionSchema } from "./identity";
export const RulesetSchema = z.strictObject({
  id: RulesetIdSchema, version: RulesetVersionSchema, schemaVersion: z.literal(1),
  deckbuilding: z.strictObject({
    mainDeck: z.strictObject({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
      .refine((x) => x.max >= x.min, "Maximum must be at least minimum"),
    legendCount: z.number().int().nonnegative(), maxCopies: z.number().int().positive()
  })
});
export type Ruleset = z.infer<typeof RulesetSchema>;
export const defaultRuleset = RulesetSchema.parse({
  id: "beta", version: "0.3.0", schemaVersion: 1,
  deckbuilding: { mainDeck: { min: 40, max: 50 }, legendCount: 3, maxCopies: 3 }
});
