import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { setupContext, setupInput } from "./setup-fixture";
import captured from "./fixtures/reviewed-card-sources.v1.json";

// Explicit per-card implementation review. Never infer executable abilities from English.
export const reviewedCards = captured.records.map(source => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: source.id, revision: 1, status: "ACTIVE", cardNumber: source.print_number,
    name: source.name, subtitle: source.subname ?? "", displayName: source.display_name,
    deckbuildingIdentity: source.name, type: "LEGEND", colors: [source.color.toUpperCase()],
    setCode: source.set_code, setName: source.set, ...(source.power === null ? {} : { power: source.power }),
    ram: source.ram === null ? {} : { [source.color.toUpperCase()]: source.ram },
    printedCost: source.cost === null ? { kind: "NONE" } : { kind: "EDDIES", amount: source.cost },
    sellProfile: { allowed: source.is_eddiable, baseEddieValue: 1 }, rulesText: source.text, sourceMarkup: source.text_markup,
    tags: source.classifications, keywords: source.keywords, execution: { scope: "NONCOMBAT_SLICE_V1", status: source.id === "rebecca-having-a-moment" ? "UNSUPPORTED" : "SUPPORTED" },
    mechanics: source.id === "viktor-vektor-sit-down-and-relax"
        ? { keywords: [], modifiers: [], abilities: [{ id: "viktor-call-search@1", trigger: "WHEN_CALLED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "SEARCH_GEAR", count: 5, maxCost: 2, maxTake: 2 }] }] }
        : source.id === "royce-psycho-on-the-edge"
            ? { keywords: ["GO_SOLO"], abilities: [], modifiers: [{ kind: "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN", amount: 2 }] }
            : { keywords: [], abilities: [], modifiers: [] },
    printings: source.printings.map((p, index) => ({ id: `${source.id}-printing-${index}`, setCode: p.set_code, collectorNumber: p.collector_number, source: captured.sourceFile })),
    provenance: { source: `${captured.sourceFile} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(source), effectiveAt: "2026-09-08", errata: [], reviewed: true }
}));
export function reviewedContext() {
    const base = setupContext(), rules = RulesetSchema.parse({ ...base.content.ruleset, version: "reviewed-noncombat-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice!, callEffects: "REVIEWED_CALL_V1" } } });
    const cards = base.content.cards.map(card => { const c = CardRevisionSnapshotSchema.parse({ ...card, execution: { scope: "NONCOMBAT_SLICE_V1", status: "SUPPORTED" } }); return c.type === "UNIT" ? CardRevisionSnapshotSchema.parse({ ...c, type: "GEAR", ram: {}, provenance: { ...c.provenance, source: "Synthetic Gear search support fixture; not an official card" } }) : c; });
    return { content: createContentBundle(rules, [...cards, ...reviewedCards], base.content.manifest.engine) };
}
export function reviewedInput() {
    const input = setupInput("reviewed-setup-1");
    return { ...input, decks: input.decks.map(d => ({ ...d, legends: ["viktor-vektor-sit-down-and-relax", "royce-psycho-on-the-edge", "dev-legend-red"] })) };
}
