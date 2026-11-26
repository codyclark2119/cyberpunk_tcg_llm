import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV94Cards, batchV94Context, batchV94Input, v94Source } from "./api-admission-batch-v94-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV94Context();
const [alt] = batchV94Cards;
const FLOOR = "floor-it", FOOL = "fool-on-the-hill", EDGE = "over-the-edge", RELAPSE = "memory-relapse"; // Programs of cost 1 (Quick: -power, then draw 1), 2, 3 and 4.
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV94Input("batch-v94"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer;

/** Trusted arrangement on the actor's MAIN: Alt Cunningham face up and ready as the actor's last Legend, every other Legend face down and
 * spent; `trash` Programs in the actor's trash (and nothing else there); `eddies` ready Eddies, the rest spent. */
function arrange(trash: string[], eddies: number) {
    const m = new TurnMutation(base, context), z = m.state.players[actor].zones;
    for (const id of [...z.TRASH]) moveCardLocation(m, id, "REMOVED");
    const programs = trash.map(cardId => {
        const c = m.state.objects.cards[z.DECK[z.DECK.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "TRASH"); return c.id;
    });
    z.EDDIES.forEach((id, i) => { m.state.objects.cards[id].readiness = i < eddies ? "READY" : "SPENT"; });
    for (const id of z.LEGENDS) { const l = m.state.objects.cards[id]; if (!l.attachments.length) { l.face = "DOWN"; l.readiness = "SPENT"; } }
    const l = m.state.objects.cards[z.LEGENDS[z.LEGENDS.length - 1]];
    l.cardId = alt.id; l.revision = alt.revision; l.face = "UP"; l.readiness = "READY";
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), alt: l.id, programs };
}
const isAlt = (id: CardInstanceId) => (a: { action: { kind: string; sourceInstanceId?: string } }) => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id;
const readyEddies = (s: GameState) => s.players[actor].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "READY").length;
const cardOptions = (s: GameState) => (s.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
/** Pays every Eddie payment choice with the first Eddie offered. */
function pay(r: Step): Step {
    const events = [...r.events]; let s = r.state;
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(s, context).ok);
        const next = pick(s, context, o => o.kind === "PAYMENT" && o.source.kind === "EDDIE") as Step; s = next.state; events.push(...next.events);
    }
    return { state: s, events };
}
function activate(s: GameState, id: CardInstanceId): Step { return pay(take(s, context, isAlt(id)) as Step); }

test("the V94 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(alt.provenance.sourceHash, hashCanonical(v94Source(alt.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === alt.id), [alt]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Alt Cunningham: Soulkiller Architect passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsLegendSpendCard(alt, context).ok);
    assert.equal(supportsTriggerCard(alt, context).ok, false, "it has no trigger");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(alt) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["cost 2", d => { d.mechanics.abilities[0].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 2 } }, { kind: "SPEND_SOURCE" }]; }],
        ["unpaid", d => { d.mechanics.abilities[0].activation!.costs = [{ kind: "SPEND_SOURCE" }]; }],
        ["Quick", d => { d.mechanics.abilities[0].activation!.timing = "QUICK"; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }]
    ];
    for (const [name, edit] of forgeries) assert.equal(supportsLegendSpendCard(forge(edit), context).ok, false, name);
});

function choosePlay(r: Step, id: CardInstanceId): Step {
    assert.ok(validateState(r.state, context).ok);
    const next = pick(r.state, context, o => o.kind === "CARD" && o.cardInstanceId === id) as Step;
    return pay({ state: next.state, events: [...r.events, ...next.events] });
}

