import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV92Context, batchV92Input, v92Source } from "./api-admission-batch-v92-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V93 (plan section 6, bundle 14): The Heist, "Trash 4. Add a Gear from among them to your hand. If that Gear's cost equals the
// value of a friendly Gig, you may play it for free instead." Source records are evidence only; mechanics are authored here and the
// card's complete shape is pinned literally in the trash-and-add-Gear table.
export const HEIST = "the-heist";
export const V93_SLUGS = [HEIST] as const;
export const v93Source = v92Source; // Same raw snapshot commit as V7 to V92.
const MECHANICS = {
    [HEIST]: { keywords: [], modifiers: [], abilities: [
        { id: `${HEIST}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "TRASH_THEN_ADD_GEAR_MAY_PLAY_IF_GIG_COST", count: 4 }] }] }
};

export const batchV93Cards = V93_SLUGS.map(slug => {
    const r = v93Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V93 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V92 chain plus the V93 revision. No new policy: the reviewed card-play, Gear and trigger policies apply. */
export function batchV93Context() {
    const base = batchV92Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV93Cards], base.manifest.engine) };
}
export function batchV93Input(seed: string) { return batchV92Input(seed); }
