import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { attachedGear } from "../packages/engine/src/attachments";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV92Cards, batchV92Context, batchV92Input, v92Source } from "./api-admission-batch-v92-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV92Context();
const [river] = batchV92Cards;
const ATLUS = "emergency-atlus", SQUAD = "psycho-squad", BLADES = "mantis-blades", KIROSHI = "kiroshi-optics", NETDRIVER = "netwatch-netdriver", RIPPLER = "tetratronic-rippler";
const JACKIE = "jackie-welles-pour-one-out-for-me"; // Vanilla power-4 and power-6 Units; cost-1 Gears (+2, +1); a cost-3 Gear; a blue cost-1 Gear; a first-blue-play Legend.
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function main(s: GameState): GameState {
    while (s.setup) s = choose(s, context, s.setup.stage === "FIRST_PLAYER" && s.timing.actingPlayer !== s.match.playerOrder[0] ? 1 : 0).state;
    while (s.timing.step !== "MAIN") s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return s;
}
const first = main(unwrap(createGameWithEvents(batchV92Input("batch-v92"), context)).state);
const base = fund(clearField(first, context), context), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
/** The Rival's first Main Phase, after the actor's empty turn, funded for both players. */
const rivalBase = (() => { let s = take(base, context, a => a.action.kind === "END_TURN").state; s = main(s); return fund(fund(s, context), context, actor); })();

type Unit = { card?: string; gears?: string[]; readiness?: "READY" | "SPENT" };
type Arrangement = { mine?: Unit[]; theirs?: Unit[]; hand?: string[]; jackie?: boolean; deck?: number };
/** Trusted arrangement on `from`'s Main: River Ward face up and ready as the owner's (`owner`, default the actor) last Legend, every other
 * Legend of the owner face down (Jackie Welles: Pour One Out for Me face up before it when `jackie`); the owner's Units `mine` and the other
 * player's Units `theirs` (with Gear); the owner's hand holding only `hand`; the owner's deck cut to its top `deck` cards. */
function arrange(from: GameState, a: Arrangement = {}, owner: PlayerId = actor) {
    const m = new TurnMutation(from, context), other = owner === actor ? rival : actor;
    for (const id of [...m.state.players[owner].zones.HAND]) moveCardLocation(m, id, "TRASH");
    const draw = (cardId: string, player: PlayerId) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    const put = (u: Unit, player: PlayerId) => {
        const host = draw(u.card ?? ATLUS, player); moveCardLocation(m, host.id, "BATTLEFIELD"); host.statuses = []; host.readiness = u.readiness ?? "READY";
        host.attachments = (u.gears ?? []).map(g => { const c = draw(g, player); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c.id; }).sort();
        return host.id;
    };
    const ids = { mine: (a.mine ?? []).map(u => put(u, owner)), theirs: (a.theirs ?? []).map(u => put(u, other)), hand: (a.hand ?? []).map(id => draw(id, owner).id) };
    if (a.deck !== undefined) for (const id of m.state.players[owner].zones.DECK.slice(a.deck)) moveCardLocation(m, id, "TRASH");
    const legends = m.state.players[owner].zones.LEGENDS;
    for (const id of legends) { const l = m.state.objects.cards[id]; if (l.face === "UP" && !l.attachments.length) l.face = "DOWN"; }
    const l = m.state.objects.cards[legends[legends.length - 1]];
    l.cardId = river.id; l.revision = river.revision; l.face = "UP"; l.readiness = "READY";
    let jackie: CardInstanceId | undefined;
    if (a.jackie) { const j = m.state.objects.cards[legends[legends.length - 2]], r = context.content.cards.find(x => x.id === JACKIE)!; j.cardId = r.id; j.revision = r.revision; j.face = "UP"; jackie = j.id; }
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), ...ids, river: l.id, jackie };
}
const isRiver = (id: CardInstanceId) => (a: { action: { kind: string; sourceInstanceId?: string } }) => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id;
const gearOn = (s: GameState, id: CardInstanceId) => attachedGear(s, id, context).map(g => g.id);
const spentEddies = (s: GameState, p: PlayerId) => s.players[p].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "SPENT").length;
const cardOptions = (s: GameState) => (s.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
function pickCard(r: Step, id: CardInstanceId): Step {
    assert.ok(validateState(r.state, context).ok);
    const next = pick(r.state, context, o => o.kind === "CARD" && o.cardInstanceId === id) as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
/** Takes the first option of every pending choice (passing an open React Step) until `done`; `target` is picked when offered. */
function settle(r: Step, done: (s: GameState) => boolean, target?: CardInstanceId): Step {
    const events = [...r.events]; let s = r.state;
    for (let n = 0; !done(s); n++) {
        assert.ok(n < 30, `stuck at ${s.timing.step}`);
        const next = s.timing.step === "RIVAL_REACT" && !s.resolution.choice ? take(s, context, x => x.action.kind === "PASS_REACT")
            : target && s.resolution.choice?.options.some(o => (o.kind === "CARD" && o.cardInstanceId === target) || (o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target))
                ? pick(s, context, o => (o.kind === "CARD" && o.cardInstanceId === target) || (o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target))
                : choose(s, context, 0);
        s = next.state; events.push(...(next.events as Events));
    }
    return { state: s, events };
}
const searching = (s: GameState) => s.resolution.current?.effect.kind === "SEARCH_TOP_TRASH_ONE" && Boolean(s.resolution.choice);

test("the V92 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(river.provenance.sourceHash, hashCanonical(v92Source(river.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === river.id), [river]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("River Ward: Detective on the Hunt passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsLegendSpendCard(river, context).ok);
    assert.ok(supportsTriggerCard(river, context).ok, "its defeat trigger routes to the Legend pin");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(river) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["main timing", d => { d.mechanics.abilities[0].activation!.timing = "MAIN"; }],
        ["paid", d => { d.mechanics.abilities[0].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }]; }],
        ["no defeat trigger", d => { d.mechanics.abilities = [d.mechanics.abilities[0]]; }],
        ["other guard", d => { d.mechanics.abilities[1].guard = "FIRST_ARASAKA_UNIT_DEFEAT_PER_TURN"; }],
        ["may trash", d => { d.mechanics.abilities[1].effects = [{ kind: "SEARCH_TOP_MAY_TRASH", count: 1 }]; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }]
    ];
    for (const [name, edit] of forgeries) assert.equal(supportsLegendSpendCard(forge(edit), context).ok, false, name);
});

