import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV88Context, batchV88Input, v88Source } from "./api-admission-batch-v88-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V89 (plan section 6, bundle 13): Deadman Transmitter, "(Equip to a friendly Unit or face-up Legend.) If this Unit would be
// defeated, defeat its "DEADMAN TRANSMITTER" instead." Source records are evidence only; mechanics are authored here and the card's
// complete shape is pinned literally in the defeat-replacement Gear table.
export const DEADMAN = "deadman-transmitter";
export const V89_SLUGS = [DEADMAN] as const;
export const v89Source = v88Source; // Same raw snapshot commit as V7 to V88.
const MECHANICS = {
    [DEADMAN]: { keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "DEFEAT_THIS_GEAR_INSTEAD_OF_HOST" }], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, abilities: [] }
};

export const batchV89Cards = V89_SLUGS.map(slug => {
    const r = v89Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V89 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V88 chain plus the V89 revision. No new policy: the reviewed Gear, combat and defeat policies apply. */
export function batchV89Context() {
    const base = batchV88Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV89Cards], base.manifest.engine) };
}
export function batchV89Input(seed: string) { return batchV88Input(seed); }
