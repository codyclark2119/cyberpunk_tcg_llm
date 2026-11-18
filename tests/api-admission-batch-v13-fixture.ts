import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV12Context, batchV12Input, v12Source } from "./api-admission-batch-v12-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V13 (plan section 6, scope 3c): a DEFEATED trigger that returns another Unit from its controller's
// trash to hand. Source records are evidence only; mechanics are authored here and the card's complete
// shape is pinned literally in its engine gate.
export const SCREW = "screw-lovelorn-fool";
export const V13_SLUGS = [SCREW] as const;
export const v13Source = v12Source; // Same raw snapshot commit as V7 to V12.
const MECHANICS = {
    [SCREW]: { keywords: [], modifiers: [], abilities: [{ id: `${SCREW}-defeated-trash-return@1`, trigger: "WHEN_DEFEATED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "RETURN_TRASH_UNIT_TO_HAND", exclude: "SUBJECT" }] }] }
};

export const batchV13Cards = V13_SLUGS.map(slug => {
    const r = v13Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V13 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-18", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V12 chain plus the V13 revision. No new policy: it extends COMBAT_TRIGGERS_V1. */
export function batchV13Context() {
    const base = batchV12Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV13Cards], base.manifest.engine) };
}
export function batchV13Input(seed: string) { return batchV12Input(seed); }
