import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV66Context, batchV66Input, v66Source } from "./api-admission-batch-v66-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V67 (plan section 6, scope 3c): Gorilla Arms, a Gear whose host inherits "The first time this Unit steals 1 or more Gigs
// each turn, steal a rival Gig with a value not shared by a friendly Gig." Source records are evidence only; mechanics are authored
// here and the card's complete shape is pinned literally in the Gear-steal pin table.
export const GORILLA = "gorilla-arms";
export const V67_SLUGS = [GORILLA] as const;
export const v67Source = v66Source; // Same raw snapshot commit as V7 to V66.
const MECHANICS = {
    [GORILLA]: { keywords: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }], equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, abilities: [
        { id: `${GORILLA}-first-steal-steal@1`, trigger: "WHEN_GIG_STOLEN", inherited: "EQUIPPED_HOST", guard: "FIRST_HOST_STEAL_PER_TURN", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "STEAL_GIG", actor: "TRIGGER_SUBJECT", count: 1, valueNotSharedByFriendly: true }] }] }
};

export const batchV67Cards = V67_SLUGS.map(slug => {
    const r = v67Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V67 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V66 chain plus the V67 revision. No new policy: the reviewed Gear, steal and trigger policies apply. */
export function batchV67Context() {
    const base = batchV66Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV67Cards], base.manifest.engine) };
}
export function batchV67Input(seed: string) { return batchV66Input(seed); }
