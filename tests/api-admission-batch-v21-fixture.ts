import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV20Context, batchV20Input, v20Source } from "./api-admission-batch-v20-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V21 (plan section 6, scope 3c): two {Play} Units whose restriction on rival stealing lasts until their controller's next turn.
// Source records are evidence only; mechanics are authored here and each card's complete shape is pinned
// literally in the {Play} pin table.
export const FANG = "chrome-fang";
export const WESTBROOK = "westbrook-netrunner";
export const V21_SLUGS = [FANG, WESTBROOK] as const;
export const v21Source = v20Source; // Same raw snapshot commit as V7 to V20.
const MECHANICS = {
    [FANG]: { keywords: [], modifiers: [],
        abilities: [{ id: `${FANG}-play-steal-restriction@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "RESTRICT_RIVAL_GIG_STEAL", actor: "UNIT", forbidden: "VALUE_ABOVE_POWER", duration: "UNTIL_YOUR_NEXT_TURN" }] }] },
    [WESTBROOK]: { keywords: [], modifiers: [],
        abilities: [{ id: `${WESTBROOK}-play-steal-restriction@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "RESTRICT_RIVAL_GIG_STEAL", actor: "LEGEND", forbidden: "VALUE_BELOW_POWER", duration: "UNTIL_YOUR_NEXT_TURN" }] }] }
};

export const batchV21Cards = V21_SLUGS.map(slug => {
    const r = v21Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, power: r.power,
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V21 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V20 chain plus the V21 revisions. No new policy: the reviewed trigger, card-play and combat-resolution policies apply. */
export function batchV21Context() {
    const base = batchV20Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV21Cards], base.manifest.engine) };
}
export function batchV21Input(seed: string) { return batchV20Input(seed); }
