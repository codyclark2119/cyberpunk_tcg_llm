import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV72Context, batchV72Input, v72Source } from "./api-admission-batch-v72-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V73 (plan section 6, scope 3c): V: Streetkid, a Go Solo Legend with "{Call} Trash 3. Then, add 1 BRAINDANCE Program from your
// trash to your hand." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally
// in the Call trash-then-add pin table.
export const STREETKID = "v-streetkid";
export const V73_SLUGS = [STREETKID] as const;
export const v73Source = v72Source; // Same raw snapshot commit as V7 to V72.
const MECHANICS = {
    [STREETKID]: { keywords: ["GO_SOLO"], modifiers: [], abilities: [
        { id: `${STREETKID}-call-trash-add-braindance@1`, trigger: "WHEN_CALLED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "TRASH_THEN_ADD_TRASH_PROGRAM", count: 3, tag: "Braindance" }] }] }
};

export const batchV73Cards = V73_SLUGS.map(slug => {
    const r = v73Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V73 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V72 chain plus the V73 revision. No new policy: the reviewed Call and field-Legend policies apply. */
export function batchV73Context() {
    const base = batchV72Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV73Cards], base.manifest.engine) };
}
export function batchV73Input(seed: string) { return batchV72Input(seed); }
