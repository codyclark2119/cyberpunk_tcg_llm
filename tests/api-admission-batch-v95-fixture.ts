import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV94Context, batchV94Input, v94Source } from "./api-admission-batch-v94-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V95 (plan section 6, bundle 14): Judy Álvarez: Nothing to Doubt, "1 €$, {Spend} Reveal the top card of your deck. You may
// play it for free. Otherwise, add it to your hand." Source records are evidence only (its one erratum corrects the artist credit, not
// the rules); mechanics are authored here and the card's complete shape is pinned literally in the Quick-activation pin table.
export const JUDY = "judy-a-lvarez-nothing-to-doubt";
export const V95_SLUGS = [JUDY] as const;
export const v95Source = v94Source; // Same raw snapshot commit as V7 to V94.
const MECHANICS = {
    [JUDY]: { keywords: [], modifiers: [], abilities: [
        { id: `${JUDY}-spend-reveal-top-play-free@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION",
            costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "REVEAL_TOP_MAY_PLAY_FREE_ELSE_HAND" }] }] }
};

export const batchV95Cards = V95_SLUGS.map(slug => {
    const r = v95Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V95 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V94 chain plus the V95 revision. No new policy: the reviewed play, react, trigger and combat policies apply. */
export function batchV95Context() {
    const base = batchV94Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV95Cards], base.manifest.engine) };
}
export function batchV95Input(seed: string) { return batchV94Input(seed); }
