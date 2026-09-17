import test from "node:test";
import assert from "node:assert/strict";
import { CardIdSchema, CardRevisionSnapshotSchema, DefeatGearTargetSchema, DefeatTargetSchema, DefeatUnitTargetSchema, EffectSchema, GameStateSchema, RulesetSchema, canonicalSerialize, createContentBundle, hashCanonical, type CardRevisionSnapshot, type GameState, type Result } from "@tcg/domain";
import { createGameWithEvents, validateState, type EngineContext } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsReactPlay } from "../packages/engine/src/react-support";
import { hasTargetedDefeatMetadata, supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { hasTargetedGearDefeatMetadata, reviewTargetedGearDefeatShape, targetedGearDefeatPolicyComplete } from "../packages/engine/src/targeted-gear-defeat-support";
import { listDefeatableUnits } from "../packages/engine/src/targeted-defeat-queries";
import { targetedCards, targetedContext, targetedInput, OVER_THE_EDGE } from "./targeted-defeat-fixture";

const base = targetedContext();
const gearTarget = DefeatGearTargetSchema.parse({ kind: "GEAR", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 } });
// Deliberately synthetic: no Detonate CardId, upstream record, executable admission or publication claim.
const probe = CardRevisionSnapshotSchema.parse({
    ...targetedCards.find(c => c.id === OVER_THE_EDGE)!,
    id: "v5-gear-shape-probe", name: "Synthetic Gear Defeat Shape Probe", displayName: "Synthetic Gear Defeat Shape Probe",
    deckbuildingIdentity: "v5-gear-shape-probe", subtitle: "", cardNumber: "V5-PROBE", setCode: "DEV", setName: "Synthetic V5 shape tests",
    colors: ["RED"], ram: { RED: 2 }, printedCost: { kind: "EDDIES", amount: 1 },
    sellProfile: { allowed: true, baseEddieValue: 1 }, tags: ["Quickhack"], keywords: [],
    rulesText: "Synthetic typed shape probe; not an admitted official card.", sourceMarkup: "Synthetic typed shape probe; not an admitted official card.",
    execution: { scope: "TARGETED_GEAR_DEFEAT_V1", status: "SUPPORTED" },
    mechanics: { keywords: ["QUICK"], modifiers: [], abilities: [{ id: "synthetic-gear-defeat@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DEFEAT_UNIT", target: gearTarget }] }] },
    printings: [{ id: "v5-shape-probe-print", setCode: "DEV", collectorNumber: "V5-PROBE", source: "Synthetic schema/admission probe" }],
    provenance: { source: "Synthetic schema/admission probe, not real-card evidence or execution certification", sourceHash: hashCanonical({ fixture: "v5-gear-shape-probe" }), effectiveAt: "2026-09-17", errata: [], reviewed: true }
});
function contextFor(card = probe, ruleset = RulesetSchema.parse({ ...base.content.ruleset, version: "v5-foundation-probe-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, targetedGearDefeat: "TARGETED_GEAR_DEFEAT_V1" } } })): EngineContext {
    return { content: createContentBundle(ruleset, [...base.content.cards, card], base.content.manifest.engine) };
}
const context = contextFor();
function unwrap<T>(result: Result<T>): T { assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors)); return result.value; }
function repin(state: GameState, ctx: EngineContext) {
    const copy = GameStateSchema.parse(state), b = ctx.content;
    copy.match.rulesetId = b.ruleset.id; copy.match.rulesetVersion = b.ruleset.version;
    copy.match.rulesetHash = b.manifest.ruleset.hash; copy.match.contentManifestHash = b.manifestHash;
    copy.match.engineVersion = b.manifest.engine.version; copy.match.engineArtifactHash = b.manifest.engine.artifactHash;
    copy.match.cards = b.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    return copy;
}

test("V5 foundation preserves both original Unit selector payloads exactly", () => {
    for (const card of targetedCards) for (const ability of card.mechanics.abilities) for (const effect of ability.effects) {
        assert.equal(effect.kind, "DEFEAT_UNIT");
        if (effect.kind !== "DEFEAT_UNIT") throw new Error("Expected original Unit defeat fixture");
        assert.equal(effect.target.kind, "UNITS");
        assert.equal(canonicalSerialize(DefeatUnitTargetSchema.parse(effect.target)), canonicalSerialize(effect.target));
        assert.equal(canonicalSerialize(DefeatTargetSchema.parse(effect.target)), canonicalSerialize(effect.target));
        assert.equal(canonicalSerialize(EffectSchema.parse(effect)), canonicalSerialize(effect));
    }
    assert.equal(DefeatUnitTargetSchema.safeParse({ kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 } }).success, false);
});

