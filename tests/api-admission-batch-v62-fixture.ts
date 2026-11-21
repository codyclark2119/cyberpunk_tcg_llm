import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV61Context, batchV61Input, v61Source } from "./api-admission-batch-v61-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V62 (plan section 6, scope 3c): Padre: Man of the Cross, "{Call} Choose one effect. Spend a rival Unit. // Draw 1." and
// "{Spend} Set a player's Gig to the same value as another player's Gig." Source records are evidence only; mechanics are authored
// here and the card's complete shape is pinned literally in the Legend {Spend} pin table.
export const PADRE = "padre-man-of-the-cross";
export const V62_SLUGS = [PADRE] as const;
export const v62Source = v61Source; // Same raw snapshot commit as V7 to V61.
const MECHANICS = {
    [PADRE]: { keywords: [], modifiers: [], abilities: [
        { id: `${PADRE}-call-choose-one@1`, trigger: "WHEN_CALLED", choose: { count: 1 }, cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL" } }, { kind: "DRAW", count: 1 }] },
        { id: `${PADRE}-spend-set-gig@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }, cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE" }] }] }
};

export const batchV62Cards = V62_SLUGS.map(slug => {
    const r = v62Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V62 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V61 chain plus the V62 revision. No new policy: the reviewed play, Call, spend and value policies apply. */
export function batchV62Context() {
    const base = batchV61Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV62Cards], base.manifest.engine) };
}
export function batchV62Input(seed: string) { return batchV61Input(seed); }
