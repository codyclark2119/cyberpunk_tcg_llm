import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { noncombatContext, noncombatInput } from "./noncombat-fixture";
import captured from "./fixtures/gear-card-source.v1.json";
import rules from "./fixtures/gear-rules.v1.json";
export const MANTIS = "mantis-blades";
export const VIKTOR = "viktor-vektor-sit-down-and-relax";
export const ROYCE = "royce-psycho-on-the-edge";
const r = captured.record;
export const mantis = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: "GEAR", colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, power: r.power,
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
    mechanics: { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, keywords: [], abilities: [], modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: captured.source })),
    provenance: { source: `${captured.source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: [], reviewed: true }
});
export function gearContext() {
    const base = noncombatContext();
    const policy = RulesetSchema.parse({ ...base.content.ruleset, version: "gear-equip-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, rulesSourceHash: rules.sha256, gear: "REVIEWED_GEAR_V1" } } });
    return { content: createContentBundle(policy, [...base.content.cards, mantis], base.content.manifest.engine) };
}
export function gearInput(seed = "gear-equip-1") {
    const input = noncombatInput(seed);
    return { ...input, decks: input.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-2" ? MANTIS : id) })) };
}
