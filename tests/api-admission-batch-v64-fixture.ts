import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV63Context, batchV63Input, v63Source } from "./api-admission-batch-v63-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V64 (plan section 6, scope 3c): Nadia: Fighting Through Grief, "If a Rival controls more Gigs than you, this Unit can attack
// their Gig area the turn it's played." Source records are evidence only; mechanics are authored here and the card's complete
// shape is pinned literally in the attack-permission pin table.
export const NADIA = "nadia-fighting-through-grief";
export const V64_SLUGS = [NADIA] as const;
export const v64Source = v63Source; // Same raw snapshot commit as V7 to V63.
const MECHANICS = {
    [NADIA]: { keywords: [], abilities: [], modifiers: [{ kind: "CAN_ATTACK_GIG_AREA_WHILE_LAGGING_IF", condition: { kind: "RIVAL_CONTROLS_MORE_GIGS", minimum: 1 } }] }
};

export const batchV64Cards = V64_SLUGS.map(slug => {
    const r = v64Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V64 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V63 chain plus the V64 revision. No new policy: the reviewed play and combat policies apply. */
export function batchV64Context() {
    const base = batchV63Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV64Cards], base.manifest.engine) };
}
export function batchV64Input(seed: string) { return batchV63Input(seed); }
