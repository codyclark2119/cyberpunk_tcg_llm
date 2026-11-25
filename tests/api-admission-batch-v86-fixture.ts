import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV85Context, batchV85Input, v85Source } from "./api-admission-batch-v85-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V86 (plan section 6, scope 3c): T-Bug: Amateur Philosopher, "{Defeated} Look at all friendly face-down Legends. Then, you may
// Call a Legend for free. (You can only Call a Legend once per turn.)" Source records are evidence only; mechanics are authored here and
// the card's complete shape is pinned literally in the free-Call pin table.
export const TBUG = "t-bug-amateur-philosopher";
export const V86_SLUGS = [TBUG] as const;
export const v86Source = v85Source; // Same raw snapshot commit as V7 to V85.
const MECHANICS = {
    [TBUG]: { keywords: [], modifiers: [], abilities: [
        { id: `${TBUG}-defeated-look-free-call@1`, trigger: "WHEN_DEFEATED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "MAY_CALL_LEGEND_FREE", lookAtAll: true }] }] }
};

export const batchV86Cards = V86_SLUGS.map(slug => {
    const r = v86Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V86 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V85 chain plus the V86 revision. No new policy: the reviewed trigger and private-information policies apply. */
export function batchV86Context() {
    const base = batchV85Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV86Cards], base.manifest.engine) };
}
export function batchV86Input(seed: string) { return batchV85Input(seed); }
