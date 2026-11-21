import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV62Context, batchV62Input, v62Source } from "./api-admission-batch-v62-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V63 (plan section 6, scope 3c): Evelyn Parker: Beautiful Enigma, "When a friendly CORPO or GANGER Unit steals 1 or more
// Gigs, ready 1 Eddie." and "1 €$, {Spend} A rival Unit must attack next turn if it can." Source records are evidence only;
// mechanics are authored here and the card's complete shape is pinned literally in the Legend {Spend} pin table.
export const EVELYN = "evelyn-parker-beautiful-enigma";
export const V63_SLUGS = [EVELYN] as const;
export const v63Source = v62Source; // Same raw snapshot commit as V7 to V62.
const MECHANICS = {
    [EVELYN]: { keywords: [], modifiers: [], abilities: [
        { id: `${EVELYN}-corpo-ganger-steal-ready@1`, trigger: "WHEN_FRIENDLY_UNIT_STEALS_GIG", guard: "FRIENDLY_CORPO_OR_GANGER_UNIT_STEALS", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "READY_EDDIES", player: "CONTROLLER", count: 1 }] },
        { id: `${EVELYN}-spend-must-attack@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "FORCE_RIVAL_UNIT_ATTACK", duration: "NEXT_TURN" }] }] }
};

export const batchV63Cards = V63_SLUGS.map(slug => {
    const r = v63Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V63 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-21", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V62 chain plus the V63 revision. No new policy: the reviewed Call, trigger and must-attack policies apply. */
export function batchV63Context() {
    const base = batchV62Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV63Cards], base.manifest.engine) };
}
export function batchV63Input(seed: string) { return batchV62Input(seed); }
