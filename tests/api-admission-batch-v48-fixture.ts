import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV47Context, batchV47Input, v47Source } from "./api-admission-batch-v47-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V48 (plan section 6, scope 3c): a Gear whose host inherits "{Defeated} Play another Unit with cost 9 or less from your
// trash for free. Then, bottom-deck this Unit." Source records are evidence only; mechanics are authored here and the card's
// complete shape is pinned literally in the free-play pin table.
export const RELIC = "the-relic-experimental-biochip";
export const V48_SLUGS = [RELIC] as const;
export const v48Source = v47Source; // Same raw snapshot commit as V7 to V47.
const MECHANICS = {
    [RELIC]: { keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" },
        abilities: [{ id: `${RELIC}-defeated-free-play@1`, trigger: "WHEN_DEFEATED", inherited: "EQUIPPED_HOST", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "PLAY_UNIT_FREE", from: "TRASH", maxCost: 9, exclude: "SUBJECT", then: "BOTTOM_DECK_SUBJECT" }] }] }
};

export const batchV48Cards = V48_SLUGS.map(slug => {
    const r = v48Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V48 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V47 chain plus the V48 revision. No new policy: the reviewed play, Gear, trigger and combat policies apply. */
export function batchV48Context() {
    const base = batchV47Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV48Cards], base.manifest.engine) };
}
export function batchV48Input(seed: string) { return batchV47Input(seed); }
