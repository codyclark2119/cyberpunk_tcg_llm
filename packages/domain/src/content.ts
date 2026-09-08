import { z } from "zod";
import { CardRevisionSnapshotSchema, CardReferenceSchema } from "./card";
import { RulesetSchema } from "./ruleset";
import { HashSchema } from "./game";
import { hashCanonical } from "./canonical";
export const EngineIdentitySchema = z.strictObject({ version: z.string().min(1), artifactHash: HashSchema });
export const ContentBundleManifestSchema = z.strictObject({ schemaVersion: z.literal(1), engine: EngineIdentitySchema,
    ruleset: z.strictObject({ id: z.string().min(1), version: z.string().min(1), hash: HashSchema }),
    cards: z.array(CardReferenceSchema.extend({ hash: HashSchema }))
});
export const ContentBundleSchema = z.strictObject({ schemaVersion: z.literal(1), manifest: ContentBundleManifestSchema, manifestHash: HashSchema, ruleset: RulesetSchema, cards: z.array(CardRevisionSnapshotSchema) }).superRefine((b, ctx) => {
    const printings = b.cards.flatMap(c => c.printings.map(p => p.id));
    if (new Set(printings).size !== printings.length) ctx.addIssue({ code: "custom", message: "Printing identity cannot belong to multiple cards" });
    const pins = b.cards.map(c => ({ cardId: c.id, revision: c.revision, hash: hashCanonical(c) })).sort((a, b) => a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : a.revision - b.revision);
    if (new Set(b.cards.map(c => c.id)).size !== b.cards.length || b.cards.some(c => !c.provenance.reviewed))
        ctx.addIssue({ code: "custom", message: "Bundle requires unique reviewed card revisions" });
    if (hashCanonical(pins) !== hashCanonical(b.manifest.cards) || b.manifest.ruleset.id !== b.ruleset.id || b.manifest.ruleset.version !== b.ruleset.version || b.manifest.ruleset.hash !== hashCanonical(b.ruleset) || b.manifestHash !== hashCanonical(b.manifest))
        ctx.addIssue({ code: "custom", message: "Content manifest mismatch" });
});
export type ContentBundle = z.infer<typeof ContentBundleSchema>;
export type ContentBundleManifest = z.infer<typeof ContentBundleManifestSchema>;
export function createContentBundle(ruleset: z.infer<typeof RulesetSchema>, cards: z.infer<typeof CardRevisionSnapshotSchema>[], engine: z.infer<typeof EngineIdentitySchema>): ContentBundle {
    const manifest = { schemaVersion: 1 as const, engine, ruleset: { id: ruleset.id, version: ruleset.version, hash: hashCanonical(ruleset) }, cards: cards.map(c => ({ cardId: c.id, revision: c.revision, hash: hashCanonical(c) })).sort((a, b) => a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : a.revision - b.revision) };
    return ContentBundleSchema.parse({ schemaVersion: 1, manifest, manifestHash: hashCanonical(manifest), ruleset, cards });
}
