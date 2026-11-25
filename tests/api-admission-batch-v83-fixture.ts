import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV82Context, batchV82Input, v82Source } from "./api-admission-batch-v82-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V83 (plan section 6, scope 3c): Nocturne Op55 N1, "If your fixer area is empty, play this Program for 1 €$. Choose one effect.
// Draw 2. // A Unit can't attack until your next turn. // A friendly Legend may use {Go Solo} for -2 €$ this turn, to a minimum of 1 €$."
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the modal Program pin
// table.
export const NOCTURNE = "nocturne-op55-n1";
export const V83_SLUGS = [NOCTURNE] as const;
export const v83Source = v82Source; // Same raw snapshot commit as V7 to V82.
const MECHANICS = {
    [NOCTURNE]: { keywords: [], modifiers: [{ kind: "ALTERNATIVE_PLAY_COST_IF_FIXER_EMPTY", amount: 1 }], abilities: [
        { id: `${NOCTURNE}-choose-one@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], choose: { count: 1 },
            effects: [{ kind: "DRAW", count: 2 }, { kind: "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN" }, { kind: "FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN", amount: 2, minimum: 1 }] }] }
};

export const batchV83Cards = V83_SLUGS.map(slug => {
    const r = v83Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V83 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V82 chain plus the V83 revision. No new policy: the reviewed modal Program policy applies. */
export function batchV83Context() {
    const base = batchV82Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV83Cards], base.manifest.engine) };
}
export function batchV83Input(seed: string) { return batchV82Input(seed); }
