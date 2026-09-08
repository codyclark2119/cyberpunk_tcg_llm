import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { combatContext, combatInput } from "./combat-fixture";
import sources from "./fixtures/react-card-sources.v1.json";
import rules from "./fixtures/react-rules.v1.json";
export const FLOOR_IT = "floor-it", BOMBUS = "secondhand-bombus", VIKTOR = "viktor-vektor-sit-down-and-relax";
export const reactCards = sources.cards.map(({ record: r, source }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, ...(r.power === null ? {} : { power: r.power }),
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "COMBAT_REACT_V1", status: "SUPPORTED" },
    mechanics: r.slug === FLOOR_IT ? { keywords: ["QUICK"], modifiers: [], abilities: [{ id: "floor-it-program@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -1 }, { kind: "DRAW", count: 1 }] }] } : { keywords: ["BLOCKER"], modifiers: [], abilities: [] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source })),
    provenance: { source: `${source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: [], reviewed: true }
}));
export function reactContext() {
    const base = combatContext();
    const policy = RulesetSchema.parse({ ...base.content.ruleset, version: "combat-react-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, react: "COMBAT_REACT_V1", rulesSourceHash: rules.sha256 } } });
    return { content: createContentBundle(policy, [...base.content.cards, ...reactCards], base.content.manifest.engine) };
}
export function reactInput(seed = "combat-attack-46") {
    const input = combatInput(seed);
    return { ...input, decks: input.decks.map(d => ({ ...d, legends: d.legends.map(id => id === "dev-legend-red" ? "dev-legend-blue" : id), main: d.main.map(id => id === "slice-card-12" ? FLOOR_IT : id === "slice-card-5" ? BOMBUS : id) })) };
}
