import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsGear } from "../packages/engine/src/attachments";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV48Cards, batchV48Context, batchV48Input, v48Source, RELIC } from "./api-admission-batch-v48-fixture";
import { APPETITE } from "./api-admission-batch-v47-fixture";
import { SAFETY } from "./api-admission-batch-v46-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV48Context();
const relic = batchV48Cards[0];
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad", ANIMALS = "octant", DELAMAIN = "delamain-rideshare-ai", SMASHER = "adam-smasher-metal-over-meat";
const JACKIE = "jackie-welles-pour-one-out-for-me", V = "v-roamer-of-the-badlands", MISTY = "misty-olszewski-mender-of-broken-spirits"; // ATLUS 4, PSYCHO 6, OCTANT 8, V 6, MISTY 0.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV48Input("batch-v48"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { host: string; rivalUnit: string; trash: string[]; hostReady: boolean; legend?: string; hand?: string[]; rivalHand?: string[] };
/** Trusted arrangement: the actor's `host` on the field with The Relic attached (ready to attack, or spent to be attacked), the
 * rival's `rivalUnit` on the field (spent to be attacked, or ready to attack), each `trash` Unit in the actor's trash (a copy of
 * the host card among them is a different card), an optional face-up actor Legend and extra actor hand cards. */
function arrange(a: Arrangement) {
    const m = new TurnMutation(base, context);
    for (const p of [actor, rival]) for (const id of [...m.state.players[p].zones.TRASH]) assert.notEqual(context.content.cards.find(r => r.id === m.state.objects.cards[id].cardId)?.type, "UNIT");
    const rewrite = (player: PlayerId, cardId: string, zone: "HAND" | "BATTLEFIELD" | "TRASH") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); if (zone !== "HAND") moveCardLocation(m, c.id, zone); c.statuses = []; return c;
    };
    const host = rewrite(actor, a.host, "BATTLEFIELD"), gear = rewrite(actor, RELIC, "BATTLEFIELD"), other = rewrite(rival, a.rivalUnit, "BATTLEFIELD");
    host.attachments = [gear.id]; host.readiness = a.hostReady ? "READY" : "SPENT"; gear.readiness = "READY"; other.readiness = a.hostReady ? "SPENT" : "READY";
    const trash = a.trash.map(id => rewrite(actor, id, "TRASH").id);
    for (const id of a.hand ?? []) rewrite(actor, id, "HAND");
    for (const id of a.rivalHand ?? []) rewrite(rival, id, "HAND");
    if (a.rivalHand) for (const c of Object.values(m.state.objects.cards).filter(c => c.controllerId === rival && c.zone.zone === "DECK" && c.cardId.startsWith("slice-card-")).slice(0, 2)) {
        m.state.players[rival].zones.DECK = m.state.players[rival].zones.DECK.filter(id => id !== c.id);
        m.state.players[rival].zones.EDDIES.push(c.id); c.zone = { playerId: rival, zone: "EDDIES" }; c.face = "DOWN"; c.readiness = "READY";
    }
    if (a.legend) {
        const slot = m.state.players[actor].zones.LEGENDS[0], c = m.state.objects.cards[slot], r = context.content.cards.find(x => x.id === a.legend)!;
        c.cardId = r.id; c.revision = r.revision; c.face = "UP"; c.readiness = "READY";
    }
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), host: host.id, gear: gear.id, other: other.id, trash };
}
/** Drives to the end of the attack: the defending player passes its React Step, `choice` picks an option when it returns one. */
function finish(s: GameState, choice: (s: GameState) => number | undefined = () => undefined) {
    let state = s; const events = [], choices: string[] = [];
    while (!(state.timing.step === "MAIN" && state.timing.combat.stage === "NONE")) {
        if (state.timing.step === "RIVAL_REACT") { const r = take(state, context, a => a.action.kind === "PASS_REACT"); state = r.state; events.push(...r.events); continue; }
        choices.push(state.timing.step!);
        const r = choose(state, context, choice(state) ?? 0); state = r.state; events.push(...r.events);
    }
    return { state, events, choices };
}
function attack(s: GameState, attacker: CardInstanceId, target: CardInstanceId) {
    const state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    return state.timing.step === "ATTACK_TARGET_SELECTION" ? pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target).state : state;
}
/** The actor's own attack: its host attacks the rival's spent Unit and loses. */
const ownAttack = (a: ReturnType<typeof arrange>, choice?: (s: GameState) => number | undefined) => finish(attack(a.state, a.host, a.other), choice);
/** The rival's attack on the actor's spent host, on the rival's next turn. */
function rivalAttack(a: ReturnType<typeof arrange>, choice?: (s: GameState) => number | undefined) {
    let state = end(a.state, context).state;
    while (!(state.timing.step === "MAIN" && state.timing.activePlayer === rival)) state = take(state, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    return finish(attack(state, a.other, a.host), choice);
}
const cardChoice = (id: CardInstanceId) => (s: GameState) => { const i = s.resolution.choice?.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === id) ?? -1; return i >= 0 ? i : undefined; };
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);
const at = (events: { payload: { kind: string; cardInstanceId?: string } }[], kind: string, id: string) => events.findIndex(e => e.payload.kind === kind && e.payload.cardInstanceId === id);

