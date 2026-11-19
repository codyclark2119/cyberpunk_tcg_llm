import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV21Context, batchV21Input, v21Source } from "./api-admission-batch-v21-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V22 (plan section 6, scope 3c): a {Play} Unit and a Program that stop a rival Unit from readying until their controller's next turn.
// Source records are evidence only; mechanics are authored here and each card's complete shape is pinned literally in the
// {Play} pin table (Pacifica Netrunner) or the targeted-spend pin table (Memory Relapse).
export const PACIFICA = "pacifica-netrunner";
export const RELAPSE = "memory-relapse";
export const V22_SLUGS = [PACIFICA, RELAPSE] as const;
export const v22Source = v21Source; // Same raw snapshot commit as V7 to V21.
const MECHANICS = {
    [PACIFICA]: { keywords: [], modifiers: [],
        abilities: [{ id: `${PACIFICA}-play-ready-lock@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "PREVENT_UNIT_READY", target: { kind: "UNITS", relation: "RIVAL" }, when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_IS_EVEN" } }, duration: "UNTIL_YOUR_NEXT_TURN" }] }] },
    [RELAPSE]: { keywords: [], modifiers: [],
        abilities: [{ id: `${RELAPSE}-spend-ready-lock@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL" }, preventReady: "UNTIL_YOUR_NEXT_TURN" }, { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "STREET_CRED_IS_EVEN" }, count: 1 }] }] }
};
const SCOPE = { [PACIFICA]: "COMBAT_TRIGGERS_V1", [RELAPSE]: "TARGETED_SPEND_V1" } as const;

export const batchV22Cards = V22_SLUGS.map(slug => {
    const r = v22Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: SCOPE[slug], status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V22 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-19", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V21 chain plus the V22 revisions. No new policy: the reviewed trigger, card-play and targeted-spend policies apply. */
export function batchV22Context() {
    const base = batchV21Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV22Cards], base.manifest.engine) };
}
export function batchV22Input(seed: string) { return batchV21Input(seed); }
