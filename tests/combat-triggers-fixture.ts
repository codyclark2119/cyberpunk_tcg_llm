import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { restrictionsContext, restrictionsInput, REBOOT, PSYCHO, FLATHEAD } from "./combat-restrictions-fixture";
import { FLOOR_IT, BOMBUS } from "./react-fixture";
import { MANTIS, VIKTOR } from "./gear-fixture";
import { SWORDWISE } from "./combat-fixture";
import { KERRY } from "./noncombat-fixture";
import captured from "./fixtures/combat-triggers-card-sources.v1.json";
export const SATORI = "satori-sword-of-saburo", DEXTER = "dexter-deshawn-one-last-chance", JACKIE = "jackie-welles-pour-one-out-for-me";
const adjustment = { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 };
export const triggerCards = captured.records.map(({ source, record: r }) => CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
    name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
    type: r.card_type.toUpperCase(), colors: [r.color.toUpperCase()], ram: { [r.color.toUpperCase()]: r.ram },
    setCode: r.set.code, setName: r.set.name, ...(r.power === null ? {} : { power: r.power }),
    printedCost: r.cost === null ? { kind: "DASH" } : { kind: "EDDIES", amount: r.cost }, sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
    rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
    execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: r.slug === SATORI ? [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }] : [],
        ...(r.slug === SATORI ? { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" } } : {}),
        abilities: r.slug === SATORI ? [{ id: "inherited-fight-win-draw@1", trigger: "WHEN_FIGHT_WON", inherited: "EQUIPPED_HOST", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "DRAW", count: 1 }] }]
            : r.slug === DEXTER ? [
                { id: "play-adjust@1", trigger: "WHEN_PLAYED", conditions: [], cost: { kind: "NONE" }, effects: [adjustment] },
                { id: "attack-adjust@1", trigger: "WHEN_ATTACKING", conditions: [], cost: { kind: "NONE" }, effects: [adjustment] },
                { id: "defeated-difference-draw@1", trigger: "WHEN_DEFEATED", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "STREET_CRED_DIFFERENCE_AT_LEAST", minimum: 10 }, count: 2 }] }
            ] : [{ id: "first-blue-play@1", trigger: "WHEN_CARD_PLAYED", guard: "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN", maximum: 2, draw: 1 }] }] },
    printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source })),
    provenance: { source: `${source} (implementation review; not human-certified gold)`, sourceHash: hashCanonical(r), effectiveAt: "2026-09-08", errata: [], reviewed: true }
}));
export function triggersContext() {
    const base = restrictionsContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "combat-triggers-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, combatTriggers: "COMBAT_TRIGGERS_V1" } } });

    return { content: createContentBundle(rules, [...base.content.cards, ...triggerCards], base.content.manifest.engine) };
}
export function triggersInput(seed: string, jackie = false) {
    const input = restrictionsInput(seed);
    return { ...input, decks: input.decks.map(() => ({ legends: [jackie ? JACKIE : "restriction-blue-support", "dev-legend-red", VIKTOR], main: [SATORI, DEXTER, PSYCHO, FLOOR_IT, REBOOT, MANTIS, SWORDWISE, KERRY, jackie ? "slice-card-8" : FLATHEAD, BOMBUS, "slice-card-2", "slice-card-4", "slice-card-6", "slice-card-7"].flatMap(id => [id, id, id]) })) };
}
