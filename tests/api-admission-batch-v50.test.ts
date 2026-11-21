import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV50Cards, batchV50Context, batchV50Input, v50Source, DRAGON } from "./api-admission-batch-v50-fixture";
import { batchV49Context } from "./api-admission-batch-v49-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV50Context();
const dragon = batchV50Cards[0];
// Vanilla Units: Psycho Squad (6, cost 4), Octant (8, cost 7), Jacked-in Voodoo Boy (2, cost 2); the Arasaka fixture Unit (6, cost 4).
const PSYCHO = "psycho-squad", OCTANT = "octant", VOODOO = "jacked-in-voodoo-boy", ARASAKA = "yorinobu-fixture-arasaka-unit", DELAMAIN = "delamain-rideshare-ai", SMASHER = "adam-smasher-metal-over-meat"; // Smasher: 15.
function setup(ctx = context): GameState {
    let state = unwrap(createGameWithEvents(batchV50Input("batch-v50"), ctx)).state;
    while (state.setup) state = choose(state, ctx, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, ctx, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, ctx), ctx), ctx, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
type Mutable = ReturnType<typeof GameStateSchema.parse>;

type Arrangement = { mine?: string[]; theirs?: string[]; hand?: string[]; trash?: string[]; spent?: string[] };
/** Trusted arrangement on the actor's MAIN: `mine` and `theirs` on the field (ready unless listed in `spent`), and extra actor hand
 * and trash cards. Every rewritten card is a fresh instance; `ids` maps each card id to its last instance. */
function arrange(a: Arrangement, ctx = context, from = base) {
    assert.equal(from.timing.activePlayer, actor);
    const m = new TurnMutation(from, ctx), ids: Record<string, CardInstanceId> = {};
    for (const p of [actor, rival]) for (const id of [...m.state.players[p].zones.TRASH]) assert.notEqual(ctx.content.cards.find(r => r.id === m.state.objects.cards[id].cardId)?.type, "UNIT");
    const gear = ctx.content.cards.find(r => r.id === "slice-card-4")!; // The starting hand becomes plain Gear, so only arranged Units are eligible.
    for (const id of m.state.players[actor].zones.HAND) { m.state.objects.cards[id].cardId = gear.id; m.state.objects.cards[id].revision = gear.revision; }
    const rewrite = (player: PlayerId, cardId: string, zone: "HAND" | "BATTLEFIELD" | "TRASH") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = ctx.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); if (zone !== "HAND") moveCardLocation(m, c.id, zone); c.statuses = [];
        if (zone === "BATTLEFIELD") c.readiness = a.spent?.includes(cardId) ? "SPENT" : "READY";
        ids[cardId] = c.id; return c.id;
    };
    for (const id of a.mine ?? []) rewrite(actor, id, "BATTLEFIELD");
    for (const id of a.theirs ?? []) rewrite(rival, id, "BATTLEFIELD");
    for (const id of a.hand ?? []) rewrite(actor, id, "HAND");
    for (const id of a.trash ?? []) rewrite(actor, id, "TRASH");
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), ctx)), ids };
}
function pay(s: GameState) {
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 12);
        const i = s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        s = choose(s, context, i >= 0 ? i : 0).state;
    }
    return s;
}
const playDragon = (s: GameState, id: CardInstanceId) => pay(take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id).state);
const options = (s: GameState) => s.resolution.choice?.options.map(o => o.kind === "CARD" ? o.cardInstanceId : o.kind === "CONFIRM" ? `confirm:${o.confirmed}` : o.kind) ?? [];
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const legal = (s: GameState) => unwrap(listLegalActions(s, s.timing.actingPlayer, context));
const hand = (s: GameState, p: PlayerId) => s.players[p].zones.HAND.length;
/** `attacker` attacks the rival's `target` Unit; the defender passes React; trigger choices take their first option. */
function fight(s: GameState, attacker: CardInstanceId, target: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target).state;
    const events = [];
    while (!(state.timing.step === "MAIN" && state.timing.combat.stage === "NONE")) {
        const r = state.timing.step === "RIVAL_REACT" ? take(state, context, a => a.action.kind === "PASS_REACT") : choose(state, context, 0);
        state = r.state; events.push(...r.events);
    }
    return { state, events };
}
const drew = (events: { payload: { kind: string } }[], source: CardInstanceId) => events.some(e => e.payload.kind === "EFFECT_PENDING" && (e.payload as { sourceId?: string }).sourceId === source);

