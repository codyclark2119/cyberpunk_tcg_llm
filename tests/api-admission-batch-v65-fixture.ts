import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV64Context, batchV64Input, v64Source } from "./api-admission-batch-v64-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V65 (plan section 6, scope 3c): Valentino Guerrera, "If you have more ☆ (Street Cred) than a Rival, this Unit can attack ready
// Units with {Blocker}." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in the attack-permission pin table.
export const GUERRERA = "valentino-guerrera";
export const V65_SLUGS = [GUERRERA] as const;
export const v65Source = v64Source; // Same raw snapshot commit as V7 to V64.
const MECHANICS = {
    [GUERRERA]: { keywords: [], abilities: [], modifiers: [{ kind: "CAN_ATTACK_READY_BLOCKERS_IF", condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" } }] }
};

export const batchV65Cards = V65_SLUGS.map(slug => {
    const r = v65Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V65 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V64 chain plus the V65 revision. No new policy: the reviewed play and combat policies apply. */
export function batchV65Context() {
    const base = batchV64Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV65Cards], base.manifest.engine) };
}
export function batchV65Input(seed: string) { return batchV64Input(seed); }
