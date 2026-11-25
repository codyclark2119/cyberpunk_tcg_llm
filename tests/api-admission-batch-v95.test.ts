import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, observe, validateState } from "@tcg/engine";
import { supportsQuickActivationCard } from "../packages/engine/src/quick-activation-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV95Cards, batchV95Context, batchV95Input, v95Source } from "./api-admission-batch-v95-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV95Context();
const [judy] = batchV95Cards;
const OCTANT = "octant", BLADES = "mantis-blades", FOOL = "fool-on-the-hill"; // A vanilla Unit, a Gear, a Program that pauses for the Rival.
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV95Input("batch-v95"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: Judy ready on the actor's field; `top` (a card id) as the top card of the deck, or an empty
 * deck with `top` null; `eddies` ready Eddies, the rest spent, and every Legend spent. */
function arrange(top: string | null, eddies = 3) {
    const m = new TurnMutation(base, context), z = m.state.players[actor].zones;
    const j = m.state.objects.cards[z.DECK[z.DECK.length - 1]];
    j.cardId = judy.id; j.revision = judy.revision; moveCardLocation(m, j.id, "HAND"); moveCardLocation(m, j.id, "BATTLEFIELD"); j.statuses = []; j.readiness = "READY";
    if (top === null) for (const id of [...z.DECK]) moveCardLocation(m, id, "REMOVED");
    else { const c = m.state.objects.cards[z.DECK[0]], r = context.content.cards.find(x => x.id === top)!; c.cardId = r.id; c.revision = r.revision; }
    z.EDDIES.forEach((id, i) => { m.state.objects.cards[id].readiness = i < eddies ? "READY" : "SPENT"; });
    for (const id of z.LEGENDS) m.state.objects.cards[id].readiness = "SPENT";
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), judy: j.id, top: top === null ? undefined : z.DECK[0] };
}
const isJudy = (id: CardInstanceId) => (a: { action: { kind: string; sourceInstanceId?: string } }) => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id;
const readyEddies = (s: GameState) => s.players[actor].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "READY").length;
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
const name = (cardId: string) => context.content.cards.find(c => c.id === cardId)!.displayName;
/** Activates Judy, paying with the first Eddie offered when a payment choice pauses. */
function activate(s: GameState, id: CardInstanceId): Step {
    const r = take(s, context, isJudy(id)) as Step;
    if (r.state.resolution.choice?.kind !== "PAYMENT") return r;
    const next = pick(r.state, context, o => o.kind === "PAYMENT" && o.source.kind === "EDDIE") as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}
function then(r: Step, f: (o: { kind: string; confirmed?: boolean; cardInstanceId?: string }) => boolean): Step {
    assert.ok(validateState(r.state, context).ok);
    const next = pick(r.state, context, f) as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}

test("the V95 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(judy.provenance.sourceHash, hashCanonical(v95Source(judy.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === judy.id), [judy]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Judy Álvarez: Nothing to Doubt passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsQuickActivationCard(judy, context).ok);
    assert.ok(supportsPlay(judy, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(judy) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["cost 2", d => { d.mechanics.abilities[0].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 2 } }, { kind: "SPEND_SOURCE" }]; }],
        ["Quick", d => { d.mechanics.abilities[0].activation!.timing = "QUICK"; }],
        ["power", d => { d.power = 7; }],
        ["sellable", d => { d.sellProfile.allowed = true; }],
        ["tags", d => { d.tags = ["Ganger"]; }]
    ];
    for (const [label, edit] of forgeries) {
        assert.equal(supportsQuickActivationCard(forge(edit), context).ok, false, label);
        assert.equal(supportsPlay(forge(edit), context).ok, false, label);
    }
});