test("the V50 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(dragon.provenance.sourceHash, hashCanonical(v50Source(dragon.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === dragon.id), [dragon]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Yorinobu passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard]) assert.ok(gate(dragon, context).ok);
    for (const gate of [supportsCall, supportsFieldLegend]) assert.equal(gate(dragon, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(dragon) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const play = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as Extract<CardRevisionSnapshot["mechanics"]["abilities"][number]["effects"][number], { kind: "PLAY_UNIT_FREE" }>;
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["mandatory", d => { delete play(d).optional; }],
        ["trash only", d => { play(d).from = "TRASH"; }],
        ["cost 9", d => { play(d).maxCost = 9; }],
        ["no grant", d => { delete play(d).grant; }],
        ["bottom-deck", d => { play(d).then = "BOTTOM_DECK_SUBJECT"; }],
        ["any defeat", d => { delete d.mechanics.abilities[1].guard; }],
        ["draw 2", d => { d.mechanics.abilities[1].effects = [{ kind: "DRAW", count: 2 }]; }],
        ["no draw ability", d => { d.mechanics.abilities.pop(); }],
        ["power", d => { d.power = 8; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 6 }; }],
        ["tags", d => { d.tags = ["Arasaka"]; }],
        ["Blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("{Play}: the controller may play a cost-4-or-less Unit from hand or trash; it can attack only rival Units this turn", () => {
    const a = arrange({ theirs: [OCTANT], hand: [DRAGON, VOODOO, OCTANT], trash: [PSYCHO, ARASAKA], spent: [OCTANT] });
    const yorinobu = a.ids[DRAGON], voodoo = a.ids[VOODOO], psycho = a.ids[PSYCHO], arasaka = a.ids[ARASAKA];
    const s = playDragon(a.state, yorinobu);
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(new Set(options(s)), new Set(["confirm:false", voodoo, psycho, arasaka]), "Octant costs 7; Yorinobu is on the field");
    assert.ok(validateState(s, context).ok);
    const forged = GameStateSchema.parse(structuredClone(s)) as Mutable; forged.resolution.choice!.options.shift(); assert.equal(validateState(forged, context).ok, false);
    const fromTrash = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === psycho).state, p = fromTrash.objects.cards[psycho];
    assert.equal(p.zone.zone, "BATTLEFIELD"); assert.equal(p.readiness, "READY"); assert.ok(p.statuses.includes("LAG"));
    assert.deepEqual(fromTrash.turnHistory?.rivalUnitAttackGrants, [psycho]);
    const attack = legal(fromTrash).find(x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === psycho);
    assert.ok(attack, "lagging, but it can attack rival Units this turn");
    assert.equal(legal(fromTrash).some(x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === yorinobu), false, "Yorinobu itself lags without the grant");
    const declared = take(fromTrash, context, x => x === attack || (x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === psycho)).state;
    assert.ok(declared.timing.step === "RIVAL_REACT" || declared.resolution.choice?.options.every(o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD"), "never the Gig area");
    const fromHand = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === voodoo).state;
    assert.equal(zone(fromHand, voodoo), "BATTLEFIELD"); assert.equal(fromHand.objects.cards[voodoo].face, "UP");
    let next = end(fromTrash, context).state;
    while (next.timing.activePlayer !== rival || next.timing.step !== "MAIN") next = take(next, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    assert.equal(next.turnHistory?.rivalUnitAttackGrants, undefined, "this turn only");
});

test("the controller may decline; with nothing eligible there is no choice; a played Unit's {Play} joins the batch", () => {
    const a = arrange({ hand: [DRAGON], trash: [PSYCHO] });
    const declined = pick(playDragon(a.state, a.ids[DRAGON]), context, o => o.kind === "CONFIRM").state;
    assert.equal(zone(declined, a.ids[PSYCHO]), "TRASH"); assert.equal(declined.timing.step, "MAIN"); assert.equal(declined.turnHistory?.rivalUnitAttackGrants, undefined);
    const none = arrange({ hand: [DRAGON, OCTANT] }), n = playDragon(none.state, none.ids[DRAGON]);
    assert.equal(n.timing.step, "MAIN"); assert.equal(zone(n, none.ids[DRAGON]), "BATTLEFIELD");
    const d = arrange({ hand: [DRAGON], trash: [DELAMAIN] }), before = hand(d.state, actor) - 1;
    const played = pick(playDragon(d.state, d.ids[DRAGON]), context, o => o.kind === "CARD" && o.cardInstanceId === d.ids[DELAMAIN]).state;
    let s = played; while (s.resolution.choice) s = choose(s, context, 0).state;
    assert.equal(zone(s, d.ids[DELAMAIN]), "BATTLEFIELD"); assert.equal(hand(s, actor), before + 2, "Delamain's {Play} draw 2 resolved in Yorinobu's batch");
});

test("the turn's first ARASAKA Unit defeat draws 1, for either player's Unit; a second one does not", () => {
    const a = arrange({ mine: [DRAGON, ARASAKA, PSYCHO], theirs: [OCTANT, ARASAKA], spent: [OCTANT] });
    const mine = Object.values(a.state.objects.cards).find(c => c.cardId === ARASAKA && c.controllerId === actor)!.id, before = hand(a.state, actor);
    const lost = fight(a.state, mine, a.ids[OCTANT]);
    assert.equal(zone(lost.state, mine), "TRASH"); assert.equal(lost.state.turnHistory?.firstArasakaDefeat, mine);
    assert.ok(drew(lost.events, a.ids[DRAGON])); assert.equal(hand(lost.state, actor), before + 1);
    const theirs = Object.values(lost.state.objects.cards).find(c => c.cardId === ARASAKA && c.controllerId === rival)!.id;
    const m = new TurnMutation(lost.state, context); m.state.objects.cards[theirs].readiness = "SPENT";
    const second = fight(unwrap(validateState(m.state, context)), a.ids[PSYCHO], theirs);
    assert.equal(zone(second.state, theirs), "TRASH", "the rival's Arasaka Unit was defeated, but it is not the turn's first");
    assert.equal(drew(second.events, a.ids[DRAGON]), false); assert.equal(hand(second.state, actor), before + 1);
});

test("a rival's ARASAKA Unit defeated first draws for Yorinobu's controller; Yorinobu defeated first still draws", () => {
    const a = arrange({ mine: [DRAGON, OCTANT], theirs: [ARASAKA], spent: [ARASAKA] }), before = hand(a.state, actor);
    const won = fight(a.state, a.ids[OCTANT], a.ids[ARASAKA]);
    assert.equal(zone(won.state, a.ids[ARASAKA]), "TRASH"); assert.equal(won.state.turnHistory?.firstArasakaDefeat, a.ids[ARASAKA]);
    assert.equal(hand(won.state, actor), before + 1);
    const b = arrange({ mine: [DRAGON], theirs: [SMASHER], spent: [DRAGON] }), y = b.ids[DRAGON];
    let s = b.state;
    s = end(s, context).state;
    while (s.timing.activePlayer !== rival || s.timing.step !== "MAIN") s = take(s, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    const h = hand(s, actor), lost = fight(s, b.ids[SMASHER], y);
    assert.equal(zone(lost.state, y), "TRASH"); assert.equal(lost.state.turnHistory?.firstArasakaDefeat, y);
    assert.equal(hand(lost.state, actor), h + 1, "the defeated Yorinobu saw its own defeat (captured before it moved)");
});

test("non-ARASAKA defeats are not recorded; the history and grants exist only with their reviewed reader and are checked", () => {
    const a = arrange({ mine: [DRAGON, OCTANT], theirs: [PSYCHO], spent: [PSYCHO] }), won = fight(a.state, a.ids[OCTANT], a.ids[PSYCHO]);
    assert.equal(zone(won.state, a.ids[PSYCHO]), "TRASH"); assert.equal(won.state.turnHistory?.firstArasakaDefeat, undefined);
    for (const edit of [(f: Mutable) => { f.turnHistory!.firstArasakaDefeat = a.ids[PSYCHO]; }, (f: Mutable) => { f.turnHistory!.rivalUnitAttackGrants = [a.ids[OCTANT], a.ids[OCTANT]]; }]) {
        const bad = GameStateSchema.parse(structuredClone(won.state)) as Mutable; edit(bad); assert.equal(validateState(bad, context).ok, false);
    }
    const old = batchV49Context(), o = arrange({ mine: [ARASAKA], theirs: [OCTANT], spent: [OCTANT] }, old, setup(old));
    let s = take(o.state, old, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === o.ids[ARASAKA]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, old, x => x.kind === "ATTACK_TARGET" && x.target.kind === "CARD").state;
    while (!(s.timing.step === "MAIN" && s.timing.combat.stage === "NONE")) s = s.timing.step === "RIVAL_REACT" ? take(s, old, x => x.action.kind === "PASS_REACT").state : choose(s, old, 0).state;
    assert.equal(zone(s, o.ids[ARASAKA]), "TRASH"); assert.equal(s.turnHistory?.firstArasakaDefeat, undefined);
    const forged = GameStateSchema.parse(structuredClone(s)) as Mutable; forged.turnHistory!.firstArasakaDefeat = o.ids[ARASAKA];
    assert.equal(validateState(forged, old).ok, false);
});

test("the reviewed union contains Yorinobu Arasaka: Steel Dragon", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === DRAGON));
});