test("V5 foundation Gear vocabulary is a separate literal-two rival-only target", () => {
    assert.deepEqual(DefeatTargetSchema.parse(gearTarget), gearTarget);
    assert.equal(DefeatUnitTargetSchema.safeParse(gearTarget).success, false);
    for (const value of [-1, 0, 1, 3, 5])
        assert.equal(DefeatGearTargetSchema.safeParse({ ...gearTarget, power: { kind: "AT_MOST", value } }).success, false, `threshold ${value}`);
    for (const relation of ["ANY", "CONTROLLED"])
        assert.equal(DefeatGearTargetSchema.safeParse({ ...gearTarget, relation }).success, false, relation);
    assert.equal(DefeatGearTargetSchema.safeParse({ ...gearTarget, power: { kind: "CONTROLLED_GIG_VALUE", dieType: "D20" } }).success, false);
    assert.equal(DefeatGearTargetSchema.safeParse({ ...gearTarget, count: 2 }).success, false);
    assert.deepEqual(EffectSchema.parse({ kind: "DEFEAT_UNIT", target: gearTarget }), { kind: "DEFEAT_UNIT", target: gearTarget });
});

test("V5 foundation shape review is semantic and does not confer execution support", () => {
    assert.equal(targetedGearDefeatPolicyComplete(context), true);
    assert.equal(reviewTargetedGearDefeatShape(probe, context).ok, true);
    const renamed = CardRevisionSnapshotSchema.parse(probe);
    renamed.id = CardIdSchema.parse("another-synthetic-gear-probe");
    renamed.name = "Another Synthetic Probe"; renamed.rulesText = "No English interpretation"; renamed.sourceMarkup = "No English interpretation";
    assert.equal(reviewTargetedGearDefeatShape(renamed, context).ok, true);
    for (const card of [probe, renamed]) {
        assert.equal(supportsTargetedDefeatCard(card, context).ok, false);
        assert.equal(supportsPlay(card, context).ok, false, "V5_EXECUTION_REMAINS_CLOSED");
        assert.equal(supportsReactPlay(card, context).ok, false, "V5_REACT_REMAINS_CLOSED");
    }
});

test("V5 foundation does not relax Minotaur or Over the Edge admission", () => {
    for (const original of targetedCards) {
        const hash = hashCanonical(original);
        assert.equal(supportsTargetedDefeatCard(original, base).ok, true);
        assert.equal(supportsTargetedDefeatCard(original, context).ok, true);
        assert.equal(supportsPlay(original, context).ok, true);
        const quick = CardRevisionSnapshotSchema.parse(original); quick.mechanics.keywords = ["QUICK"];
        assert.equal(supportsTargetedDefeatCard(quick, context).ok, false);
        const gear = CardRevisionSnapshotSchema.parse(original); gear.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: gearTarget }];
        assert.equal(supportsTargetedDefeatCard(gear, context).ok, false);
        assert.equal(reviewTargetedGearDefeatShape(gear, context).ok, false);
        assert.equal(hashCanonical(original), hash, "Earlier immutable revision changed");
    }
});

