import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV42Context, batchV42Input, v42Source } from "./api-admission-batch-v42-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V43 (plan section 6, scope 3c): a Blocker Unit whose {Play} obliges a chosen rival Unit to attack next turn if it can.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// must-attack pin table.
export const INCITERS = "mox-inciters";
export const V43_SLUGS = [INCITERS] as const;
export const v43Source = v42Source; // Same raw snapshot commit as V7 to V42.
const MECHANICS = {
    [INCITERS]: { keywords: ["BLOCKER"], modifiers: [],
        abilities: [{ id: `${INCITERS}-play-must-attack@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "FORCE_RIVAL_UNIT_ATTACK", duration: "NEXT_TURN" }] }] }
};

export const batchV43Cards = V43_SLUGS.map(slug => {
    const r = v43Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V43 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V42 chain plus the V43 revision. No new policy: the reviewed trigger, combat and React policies apply. */
export function batchV43Context() {
    const base = batchV42Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV43Cards], base.manifest.engine) };
}
export function batchV43Input(seed: string) { return batchV42Input(seed); }
