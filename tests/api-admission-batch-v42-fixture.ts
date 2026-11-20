import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV41Context, batchV41Input, v41Source } from "./api-admission-batch-v41-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V42 (plan section 6, scope 3c): a Unit that can't attack and, at the end of its controller's turn, names a card type and
// reveals the top card: the named type goes to hand and readies 1 Eddie, anything else is trashed.
// Source records are evidence only; mechanics are authored here and the card's complete shape is pinned literally in the
// type-reveal pin table.
export const MISTY = "misty-olszewski-mender-of-broken-spirits";
export const V42_SLUGS = [MISTY] as const;
export const v42Source = v41Source; // Same raw snapshot commit as V7 to V41.
const MECHANICS = {
    [MISTY]: { keywords: [], modifiers: [], restrictions: [{ kind: "CANNOT_ATTACK" }],
        abilities: [{ id: `${MISTY}-end-turn-type-reveal@1`, trigger: "WHEN_OWN_TURN_ENDS", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "CHOOSE_TYPE_REVEAL_TOP_ADD_AND_READY_EDDIE", ready: 1 }] }] }
};

export const batchV42Cards = V42_SLUGS.map(slug => {
    const r = v42Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V42 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-20", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V41 chain plus the V42 revision. No new policy: the reviewed trigger, end-turn and restriction policies apply. */
export function batchV42Context() {
    const base = batchV41Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV42Cards], base.manifest.engine) };
}
export function batchV42Input(seed: string) { return batchV41Input(seed); }
