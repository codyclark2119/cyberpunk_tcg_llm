import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV40Context, batchV40Input, v40Source } from "./api-admission-batch-v40-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V41 (plan section 6, scope 3c): a Go Solo Legend whose {Attack} reveals the top card of its deck into hand and gains power
// equal to that card's cost this turn, and whose {Defeated} makes a Rival discard 1.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Legend reveal pin table.
export const SASHA = "sasha-yakovleva-won-t-let-you-down";
export const V41_SLUGS = [SASHA] as const;
export const v41Source = v40Source; // Same raw snapshot commit as V7 to V40.
const MECHANICS = {
    [SASHA]: { keywords: ["GO_SOLO"], modifiers: [],
        abilities: [
            { id: `${SASHA}-attack-reveal-power@1`, trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST", count: 1 }] },
            { id: `${SASHA}-defeated-rival-discard@1`, trigger: "WHEN_DEFEATED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER" }] }] }
};

export const batchV41Cards = V41_SLUGS.map(slug => {
    const r = v41Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V41 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V40 chain plus the V41 revision. No new policy: the reviewed trigger and field-Legend policies apply. */
export function batchV41Context() {
    const base = batchV40Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV41Cards], base.manifest.engine) };
}
export function batchV41Input(seed: string) { return batchV40Input(seed); }
