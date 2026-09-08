import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { reviewedContext, reviewedInput } from "./reviewed-card-fixture";
import sources from "./fixtures/noncombat-card-sources.v1.json";
import rulesSource from "./fixtures/noncombat-rules.v1.json";
export const AFTERPARTY = "afterparty-at-lizzie-s";
export const KERRY = "kerry-eurodyne-the-last-rockerboy";
export const noncombatCards = sources.records.map(({ record: r, source }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, ...(r.power === null ? {} : { power: r.power }),
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: r.slug === AFTERPARTY ? [{
        id: "afterparty-program@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
        effects: [ { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 },
            { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "DISTINCT_GIG_VALUES", minimum: 2 }, count: 1 } ]
    }] : [{ id: "kerry-spend-draw@1", cost: { kind: "NONE" }, conditions: [{ kind: "GIG_VALUE_AT_LEAST", minimum: 8 }],
        activation: { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }, effects: [{ kind: "DRAW", count: 2 }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source })),
    provenance: { source: `${source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: [], reviewed: true }
}));
export function noncombatContext() {
    const base = reviewedContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "noncombat-play-1", gameplay: { ...base.content.ruleset.gameplay, gigValueBounds: "DIE_FACES_V1", turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, rulesSourceHash: rulesSource.sha256, cardPlay: "NONCOMBAT_PLAY_V1" } } });
    return { content: createContentBundle(rules, [...base.content.cards, ...noncombatCards], base.content.manifest.engine) };
}
export function noncombatInput(seed = "noncombat-play-1") {
    const input = reviewedInput();
    return { ...input, seed, decks: input.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-0" ? AFTERPARTY : id === "slice-card-1" ? KERRY : id) })) };
}
