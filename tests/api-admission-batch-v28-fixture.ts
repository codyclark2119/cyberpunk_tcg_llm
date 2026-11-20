import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV27Context, batchV27Input, v27Source } from "./api-admission-batch-v27-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V28 (plan section 6, scope 3c): a Unit whose {Attack} power and {Defeated} draw are counted from friendly Gig values
// (even for the power, odd for the draw) when each effect resolves.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// Gig-parity pin table.
export const JACKIE = "jackie-welles-ride-or-die-choom";
export const V28_SLUGS = [JACKIE] as const;
export const v28Source = v27Source; // Same raw snapshot commit as V7 to V27.
const MECHANICS = {
    [JACKIE]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${JACKIE}-attack-power-per-even-gig@1`, trigger: "WHEN_ATTACKING", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "POWER_PER_FRIENDLY_GIG", target: { kind: "SOURCE_SUBJECT" }, amount: 2, parity: "EVEN" }] },
            { id: `${JACKIE}-defeated-draw-per-odd-gig@1`, trigger: "WHEN_DEFEATED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "DRAW_PER_FRIENDLY_GIG", count: 1, parity: "ODD" }] }] }
};

export const batchV28Cards = V28_SLUGS.map(slug => {
    const r = v28Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V28 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V27 chain plus the V28 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV28Context() {
    const base = batchV27Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV28Cards], base.manifest.engine) };
}
export function batchV28Input(seed: string) { return batchV27Input(seed); }