test("in the Main Phase the controller chooses a hand Gear with cost 2 or less, then its host; it is played free and ready", () => {
    const a = arrange(base, { mine: [{ readiness: "SPENT" }], hand: [BLADES, KIROSHI, NETDRIVER] }), [atlus] = a.mine, [blades, kiroshi] = a.hand;
    const label = actions(a.state, context).find(x => isRiver(a.river)(x))?.descriptor.label;
    assert.equal(label, `Activate ${river.displayName}: Spend to play a Gear with cost 2 or less from your hand for free`);
    let r = take(a.state, context, isRiver(a.river)) as Step;
    assert.deepEqual(cardOptions(r.state), [blades, kiroshi].sort(), "the cost-3 Gear is not offered");
    assert.equal(r.state.objects.cards[a.river].readiness, "SPENT");
    r = pickCard(r, blades);
    assert.equal(r.state.resolution.playContinuation?.handGearId, blades);
    assert.deepEqual(cardOptions(r.state), [atlus, a.river].sort(), "a friendly Unit or face-up Legend");
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Equip ${context.content.cards.find(c => c.id === BLADES)!.displayName} to ${context.content.cards.find(c => c.id === ATLUS)!.displayName} (${atlus})`));
    r = pickCard(r, atlus);
    const s = r.state;
    assert.ok(validateState(s, context).ok);
    assert.deepEqual(gearOn(s, atlus), [blades]);
    assert.equal(s.objects.cards[blades].readiness, "READY"); assert.equal(s.objects.cards[blades].face, "UP");
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === blades));
    assert.ok(has(r.events, "GEAR_ATTACHED", p => p.gearInstanceId === blades && p.hostInstanceId === atlus));
    assert.equal(spentEddies(s, actor), 0, "played for free");
    assert.equal(effectivePower(s, atlus, context), 6);
    assert.ok(mainIdle(s));
    assert.equal(s.resolution.playContinuation, undefined);
});

test("a lone Gear with a lone host is played without a choice; with no eligible Gear nothing is played", () => {
    const a = arrange(base, { hand: [BLADES] }), [blades] = a.hand;
    const r = take(a.state, context, isRiver(a.river)) as Step;
    assert.ok(mainIdle(r.state));
    assert.deepEqual(gearOn(r.state, a.river), [blades], "River Ward is the only host");
    const b = arrange(base, { mine: [{}], hand: [NETDRIVER] });
    const n = take(b.state, context, isRiver(b.river)) as Step;
    assert.ok(mainIdle(n.state)); assert.equal(n.state.objects.cards[b.river].readiness, "SPENT");
    assert.ok(!has(n.events, "CARD_PLAYED"));
    assert.deepEqual(n.state.players[actor].zones.HAND, b.hand);
});

test("as a reaction to a rival attack, the Gear is played and the React Step reopens for its controller", () => {
    const a = arrange(rivalBase, { mine: [{ readiness: "READY" }], theirs: [{ card: SQUAD }], hand: [BLADES] }), [atlus] = a.mine, [squad] = a.theirs, [blades] = a.hand;
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === squad).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.timing.actingPlayer, actor);
    let r = take(s, context, isRiver(a.river)) as Step;
    r = pickCard(r, atlus);
    assert.deepEqual(gearOn(r.state, atlus), [blades]);
    assert.equal(r.state.timing.step, "RIVAL_REACT"); assert.equal(r.state.timing.actingPlayer, actor);
    assert.ok(validateState(r.state, context).ok);
    assert.ok(!actions(r.state, context).some(isRiver(a.river)), "River Ward is spent");
});

test("a blue Gear played in the React Step starts its own play batch; the React Step reopens after it", () => {
    const a = arrange(rivalBase, { theirs: [{ card: SQUAD }], hand: [RIPPLER], jackie: true }), [squad] = a.theirs, [rippler] = a.hand;
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === squad).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    let r = take(s, context, isRiver(a.river)) as Step;
    if (r.state.resolution.playContinuation?.handGearId) r = pickCard(r, a.river);
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === rippler));
    assert.ok(has(r.events, "EFFECT_PENDING", p => p.sourceId === a.jackie), "the first-blue-play observer triggers");
    assert.equal(r.state.resolution.triggerContinuation?.origin.kind, "PLAY");
    assert.equal(r.state.timing.combat.stage, "TRIGGER_RESOLUTION");
    r = settle(r, x => x.timing.step === "RIVAL_REACT" && !x.resolution.choice && !x.resolution.triggerContinuation);
    assert.equal(r.state.timing.actingPlayer, actor);
    assert.ok(validateState(r.state, context).ok);
});

test("a friendly equipped Unit's defeat searches the top 2 and trashes the chosen one; the other stays on top", () => {
    const a = arrange(base, { mine: [{ gears: [BLADES] }], theirs: [{ card: SQUAD, readiness: "SPENT" }] }), [atlus] = a.mine, [squad] = a.theirs;
    const [top, second] = a.state.players[actor].zones.DECK;
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === atlus) as Step;
    r = settle(r, x => searching(x) || mainIdle(x), squad);
    assert.ok(searching(r.state), "a 6-6 fight defeats both; River Ward's controller's Unit was equipped");
    assert.ok(validateState(r.state, context).ok);
    assert.deepEqual(cardOptions(r.state), [top, second]);
    assert.equal(r.state.resolution.current?.trigger?.subjectId, atlus);
    assert.deepEqual(r.state.turnHistory?.equippedDefeats, [atlus]);
    r = pickCard(r, second);
    r = settle(r, mainIdle);
    assert.equal(r.state.objects.cards[second].zone.zone, "TRASH");
    assert.equal(r.state.players[actor].zones.DECK[0], top);
});

test("no trigger for an unequipped friendly Unit, or for a rival's equipped Unit; one card left is trashed without a choice", () => {
    const a = arrange(base, { mine: [{ card: SQUAD }], theirs: [{ card: SQUAD, readiness: "SPENT", gears: [BLADES] }] }), [mine] = a.mine, [theirs] = a.theirs;
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === mine) as Step;
    r = settle(r, x => searching(x) || mainIdle(x), theirs);
    assert.ok(mainIdle(r.state)); assert.equal(r.state.objects.cards[mine].zone.zone, "TRASH");
    assert.ok(!has(r.events, "EFFECT_PENDING", p => p.sourceId === a.river));
    const b = arrange(base, { mine: [{ gears: [BLADES] }], theirs: [{ card: SQUAD, readiness: "SPENT" }], deck: 1 }), [atlus] = b.mine, [squad] = b.theirs, [only] = b.state.players[actor].zones.DECK;
    let q = take(b.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === atlus) as Step;
    q = settle(q, x => searching(x) || mainIdle(x), squad);
    assert.ok(mainIdle(q.state)); assert.equal(q.state.objects.cards[only].zone.zone, "TRASH"); assert.deepEqual(q.state.players[actor].zones.DECK, []);
    assert.ok(has(q.events, "EFFECT_RESOLVED", p => typeof p.effectId === "string") && has(q.events, "EFFECT_PENDING", p => p.sourceId === b.river));
});

test("forged states are rejected: a held Gear before its choice, a played Gear at a decision, a forged equipped-defeat history", () => {
    const a = arrange(base, { mine: [{ readiness: "SPENT" }], hand: [BLADES, KIROSHI] }), [blades] = a.hand;
    const r = pickCard(take(a.state, context, isRiver(a.river)) as Step, blades);
    assert.ok(validateState(r.state, context).ok);
    const played = GameStateSchema.parse(structuredClone(r.state)); played.resolution.playContinuation!.playedGearId = blades;
    assert.equal(validateState(played, context).ok, false);
    const lone = GameStateSchema.parse(structuredClone(take(a.state, context, isRiver(a.river)).state)); lone.resolution.playContinuation!.handGearId = a.hand[1];
    assert.equal(validateState(lone, context).ok, false, "a held Gear exists only after its choice");
    const history = GameStateSchema.parse(structuredClone(a.state)); history.turnHistory!.equippedDefeats = ["no-such-card" as CardInstanceId];
    assert.equal(validateState(history, context).ok, false);
});
