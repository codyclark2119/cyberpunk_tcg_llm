import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsTrashGearProgram } from "../packages/engine/src/trash-gear";
import { attachedGear } from "../packages/engine/src/attachments";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV93Cards, batchV93Context, batchV93Input, v93Source } from "./api-admission-batch-v93-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV93Context();
const [heist] = batchV93Cards;
const ATLUS = "emergency-atlus", BLADES = "mantis-blades", SATORI = "satori-sword-of-saburo", NETDRIVER = "netwatch-netdriver", RIPPLER = "tetratronic-rippler";
const JACKIE = "jackie-welles-pour-one-out-for-me"; // A vanilla Unit; Gears of cost 1, 2 and 3; a blue cost-1 Gear; a first-blue-play Legend.
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV93Input("batch-v93"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer;

type Arrangement = { top?: string[]; deck?: number; gigs?: number[]; units?: number; jackie?: boolean };
/** Trusted arrangement on the actor's MAIN: The Heist in hand; the deck's top cards rewritten to `top` (the rest unchanged), then cut to
 * `deck` cards; the actor's Gig area holding rolled Gigs of `gigs` values (default [6]); `units` ready Emergency Atlus (default 1); every
 * Legend face down (Jackie Welles: Pour One Out for Me face up when `jackie`). */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), deck = m.state.players[actor].zones.DECK;
    const rewrite = (id: CardInstanceId, cardId: string) => { const c = m.state.objects.cards[id], r = context.content.cards.find(x => x.id === cardId)!; c.cardId = r.id; c.revision = r.revision; return c; };
    const h = rewrite(deck[deck.length - 1], heist.id); moveCardLocation(m, h.id, "HAND");
    const units: CardInstanceId[] = [];
    for (let i = 0; i < (a.units ?? 1); i++) { const u = rewrite(deck[deck.length - 1], ATLUS); moveCardLocation(m, u.id, "HAND"); moveCardLocation(m, u.id, "BATTLEFIELD"); u.statuses = []; u.readiness = "READY"; units.push(u.id); }
    (a.top ?? []).forEach((cardId, i) => rewrite(deck[i], cardId));
    if (a.deck !== undefined) for (const id of m.state.players[actor].zones.DECK.slice(a.deck)) moveCardLocation(m, id, "TRASH");
    const legends = m.state.players[actor].zones.LEGENDS;
    for (const id of legends) if (!m.state.objects.cards[id].attachments.length) m.state.objects.cards[id].face = "DOWN";
    let jackie: CardInstanceId | undefined;
    if (a.jackie) { const j = rewrite(legends[legends.length - 1], JACKIE); j.face = "UP"; jackie = j.id; }
    const d = GameStateSchema.parse(m.state), values = [...(a.gigs ?? [6])];
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const gig of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
        const value = gig.ownerId === actor ? values.shift() : undefined;
        gig.controllerId = gig.ownerId; gig.location = { playerId: gig.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        gig.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[gig.ownerId].gigs[gig.location.zone].push(gig.id);
    }
    const state = unwrap(validateState(d, context));
    return { state, heist: h.id, units, top: state.players[actor].zones.DECK.slice(0, 4), jackie };
}
function play(s: GameState, id: CardInstanceId): Step {
    let r = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id) as Step; const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        r = pick(r.state, context, o => o.kind === "PAYMENT" && o.source.kind === "EDDIE") as Step; events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}
function pickOption(r: Step, f: (o: NonNullable<GameState["resolution"]["choice"]>["options"][number]) => boolean): Step {
    assert.ok(validateState(r.state, context).ok);
    const next = pick(r.state, context, f) as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}
