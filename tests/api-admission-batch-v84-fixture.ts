import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV83Context, batchV83Input, v83Source } from "./api-admission-batch-v83-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V84 (plan section 6, scope 3c): Tyger's Whisper, "{Play} You may Call a Legend for free. (You can only Call a Legend once
// per turn.)" Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// free-Call pin table.
export const WHISPER = "tyger-s-whisper";
export const V84_SLUGS = [WHISPER] as const;
export const v84Source = v83Source; // Same raw snapshot commit as V7 to V83.
const MECHANICS = {
    [WHISPER]: { keywords: [], modifiers: [], abilities: [
        { id: `${WHISPER}-play-free-call@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "MAY_CALL_LEGEND_FREE" }] }] }
};

export const batchV84Cards = V84_SLUGS.map(slug => {
    const r = v84Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V84 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V83 chain plus the V84 revision. No new policy: the reviewed trigger policy applies. */
export function batchV84Context() {
    const base = batchV83Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV84Cards], base.manifest.engine) };
}
export function batchV84Input(seed: string) { return batchV83Input(seed); }
