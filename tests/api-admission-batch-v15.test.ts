import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV15Cards, batchV15Context, batchV15Input, v15Source, LES_E_LE_MENS, UNLIKELY_BOND } from "./api-admission-batch-v15-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { playCard, pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV15Context();
const card = (id: string) => batchV15Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV15Input("batch-v15"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function unitOfPower(power: number) {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.power === power && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_OWN_TURN_ENDS"));
    assert.ok(r, `no plain reviewed Unit with power ${power}`); return r.id;
}
const GEAR = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "GEAR" && supportsPlay(c, context).ok && c.mechanics.equip?.kind === "FRIENDLY_UNIT_OR_FACE_UP_LEGEND")!.id;
type Spec = { power: number; player: PlayerId; spent?: boolean; gear?: true };
/** Trusted arrangement: the Program in the actor's hand and each Unit (and Gear) rewritten from the bottom of its controller's deck. */
function arrange(program: string, specs: Spec[]) {
    const m = new TurnMutation(base, context), used = new Set<CardInstanceId>();
    const put = (player: PlayerId, cardId: string) => {
        const id = [...m.state.players[player].zones.DECK].reverse().find(id => !used.has(id))!, r = context.content.cards.find(c => c.id === cardId)!;
        used.add(id); m.state.objects.cards[id].cardId = r.id; m.state.objects.cards[id].revision = r.revision; return id;
    };
    moveCardLocation(m, put(actor, program), "HAND");
    const ids: CardInstanceId[] = [], gears: CardInstanceId[] = [];
    for (const s of specs) {
        const id = put(s.player, unitOfPower(s.power)); moveCardLocation(m, id, "BATTLEFIELD");
        const c = m.state.objects.cards[id]; c.readiness = s.spent ? "SPENT" : "READY"; c.statuses = []; ids.push(id);
        if (s.gear) { const g = put(s.player, GEAR); moveCardLocation(m, g, "HAND"); unwrap(attachPlayedGear(m, g, id)); gears.push(g); }
    }
    return { state: unwrap(validateState(m.state, context)), ids, gears };
}
const zone = (s: GameState, id: string) => s.objects.cards[id as CardInstanceId].zone;
const optionIds = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const bottom = (s: GameState, p: PlayerId, n: number) => s.players[p].zones.DECK.slice(-n);

test("V15 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV15Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v15Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(card(LES_E_LE_MENS).rulesText, "Bottom-deck a Rival's lowest-power Unit. (If there are multiple, choose 1.)");
    assert.equal(card(UNLIKELY_BOND).rulesText, "Bottom-deck a ready friendly Unit. If you do, bottom-deck a spent rival Unit.");
});

test("each V15 card passes only its own exact pin; any changed field is rejected", () => {
    for (const c of batchV15Cards) assert.ok(supportsPlay(c, context).ok, c.id);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const effect = (e: object) => (d: CardRevisionSnapshot) => { d.mechanics.abilities[0].effects = [e as never]; };
    const edits: [string, string, (d: CardRevisionSnapshot) => void][] = [
        [LES_E_LE_MENS, "any power", effect({ kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL" } })],
        [LES_E_LE_MENS, "friendly", effect({ kind: "BOTTOM_DECK_UNIT", target: { relation: "CONTROLLED", lowestPower: true } })],
        [LES_E_LE_MENS, "cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        [LES_E_LE_MENS, "ram", d => { d.ram = { BLUE: 2 }; }],
        [UNLIKELY_BOND, "no second", effect({ kind: "BOTTOM_DECK_UNIT", target: { relation: "CONTROLLED", readiness: "READY" } })],
        [UNLIKELY_BOND, "ready rival", effect({ kind: "BOTTOM_DECK_UNIT", target: { relation: "CONTROLLED", readiness: "READY" }, then: { relation: "RIVAL", readiness: "READY" } })],
        [UNLIKELY_BOND, "tags", d => { d.tags = ["Corpo"]; }],
        [UNLIKELY_BOND, "extra draw", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }]
    ];
    for (const [id, label, edit] of edits) assert.equal(supportsPlay(forge(card(id), edit), context).ok, false, `${id}: ${label}`);
});

test("Les Élémens offers only the Rival's tied lowest-power Units and its owner bottom-decks the choice face down", () => {
    const a = arrange(LES_E_LE_MENS, [{ power: 3, player: rival }, { power: 3, player: rival, spent: true }, { power: 5, player: rival }, { power: 0, player: actor }]);
    const played = playCard(a.state, context, LES_E_LE_MENS);
    assert.equal(played.state.timing.step, "TARGET_SELECTION");
    assert.equal(played.state.resolution.choice!.actorId, actor, "the Program's controller chooses among ties");
    assert.deepEqual(optionIds(played.state), [a.ids[0], a.ids[1]].sort(), "only the rival's lowest power, spent or ready");
    const forged = GameStateSchema.parse(played.state); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: a.ids[2] });
    assert.equal(validateState(forged, context).ok, false, "a higher-power Unit cannot be offered");
    const done = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === a.ids[1]).state;
    assert.deepEqual(zone(done, a.ids[1]), { playerId: rival, zone: "DECK" });
    assert.deepEqual(bottom(done, rival, 1), [a.ids[1]]);
    const moved = done.objects.cards[a.ids[1]];
    assert.deepEqual([moved.face, moved.readiness, moved.statuses], ["DOWN", "READY", []]);
    assert.deepEqual([a.ids[0], a.ids[2], a.ids[3]].map(id => zone(done, id).zone), ["BATTLEFIELD", "BATTLEFIELD", "BATTLEFIELD"]);
    assert.equal(done.resolution.choice, null);
    assert.equal(done.resolution.playContinuation, undefined);
});

