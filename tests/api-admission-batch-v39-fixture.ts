import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV38Context, batchV38Input, v38Source } from "./api-admission-batch-v38-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V39 (plan section 6, scope 3c): a Gear whose host has [Adrenaline] while a Rival controls at least 2 more Gigs than the
// host's controller.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// conditional host keyword pin table.
export const CONVERTER = "adrenaline-converter";
export const V39_SLUGS = [CONVERTER] as const;
export const v39Source = v38Source; // Same raw snapshot commit as V7 to V38.
const MECHANICS = {
    [CONVERTER]: { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, keywords: [], abilities: [],
        modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "GRANT_KEYWORD_TO_HOST_IF", keyword: "ADRENALINE", condition: { kind: "RIVAL_CONTROLS_MORE_GIGS", minimum: 2 } }] }
};

export const batchV39Cards = V39_SLUGS.map(slug => {
    const r = v39Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "GEAR_CAPABILITIES_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V39 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V38 chain plus the V39 revision. No new policy: the reviewed Gear capability and Adrenaline policies apply. */
export function batchV39Context() {
    const base = batchV38Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV39Cards], base.manifest.engine) };
}
export function batchV39Input(seed: string) { return batchV38Input(seed); }