test("the V48 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(relic.provenance.sourceHash, hashCanonical(v48Source(relic.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === relic.id), [relic]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("The Relic passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsGear]) assert.ok(gate(relic, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(relic) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["not inherited", d => { delete d.mechanics.abilities[0].inherited; }],
        ["on play", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["no power grant", d => { d.mechanics.modifiers = []; }],
        ["power", d => { d.power = 4; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["tags", d => { d.tags = ["Arasaka", "Cyberdeck"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsGear]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("its host loses a fight: the controller plays another trash Unit for free, which brings its {Play}; then the host is bottom-decked", () => {
    const a = arrange({ host: ATLUS, rivalUnit: ANIMALS, trash: [PSYCHO, DELAMAIN, ATLUS], hostReady: true }), [psycho, delamain, atlusCopy] = a.trash;
    const hand = a.state.players[actor].zones.HAND.length;
    const done = ownAttack(a, s => s.resolution.choice?.options.some(o => o.kind === "CARD" && o.cardInstanceId === delamain) ? cardChoice(delamain)(s) : undefined);
    assert.ok(done.choices.includes("TARGET_SELECTION"));
    const offered = done.events.find(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === delamain);
    assert.ok(offered && offered.payload.kind === "CARD_TARGET_SELECTED" && !offered.payload.forced, "a strategic choice among the trash Units");
    const s = done.state, d = s.objects.cards[delamain];
    assert.equal(d.zone.zone, "BATTLEFIELD"); assert.equal(d.readiness, "READY"); assert.ok(d.statuses.includes("LAG"), "played this turn");
    assert.equal(zone(s, psycho), "TRASH"); assert.equal(zone(s, atlusCopy), "TRASH", "another copy of the host's card is a different card");
    assert.equal(zone(s, a.host), "DECK"); assert.equal(s.players[actor].zones.DECK.at(0) === a.host || s.players[actor].zones.DECK.at(-1) === a.host, true);
    assert.equal(zone(s, a.gear), "TRASH", "the Gear stays in the trash (11.23.3)");
    assert.equal(s.players[actor].zones.HAND.length, hand + 2, "Delamain's {Play} draw 2 joined the batch and resolved");
    assert.ok(at(done.events, "CARD_DEFEATED", a.host) < at(done.events, "CARD_PLAYED", delamain));
    assert.ok(kinds(done.events).includes("QUALIFYING_PLAY_RECORDED"), "a blue Unit play counts toward the first-blue-play history");
    assert.equal(s.turnHistory?.blueUnitOrGearPlays[actor], 1);
});

test("one trash Unit is played without a choice; with none only the host is bottom-decked; the host itself is never played", () => {
    const one = arrange({ host: ATLUS, rivalUnit: ANIMALS, trash: [PSYCHO], hostReady: true }), o = ownAttack(one);
    assert.equal(zone(o.state, one.trash[0]), "BATTLEFIELD"); assert.equal(o.choices.includes("TARGET_SELECTION"), false);
    const none = arrange({ host: ATLUS, rivalUnit: ANIMALS, trash: [], hostReady: true }), n = ownAttack(none);
    assert.equal(zone(n.state, none.host), "DECK"); assert.equal(kinds(n.events).includes("CARD_PLAYED"), false);
});

test("on the rival's turn the defending controller plays the Unit, and its {Play} defeat resolves inside the attack's batch", () => {
    const a = arrange({ host: ATLUS, rivalUnit: ANIMALS, trash: [SMASHER], hostReady: false }), smasher = a.trash[0];
    const done = rivalAttack(a);
    assert.equal(done.state.timing.activePlayer, rival);
    assert.equal(zone(done.state, smasher), "BATTLEFIELD"); assert.equal(zone(done.state, a.host), "DECK");
    assert.ok(done.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.other), "Adam Smasher's {Play} defeats the attacker");
});

test("a rival's {Play} defeat of its host: the free play, and that Unit's own {Play} defeat, join the rival's batch", () => {
    const a = arrange({ host: ATLUS, rivalUnit: PSYCHO, trash: [SMASHER], hostReady: true, rivalHand: [SMASHER] }), mine = a.trash[0];
    let state = end(a.state, context).state;
    while (!(state.timing.step === "MAIN" && state.timing.activePlayer === rival)) state = take(state, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    const played = playCard(state, context, SMASHER), theirs = played.state.players[rival].zones.BATTLEFIELD.find(id => played.state.objects.cards[id].cardId === SMASHER)!;
    const done = finish(played.state), events = [...played.events, ...done.events];
    assert.equal(zone(done.state, a.host), "DECK", "defeated by the rival's Smasher, then bottom-decked");
    assert.equal(zone(done.state, mine), "BATTLEFIELD"); assert.equal(zone(done.state, theirs), "TRASH", "my Smasher's {Play} defeats theirs");
    assert.equal(zone(done.state, a.other), "TRASH");
    assert.ok(at(events, "CARD_PLAYED", mine) > at(events, "CARD_DEFEATED", a.host));
});

test("a played blue Unit that is the turn's first blue play also brings the first-blue-play Legend observer", () => {
    const a = arrange({ host: ATLUS, rivalUnit: ANIMALS, trash: [DELAMAIN], hostReady: true, legend: JACKIE });
    const done = ownAttack(a), legend = a.state.players[actor].zones.LEGENDS[0];
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === legend), "Jackie's first-blue-play trigger joined the batch");
});

test("every admitted Unit with a {Play} can be played by it, on either player's turn, with every choice taken", () => {
    const units = reviewedUnionContext().content.cards.filter(c => c.type === "UNIT" && c.mechanics.abilities.some(x => x.trigger === "WHEN_PLAYED") && context.content.cards.some(r => r.id === c.id));
    assert.ok(units.length >= 20);
    const last = (s: GameState) => s.resolution.choice!.options.length - 1;
    for (const unit of units) for (const hostReady of [true, false]) for (const policy of [undefined, last]) {
        const a = arrange({ host: ATLUS, rivalUnit: ANIMALS, trash: [unit.id], hostReady, hand: [PSYCHO, MISTY] });
        const label = `${unit.id} on the ${hostReady ? "controller's" : "rival's"} turn, ${policy ? "last" : "first"} options`;
        let done; try { done = hostReady ? ownAttack(a, policy) : rivalAttack(a, policy); } catch (e) { assert.fail(`${label}: ${(e as Error).message}`); }
        assert.ok(at(done.events, "CARD_PLAYED", a.trash[0]) >= 0, label);
    }
});

test("two fired next-fight steals in one batch both resolve, each with its own steal triggers", () => {
    const m = new TurnMutation(base, context);
    const rewrite = (player: PlayerId, cardId: string) => { const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c; };
    rewrite(actor, APPETITE); rewrite(actor, APPETITE);
    const v = rewrite(actor, V), misty = rewrite(rival, MISTY);
    for (const [c, r] of [[v, "READY"], [misty, "SPENT"]] as const) { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = r; c.statuses = []; }
    const s = GameStateSchema.parse(m.state);
    for (const p of Object.values(s.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(s.objects.gigs)) {
        const rolled = g.ownerId === rival && (g.dieType === "D8" || g.dieType === "D6");
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: 2 } : { kind: "UNROLLED" };
        s.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    let state = unwrap(validateState(s, context));
    state = playCard(playCard(state, context, APPETITE).state, context, APPETITE).state;
    assert.equal(state.fightOutcomeEffects?.length, 2);
    const done = finish(attack(state, v.id, misty.id));
    assert.equal(done.events.filter(e => e.payload.kind === "GIG_STOLEN").length, 2);
    assert.equal(done.state.players[rival].gigs.GIGS.length, 0);
});

test("a fired next-fight defeat whose DEFEATED trigger pauses for a choice keeps a valid batch", () => {
    // Regression (V46): the post-fight batch held a fired Program defeat; any pause after it failed state validation.
    const a = arrange({ host: ATLUS, rivalUnit: "caliber-totentanz-s-top-dog", trash: [], hostReady: true, hand: [SAFETY, PSYCHO, MISTY] });
    const s = GameStateSchema.parse(a.state); s.objects.cards[a.host].attachments = []; s.objects.cards[a.gear].zone = { playerId: actor, zone: "TRASH" };
    s.players[actor].zones.BATTLEFIELD = s.players[actor].zones.BATTLEFIELD.filter(id => id !== a.gear); s.players[actor].zones.TRASH.push(a.gear);
    const played = playCard(unwrap(validateState(s, context)), context, SAFETY).state, done = ownAttack({ ...a, state: played });
    assert.equal(zone(done.state, a.other), "TRASH", "Safety Override defeats Caliber after the fight");
    assert.ok(done.choices.includes("DISCARD_SELECTION"), "Caliber's {Defeated} discard paused for the actor's choice");
});

test("the reviewed union admits the V48 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === RELIC));
});
