import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV84Context, batchV84Input, v84Source } from "./api-admission-batch-v84-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V85 (plan section 6, scope 3c): Chrome Reverie, "A rival Unit can't attack until your next turn. If you control a min Gig, you
// may Call a Legend for free. (You can only Call a Legend once per turn.)" Source records are evidence only; mechanics are authored here
// and the card's complete shape is pinned literally in the free-Call pin table.
export const REVERIE = "chrome-reverie";
export const V85_SLUGS = [REVERIE] as const;
export const v85Source = v84Source; // Same raw snapshot commit as V7 to V84.
const MECHANICS = {
    [REVERIE]: { keywords: [], modifiers: [], abilities: [
        { id: `${REVERIE}-lock-then-free-call@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN", target: "RIVAL_UNIT" }, { kind: "MAY_CALL_LEGEND_FREE", condition: { kind: "FRIENDLY_GIG_IS_MIN" } }] }] }
};

export const batchV85Cards = V85_SLUGS.map(slug => {
    const r = v85Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V85 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V84 chain plus the V85 revision. No new policy: the reviewed Program play policy applies. */
export function batchV85Context() {
    const base = batchV84Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV85Cards], base.manifest.engine) };
}
export function batchV85Input(seed: string) { return batchV84Input(seed); }
