import test from "node:test";
import assert from "node:assert/strict";
import { CardRevisionSnapshotSchema, createContentBundle, validateDeck, DeckSchema, type CardInstanceId, type GameState } from "@tcg/domain";
import { composeScenario, validateState, listLegalActions, applyAction, hashReplayState, SCENARIO_PLAYERS, type Scenario } from "@tcg/engine";
import { handleRequest } from "@tcg/wire";
import { reviewedUnionContext } from "./reviewed-union-fixture";

// Plan section 7: composeScenario builds one exact position at the active seat's MAIN step.
const context = reviewedUnionContext();
const L0 = ["jackie-welles-pour-one-out-for-me", "saburo-arasaka-stubborn-patriarch", "yorinobu-arasaka-embracing-destruction"];
const L1 = ["goro-takemura-hands-unclean", "v-corporate-exile", "viktor-vektor-sit-down-and-relax"];
function scenario(edit: (s: Scenario) => void = () => {}): Scenario {
    const s: Scenario = { seed: "scenario-test", activeSeat: 0, players: [
        { field: [{ card: "field-operator", readiness: "READY", gear: ["dying-night-v-s-pistol"] }, { card: "corpo-security", readiness: "SPENT" }],
            legends: [{ card: L0[0], face: "UP", readiness: "READY", gear: ["satori-sword-of-saburo"] }, { card: L0[1], face: "DOWN", readiness: "READY" }, { card: L0[2], face: "DOWN", readiness: "SPENT" }],
            hand: ["delamain-cab", "field-operator"], trash: ["corpo-security"], deck: ["emergency-atlus", "delamain-cab"], gigs: [{ die: "D6", value: 4 }, { die: "D10", value: 7 }], eddies: { ready: 3, spent: 1 } },
        { field: [{ card: "corpo-security", readiness: "SPENT" }], legends: L1.map(card => ({ card, face: "DOWN" as const, readiness: "READY" as const })),
            hand: [], trash: [], deck: [], gigs: [{ die: "D8", value: 2 }], eddies: { ready: 1, spent: 0 } }
    ] };
    edit(s);
    return s;
}
function compose(s: unknown = scenario()) {
    const r = composeScenario(s, context);
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
    return r.value;
}
function refused(s: Scenario, code: string, path?: string) {
    const r = composeScenario(s, context);
    assert.equal(r.ok, false, `expected ${code}`);
    if (r.ok) return;
    assert.equal(r.errors[0].code, code, JSON.stringify(r.errors));
    if (path) assert.equal(r.errors[0].path, path);
}
const slugs = (s: GameState, ids: readonly CardInstanceId[]) => ids.map(id => s.objects.cards[id].cardId);

test("the composed state is valid, at the active seat's MAIN step, with an empty turn history", () => {
    const s = compose(), [a, b] = SCENARIO_PLAYERS;
    assert.ok(validateState(s, context).ok);
    assert.equal(s.timing.step, "MAIN"); assert.equal(s.timing.window, "MAIN"); assert.equal(s.timing.turn, 3);
    assert.equal(s.timing.activePlayer, a); assert.equal(s.timing.actingPlayer, a); assert.equal(s.timing.firstPlayer, a, "odd turns are the first player's");
    assert.deepEqual(s.match.playerOrder, [a, b]);
    assert.equal(s.resolution.choice, null); assert.equal(s.resolution.pending.length, 0); assert.equal(s.timing.combat.stage, "NONE");
    assert.deepEqual(s.turnHistory?.blueUnitOrGearPlays, { [a]: 0, [b]: 0 });
    for (const p of Object.values(s.players)) assert.deepEqual(p.economy, { sellsThisTurn: 0, callsThisTurn: 0, usageTurn: 3 });
    const even = compose(scenario(x => { x.turn = 4; x.activeSeat = 1; }));
    assert.equal(even.timing.activePlayer, b); assert.equal(even.timing.firstPlayer, a, "even turns are the second player's");
});

