import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { resolutionContext } from "./combat-resolution-fixture";
import { reactInput, FLOOR_IT } from "./react-fixture";
import { MANTIS } from "./gear-fixture";
import { SWORDWISE } from "./combat-fixture";
import { KERRY } from "./noncombat-fixture";
import source from "./fixtures/combat-restrictions-card-sources.v1.json";
export const REBOOT = "reboot-optics", CORPO = "corpo-security", FLATHEAD = "mt0d12-flathead", PSYCHO = "psycho-squad", ATLUS = "emergency-atlus";
export const restrictionCards = source.records.map(({ record: r, source }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, ...(r.power === null ? {} : { power: r.power }),
    printedCost: { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "COMBAT_RESTRICTIONS_V1", status: "SUPPORTED" },
    mechanics: { modifiers: [], keywords: r.slug === CORPO ? ["BLOCKER"] : r.slug === REBOOT ? ["QUICK"] : [],
        ...(r.slug === CORPO ? { restrictions: [{ kind: "CANNOT_ATTACK" }] } : r.slug === FLATHEAD ? { restrictions: [{ kind: "CANNOT_BE_BLOCKED", condition: { kind: "STREET_CRED_LESS_THAN_RIVAL" } }] } : {}),
        abilities: r.slug === REBOOT ? [{ id: "next-rival-fight-prevention@1", trigger: "WHEN_PLAYED", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "CREATE_NEXT_RIVAL_FIGHT_PREVENTION" }] }] : [] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source })),
    provenance: { source: `${source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: [], reviewed: true }
}));
export function restrictionsContext() {
    const base = resolutionContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "combat-restrictions-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, combatRestrictions: "COMBAT_RESTRICTIONS_V1" } } });
    // Explicit new synthetic RAM support, never a mutation of an existing real/fixture revision.
    const blue = CardRevisionSnapshotSchema.parse({ ...base.content.cards.find(c => c.id === "dev-legend-blue")!, id: "restriction-blue-support", name: "Restriction Blue Support", displayName: "Restriction Blue Support", deckbuildingIdentity: "restriction-blue-support", ram: { BLUE: 3 }, printings: [{ id: "restriction-blue-support-print", setCode: "DEV", collectorNumber: "R01", source: "Synthetic test support" }], provenance: { source: "Synthetic Blue RAM 3 support Legend for legal constructed test decks; not a real card", sourceHash: hashCanonical({ fixture: "restriction-blue-support", ram: 3 }), effectiveAt: "2026-09-08", errata: [], reviewed: true } });
    return { content: createContentBundle(rules, [...base.content.cards, blue, ...restrictionCards], base.content.manifest.engine) };
}
export function restrictionsInput(seed: string) {
    const base = reactInput(seed);
    return { ...base, decks: base.decks.map(() => ({ legends: ["restriction-blue-support", "dev-legend-green", "dev-legend-red"], main: [REBOOT, CORPO, FLATHEAD, PSYCHO, ATLUS, FLOOR_IT, MANTIS, SWORDWISE, KERRY, "slice-card-2", "slice-card-4", "slice-card-6", "slice-card-7", "slice-card-8"].flatMap(id => [id, id, id]) })) };
}
