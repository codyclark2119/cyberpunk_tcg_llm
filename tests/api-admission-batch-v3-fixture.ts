import { CardIdSchema, CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { CORPO, ATLUS } from "./combat-restrictions-fixture";
import { MANTIS } from "./gear-fixture";
import { SWORDWISE } from "./combat-fixture";
import { KERRY } from "./noncombat-fixture";
import { ANIMALS_WRECKER, GREEN_SUPPORT, RED_SUPPORT, RIDING_NOMAD, ROCKN_ROCKERBOY, YELLOW_SUPPORT, batchV2Context, batchV2Input } from "./api-admission-batch-v2-fixture";
import sources from "./fixtures/api-admission-batch-v3-card-sources.v1.json";

export const RUTHLESS_LOWLIFE = CardIdSchema.parse("ruthless-lowlife");
export const MAXTAC_SUPPRESSION = CardIdSchema.parse("maxtac-suppression-team");

/** Explicitly authored reviewed mechanics. Source markup, hints and errata are evidence, never parsed into mechanics. */
const REVIEWED_MECHANICS: Record<string, { restrictions?: { kind: "CANNOT_ATTACK_GIG_AREA" }[]; modifiers: { kind: "RIVAL_LAGGING_UNITS_CANNOT_ATTACK" }[] }> = {
    [RUTHLESS_LOWLIFE]: { restrictions: [{ kind: "CANNOT_ATTACK_GIG_AREA" }], modifiers: [] },
    [MAXTAC_SUPPRESSION]: { modifiers: [{ kind: "RIVAL_LAGGING_UNITS_CANNOT_ATTACK" }] }
};
const REVIEWED_SCOPE: Record<string, "COMBAT_RESTRICTIONS_V1" | "ATTACK_PREVENTION_V1"> = {
    [RUTHLESS_LOWLIFE]: "COMBAT_RESTRICTIONS_V1",
    [MAXTAC_SUPPRESSION]: "ATTACK_PREVENTION_V1"
};

/** Printed characteristics plus one explicitly authored printed restriction/modifier; never admitted by card identity. */
export const batchV3Cards = sources.records.map(({ record: r, source }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, ...(r.power === null ? {} : { power: r.power }),
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: REVIEWED_SCOPE[r.slug], status: "SUPPORTED" },
    mechanics: { keywords: [], abilities: [], ...REVIEWED_MECHANICS[r.slug] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source })),
    provenance: { source: `${source} (API Admission Batch V3; implementation review, not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-16", errata: [], reviewed: true }
}));

/** Batch V2 bundle (including ADRENALINE_V1) plus the two explicit Batch V3 attack-restriction policies. */
export function batchV3Context(engine?: Parameters<typeof createContentBundle>[2]) {
    const base = batchV2Context(engine);
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "api-admission-batch-v3-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, attackTargetRestrictions: "ATTACK_TARGET_RESTRICTIONS_V1", attackPrevention: "ATTACK_PREVENTION_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, ...batchV3Cards], engine ?? base.content.manifest.engine) };
}
export function batchV3Input(seed: string) {
    const base = batchV2Input(seed);
    // Riding Nomad stays in the deck: printed Adrenaline is what the prevention must outrank (2.6).
    return { ...base, decks: base.decks.map(() => ({ legends: [RED_SUPPORT, YELLOW_SUPPORT, GREEN_SUPPORT], main: [RUTHLESS_LOWLIFE, MAXTAC_SUPPRESSION, RIDING_NOMAD, ANIMALS_WRECKER, ROCKN_ROCKERBOY, CORPO, ATLUS, MANTIS, SWORDWISE, KERRY, "slice-card-2", "slice-card-3", "slice-card-6", "slice-card-7"].flatMap(id => [id, id, id]) })) };
}