test("every described card sits where the description puts it, hosts before their Gear", () => {
    const s = compose(), p = s.players[SCENARIO_PLAYERS[0]], cards = s.objects.cards;
    assert.deepEqual(slugs(s, p.zones.LEGENDS.slice(0, 3)), L0, "legends[i] is LEGENDS slot i");
    assert.deepEqual(p.zones.LEGENDS.slice(0, 3).map(id => [cards[id].face, cards[id].readiness]), [["UP", "READY"], ["DOWN", "READY"], ["DOWN", "SPENT"]]);
    assert.deepEqual(slugs(s, cards[p.zones.LEGENDS[0]].attachments), ["satori-sword-of-saburo"]);
    assert.deepEqual(slugs(s, p.zones.BATTLEFIELD.slice(0, 2)), ["field-operator", "corpo-security"], "field[i] is field slot i");
    assert.deepEqual(p.zones.BATTLEFIELD.slice(0, 2).map(id => cards[id].readiness), ["READY", "SPENT"]);
    assert.deepEqual(slugs(s, cards[p.zones.BATTLEFIELD[0]].attachments), ["dying-night-v-s-pistol"]);
    assert.deepEqual(slugs(s, p.zones.HAND), ["delamain-cab", "field-operator"]);
    assert.deepEqual(slugs(s, p.zones.TRASH), ["corpo-security"]);
    assert.deepEqual(slugs(s, p.zones.DECK.slice(0, 2)), ["emergency-atlus", "delamain-cab"], "the described deck is its top, in order");
    assert.deepEqual(p.zones.EDDIES.map(id => [cards[id].face, cards[id].readiness]), [["DOWN", "READY"], ["DOWN", "READY"], ["DOWN", "READY"], ["DOWN", "SPENT"]]);
    for (const id of p.zones.EDDIES) { const r = context.content.cards.find(c => c.id === cards[id].cardId)!; assert.ok(r.sellProfile.allowed && r.sellProfile.baseEddieValue === 1); }
    const gigs = p.gigs.GIGS.map(g => s.objects.gigs[g]);
    assert.deepEqual(gigs.map(g => [g.dieType, g.roll.kind === "ROLLED" ? g.roll.currentValue : null]), [["D6", 4], ["D10", 7]]);
    assert.deepEqual(p.gigs.FIXER.map(g => s.objects.gigs[g].dieType), ["D4", "D8", "D12", "D20"]);
});

test("each player's whole composition is a legal CONSTRUCTED deck, completed below the described top", () => {
    const s = compose();
    for (const id of s.match.playerOrder) {
        const owned = Object.values(s.objects.cards).filter(c => c.ownerId === id), legend = (c: typeof owned[number]) => context.content.cards.find(r => r.id === c.cardId)!.type === "LEGEND";
        const counts = new Map<string, number>();
        for (const c of owned.filter(c => !legend(c))) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
        assert.equal([...counts.values()].reduce((a, b) => a + b, 0), 40);
        const deck = DeckSchema.parse({ name: "x", legends: owned.filter(legend).map(c => c.cardId), cards: [...counts].map(([cardId, quantity]) => ({ cardId, quantity })) });
        assert.ok(validateDeck(deck, context.content.cards as never, context.content.ruleset as never).legal);
    }
});

test("composition is deterministic, and the seed moves only the RNG", () => {
    assert.equal(hashReplayState(compose()), hashReplayState(compose()));
    const other = compose(scenario(x => { x.seed = "another-seed"; }));
    assert.notEqual(hashReplayState(other), hashReplayState(compose()));
    assert.deepEqual({ ...other, rng: null }, { ...compose(), rng: null });
});