test("a single lowest-power Unit is forced and takes its equipped Gear with it in a random order", () => {
    const a = arrange(LES_E_LE_MENS, [{ power: 3, player: rival, gear: true }, { power: 6, player: rival }]);
    const played = playCard(a.state, context, LES_E_LE_MENS), s = played.state;
    assert.equal(s.resolution.choice, null);
    assert.deepEqual([...bottom(s, rival, 2)].sort(), [a.ids[0], a.gears[0]].sort());
    assert.ok(s.rng.counter > a.state.rng.counter, "the Unit and its Gear are randomized together");
    assert.deepEqual(s.objects.cards[a.ids[0]].attachments, []);
    assert.ok(played.events.some(e => e.payload.kind === "GEAR_DETACHED" && e.payload.hostInstanceId === a.ids[0]));
    assert.equal(zone(s, a.ids[1]).zone, "BATTLEFIELD");
    const none = playCard(arrange(LES_E_LE_MENS, [{ power: 0, player: actor }]).state, context, LES_E_LE_MENS).state;
    assert.equal(none.resolution.choice, null, "no rival Unit, nothing happens");
});

test("Unlikely Bond bottom-decks a ready friendly Unit, then a spent rival Unit only if it did", () => {
    const a = arrange(UNLIKELY_BOND, [{ power: 3, player: actor }, { power: 4, player: actor }, { power: 0, player: actor, spent: true }, { power: 3, player: rival, spent: true }, { power: 5, player: rival, spent: true }, { power: 0, player: rival }]);
    const played = playCard(a.state, context, UNLIKELY_BOND);
    assert.deepEqual(optionIds(played.state), [a.ids[0], a.ids[1]].sort(), "only ready friendly Units");
    const first = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === a.ids[1]).state;
    assert.equal(first.resolution.playContinuation!.bottomDecked, a.ids[1]);
    assert.deepEqual(bottom(first, actor, 1), [a.ids[1]]);
    assert.deepEqual(optionIds(first), [a.ids[3], a.ids[4]].sort(), "then only spent rival Units");
    assert.notEqual(first.resolution.choice!.id, played.state.resolution.choice!.id);
    const dropped = GameStateSchema.parse(first); delete dropped.resolution.playContinuation!.bottomDecked;
    assert.equal(validateState(dropped, context).ok, false, "the second clause needs its bottom-decked first Unit");
    const back = GameStateSchema.parse(first); back.resolution.playContinuation!.bottomDecked = a.ids[0];
    assert.equal(validateState(back, context).ok, false, "the first Unit must be in its owner's deck");
    const done = pick(first, context, o => o.kind === "CARD" && o.cardInstanceId === a.ids[4]).state;
    assert.deepEqual(bottom(done, rival, 1), [a.ids[4]]);
    assert.deepEqual(a.ids.map(id => zone(done, id).zone), ["BATTLEFIELD", "DECK", "BATTLEFIELD", "BATTLEFIELD", "DECK", "BATTLEFIELD"]);
    assert.equal(done.resolution.choice, null);
    // No ready friendly Unit: nothing, not even the rival clause.
    const idle = arrange(UNLIKELY_BOND, [{ power: 0, player: actor, spent: true }, { power: 3, player: rival, spent: true }]);
    const skipped = playCard(idle.state, context, UNLIKELY_BOND).state;
    assert.equal(skipped.resolution.choice, null);
    assert.deepEqual(idle.ids.map(id => zone(skipped, id).zone), ["BATTLEFIELD", "BATTLEFIELD"]);
    // One of each is forced end to end; a friendly Unit alone is bottom-decked without a rival target.
    const forced = arrange(UNLIKELY_BOND, [{ power: 3, player: actor }, { power: 3, player: rival, spent: true }]);
    const both = playCard(forced.state, context, UNLIKELY_BOND).state;
    assert.equal(both.resolution.choice, null);
    assert.deepEqual(forced.ids.map(id => zone(both, id).zone), ["DECK", "DECK"]);
    const alone = arrange(UNLIKELY_BOND, [{ power: 3, player: actor }, { power: 3, player: rival }]);
    const one = playCard(alone.state, context, UNLIKELY_BOND).state;
    assert.deepEqual(alone.ids.map(id => zone(one, id).zone), ["DECK", "BATTLEFIELD"]);
    assert.equal(one.resolution.playContinuation, undefined);
});

test("the reviewed union admits the V15 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [LES_E_LE_MENS, UNLIKELY_BOND]) assert.ok(ids.has(id), id);
});
