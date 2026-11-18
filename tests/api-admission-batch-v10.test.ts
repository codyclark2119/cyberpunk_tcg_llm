import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { TurnMutation } from "../packages/engine/src/turn";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsRestrictedPlay } from "../packages/engine/src/restriction-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV10Cards, batchV10Context, batchV10Input, v10Source, SMASHER, VOODOO } from "./api-admission-batch-v10-fixture";
import { REAPER } from "./api-admission-batch-v9-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { placeCard, playCard, pick } from "./value-conditions-focused";
import { clearField, fund, field, equip, finishOrder } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV10Context();
const card = (id: string) => batchV10Cards.find(c => c.id === id)!;
/** fund() stops at 8 Eddies; Adam Smasher costs 9. */
function rich(s: GameState, count = 10) {
    const m = new TurnMutation(s, context), player = s.timing.activePlayer;
    while (m.state.players[player].zones.EDDIES.length < count) {
        const c = Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.zone.zone === "DECK" && c.cardId.startsWith("slice-card-"))!;
        m.state.players[player].zones.DECK = m.state.players[player].zones.DECK.filter(id => id !== c.id);
        m.state.players[player].zones.EDDIES.push(c.id); c.zone = { playerId: player, zone: "EDDIES" }; c.face = "DOWN"; c.readiness = "READY";
    }
    return unwrap(validateState(m.state, context));
}
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV10Input("batch-v10"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function unitOfPower(power: number) {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.power === power && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_OWN_TURN_ENDS"));
    assert.ok(r, `no plain reviewed Unit with power ${power}`); return r.id;
}
const canAttack = (s: GameState, id: string) => unwrap(listLegalActions(s, actor, context)).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id);

test("V10 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV10Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v10Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(card(SMASHER).rulesText, "{Play} Defeat all other Units.");
    assert.equal(card(VOODOO).rulesText, "This Unit can't attack unless you played a Program this turn.");
});

test("each V10 card passes only its own exact pin; any changed field is rejected", () => {
    assert.ok(supportsTargetedDefeatCard(card(SMASHER), context).ok);
    assert.ok(supportsRestrictedPlay(card(VOODOO), context).ok);
    for (const c of batchV10Cards) assert.ok(supportsPlay(c, context).ok, c.id);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const smasher: [string, (d: CardRevisionSnapshot) => void][] = [
        ["rival only", d => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, all: "OTHER_THAN_SOURCE" } }]; }],
        ["single target", d => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" } } }]; }],
        ["power bound", d => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "AT_MOST", value: 14 }, all: "OTHER_THAN_SOURCE" } }]; }],
        ["power", d => { d.power = 14; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 8 }; }]
    ];
    for (const [label, edit] of smasher) assert.equal(supportsTargetedDefeatCard(forge(card(SMASHER), edit), context).ok, false, label);
    const voodoo: [string, (d: CardRevisionSnapshot) => void][] = [
        ["Blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["power", d => { d.power = 3; }],
        ["tags", d => { d.tags = ["Netrunner"]; }],
        ["extra restriction", d => { d.mechanics.restrictions = [{ kind: "CANNOT_ATTACK_UNLESS_PROGRAM_PLAYED_THIS_TURN" }, { kind: "CANNOT_ATTACK_GIG_AREA" }]; }]
    ];
    for (const [label, edit] of voodoo) assert.equal(supportsRestrictedPlay(forge(card(VOODOO), edit), context).ok, false, label);
    const { programPlayHistory: _, ...withoutHistory } = context.content.ruleset.gameplay!.turnSlice!;
    const noHistory = { content: { ...context.content, ruleset: { ...context.content.ruleset, gameplay: { ...context.content.ruleset.gameplay!, turnSlice: withoutHistory } } } } as typeof context;
    assert.equal(supportsRestrictedPlay(card(VOODOO), noHistory).ok, false, "the ban needs the Program-play history policy");
});

test("Adam Smasher defeats every other Unit on both sides, each owner ordering its own Gear", () => {
    const a = field(base, context, unitOfPower(3), rival), b = field(a.state, context, unitOfPower(4), rival), own = field(b.state, context, unitOfPower(5), actor);
    const gear = equip(own.state, context, "sandevistan", b.id);
    const placed = placeCard(rich(gear.state), context, SMASHER), played = playCard(placed.state, context, SMASHER);
    // Only the rival's equipped Unit has a real Trash-order choice, and its owner makes it.
    assert.equal(played.state.timing.step, "DEFEAT_ORDER_SELECTION");
    assert.equal(played.state.resolution.choice!.actorId, rival);
    assert.equal(played.state.timing.actingPlayer, rival);
    const done = finishOrder(played.state, context);
    for (const id of [a.id, b.id, own.id, gear.id]) assert.equal(done.state.objects.cards[id].zone.zone, "TRASH", id);
    assert.equal(done.state.objects.cards[placed.id].zone.zone, "BATTLEFIELD");
    assert.equal(done.state.resolution.choice, null);
    assert.equal(done.state.timing.actingPlayer, actor);
    const defeated = done.events.flatMap(e => e.payload.kind === "CARD_DEFEATED" ? [e.payload.cardInstanceId] : []);
    assert.deepEqual(defeated.sort(), [a.id, b.id, own.id].sort());
    const empty = playCard(placeCard(rich(base), context, SMASHER).state, context, SMASHER);
    assert.equal(empty.state.resolution.choice, null);
    assert.equal(empty.state.players[actor].zones.BATTLEFIELD.length, 1);
});

test("Jacked-in Voodoo Boy can attack only after its controller plays a Program this turn", () => {
    const target = field(base, context, unitOfPower(3), rival), spent = GameStateSchema.parse(target.state);
    spent.objects.cards[target.id].readiness = "SPENT";
    const voodoo = field(unwrap(validateState(spent, context)), context, VOODOO, actor);
    assert.equal(canAttack(voodoo.state, voodoo.id), false);
    assert.deepEqual(voodoo.state.turnHistory!.programPlays, { [actor]: 0, [rival]: 0 });
    const played = playCard(placeCard(voodoo.state, context, REAPER).state, context, REAPER);
    let after = played.state;
    while (after.resolution.choice) after = finishOrder(pick(after, context, o => o.kind === "CARD").state, context).state;
    assert.equal(after.turnHistory!.programPlays![actor], 1);
    // Reaper may have defeated the original target; place a fresh spent rival Unit to attack.
    const again = field(after, context, unitOfPower(4), rival), d = GameStateSchema.parse(again.state);
    d.objects.cards[again.id].readiness = "SPENT"; d.objects.cards[voodoo.id].readiness = "READY";
    const ready = unwrap(validateState(d, context));
    assert.equal(ready.objects.cards[voodoo.id].zone.zone, "BATTLEFIELD"); // Reaper defeats only spent Units; Voodoo Boy stayed ready.
    assert.equal(canAttack(ready, voodoo.id), true);
    const forged = GameStateSchema.parse(voodoo.state); delete forged.turnHistory!.programPlays;
    assert.equal(validateState(forged, context).ok, false, "the reviewed policy requires the counters");
});

test("the reviewed union admits the V10 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [SMASHER, VOODOO]) assert.ok(ids.has(id), id);
});
