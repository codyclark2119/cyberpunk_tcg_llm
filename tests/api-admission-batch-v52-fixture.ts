import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV51Context, batchV51Input, v51Source } from "./api-admission-batch-v51-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V52 (plan section 6, scope 3c): "The first time this Unit wins a fight each turn, ready it. This Unit wins all fights
// against CORPO Units." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned
// literally in the fight-win pin table.
export const JOHNNY = "johnny-silverhand-never-stop-fighting";
export const V52_SLUGS = [JOHNNY] as const;
export const v52Source = v51Source; // Same raw snapshot commit as V7 to V51.
const MECHANICS = {
    [JOHNNY]: { keywords: [], modifiers: [{ kind: "WINS_FIGHTS_AGAINST_CLASSIFICATION", classification: "Corpo" }],
        abilities: [{ id: `${JOHNNY}-first-fight-win-ready@1`, trigger: "WHEN_FIGHT_WON", guard: "FIRST_FIGHT_WIN_PER_TURN", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "READY_UNIT", target: { kind: "SOURCE" } }] }] }
};

export const batchV52Cards = V52_SLUGS.map(slug => {
    const r = v52Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V52 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V51 chain plus the V52 revision. No new policy: the reviewed play, trigger and combat policies apply. */
export function batchV52Context() {
    const base = batchV51Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV52Cards], base.manifest.engine) };
}
export function batchV52Input(seed: string) { return batchV51Input(seed); }
