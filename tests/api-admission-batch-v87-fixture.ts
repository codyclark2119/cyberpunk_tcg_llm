import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV86Context, batchV86Input, v86Source } from "./api-admission-batch-v86-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V87 (plan section 6, scope 3c): Arasaka Emergency Radioport, "(Equip to a friendly Unit or face-up Legend.) When this Unit or
// Legend is spent, you may look at a friendly face-down Legend. If that Legend is ARASAKA or has {Go Solo}, you may Call it for free.
// (You may only Call a Legend once per turn.)" Source records are evidence only; mechanics are authored here and the card's complete
// shape is pinned literally in the "when spent" pin table.
export const RADIOPORT = "arasaka-emergency-radioport";
export const V87_SLUGS = [RADIOPORT] as const;
export const v87Source = v86Source; // Same raw snapshot commit as V7 to V86.
const MECHANICS = {
    [RADIOPORT]: { keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, abilities: [
        { id: `${RADIOPORT}-spent-look-free-call@1`, trigger: "WHEN_SPENT", inherited: "EQUIPPED_HOST", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "MAY_CALL_LEGEND_FREE", lookAtOne: { tag: "Arasaka", keyword: "GO_SOLO" } }] }] }
};

export const batchV87Cards = V87_SLUGS.map(slug => {
    const r = v87Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V87 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V86 chain plus the V87 revision. No new policy: the reviewed Gear, trigger and private-information policies apply. */
export function batchV87Context() {
    const base = batchV86Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV87Cards], base.manifest.engine) };
}
export function batchV87Input(seed: string) { return batchV86Input(seed); }
