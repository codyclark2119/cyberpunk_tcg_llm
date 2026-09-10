import { z } from "zod";
import { CardIdSchema, CardRevisionSchema, HashSchema, DeckSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { attackPowerContext, attackPowerInput } from "./attack-condition-power-fixture";
import captured from "./fixtures/demo-reference-manifests.v1.json";

// Research artifacts only: this schema does not register or admit a playable format.
const ZoneSchema = z.enum(["MAIN", "LEGENDS"]);
const EntrySchema = z.strictObject({
    cardId: CardIdSchema, revision: CardRevisionSchema, zone: ZoneSchema,
    quantity: z.number().int().positive(), revisionHash: HashSchema,
    printing: z.strictObject({ id: z.uuid(), applicationPrintingId: z.string().min(1), setCode: z.string().min(1), collectorNumber: z.string().min(1) }),
    source: z.strictObject({ localPath: z.string().min(1), rawSha256: HashSchema, recordHash: HashSchema })
});
export const DemoReferenceManifestSchema = z.strictObject({
    schemaVersion: z.literal(1), id: z.enum(["ARASAKA_DEMO_V1", "MERC_DEMO_V1"]),
    status: z.literal("REFERENCE_ONLY"), publisherName: z.string().min(1),
    entries: z.array(EntrySchema).min(1), compositionHash: HashSchema,
    provenance: z.strictObject({
        sourceId: z.string(), url: z.url(), sha256: HashSchema, pages: z.literal(4), pdfCreatedAt: z.string(),
        visualAudit: z.string(), orderMeaning: z.string(),
        physicalSlots: z.array(z.strictObject({ cardId: CardIdSchema, collectorNumber: z.string(), zone: ZoneSchema, pdfPage: z.number().int().min(1).max(4), slot: z.number().int().min(1).max(9) })).length(30)
    })
});
export type DemoReferenceManifest = z.infer<typeof DemoReferenceManifestSchema>;
function freeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
export const demoReferences = freeze(captured.manifests.map(m => DemoReferenceManifestSchema.parse(m)));

/** Multiset identity: order and printing provenance are deliberately not gameplay composition. */
export function referenceCompositionHash(manifest: DemoReferenceManifest) {
    const entries = new Map<string, Pick<DemoReferenceManifest["entries"][number], "cardId" | "revision" | "zone" | "quantity">>();
    for (const { cardId, revision, zone, quantity } of manifest.entries) {
        const key = JSON.stringify([zone, cardId, revision]);
        const previous = entries.get(key);
        entries.set(key, { cardId, revision, zone, quantity: quantity + (previous?.quantity ?? 0) });
    }
    const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    return hashCanonical({ schemaVersion: manifest.schemaVersion, id: manifest.id,
        entries: [...entries.values()].sort((a, b) => compare(a.zone, b.zone) || compare(a.cardId, b.cardId) || a.revision - b.revision) });
}

/** Exact 29 existing real revisions, with the unchanged ruleset; not a demo legality policy. */
export function demoReferenceContext() {
    const base = attackPowerContext().content;
    const entries = demoReferences.flatMap(m => m.entries);
    const cards = base.cards.filter(c => entries.some(e => e.cardId === c.id && e.revision === c.revision));
    return { content: createContentBundle(base.ruleset, cards, base.manifest.engine) };
}
export function referenceDeck(manifest: DemoReferenceManifest) {
    return DeckSchema.parse({ name: manifest.id,
        legends: manifest.entries.filter(e => e.zone === "LEGENDS").flatMap(e => Array.from({ length: e.quantity }, () => e.cardId)),
        cards: manifest.entries.filter(e => e.zone === "MAIN").map(e => ({ cardId: e.cardId, quantity: e.quantity })) });
}
export function referenceInput() {
    return { ...attackPowerInput("demo-reference-admission-negative"), decks: demoReferences.map(m => {
        const deck = referenceDeck(m);
        return { legends: deck.legends, main: deck.cards.flatMap(e => Array.from({ length: e.quantity }, () => e.cardId)) };
    }) };
}
