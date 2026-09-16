import { CardIdSchema, CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { restrictionsContext, restrictionsInput, CORPO, ATLUS } from "./combat-restrictions-fixture";
import { MANTIS } from "./gear-fixture";
import { SWORDWISE } from "./combat-fixture";
import { KERRY } from "./noncombat-fixture";
import sources from "./fixtures/api-admission-batch-v2-card-sources.v1.json";

export const ANIMALS_WRECKER = CardIdSchema.parse("animals-wrecker");
export const ROCKN_ROCKERBOY = CardIdSchema.parse("rockn-rockerboy");
export const RIDING_NOMAD = CardIdSchema.parse("riding-nomad");
export const RED_SUPPORT = CardIdSchema.parse("api-admission-v2-red-support");
export const YELLOW_SUPPORT = CardIdSchema.parse("api-admission-v2-yellow-support");
export const GREEN_SUPPORT = CardIdSchema.parse("api-admission-v2-green-support");

/** Explicitly authored reviewed keywords. Source keyword hints are diagnostics only and are never parsed into mechanics. */
const REVIEWED_KEYWORDS: Record<string, "ADRENALINE"[]> = { [RIDING_NOMAD]: ["ADRENALINE"] };

/** Printed characteristics only, on the shared reviewed ordinary-Unit shape; never admitted by card identity. */
export const batchV2Cards = sources.records.map(({ record: r, source }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, ...(r.power === null ? {} : { power: r.power }),
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "COMBAT_RESTRICTIONS_V1", status: "SUPPORTED" },
    mechanics: { keywords: REVIEWED_KEYWORDS[r.slug] ?? [], modifiers: [], abilities: [] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source })),
    provenance: { source: `${source} (API Admission Batch V2; implementation review, not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-15", errata: [], reviewed: true }
}));

// Explicit new synthetic RAM support, never a mutation of an existing real/fixture revision.
function supportLegend(id: string, name: string, color: "RED" | "YELLOW" | "GREEN", ram: number, collectorNumber: string) {
    const base = restrictionsContext().content.cards.find(c => c.id === "dev-legend-red")!;
    return CardRevisionSnapshotSchema.parse({ ...base, id, name, displayName: name, deckbuildingIdentity: id, colors: [color], ram: { [color]: ram },
        printings: [{ id: `${id}-print`, setCode: "DEV", collectorNumber, source: "Synthetic test support" }],
        provenance: { source: `Synthetic ${color} RAM ${ram} support Legend for API Admission Batch V2 legal constructed test decks; not a real card`, sourceHash: hashCanonical({ fixture: id, color, ram }), effectiveAt: "2026-09-15", errata: [], reviewed: true } });
}
/** Restrictions bundle plus the explicit reviewed ADRENALINE_V1 policy and Batch V2 revisions. */
export function batchV2Context(engine?: Parameters<typeof createContentBundle>[2]) {
    const base = restrictionsContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "api-admission-batch-v2-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, adrenaline: "ADRENALINE_V1" } } });
    const supports = [supportLegend(RED_SUPPORT, "API Admission V2 Red Support", "RED", 3, "V2R"), supportLegend(YELLOW_SUPPORT, "API Admission V2 Yellow Support", "YELLOW", 1, "V2Y"), supportLegend(GREEN_SUPPORT, "API Admission V2 Green Support", "GREEN", 4, "V2G")];
    return { content: createContentBundle(rules, [...base.content.cards, ...supports, ...batchV2Cards], engine ?? base.content.manifest.engine) };
}
export function batchV2Input(seed: string) {
    const base = restrictionsInput(seed);
    return { ...base, decks: base.decks.map(() => ({ legends: [RED_SUPPORT, YELLOW_SUPPORT, GREEN_SUPPORT], main: [ANIMALS_WRECKER, ROCKN_ROCKERBOY, RIDING_NOMAD, CORPO, ATLUS, MANTIS, SWORDWISE, KERRY, "slice-card-2", "slice-card-3", "slice-card-4", "slice-card-6", "slice-card-7", "slice-card-8"].flatMap(id => [id, id, id]) })) };
}
