import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV75Context, batchV75Input, v75Source } from "./api-admission-batch-v75-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V76 (plan section 6, scope 3c): Judy Álvarez: Braindance Maestro, "When you play a BRAINDANCE Program, give a friendly Unit +1
// power this turn." and "{Spend} Trash the top card of your deck. If it's a Program, you may add it to your hand." Source records are
// evidence only; mechanics are authored here and the card's complete shape is pinned literally in the Legend {Spend} pin table.
export const JUDY_MAESTRO = "judy-a-lvarez-braindance-maestro";
export const V76_SLUGS = [JUDY_MAESTRO] as const;
export const v76Source = v75Source; // Same raw snapshot commit as V7 to V75.
const MECHANICS = {
    [JUDY_MAESTRO]: { keywords: [], modifiers: [], abilities: [
        { id: `${JUDY_MAESTRO}-braindance-play-power@1`, trigger: "WHEN_CARD_PLAYED", guard: "FRIENDLY_BRAINDANCE_PROGRAM_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "PROGRAM_PLAY_FRIENDLY_POWER_THIS_TURN", amount: 1 }] },
        { id: `${JUDY_MAESTRO}-spend-trash-top@1`, activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] },
            cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "TRASH_TOP_MAY_ADD_PROGRAM" }] }] }
};

export const batchV76Cards = V76_SLUGS.map(slug => {
    const r = v76Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
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
        provenance: { source: `${origin} (Batch V76 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V75 chain plus the V76 revision. No new policy: the reviewed Legend {Spend} and trigger policies apply. */
export function batchV76Context() {
    const base = batchV75Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV76Cards], base.manifest.engine) };
}
export function batchV76Input(seed: string) { return batchV75Input(seed); }
