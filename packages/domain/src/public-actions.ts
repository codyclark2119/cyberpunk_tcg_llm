import { z } from "zod";
import { GigInstanceIdSchema } from "./identity";
import { HashSchema } from "./game";
import { PendingChoiceSchema } from "./mechanics";

export const PublicCardActionRefV2Schema = z.strictObject({ kind: z.literal("CARD"), publicId: z.string().min(1) });
export const PublicGigActionRefV2Schema = z.strictObject({ kind: z.literal("GIG"), gigId: GigInstanceIdSchema });
export const PublicZoneSlotActionRefV2Schema = z.strictObject({ kind: z.literal("ZONE_SLOT"), seat: z.number().int().nonnegative(), zone: z.enum(["EDDIES", "LEGENDS"]), slot: z.number().int().nonnegative() });
export const PublicGigAreaActionRefV2Schema = z.strictObject({ kind: z.literal("GIG_AREA"), seat: z.number().int().nonnegative() });
export const PublicInspectedCardActionRefV2Schema = z.strictObject({ kind: z.literal("INSPECTED_CARD"), inspectedId: z.string().min(1) });

export const PublicChoiceOptionV2Schema = z.discriminatedUnion("kind", [
    PublicCardActionRefV2Schema,
    PublicGigActionRefV2Schema,
    PublicZoneSlotActionRefV2Schema,
    PublicGigAreaActionRefV2Schema,
    PublicInspectedCardActionRefV2Schema,
    z.strictObject({ kind: z.literal("MODE"), value: z.string().min(1) }),
    z.strictObject({ kind: z.literal("AMOUNT"), value: z.number().int() }),
    z.strictObject({ kind: z.literal("EFFECT"), effectId: z.string().min(1) }),
    z.strictObject({ kind: z.literal("CONFIRM"), value: z.boolean() })
]);

const base = { schemaVersion: z.literal(2), label: z.string() };
export const PublicActionDescriptorV2Schema = z.discriminatedUnion("kind", [
    z.strictObject({ ...base, kind: z.literal("SELL_CARD"), source: PublicCardActionRefV2Schema }),
    z.strictObject({ ...base, kind: z.literal("PLAY_CARD"), source: PublicCardActionRefV2Schema }),
    z.strictObject({ ...base, kind: z.literal("GO_SOLO"), source: PublicCardActionRefV2Schema }),
    z.strictObject({ ...base, kind: z.literal("DECLARE_ATTACK"), source: PublicCardActionRefV2Schema }),
    z.strictObject({ ...base, kind: z.literal("DECLARE_BLOCKER"), source: PublicCardActionRefV2Schema }),
    z.strictObject({ ...base, kind: z.literal("ACTIVATE_ABILITY"), source: PublicCardActionRefV2Schema, abilityId: z.string().min(1) }),
    z.strictObject({ ...base, kind: z.literal("ROLL_GIG"), source: PublicGigActionRefV2Schema }),
    z.strictObject({ ...base, kind: z.literal("CALL_LEGEND"), source: PublicZoneSlotActionRefV2Schema.extend({ zone: z.literal("LEGENDS") }) }),
    z.strictObject({ ...base, kind: z.literal("CHOOSE"), choiceKind: PendingChoiceSchema.shape.kind, option: PublicChoiceOptionV2Schema }),
    z.strictObject({ ...base, kind: z.literal("PASS_REACT") }),
    z.strictObject({ ...base, kind: z.literal("END_TURN") })
]);

export const ModelLegalActionV2Schema = z.strictObject({ actionId: HashSchema, descriptor: PublicActionDescriptorV2Schema });
export type PublicChoiceOptionV2 = z.infer<typeof PublicChoiceOptionV2Schema>;
export type PublicActionDescriptorV2 = z.infer<typeof PublicActionDescriptorV2Schema>;
export type ModelLegalActionV2 = z.infer<typeof ModelLegalActionV2Schema>;
