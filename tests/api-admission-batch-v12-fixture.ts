import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV11Context, batchV11Input, v11Source } from "./api-admission-batch-v11-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V12 (plan section 6, scope 3c): two Programs that widen Unit defeat: an optional second target while a
// Rival leads in Gigs, and each player defeating one of their own Units. Source records are evidence only;
// mechanics are authored here and each card's complete shape is pinned literally in its engine gate.
export const BONNIE = "bonnie-and-clyde", AFTERMATH = "live-with-the-aftermath";
export const V12_SLUGS = [BONNIE, AFTERMATH] as const;
export const v12Source = v11Source; // Same raw snapshot commit as V7 to V11.
const play = (slug: string, target: object) => ({ keywords: [], modifiers: [],
    abilities: [{ id: `${slug}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DEFEAT_UNIT", target }] }] });
const MECHANICS = {
    [BONNIE]: play(BONNIE, { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 4 }, second: { condition: { kind: "RIVAL_GIG_COUNT_LEAD_AT_LEAST", minimum: 2 } } }),
    [AFTERMATH]: play(AFTERMATH, { kind: "UNITS", relation: "CONTROLLED", power: { kind: "ANY" }, each: "PLAYER_CHOOSES_OWN" })
};

export const batchV12Cards = V12_SLUGS.map(slug => {
    const r = v12Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "TARGETED_DEFEAT_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V12 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-18", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V11 chain plus the V12 revisions. No new policy: both extend TARGETED_DEFEAT_V1. */
export function batchV12Context() {
    const base = batchV11Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV12Cards], base.manifest.engine) };
}
export function batchV12Input(seed: string) { return batchV11Input(seed); }
