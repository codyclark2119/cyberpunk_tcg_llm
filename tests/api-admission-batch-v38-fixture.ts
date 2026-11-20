import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV37Context, batchV37Input, v37Source } from "./api-admission-batch-v37-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V38 (plan section 6, scope 3c): a Unit that gives other friendly attacking Units +2 power and readies up to 3 friendly
// Units at the end of its controller's turn.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// attacking-ready pin table.
export const SAUL = "saul-bright-stormrider";
export const V38_SLUGS = [SAUL] as const;
export const v38Source = v37Source; // Same raw snapshot commit as V7 to V37.
const MECHANICS = {
    [SAUL]: { keywords: [], modifiers: [{ kind: "OTHER_FRIENDLY_ATTACKING_UNIT_POWER", amount: 2 }],
        abilities: [
            { id: `${SAUL}-end-turn-ready-up-to-3-friendly-units@1`, trigger: "WHEN_OWN_TURN_ENDS", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "READY_UNITS_UP_TO", relation: "FRIENDLY", maximum: 3 }] }] }
};

export const batchV38Cards = V38_SLUGS.map(slug => {
    const r = v38Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V38 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V37 chain plus the V38 revision. No new policy: the reviewed trigger, combat and card-play policies apply. */
export function batchV38Context() {
    const base = batchV37Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV38Cards], base.manifest.engine) };
}
export function batchV38Input(seed: string) { return batchV37Input(seed); }
