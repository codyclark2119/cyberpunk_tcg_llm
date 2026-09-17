import assert from "node:assert/strict";
import { CardIdSchema, CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, canonicalSerialize, createContentBundle, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameAction, type GameEvent, type GameState, type LegalAction, type PlayerId } from "@tcg/domain";
import { applyAction, createGameWithEvents, listLegalActions, validateState, type EngineContext } from "@tcg/engine";
import { attackPowerContext, attackPowerInput, LOSING } from "./attack-condition-power-fixture";
import { GORO } from "./goro-fixture";
import { FLOOR_IT } from "./react-fixture";
import { KERRY } from "./noncombat-fixture";
import { JONIN, jonin } from "./api-admission-batch-v4-fixture";
import { must } from "./api-admission-batch-v4-replay";
import { selectReplayAction } from "./replay-selection";

export { JONIN, LOSING, GORO, FLOOR_IT };
export const NINE_POWER = CardIdSchema.parse("v4-cross-synthetic-nine-power");
const RED_YELLOW = CardIdSchema.parse("v4-cross-synthetic-red-yellow");
const BLUE_GREEN = CardIdSchema.parse("v4-cross-synthetic-blue-green");
const FILLERS = ["slice-card-4", "slice-card-6", "slice-card-7"] as const;

