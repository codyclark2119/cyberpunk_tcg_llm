import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV49Context, batchV49Input, v49Source } from "./api-admission-batch-v49-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V50 (plan section 6, scope 3c): a Unit with "{Play} You may play a Unit with cost 4 or less from your hand or trash for
// free. It can attack rival Units this turn." and "The first time an ARASAKA Unit is defeated each turn, draw 1." Source records
// are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the free-play pin table.
export const DRAGON = "yorinobu-arasaka-steel-dragon";
export const V50_SLUGS = [DRAGON] as const;
export const v50Source = v49Source; // Same raw snapshot commit as V7 to V49.
const MECHANICS = {
    [DRAGON]: { keywords: [], modifiers: [],
        abilities: [
            { id: `${DRAGON}-play-free-unit@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "PLAY_UNIT_FREE", from: "HAND_OR_TRASH", maxCost: 4, optional: true, grant: "ATTACK_RIVAL_UNITS_THIS_TURN" }] },
            { id: `${DRAGON}-first-arasaka-defeat-draw@1`, trigger: "WHEN_UNIT_DEFEATED", guard: "FIRST_ARASAKA_UNIT_DEFEAT_PER_TURN", cost: { kind: "NONE" }, conditions: [],
                effects: [{ kind: "DRAW", count: 1 }] }] }
};

export const batchV50Cards = V50_SLUGS.map(slug => {
    const r = v50Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V50 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V49 chain plus the V50 revision. No new policy: the reviewed play, trigger and combat policies apply. */
export function batchV50Context() {
    const base = batchV49Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV50Cards], base.manifest.engine) };
}
export function batchV50Input(seed: string) { return batchV49Input(seed); }