test("the controller chooses a payable trash Program, pays its cost, and it resolves, then goes to the bottom of the deck", () => {
    const a = arrange([FLOOR, FOOL, EDGE], 3), [floor, fool] = a.programs;
    assert.equal(actions(a.state, context).find(x => isAlt(a.alt)(x))?.descriptor.label, `Activate ${alt.displayName}: Pay 1 and spend to play a Program from your trash, then bottom-deck it`);
    let r = activate(a.state, a.alt);
    assert.equal(readyEddies(r.state), 2);
    assert.deepEqual(cardOptions(r.state), [floor, fool].sort(), "the cost-3 Program cannot be paid with 2 Eddies left");
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Play ${context.content.cards.find(c => c.id === FLOOR)!.displayName} (${floor}) from your trash`));
    r = choosePlay(r, floor);
    assert.ok(mainIdle(r.state), r.state.timing.step);
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === floor));
    assert.ok(!has(r.events, "CARD_REVEALED", p => p.cardInstanceId === floor), "a trash card is already public");
    const deck = r.state.players[actor].zones.DECK;
    assert.equal(deck[deck.length - 1], floor, "bottom-decked, not trashed");
    assert.equal(r.state.objects.cards[floor].face, "DOWN");
    assert.ok(!r.state.players[actor].zones.TRASH.includes(floor));
    assert.equal(readyEddies(r.state), 1, "its cost of 1 was paid");
    assert.equal(r.state.objects.cards[a.alt].readiness, "SPENT");
    assert.equal(r.state.players[actor].zones.RESOLVING_PROGRAM, undefined);
    assert.ok(validateState(r.state, context).ok);
});

test("a lone payable Program is played without a choice, pausing for its own payment; with none nothing is played", () => {
    const a = arrange([FOOL, RELAPSE], 4), [fool] = a.programs;
    const r = take(a.state, context, isAlt(a.alt)) as Step;
    let s = r.state;
    if (s.resolution.choice?.kind === "PAYMENT" && s.resolution.playContinuation?.kind === "ACTIVATE") s = pick(s, context, o => o.kind === "PAYMENT" && o.source.kind === "EDDIE").state;
    assert.equal(s.resolution.playContinuation?.kind, "PLAY"); assert.equal(s.resolution.playContinuation?.sourceId, fool);
    assert.equal(s.resolution.playContinuation?.fromTrash, true);
    assert.equal(s.resolution.choice?.kind, "PAYMENT"); assert.equal(s.objects.cards[fool].zone.zone, "TRASH");
    assert.ok(validateState(s, context).ok);
    const unflagged = GameStateSchema.parse(structuredClone(s)); delete unflagged.resolution.playContinuation!.fromTrash;
    assert.equal(validateState(unflagged, context).ok, false, "a hand play's payment needs its source in hand");
    const chosen = GameStateSchema.parse(structuredClone(s)); chosen.resolution.playContinuation!.trashProgramId = fool;
    assert.equal(validateState(chosen, context).ok, false, "a chosen trash Program never waits at a decision");
    const b = arrange([EDGE], 2);
    const n = activate(b.state, b.alt);
    assert.ok(mainIdle(n.state)); assert.equal(n.state.objects.cards[b.programs[0]].zone.zone, "TRASH");
    assert.ok(!has(n.events, "CARD_PLAYED"));
    assert.equal(n.state.objects.cards[b.alt].readiness, "SPENT");
});

test("a Program played from the trash counts as a played Program and keeps its own effects", () => {
    const a = arrange([FOOL], 4), [fool] = a.programs, before = a.state.turnHistory?.programPlays?.[actor];
    const r = pay(activate(a.state, a.alt));
    assert.ok(has(r.events, "CARD_PLAYED", p => p.cardInstanceId === fool));
    if (before !== undefined) assert.equal(r.state.turnHistory?.programPlays?.[actor], before + 1);
    assert.equal(r.state.resolution.current?.effect.kind, "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH", "Fool on the Hill pauses for the Rival's choice");
    assert.equal(r.state.objects.cards[fool].zone.zone, "RESOLVING_PROGRAM");
    const done = choose(r.state, context, 0);
    assert.ok(mainIdle(done.state));
    const deck = done.state.players[actor].zones.DECK;
    assert.equal(deck[deck.length - 1], fool);
});
