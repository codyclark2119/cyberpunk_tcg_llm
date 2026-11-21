import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV67Context, batchV67Input, v67Source } from "./api-admission-batch-v67-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V68 (plan section 6, scope 3c): Viktor Vektor: You Might Feel a Little Pinch. "{Play} Play a CYBERWARE Gear with cost 2 or
// less from your trash for free. Equip it only to another friendly Unit." Source records are evidence only; mechanics are authored
// here and the card's complete shape is pinned literally in the free-play pin table.
export const PINCH = "viktor-vektor-you-might-feel-a-little-pinch";
export const V68_SLUGS = [PINCH] as const;
export const v68Source = v67Source; // Same raw snapshot commit as V7 to V67.
const MECHANICS = {
    [PINCH]: { keywords: [], modifiers: [], abilities: [
        { id: `${PINCH}-play-free-gear@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "PLAY_GEAR_FREE", from: "TRASH", maxCost: 2, tag: "Cyberware", host: "ANOTHER_FRIENDLY_UNIT" }] }] }
};

export const batchV68Cards = V68_SLUGS.map(slug => {
    const r = v68Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V68 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V67 chain plus the V68 revision. No new policy: the reviewed play, Gear and trigger policies apply. */
export function batchV68Context() {
    const base = batchV67Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV68Cards], base.manifest.engine) };
}
export function batchV68Input(seed: string) { return batchV67Input(seed); }
