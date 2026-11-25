import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV91Context, batchV91Input, v91Source } from "./api-admission-batch-v91-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V92 (plan section 6, bundle 14): River Ward: Detective on the Hunt, "{Quick} {Spend} Play a Gear with cost 2 or less from your
// hand for free. When a friendly equipped Unit is defeated, search the top 2 cards of your deck and trash 1." Source records are evidence
// only; mechanics are authored here and the card's complete shape is pinned literally in the Legend pin table.
export const RIVER = "river-ward-detective-on-the-hunt";
export const V92_SLUGS = [RIVER] as const;
export const v92Source = v91Source; // Same raw snapshot commit as V7 to V91.
const MECHANICS = {
    [RIVER]: { keywords: [], modifiers: [], abilities: [
        { id: `${RIVER}-quick-spend-play-gear@1`, activation: { timing: "QUICK", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "PLAY_GEAR_FROM_HAND_FREE", maxCost: 2 }] },
        { id: `${RIVER}-equipped-defeat-search@1`, trigger: "WHEN_UNIT_DEFEATED", guard: "FRIENDLY_EQUIPPED_UNIT_DEFEATED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "SEARCH_TOP_TRASH_ONE", count: 2 }] }] }
};

export const batchV92Cards = V92_SLUGS.map(slug => {
    const r = v92Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V92 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V91 chain plus the V92 revision. No new policy: the reviewed Legend pin policy applies. */
export function batchV92Context() {
    const base = batchV91Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV92Cards], base.manifest.engine) };
}
export function batchV92Input(seed: string) { return batchV91Input(seed); }
