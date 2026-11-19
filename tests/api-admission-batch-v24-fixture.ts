import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV23Context, batchV23Input, v23Source } from "./api-admission-batch-v23-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V24 (plan section 6, scope 3c): a Unit whose "When this Unit steals a Gig" trigger makes a Rival discard if it is equipped.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// steal-trigger pin table.
export const GOONS = "maelstrom-goons";
export const V24_SLUGS = [GOONS] as const;
export const v24Source = v23Source; // Same raw snapshot commit as V7 to V23.
const MECHANICS = {
    [GOONS]: { keywords: [], modifiers: [],
        abilities: [{ id: `${GOONS}-steal-rival-discard@1`, trigger: "WHEN_GIG_STOLEN", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", when: { timing: "RESOLUTION", condition: { kind: "SUBJECT_IS_EQUIPPED" } } }] }] }
};

export const batchV24Cards = V24_SLUGS.map(slug => {
    const r = v24Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V24 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V23 chain plus the V24 revision. No new policy: the reviewed trigger and card-play policies apply. */
export function batchV24Context() {
    const base = batchV23Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV24Cards], base.manifest.engine) };
}
export function batchV24Input(seed: string) { return batchV23Input(seed); }
