import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV78Context, batchV78Input, v78Source } from "./api-admission-batch-v78-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V79 (plan section 6, scope 3c): Gunpoint Diplomacy, "Give a friendly Unit these effects. If you have less Street Cred than a
// Rival, they instead choose one effect for you. The next time this Unit attacks this turn, it may attack ready Units. // Give this Unit
// +3 power this turn." Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in
// the friendly-Unit grant Program pin table.
export const GUNPOINT = "gunpoint-diplomacy";
export const V79_SLUGS = [GUNPOINT] as const;
export const v79Source = v78Source; // Same raw snapshot commit as V7 to V78.
const MECHANICS = {
    [GUNPOINT]: { keywords: [], modifiers: [],
        abilities: [{ id: `${GUNPOINT}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "FRIENDLY_UNIT_READY_ATTACK_AND_POWER", power: 3, rivalChoosesOneIf: "STREET_CRED_LESS_THAN_RIVAL" }] }] }
};

export const batchV79Cards = V79_SLUGS.map(slug => {
    const r = v79Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V79 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V78 chain plus the V79 revision. No new policy: the reviewed noncombat play policy applies. */
export function batchV79Context() {
    const base = batchV78Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV79Cards], base.manifest.engine) };
}
export function batchV79Input(seed: string) { return batchV78Input(seed); }
