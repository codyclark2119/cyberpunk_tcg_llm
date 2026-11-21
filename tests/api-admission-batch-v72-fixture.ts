import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV71Context, batchV71Input, v71Source } from "./api-admission-batch-v71-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V72 (plan section 6, scope 3c): Rita Wheeler: No Stupid Questions, a Blocker Unit with "The first time this Unit is spent each
// turn, draw 1, then discard 1." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in the spend-trigger pin table.
export const RITA = "rita-wheeler-no-stupid-questions";
export const V72_SLUGS = [RITA] as const;
export const v72Source = v71Source; // Same raw snapshot commit as V7 to V71.
const MECHANICS = {
    [RITA]: { keywords: ["BLOCKER"], modifiers: [], abilities: [
        { id: `${RITA}-first-spend-draw-discard@1`, trigger: "WHEN_SPENT", guard: "FIRST_SPEND_PER_TURN", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", drawFirst: 1 }] }] }
};

export const batchV72Cards = V72_SLUGS.map(slug => {
    const r = v72Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V72 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V71 chain plus the V72 revision. No new policy: the reviewed Blocker and trigger policies apply. */
export function batchV72Context() {
    const base = batchV71Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV72Cards], base.manifest.engine) };
}
export function batchV72Input(seed: string) { return batchV71Input(seed); }
