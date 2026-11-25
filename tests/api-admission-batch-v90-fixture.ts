import { CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV89Context, batchV89Input, v89Source } from "./api-admission-batch-v89-fixture";
import { V7_SOURCE_COMMIT } from "./api-admission-batch-v7-fixture";

// Batch V90 (plan section 6, bundle 13): Cyberpsychosis, "{Quick} Give an equipped Unit +3 power this turn for each of its equipped
// Gears. If that Unit steals or fights, defeat it at the end of this turn." Source records are evidence only; mechanics are authored
// here and the card's complete shape is pinned literally in the targeted-defeat table.
export const CYBERPSYCHOSIS = "cyberpsychosis";
export const V90_SLUGS = [CYBERPSYCHOSIS] as const;
export const v90Source = v89Source; // Same raw snapshot commit as V7 to V89.
const MECHANICS = {
    [CYBERPSYCHOSIS]: { keywords: ["QUICK"], modifiers: [],
        abilities: [{ id: `${CYBERPSYCHOSIS}-play@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
            effects: [{ kind: "EQUIPPED_UNIT_POWER_PER_GEAR_THIS_TURN", amount: 3, ifStealsOrFights: { timing: "END_OF_TURN", effect: { kind: "DEFEAT_UNIT", target: { kind: "TRIGGER_SUBJECT" } } } }] }] }
};

export const batchV90Cards = V90_SLUGS.map(slug => {
    const r = v90Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: "TARGETED_DEFEAT_V1", status: "SUPPORTED" },
        mechanics: MECHANICS[slug],
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V90 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-25", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the V89 chain plus the V90 revision. No new policy: the reviewed defeat, react and end-of-turn policies apply. */
export function batchV90Context() {
    const base = batchV89Context().content;
    return { content: createContentBundle(base.ruleset, [...base.cards, ...batchV90Cards], base.manifest.engine) };
}
export function batchV90Input(seed: string) { return batchV89Input(seed); }
