import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV76Context, batchV76Input, v76Source } from "./api-admission-batch-v76-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V77 (plan section 6, scope 3c): Fool on the Hill, "Reveal the top 2 cards of your deck. A Rival chooses whether you add them
// to your hand or trash them. If you trash them, draw 2." Source records are evidence only; mechanics are authored here and the card's
// complete shape is pinned literally in the Rival-choice reveal Program pin table.
export const FOOL = "fool-on-the-hill";
export const V77_SLUGS = [FOOL] as const;
export const v77Source = v76Source; // Same raw snapshot commit as V7 to V76.
const MECHANICS = {
    [FOOL]: { keywords: [], modifiers: [],
        abilities: [{ id: `${FOOL}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH", count: 2, drawIfTrashed: 2 }] }] }
};

export const batchV77Cards = V77_SLUGS.map(slug => {
    const r = v77Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V77 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V76 chain plus the V77 revision. No new policy: the reviewed noncombat play policy applies. */
export function batchV77Context() {
    const base = batchV76Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV77Cards], base.manifest.engine) };
}
export function batchV77Input(seed: string) { return batchV76Input(seed); }