test("a revealed Unit is played for free: it enters the field ready and lagging, and only the activation's 1 is paid", () => {
    const a = arrange(OCTANT, 2), top = a.top!;
    assert.equal(actions(a.state, context).find(x => isJudy(a.judy)(x))?.descriptor.label, `Activate ${judy.displayName}: Pay 1 and spend to reveal the top card of your deck, then play it for free or add it to your hand`);
    let r = activate(a.state, a.judy);
    assert.ok(has(r.events, "CARD_REVEALED", p => p.cardInstanceId === top));
    assert.equal(r.state.resolution.choice?.actorId, actor);
    assert.deepEqual(actions(r.state, context).map(x => x.descriptor.label).sort(), [`Add ${name(OCTANT)} (${top}) to your hand`, `Play ${name(OCTANT)} (${top}) for free`].sort());
    const seen = unwrap(observe(r.state, rival, context));
    assert.deepEqual(seen.inspectedCards?.map(c => c.instanceId), [top], "a revealed card is public to the Rival");
    const forged = GameStateSchema.parse(structuredClone(r.state)); forged.resolution.playContinuation!.deckPlayId = top;
    assert.equal(validateState(forged, context).ok, false, "a chosen top card never waits at a decision");
    r = then(r, o => o.kind === "CONFIRM" && o.confirmed === true);
    assert.ok(mainIdle(r.state));
    const card = r.state.objects.cards[top];
    assert.equal(card.zone.zone, "BATTLEFIELD"); assert.equal(card.readiness, "READY"); assert.ok(card.statuses.includes("LAG"));
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === top));
    assert.equal(readyEddies(r.state), 1, "the Unit's own cost was not paid");
    assert.equal(r.state.objects.cards[a.judy].readiness, "SPENT");
    assert.equal(r.state.resolution.playContinuation, undefined);
    assert.ok(validateState(r.state, context).ok);
});

test("declining adds the revealed card to hand; an empty deck reveals nothing", () => {
    const a = arrange(OCTANT), top = a.top!;
    const r = then(activate(a.state, a.judy), o => o.kind === "CONFIRM" && o.confirmed === false);
    assert.ok(mainIdle(r.state));
    assert.equal(r.state.objects.cards[top].zone.zone, "HAND"); assert.equal(r.state.objects.cards[top].face, "DOWN");
    assert.ok(!has(r.events, "CARD_PLAYED"));
    const b = arrange(null), n = activate(b.state, b.judy);
    assert.ok(mainIdle(n.state)); assert.ok(!has(n.events, "CARD_REVEALED"));
    assert.equal(n.state.objects.cards[b.judy].readiness, "SPENT"); assert.equal(readyEddies(n.state), 2);
});

test("a revealed Gear is played for free onto a chosen host; its play follows the ability", () => {
    const a = arrange(BLADES), top = a.top!;
    let r = activate(a.state, a.judy);
    const hosts = (r.state.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
    assert.ok(hosts.includes(a.judy));
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Play ${name(BLADES)} (${top}) for free, equipped to ${judy.displayName} (${a.judy})`));
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Add ${name(BLADES)} (${top}) to your hand`));
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === a.judy);
    assert.ok(mainIdle(r.state));
    assert.ok(r.state.objects.cards[a.judy].attachments.includes(top));
    assert.equal(r.state.objects.cards[top].readiness, "READY");
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === top));
    assert.ok(has(r.events, "GEAR_ATTACHED", p => p.gearInstanceId === top));
    assert.equal(readyEddies(r.state), 2);
    assert.ok(validateState(r.state, context).ok);
});

test("a revealed Program is played for free after the ability and resolves as a played Program, then goes to the trash", () => {
    const a = arrange(FOOL), top = a.top!, before = a.state.turnHistory?.programPlays?.[actor];
    let r = activate(a.state, a.judy);
    r = then(r, o => o.kind === "CONFIRM" && o.confirmed === true);
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === top));
    if (before !== undefined) assert.equal(r.state.turnHistory?.programPlays?.[actor], before + 1);
    assert.equal(r.state.resolution.current?.effect.kind, "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH", "Fool on the Hill pauses for the Rival's choice");
    assert.equal(r.state.resolution.playContinuation?.freeFromDeck, true);
    assert.equal(r.state.objects.cards[top].zone.zone, "RESOLVING_PROGRAM");
    assert.equal(readyEddies(r.state), 2, "the Program's own cost was not paid");
    assert.ok(validateState(r.state, context).ok);
    const unflagged = GameStateSchema.parse(structuredClone(r.state)); delete unflagged.resolution.playContinuation!.freeFromDeck;
    assert.equal(validateState(unflagged, context).ok, false, "an unpaid Program needs its free play");
    const done = choose(r.state, context, 0);
    assert.ok(mainIdle(done.state));
    assert.equal(done.state.objects.cards[top].zone.zone, "TRASH");
});
