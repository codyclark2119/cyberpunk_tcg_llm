import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV96Context, batchV96Input, v96Source } from "./api-admission-batch-v96-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V97 (plan section 6, bundle 15): Lizzy Wizzy: Delicate Weapon, "{Play} You may play a Program with cost 3 or less from your
// hand or trash for free. Bottom-deck it after you play it. {Blocker}" Source records are evidence only; mechanics are authored here
// and the card's complete shape is pinned literally in the free-play pin table.
export const LIZZY = "lizzy-wizzy-delicate-weapon";
export const V97_SLUGS = [LIZZY] as const;
export const v97Source = v96Source; // Same raw snapshot commit as V7 to V96.
const MECHANICS = {
    [LIZZY]: { keywords: ["BLOCKER"], modifiers: [], abilities: [
        { id: `${LIZZY}-play-free-program@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "MAY_PLAY_PROGRAM_FREE_FROM_HAND_OR_TRASH_THEN_BOTTOM_DECK", maxCost: 3 }] }] }
};

export const batchV97Cards = V97_SLUGS.map(slug => {
    const r = v97Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V97 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-26", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V96 chain plus the V97 revision. No new policy: the reviewed play, trigger and combat policies apply. */
export function batchV97Context() {
    const base = batchV96Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV97Cards], base.manifest.engine) };
}
export function batchV97Input(seed: string) { return batchV96Input(seed); }
