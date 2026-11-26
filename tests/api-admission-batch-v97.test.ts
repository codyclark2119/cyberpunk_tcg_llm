import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsFreePlayCard } from "../packages/engine/src/free-play-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV97Cards, batchV97Context, batchV97Input, v97Source } from "./api-admission-batch-v97-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV97Context();
const [lizzy] = batchV97Cards;
const FLOOR = "floor-it", FOOL = "fool-on-the-hill", RELAPSE = "memory-relapse"; // Programs of cost 1, 2 (pauses for the Rival's choice) and 4.
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV97Input("batch-v97"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer;

/** Trusted arrangement on the actor's MAIN: Lizzy and `hand` Programs as the whole hand, `trash` Programs in the trash (and nothing else
 * there), every Legend spent. */
function arrange(hand: string[], trash: string[]) {
    const m = new TurnMutation(base, context), z = m.state.players[actor].zones;
    for (const id of [...z.TRASH, ...z.HAND]) moveCardLocation(m, id, "REMOVED");
    for (const id of z.LEGENDS) m.state.objects.cards[id].readiness = "SPENT";
    const put = (cardId: string, zone: "HAND" | "TRASH") => { const c = m.state.objects.cards[z.DECK[z.DECK.length - 1]], r = context.content.cards.find(x => x.id === cardId)!; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, zone); return c.id; };
    const l = put(lizzy.id, "HAND"), inHand = hand.map(id => put(id, "HAND")), inTrash = trash.map(id => put(id, "TRASH"));
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), lizzy: l, hand: inHand, trash: inTrash };
}
const cardOptions = (s: GameState) => (s.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
const name = (cardId: string) => context.content.cards.find(c => c.id === cardId)!.displayName;
const readyEddies = (s: GameState) => s.players[actor].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "READY").length;
function then(r: Step, f: (o: { kind: string; confirmed?: boolean; cardInstanceId?: string }) => boolean): Step {
    assert.ok(validateState(r.state, context).ok);
    const next = pick(r.state, context, f) as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}
/** Plays Lizzy and orders her {Play} trigger first if a batch asks for an order. */
function playLizzy(s: GameState): Step {
    let r = playCard(s, context, lizzy.id) as Step;
    for (let n = 0; r.state.resolution.triggerContinuation?.phase === "SELECT"; n++) { assert.ok(n < 5); r = then(r, o => o.kind === "EFFECT"); }
    return r;
}
function settle(r: Step): Step {
    let s = r.state; const events = [...r.events];
    for (let n = 0; !mainIdle(s); n++) { assert.ok(n < 10); assert.ok(validateState(s, context).ok); const next = choose(s, context, 0); s = next.state; events.push(...(next.events as Events)); }
    return { state: s, events };
}
const bottom = (s: GameState) => s.players[actor].zones.DECK[s.players[actor].zones.DECK.length - 1];

test("the V97 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(lizzy.provenance.sourceHash, hashCanonical(v97Source(lizzy.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === lizzy.id), [lizzy]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Lizzy Wizzy: Delicate Weapon passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsFreePlayCard(lizzy, context).ok);
    assert.ok(supportsPlay(lizzy, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(lizzy) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no Blocker", d => { d.mechanics.keywords = []; }],
        ["power", d => { d.power = 3; }],
        ["tags", d => { d.tags = ["Rocker", "Mox"]; }],
        ["sellable", d => { d.sellProfile.allowed = true; }],
        ["trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_DEFEATED"; }]
    ];
    for (const [label, edit] of forgeries) {
        assert.equal(supportsFreePlayCard(forge(edit), context).ok, false, label);
        assert.equal(supportsPlay(forge(edit), context).ok, false, label);
    }
});

test("a hand Program is chosen in the {Play} trigger, played for free once the batch is done, then bottom-decked", () => {
    const a = arrange([FOOL, RELAPSE], []), [fool, relapse] = a.hand, before = a.state.turnHistory?.programPlays?.[actor];
    let r = playLizzy(a.state);
    const paid = readyEddies(r.state);
    assert.deepEqual(cardOptions(r.state), [fool], "the cost-4 Program is not offered");
    assert.ok(!cardOptions(r.state).includes(relapse));
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Play ${name(FOOL)} (${fool}) from your hand for free, then bottom-deck it`));
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === "Play no Program"));
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === fool);
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === fool));
    assert.equal(r.state.resolution.triggerContinuation, undefined, "the Program is played after the batch");
    assert.equal(r.state.resolution.current?.effect.kind, "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH", "Fool on the Hill pauses for the Rival's choice");
    assert.equal(r.state.resolution.playContinuation?.freeBottomDeck, true);
    assert.equal(r.state.turnHistory?.queuedProgramPlay?.started, true);
    assert.equal(readyEddies(r.state), paid, "the Program's own cost was not paid");
    if (before !== undefined) assert.equal(r.state.turnHistory?.programPlays?.[actor], before + 1);
    assert.ok(validateState(r.state, context).ok);
    const unflagged = GameStateSchema.parse(structuredClone(r.state)); delete unflagged.resolution.playContinuation!.freeBottomDeck;
    assert.equal(validateState(unflagged, context).ok, false, "an unpaid Program needs its free play");
    const unqueued = GameStateSchema.parse(structuredClone(r.state)); delete unqueued.turnHistory!.queuedProgramPlay;
    assert.equal(validateState(unqueued, context).ok, false, "a free bottom-decked Program is the queued play");
    const done = settle(r);
    assert.equal(bottom(done.state), fool, "bottom-decked, not trashed");
    assert.equal(done.state.turnHistory?.queuedProgramPlay, undefined);
    assert.equal(done.state.objects.cards[a.lizzy].zone.zone, "BATTLEFIELD");
    assert.ok(validateState(done.state, context).ok);
});

test("a trash Program is played for free the same way", () => {
    const a = arrange([], [FLOOR]), [floor] = a.trash;
    let r = playLizzy(a.state);
    assert.deepEqual(cardOptions(r.state), [floor]);
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Play ${name(FLOOR)} (${floor}) from your trash for free, then bottom-deck it`));
    r = settle(then(r, o => o.kind === "CARD" && o.cardInstanceId === floor));
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === floor));
    assert.ok(!has(r.events, "CARD_REVEALED", p => p.cardInstanceId === floor), "a trash card is already public");
    assert.equal(bottom(r.state), floor);
    assert.ok(validateState(r.state, context).ok);
});

test("the play may be declined; with no eligible Program nothing is offered", () => {
    const a = arrange([FOOL], []), [fool] = a.hand;
    const r = settle(then(playLizzy(a.state), o => o.kind === "CONFIRM" && o.confirmed === false));
    assert.equal(r.state.objects.cards[fool].zone.zone, "HAND"); assert.ok(!has(r.events, "CARD_PLAYED", p => p.cardInstanceId === fool));
    assert.equal(r.state.turnHistory?.queuedProgramPlay, undefined);
    const b = arrange([RELAPSE], []), n = playLizzy(b.state);
    assert.ok(mainIdle(n.state)); assert.equal(n.state.objects.cards[b.lizzy].zone.zone, "BATTLEFIELD");
});

test("Lizzy keeps Blocker and enters the field with no Program to play", () => {
    assert.deepEqual(lizzy.mechanics.keywords, ["BLOCKER"]);
    const a = arrange([], []), r = settle(playLizzy(a.state));
    assert.ok(validateState(r.state, context).ok);
    assert.equal(r.state.objects.cards[a.lizzy].zone.zone, "BATTLEFIELD");
});