/** Test-only composition: never changes a reviewed revision or a production/Demo ruleset. */
export function crossMechanicContext(): EngineContext {
    const base = attackPowerContext();
    function support(id: string, name: string, colors: CardRevisionSnapshot["colors"], ram: CardRevisionSnapshot["ram"]) {
        const template = base.content.cards.find(c => c.id === "dev-legend-red");
        assert.ok(template);
        return CardRevisionSnapshotSchema.parse({ ...template, id, name, displayName: name, deckbuildingIdentity: id, colors, ram,
            sellProfile: { allowed: true, baseEddieValue: 1 },
            printings: [{ id: `${id}-print`, setCode: "DEV", collectorNumber: id, source: "Synthetic Batch V4 cross-mechanic test support" }],
            provenance: { source: "Synthetic RAM support, not an official card", sourceHash: hashCanonical({ id, colors, ram }), effectiveAt: "2026-09-17", errata: [], reviewed: true } });
    }
    const template = base.content.cards.find(c => c.id === "emergency-atlus");
    assert.ok(template);
    const defender = CardRevisionSnapshotSchema.parse({ ...template, id: NINE_POWER, name: "Synthetic Nine Power Defender", subtitle: "", displayName: "Synthetic Nine Power Defender", deckbuildingIdentity: NINE_POWER,
        colors: ["RED"], ram: { RED: 0 }, power: 9, printedCost: { kind: "EDDIES", amount: 2 },
        rulesText: "", sourceMarkup: "", tags: [], keywords: [], sellProfile: { allowed: false, baseEddieValue: 1 },
        mechanics: { keywords: [], modifiers: [], abilities: [] }, execution: { scope: "COMBAT_RESTRICTIONS_V1", status: "SUPPORTED" },
        printings: [{ id: `${NINE_POWER}-print`, setCode: "DEV", collectorNumber: "V4N9", source: "Synthetic fight threshold fixture" }],
        provenance: { source: "Synthetic nine-power defender, not a changed real card", sourceHash: hashCanonical({ fixture: NINE_POWER, power: 9 }), effectiveAt: "2026-09-17", errata: [], reviewed: true } });
    const additions = [jonin, defender,
        support(RED_YELLOW, "Synthetic V4 Red Yellow Support", ["RED", "YELLOW"], { RED: 3, YELLOW: 1 }),
        support(BLUE_GREEN, "Synthetic V4 Blue Green Support", ["BLUE", "GREEN"], { BLUE: 3, GREEN: 4 })];
    const cards = new Map<string, CardRevisionSnapshot>();
    for (const card of [...base.content.cards, ...additions]) {
        const key = `${card.id}@${card.revision}`, prior = cards.get(key);
        if (prior) assert.equal(canonicalSerialize(card), canonicalSerialize(prior), `Conflicting immutable revision ${key}`);
        else cards.set(key, CardRevisionSnapshotSchema.parse(card));
    }
    const ruleset = RulesetSchema.parse({ ...base.content.ruleset, version: "api-admission-v4-cross-tests-1",
        gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice,
            combatTriggers: "COMBAT_TRIGGERS_V1", friendlyPlayPower: "FRIENDLY_PLAY_POWER_V1" } } });
    return { content: createContentBundle(ruleset, [...cards.values()], base.content.manifest.engine) };
}
export function crossMechanicInput(seed = "v4-cross-arrangement-1") {
    const base = attackPowerInput(seed);
    const main = [JONIN, LOSING, FLOOR_IT, "emergency-atlus", "swordwise-huscle", "mantis-blades", KERRY, "corpo-security", "psycho-squad", "reboot-optics", NINE_POWER, ...FILLERS].flatMap(id => [id, id, id]);
    assert.equal(main.length, 42);
    return { ...base, decks: base.decks.map(() => ({ legends: [GORO, RED_YELLOW, BLUE_GREEN], main: [...main] })) };
}
export type ScenarioStep = { before: GameState; after: GameState; action: GameAction; events: GameEvent[] };
export class ScenarioDriver {
    readonly steps: ScenarioStep[] = [];
    constructor(public state: GameState, readonly context: EngineContext) { this.state = must(validateState(state, context)); }
    take(predicate: (action: LegalAction) => boolean) {
        const legal = must(listLegalActions(this.state, this.state.timing.actingPlayer, this.context));
        const selected = selectReplayAction(legal, predicate);
        assert.ok(selected, `Missing scenario action at ${this.state.timing.turn}/${this.state.timing.step}`);
        const before = this.state, action = { actorId: selected.actorId, action: selected.action };
        const next = must(applyAction(before, action, this.context));
        this.state = must(validateState(JSON.parse(JSON.stringify(next.state)), this.context));
        const step = { before, after: this.state, action, events: next.events };
        this.steps.push(step);
        return step;
    }
    choose(index: number) {
        assert.ok(index >= 0, "Required scenario choice was not offered");
        return this.take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    }
    chooseCard(id: CardInstanceId) {
        return this.choose(this.state.resolution.choice?.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === id) ?? -1);
    }
    settle() {
        for (let count = 0; this.state.resolution.choice && !this.state.match.outcome; count++) {
            assert.ok(count < 100, "Scenario choice guard exhausted");
            this.choose(0);
        }
    }
    pay() {
        for (let count = 0; this.state.resolution.choice?.kind === "PAYMENT"; count++) {
            assert.ok(count < 30, "Payment guard exhausted");
            const index = this.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
            this.choose(index >= 0 ? index : 0);
        }
    }
    play(id: CardInstanceId) { this.take(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id); this.pay(); }
    buff(sourceId: CardInstanceId, targetId: CardInstanceId) {
        const from = this.steps.length;
        this.play(sourceId);
        assert.equal(this.state.resolution.current?.effect.kind, "POWER_UNTIL_END_OF_TURN");
        assert.equal(this.state.resolution.triggerContinuation?.origin.kind, "PLAY");
        assert.equal(this.state.resolution.playContinuation, undefined);
        this.chooseCard(targetId);
        return this.steps.slice(from).flatMap(s => s.events);
    }
    attack(id: CardInstanceId, kind: "CARD" | "GIG_AREA", targetId?: CardInstanceId) {
        this.take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id);
        if (this.state.timing.step === "ATTACK_TARGET_SELECTION") {
            const index = this.state.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === kind
                && (o.target.kind !== "CARD" || o.target.cardInstanceId === targetId));
            this.choose(index);
        }
        this.settle();
        assert.equal(this.state.timing.window, "RIVAL_REACT");
        const combat = this.state.timing.combat;
        assert.ok("target" in combat && combat.target);
        assert.equal(combat.target.kind, kind);
        if (combat.target.kind === "CARD") assert.equal(combat.target.cardInstanceId, targetId);
    }
    passReact() { this.take(a => a.action.kind === "PASS_REACT"); this.settle(); }
    endTurn() { this.take(a => a.action.kind === "END_TURN"); this.settle(); }
}

