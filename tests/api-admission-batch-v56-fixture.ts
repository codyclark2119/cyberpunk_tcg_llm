import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV55Context, batchV55Input, v55Source } from "./api-admission-batch-v55-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V56 (plan section 6, scope 3c): "(Equip to a friendly Unit or face-up Legend.) {Blocker} Rivals must pay +2 €$ to use
// {Go Solo}." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally
// in the capability Gear pin table.
export const RIOT = "riot-shield";
export const V56_SLUGS = [RIOT] as const;
export const v56Source = v55Source; // Same raw snapshot commit as V7 to V55.
const MECHANICS = {
    [RIOT]: { keywords: [], abilities: [], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" },
        modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "GRANT_KEYWORD_TO_HOST", keyword: "BLOCKER" }, { kind: "RIVAL_GO_SOLO_COST_INCREASE", amount: 2 }] }
};

export const batchV56Cards = V56_SLUGS.map(slug => {
    const r = v56Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V56 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V55 chain plus the V56 revision. No new policy: the reviewed Gear, capability and field-Legend policies apply. */
export function batchV56Context() {
    const base = batchV55Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV56Cards], base.manifest.engine) };
}
export function batchV56Input(seed: string) { return batchV55Input(seed); }
