import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV93Context, batchV93Input, v93Source } from "./api-admission-batch-v93-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V94 (plan section 6, bundle 14): Alt Cunningham: Soulkiller Architect, "1 €$, {Spend} Play a Program from your trash.
// Bottom-deck it after you play it. (You still pay its cost.)" Source records are evidence only; mechanics are authored here and the
// card's complete shape is pinned literally in the Legend pin table.
export const SOULKILLER = "alt-cunningham-soulkiller-architect";
export const V94_SLUGS = [SOULKILLER] as const;
export const v94Source = v93Source; // Same raw snapshot commit as V7 to V93.
const MECHANICS = {
    [SOULKILLER]: { keywords: [], modifiers: [], abilities: [
        { id: `${SOULKILLER}-spend-play-trash-program@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION",
            costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "PLAY_TRASH_PROGRAM_THEN_BOTTOM_DECK" }] }] }
};

export const batchV94Cards = V94_SLUGS.map(slug => {
    const r = v94Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V94 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V93 chain plus the V94 revision. No new policy: the reviewed Legend pin policy applies. */
export function batchV94Context() {
    const base = batchV93Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV94Cards], base.manifest.engine) };
}
export function batchV94Input(seed: string) { return batchV93Input(seed); }