test("the engine offers actions from the composed position, and they apply", () => {
    const s = compose(), [a] = SCENARIO_PLAYERS, p = s.players[a];
    const actions = listLegalActions(s, a, context);
    assert.ok(actions.ok);
    const attack = actions.value.find(x => x.action.kind === "DECLARE_ATTACK");
    assert.ok(attack && attack.action.kind === "DECLARE_ATTACK" && attack.action.cardInstanceId === p.zones.BATTLEFIELD[0], "the ready Unit may attack");
    assert.ok(!actions.value.some(x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === p.zones.BATTLEFIELD[1]), "the spent Unit may not");
    assert.ok(actions.value.some(x => x.action.kind === "CALL_LEGEND" && x.action.cardInstanceId === p.zones.LEGENDS[1]), "a face-down Legend may be Called");
    const end = actions.value.find(x => x.action.kind === "END_TURN")!;
    const next = applyAction(s, { actorId: a, action: end.action }, context);
    assert.ok(next.ok, next.ok ? "" : JSON.stringify(next.errors));
    assert.ok(validateState(next.value.state, context).ok);
    assert.equal(next.value.state.timing.turn, 4);
});

test("refusals name the code and the path of the offending entry", () => {
    refused(scenario(x => { (x.players[0].field[0] as { readiness: string }).readiness = "TAPPED"; }), "INVALID_SCENARIO", "players[0].field[0].readiness");
    refused(scenario(x => { x.players[1].hand.push("no-such-card"); }), "UNKNOWN_CARD", "players[1].hand[0]");
    refused(scenario(x => { x.players[0].field[0].card = "dying-night-v-s-pistol"; }), "WRONG_CARD_TYPE", "players[0].field[0].card");
    refused(scenario(x => { x.players[0].field[0].gear = ["field-operator"]; }), "WRONG_CARD_TYPE", "players[0].field[0].gear[0]");
    refused(scenario(x => { x.players[0].hand.push(L1[0]); }), "WRONG_CARD_TYPE", "players[0].hand[2]");
    refused(scenario(x => { x.players[0].gigs.push({ die: "D6", value: 1 }); }), "INVALID_GIG", "players[0].gigs[2]");
    refused(scenario(x => { x.players[0].gigs[0].value = 7; }), "INVALID_GIG", "players[0].gigs[0].value");
    refused(scenario(x => { x.players[0].legends[1].gear = ["mantis-blades"]; }), "ILLEGAL_GEAR_HOST", "players[0].legends[1].gear");
    refused(scenario(x => { x.players[1].legends.pop(); }), "INVALID_DECK", "players[1]");
    refused(scenario(x => { x.players[0].hand.push("delamain-cab", "delamain-cab"); }), "INVALID_DECK", "players[0]");
    refused(scenario(x => { x.players[1].deck = Array.from({ length: 51 }, (_, i) => ["corpo-security", "delamain-cab", "field-operator"][i % 3]); }), "INVALID_DECK");
});

test("a card that fails its admission is refused as UNADMITTED_CARD", () => {
    const cards = context.content.cards.map(c => c.id === "delamain-cab" ? CardRevisionSnapshotSchema.parse({ ...c, execution: { ...c.execution!, status: "UNSUPPORTED" } }) : c);
    const forged = { content: createContentBundle(context.content.ruleset, cards, context.content.manifest.engine) };
    const r = composeScenario(scenario(), forged);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errors[0].code, "UNADMITTED_CARD", JSON.stringify(r.errors));
});

test("the worker op returns the state, or the engine's errors with their paths", () => {
    const ok = handleRequest({ schemaVersion: 1, requestId: "s1", op: "composeScenario", content: context.content, scenario: scenario() });
    assert.ok(ok.ok && ok.value.kind === "state");
    if (ok.ok && ok.value.kind === "state") assert.equal(hashReplayState(ok.value.state), hashReplayState(compose()));
    const bad = handleRequest({ schemaVersion: 1, requestId: "s2", op: "composeScenario", content: context.content, scenario: scenario(x => { x.players[1].trash.push("no-such-card"); }) });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.deepEqual(bad.errors.map(e => [e.code, e.path]), [["UNKNOWN_CARD", "players[1].trash[0]"]]);
});