/**
 * Trusted scenario, NOT a replay of paid setup: legal initialization and four ordinary
 * draw/roll/end-turns are followed by a labeled arrangement of hands, old Units and Eddies.
 * No modifiers, trigger receipts or combat outcomes are inserted. Every tested operation
 * after the arrangement uses applyAction()/moveCardForEffect() and validates its result.
 */
export function arrangedScenario() {
    const context = crossMechanicContext(), initialized = must(createGameWithEvents(crossMechanicInput(), context));
    const driver = new ScenarioDriver(initialized.state, context);
    driver.settle();
    while (driver.state.timing.turn < 5) {
        if (driver.state.timing.window === "CHOOSE_GIG") driver.take(a => a.action.kind === "ROLL_GIG");
        driver.endTurn();
    }
    if (driver.state.timing.window === "CHOOSE_GIG") driver.take(a => a.action.kind === "ROLL_GIG");
    assert.equal(driver.state.timing.window, "MAIN");
    const state = GameStateSchema.parse(driver.state), actor = state.timing.activePlayer;
    const rival = state.match.playerOrder.find(id => id !== actor)!;
    const rngBefore = canonicalSerialize(state.rng);
    const ids = (owner: PlayerId, cardId: string) => Object.values(state.objects.cards)
        .filter(c => c.controllerId === owner && c.cardId === cardId).map(c => c.id).sort();
    function place(id: CardInstanceId, zone: "HAND" | "BATTLEFIELD" | "EDDIES") {
        const card = state.objects.cards[id], from = state.players[card.zone.playerId].zones[card.zone.zone];
        assert.ok(from); const index = from.indexOf(id); assert.ok(index >= 0);
        from.splice(index, 1); state.players[card.controllerId].zones[zone].push(id);
        card.zone = { playerId: card.controllerId, zone }; card.face = zone === "BATTLEFIELD" ? "UP" : "DOWN";
        card.readiness = "READY"; card.statuses = [];
    }
    const [oldJonin, joninSource, secondJonin] = ids(actor, JONIN);
    const [goroUnit] = ids(actor, LOSING), [defender] = ids(rival, NINE_POWER), [rivalUnit] = ids(rival, "emergency-atlus");
    const [floor] = ids(rival, FLOOR_IT), [gear] = ids(actor, "mantis-blades"), [fieldLegend] = ids(actor, GORO);
    assert.ok(oldJonin && joninSource && secondJonin && goroUnit && defender && rivalUnit && floor && gear && fieldLegend);
    for (const player of [actor, rival]) {
        for (const id of state.players[player].zones.LEGENDS) { state.objects.cards[id].face = "UP"; state.objects.cards[id].readiness = "READY"; }
        for (const cardId of FILLERS) for (const id of ids(player, cardId)) place(id, "EDDIES");
    }
    for (const id of [oldJonin, goroUnit, defender, rivalUnit]) place(id, "BATTLEFIELD");
    state.objects.cards[defender].readiness = "SPENT";
    for (const id of [joninSource, secondJonin, floor, gear]) place(id, "HAND");
    assert.equal(canonicalSerialize(state.rng), rngBefore, "Arrangement does not patch RNG");
    assert.equal(state.temporaryModifiers, undefined, "All power receipts must come from executed actions");
    const valid = must(validateState(state, context));
    return { driver: new ScenarioDriver(valid, context), context, actor, rival, oldJonin, joninSource, secondJonin, goroUnit, defender, rivalUnit, floor, gear, fieldLegend };
}
