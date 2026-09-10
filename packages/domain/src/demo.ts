import { z } from "zod";
import { CardIdSchema, CardRevisionSchema } from "./identity";
import type { Card } from "./card";
import type { Deck } from "./deck";
import { hashCanonical } from "./canonical";
import captured from "./demo-manifests.v1.json";

export const DemoManifestIdSchema = z.enum(["ARASAKA_DEMO_V1", "MERC_DEMO_V1"]);
const EntrySchema = z.strictObject({ cardId: CardIdSchema, revision: CardRevisionSchema, zone: z.enum(["MAIN", "LEGENDS"]), quantity: z.number().int().positive() });
const ManifestSchema = z.strictObject({ schemaVersion: z.literal(1), id: DemoManifestIdSchema, compositionHash: z.string().regex(/^[a-f0-9]{64}$/), entries: z.array(EntrySchema).min(1) });
type Entry = z.infer<typeof EntrySchema>;
export function normalizeDemoEntries(entries: readonly Entry[]): Entry[] {
    const totals = new Map<string, Entry>();
    for (const entry of entries) {
        const key = JSON.stringify([entry.zone, entry.cardId, entry.revision]);
        totals.set(key, { zone: entry.zone, cardId: entry.cardId, revision: entry.revision, quantity: (totals.get(key)?.quantity ?? 0) + entry.quantity });
    }
    const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    return [...totals.values()].sort((a, b) => cmp(a.zone, b.zone) || cmp(a.cardId, b.cardId) || a.revision - b.revision);
}
// Runtime admission references the same immutable compositions as the source artifacts.
// Printing/provenance remain in the review fixture; they are not deck input identities.
export const demoManifests = Object.freeze(captured.map(value => {
    const m = ManifestSchema.parse(value);
    if (hashCanonical({ schemaVersion: m.schemaVersion, id: m.id, entries: normalizeDemoEntries(m.entries) }) !== m.compositionHash)
        throw new Error("Demo manifest composition hash mismatch");
    return Object.freeze({ ...m, entries: Object.freeze(m.entries.map(e => Object.freeze(e))) });
}));
/** Revisions resolve through the unique CardId pins in the supplied card pool/content bundle. */
export function matchDemoManifest(deck: Deck, cardPool: readonly Card[]) {
    const entries: Entry[] = [];
    for (const { cardId, quantity, zone } of [...deck.legends.map(cardId => ({ cardId, quantity: 1, zone: "LEGENDS" as const })), ...deck.cards.map(e => ({ ...e, zone: "MAIN" as const }))]) {
        const card = cardPool.find(c => c.id === cardId);
        if (!card || card.schemaVersion !== 2 || card.execution?.status !== "SUPPORTED" || !card.provenance.reviewed) return undefined;
        entries.push({ cardId, revision: card.revision, quantity, zone });
    }
    const composition = hashCanonical(normalizeDemoEntries(entries));
    return demoManifests.find(m => hashCanonical(normalizeDemoEntries(m.entries)) === composition)?.id;
}
export const DemoStarterPolicySchema = z.strictObject({
    authority: z.literal("APPLICATION_DECISION"),
    deckPolicy: z.literal("FIXED_MANIFEST_PAIR"),
    manifests: z.tuple([z.literal("ARASAKA_DEMO_V1"), z.literal("MERC_DEMO_V1")]),
    seatAssignment: z.literal("EITHER"), setupSequence: z.literal("ENGINE_SETUP_V1"), firstPlayerMethod: z.literal("OPPOSED_D20")
});
export const demoStarterPolicy = Object.freeze(DemoStarterPolicySchema.parse({ authority: "APPLICATION_DECISION", deckPolicy: "FIXED_MANIFEST_PAIR", manifests: ["ARASAKA_DEMO_V1", "MERC_DEMO_V1"], seatAssignment: "EITHER", setupSequence: "ENGINE_SETUP_V1", firstPlayerMethod: "OPPOSED_D20" }));
Object.freeze(demoStarterPolicy.manifests);
export const demoDeckPolicy = Object.freeze({ mainDeck: Object.freeze({ min: 27, max: 27 }), legendCount: 3, maxCopies: 3, legendUniqueness: "DECKBUILDING_IDENTITY" as const });
