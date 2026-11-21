import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV46Context, batchV46Input, v46Source } from "./api-admission-batch-v46-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V47 (plan section 6, scope 3c): a Program, "The next time a friendly Unit wins a fight by 3+ power this turn, it also
// steals a Gig." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in the next-fight steal pin table.
export const APPETITE = "appetite-for-destruction";
export const V47_SLUGS = [APPETITE] as const;
export const v47Source = v46Source; // Same raw snapshot commit as V7 to V46.
const MECHANICS = {
    [APPETITE]: { keywords: [], modifiers: [],
        abilities: [{ id: `${APPETITE}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "REGISTER_NEXT_FIGHT_OUTCOME", on: "FRIENDLY_UNIT_WINS_BY_3", effect: { kind: "STEAL_GIG", actor: "TRIGGER_SUBJECT", count: 1 } }] }] }
};

export const batchV47Cards = V47_SLUGS.map(slug => {
    const r = v47Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V47 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V44 chain plus the V47 revision. No new policy: the reviewed play, trigger and combat policies apply. */
export function batchV47Context() {
    const base = batchV46Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV47Cards], base.manifest.engine) };
}
export function batchV47Input(seed: string) { return batchV46Input(seed); }