test("V5 foundation shape review rejects extra, conditional and wrong-source metadata", () => {
    const mutations: [string, (c: CardRevisionSnapshot) => void][] = [
        ["unreviewed", c => { c.provenance.reviewed = false; }],
        ["unsupported", c => { c.execution!.status = "UNSUPPORTED"; }],
        ["old scope", c => { c.execution!.scope = "TARGETED_DEFEAT_V1"; }],
        ["Unit source", c => { c.type = "UNIT"; }],
        ["numeric Program power", c => { c.power = 0; }],
        ["cost", c => { c.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["RAM", c => { c.ram = { RED: 1 }; }],
        ["color", c => { c.colors = ["BLUE"]; }],
        ["tag", c => { c.tags = ["Merc"]; }],
        ["not sellable", c => { c.sellProfile.allowed = false; }],
        ["sell value", c => { c.sellProfile.baseEddieValue = 2; }],
        ["catalog keywords", c => { c.keywords = ["Quick"]; }],
        ["missing Quick", c => { c.mechanics.keywords = []; }],
        ["extra keyword", c => { c.mechanics.keywords.push("ADRENALINE"); }],
        ["modifier", c => { c.mechanics.modifiers = [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }]; }],
        ["restriction", c => { c.mechanics.restrictions = [{ kind: "CANNOT_ATTACK" }]; }],
        ["equip", c => { c.mechanics.equip = { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }; }],
        ["inherited", c => { c.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }],
        ["guard", c => { c.mechanics.abilities[0].guard = "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN"; }],
        ["trigger", c => { c.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["ability cost", c => { c.mechanics.abilities[0].cost = { kind: "EDDIES", amount: 1 }; }],
        ["condition", c => { c.mechanics.abilities[0].conditions = [{ kind: "STREET_CRED_GREATER_THAN_RIVAL" }]; }],
        ["activation", c => { c.mechanics.abilities[0].activation = { timing: "MAIN", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "SPEND_SOURCE" }] }; }],
        ["extra ability", c => { c.mechanics.abilities.push({ ...c.mechanics.abilities[0], id: "extra@1" }); }],
        ["extra effect", c => { c.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["Unit target", c => { c.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 5 } } }]; }],
        ["when", c => { c.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: gearTarget, when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" } } }]; }]
    ];
    for (const [name, mutate] of mutations) {
        const card = CardRevisionSnapshotSchema.parse(probe); mutate(card);
        assert.equal(reviewTargetedGearDefeatShape(CardRevisionSnapshotSchema.parse(card), context).ok, false, name);
    }
});

test("V5 foundation dependency review checks each required policy independently", () => {
    for (const key of ["targetedGearDefeat", "targetedDefeat", "cardPlay", "gear", "combat", "react", "combatTriggers", "combatResolution"] as const) {
        const ruleset = RulesetSchema.parse(context.content.ruleset); delete ruleset.gameplay!.turnSlice![key];
        const disabled = contextFor(probe, ruleset);
        assert.equal(targetedGearDefeatPolicyComplete(disabled), false, key);
        assert.equal(reviewTargetedGearDefeatShape(probe, disabled).ok, false, key);
    }
    for (const field of ["gigValueBounds", "callEffects"] as const) {
        const ruleset = RulesetSchema.parse(context.content.ruleset);
        if (field === "gigValueBounds") ruleset.gameplay!.gigValueBounds = "UNSUPPORTED";
        else ruleset.gameplay!.turnSlice!.callEffects = "SINGLE_UNCONDITIONAL_DRAW";
        assert.equal(reviewTargetedGearDefeatShape(probe, contextFor(probe, ruleset)).ok, false, field);
    }
    assert.equal(base.content.ruleset.gameplay!.turnSlice!.targetedGearDefeat, undefined, "No existing policy is enabled implicitly");
});

test("V5 foundation detectors retain coverage for empty, mixed and wrong-scope Gear sources", () => {
    const empty = CardRevisionSnapshotSchema.parse(probe); empty.mechanics.abilities = [];
    const wrong = CardRevisionSnapshotSchema.parse(probe); wrong.execution!.scope = "NONCOMBAT_PLAY_V1";
    const mixed = CardRevisionSnapshotSchema.parse(probe);
    mixed.mechanics.abilities[0].effects.push({ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 5 } } });
    for (const card of [probe, empty, wrong, mixed]) {
        assert.equal(hasTargetedGearDefeatMetadata(card), true);
        assert.equal(hasTargetedDefeatMetadata(card), true, "V5_NO_METADATA_OWNERSHIP_GAP");
        assert.equal(supportsPlay(card, context).ok, false);
    }
});

test("V5 foundation validateState rejects hidden new-scope sources through the registered metadata chain", () => {
    const initial = unwrap(createGameWithEvents(targetedInput("v5-foundation-reload"), base)).state;
    const empty = CardRevisionSnapshotSchema.parse(probe); empty.mechanics.abilities = [];
    for (const card of [probe, empty]) {
        const ctx = contextFor(card), state = repin(initial, ctx);
        assert.equal(validateState(state, ctx).ok, true, "Extended but unused catalog is a valid positive control");
        const actor = state.match.playerOrder[0], id = state.players[actor].zones.DECK[0];
        assert.ok(id); assert.equal(state.objects.cards[id].face, "DOWN");
        state.objects.cards[id].cardId = card.id; state.objects.cards[id].revision = card.revision;
        const result = validateState(JSON.parse(JSON.stringify(state)), ctx);
        assert.equal(result.ok, false, "V5_HIDDEN_SOURCE_REJECTED");
        if (result.ok) throw new Error("Unimplemented source unexpectedly accepted");
        assert.ok(result.errors.some(e => e.code === "UNSUPPORTED_TARGETED_DEFEAT"), JSON.stringify(result.errors));
    }
});

test("V5 foundation cannot initialize a gameplay deck just because the Gear shape was reviewed", () => {
    const input = targetedInput("v5-foundation-admission");
    assert.equal(createGameWithEvents(input, context).ok, true, "Existing deck remains admitted");
    const changed = { ...input, decks: input.decks.map((d, index) => index ? d : { ...d, main: d.main.map(id => id === OVER_THE_EDGE ? probe.id : id) }) };
    assert.ok(changed.decks[0].main.includes(probe.id), "The negative deck must actually contain the probe");
    assert.equal(createGameWithEvents(changed, context).ok, false, "V5_EXECUTION_REMAINS_CLOSED");
});

test("V5 foundation legacy Unit enumeration rejects Gear targets instead of silently broadening", () => {
    const state = unwrap(createGameWithEvents(targetedInput("v5-foundation-selector"), base)).state;
    assert.deepEqual(listDefeatableUnits(state, state.timing.activePlayer, gearTarget, context), []);
});