const cardOptions = (s: GameState) => (s.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const name = (cardId: string) => context.content.cards.find(c => c.id === cardId)!.displayName;

test("the V93 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(heist.provenance.sourceHash, hashCanonical(v93Source(heist.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === heist.id), [heist]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("The Heist passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTrashGearProgram(heist, context).ok); assert.ok(supportsPlay(heist, context).ok);
    assert.equal(supportsTriggerCard(heist, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(heist) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["cost 3", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["trash 3", d => { d.mechanics.abilities[0].effects = [{ kind: "TRASH_THEN_RETURN_UNIT", count: 3 }]; }],
        ["tags", d => { d.tags = []; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        ["scope", d => { d.execution = { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) { assert.equal(supportsTrashGearProgram(forge(edit), context).ok, false, label); assert.equal(supportsPlay(forge(edit), context).ok, false, label); }
});

test("with two trashed Gear and no matching Gig, the controller chooses one for the hand; the rest stay trashed", () => {
    const a = arrange({ top: [BLADES, ATLUS, SATORI, ATLUS] }), [blades, , satori] = a.top;
    let r = play(a.state, a.heist);
    assert.deepEqual(a.top.map(id => zone(r.state, id)), ["TRASH", "TRASH", "TRASH", "TRASH"]);
    assert.deepEqual(cardOptions(r.state), [blades, satori].sort());
    r = pickOption(r, o => o.kind === "CARD" && o.cardInstanceId === satori);
    assert.ok(mainIdle(r.state));
    assert.equal(zone(r.state, satori), "HAND"); assert.equal(zone(r.state, blades), "TRASH"); assert.equal(zone(r.state, a.heist), "TRASH");
    assert.ok(!has(r.events, "CARD_PLAYED", p => p.cardInstanceId === satori));
});

test("a Gear whose cost equals a friendly Gig's value may be played for free onto a chosen host, or added to hand", () => {
    const a = arrange({ top: [ATLUS, BLADES, ATLUS, ATLUS], gigs: [1, 6] }), blades = a.top[1], [atlus] = a.units;
    const r = play(a.state, a.heist);
    assert.equal(r.state.resolution.playContinuation?.trashedGearId, blades, "a lone Gear is taken");
    const options = r.state.resolution.choice!.options;
    assert.deepEqual(options[0], { kind: "CONFIRM", confirmed: false });
    assert.deepEqual(cardOptions(r.state), [atlus]);
    const labels = actions(r.state, context).map(x => x.descriptor.label);
    assert.ok(labels.includes(`Add ${name(BLADES)} to your hand`), labels.join(" | "));
    assert.ok(labels.includes(`Play ${name(BLADES)} for free, equipped to ${name(ATLUS)} (${atlus})`), labels.join(" | "));
    const spent = r.state.players[actor].zones.EDDIES.filter(id => r.state.objects.cards[id].readiness === "SPENT").length;
    const played = pickOption(r, o => o.kind === "CARD" && o.cardInstanceId === atlus);
    assert.ok(mainIdle(played.state));
    assert.deepEqual(attachedGear(played.state, atlus, context).map(g => g.id), [blades]);
    assert.equal(played.state.objects.cards[blades].readiness, "READY");
    assert.ok(has(played.events, "CARD_PLAYED", p => p.cardInstanceId === blades));
    assert.equal(played.state.players[actor].zones.EDDIES.filter(id => played.state.objects.cards[id].readiness === "SPENT").length, spent, "played for free");
    const kept = pickOption(r, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(mainIdle(kept.state)); assert.equal(zone(kept.state, blades), "HAND");
});

test("a lone unplayable Gear goes to hand without a choice; with no Gear nothing is added; a short deck trashes what it has", () => {
    const a = arrange({ top: [NETDRIVER, ATLUS, ATLUS, ATLUS], gigs: [1, 2] }), [netdriver] = a.top;
    const r = play(a.state, a.heist);
    assert.ok(mainIdle(r.state)); assert.equal(zone(r.state, netdriver), "HAND");
    const b = arrange({ top: [ATLUS, ATLUS], deck: 2 });
    const n = play(b.state, b.heist);
    assert.ok(mainIdle(n.state)); assert.deepEqual(n.state.players[actor].zones.DECK, []);
    assert.deepEqual(b.top.map(id => zone(n.state, id)), ["TRASH", "TRASH"]);
});

test("a blue Gear played for free starts its own play batch once the Program has resolved", () => {
    const a = arrange({ top: [RIPPLER, ATLUS, ATLUS, ATLUS], gigs: [1, 6], jackie: true }), [rippler] = a.top, [atlus] = a.units;
    let r = play(a.state, a.heist);
    r = pickOption(r, o => o.kind === "CARD" && o.cardInstanceId === atlus);
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === rippler));
    assert.ok(has(r.events, "EFFECT_PENDING", p => p.sourceId === a.jackie));
    assert.equal(r.state.resolution.triggerContinuation?.origin.kind, "PLAY");
    assert.equal(zone(r.state, a.heist), "TRASH");
    assert.ok(validateState(r.state, context).ok);
});

test("forged states are rejected: a held Gear that may not be played, or a played Gear at a decision", () => {
    const a = arrange({ top: [BLADES, ATLUS, SATORI, ATLUS], gigs: [1, 6] }), [blades, , satori] = a.top;
    const r = play(a.state, a.heist);
    const held = GameStateSchema.parse(structuredClone(r.state)); held.resolution.playContinuation!.trashedGearId = satori;
    assert.equal(validateState(held, context).ok, false);
    const played = GameStateSchema.parse(structuredClone(r.state)); played.resolution.playContinuation!.playedGearId = blades;
    assert.equal(validateState(played, context).ok, false);
});
