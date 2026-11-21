import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { playPaymentAmount, supportsPlayCostReduction } from "../packages/engine/src/play-cost-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV53Cards, batchV53Context, batchV53Input, v53Source, VIKTOR } from "./api-admission-batch-v53-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV53Context();
const viktor = batchV53Cards[0];
const PSYCHO = "psycho-squad", SANDEVISTAN = "sandevistan", BERSERK = "zetatech-berserk", MANTIS = "mantis-blades", PLAIN = "slice-card-4"; // CYBERWARE Gears cost 3, 6 and 1; the fixture Gear costs 2.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV53Input("batch-v53"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: `mine` and `theirs` on the field (ready unless listed in `spent`), extra actor hand cards. */
function arrange(a: { mine: string[]; theirs: string[]; spent?: string[]; hand?: string[] }) {
    const m = new TurnMutation(base, context), ids: Record<string, CardInstanceId> = {};
    const rewrite = (player: PlayerId, cardId: string, zone: "HAND" | "BATTLEFIELD") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); if (zone !== "HAND") moveCardLocation(m, c.id, zone); c.statuses = [];
        if (zone === "BATTLEFIELD") c.readiness = a.spent?.includes(cardId) ? "SPENT" : "READY";
        ids[cardId] = c.id;
    };
    for (const id of a.mine) rewrite(actor, id, "BATTLEFIELD");
    for (const id of a.theirs) rewrite(rival, id, "BATTLEFIELD");
    for (const id of a.hand ?? []) rewrite(actor, id, "HAND");
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), ids };
}
/** Plays `gear` from the actor's hand onto `host`, paying with Eddies; returns the state and the Eddies paid. */
function playGear(s: GameState, gear: CardInstanceId, host: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === gear);
    const events = [...r.events];
    while (r.state.resolution.choice) {
        const options = r.state.resolution.choice.options, pay = options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        r = choose(r.state, context, pay >= 0 ? pay : options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === host));
        events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    const paid = events.filter(e => e.payload.kind === "PAYMENT_MADE").flatMap(e => (e.payload as unknown as { sources: unknown[] }).sources).length;
    return { state: r.state, paid };
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const cost = (s: GameState, id: CardInstanceId, player: PlayerId = actor) => playPaymentAmount(s, player, id, context);

test("the V53 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(viktor.provenance.sourceHash, hashCanonical(v53Source(viktor.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === viktor.id), [viktor]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Viktor Vektor passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsPlayCostReduction]) assert.ok(gate(viktor, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(viktor) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no reduction", d => { d.mechanics.modifiers = []; }],
        ["second reduction", d => { d.mechanics.modifiers.push({ kind: "SELF_PLAY_COST_REDUCTION", per: "RIVAL_UNIT", amount: 1, minimum: 1 }); }],
        ["ability", d => { d.mechanics.abilities = [{ id: "x@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }]; }],
        ["power", d => { d.power = 6; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["sellable", d => { d.sellProfile.allowed = true; }],
        ["Blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsPlayCostReduction]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("with Viktor on the field the first CYBERWARE Gear costs 3 less, to a minimum of 1; later ones pay in full", () => {
    const a = arrange({ mine: [VIKTOR], theirs: [], hand: [SANDEVISTAN, BERSERK, MANTIS, PLAIN] }), v = a.ids[VIKTOR];
    const berserk = cost(a.state, a.ids[BERSERK])!;
    assert.equal(cost(a.state, a.ids[SANDEVISTAN]), 1); assert.equal(cost(a.state, a.ids[MANTIS]), 1); assert.equal(cost(a.state, a.ids[PLAIN]), 2, "not CYBERWARE");
    const s = GameStateSchema.parse(structuredClone(a.state)); s.players[actor].zones.BATTLEFIELD = s.players[actor].zones.BATTLEFIELD.filter(id => id !== v); s.objects.cards[v].zone = { playerId: actor, zone: "TRASH" }; s.players[actor].zones.TRASH.push(v);
    assert.equal(berserk, Math.max(1, cost(s, a.ids[BERSERK])! - 3), "after its own reduction");
    const played = playGear(a.state, a.ids[SANDEVISTAN], v);
    assert.equal(played.paid, 1); assert.equal(played.state.turnHistory?.firstCyberwareGearPlays?.[actor], a.ids[SANDEVISTAN]);
    assert.equal(cost(played.state, a.ids[MANTIS]), 1, "printed 1"); assert.equal(cost(played.state, a.ids[BERSERK]), cost(s, a.ids[BERSERK]), "second CYBERWARE Gear pays in full");
    assert.equal(cost(played.state, a.ids[PLAIN]), 2);
});

test("a CYBERWARE Gear played before Viktor arrived was the turn's first", () => {
    const a = arrange({ mine: [PSYCHO], theirs: [], hand: [MANTIS, VIKTOR, SANDEVISTAN] });
    const first = playGear(a.state, a.ids[MANTIS], a.ids[PSYCHO]);
    assert.equal(first.state.turnHistory?.firstCyberwareGearPlays?.[actor], a.ids[MANTIS]);
    let s = take(first.state, context, x => x.action.kind === "PLAY_CARD" && x.action.cardInstanceId === a.ids[VIKTOR]).state;
    while (s.resolution.choice) s = choose(s, context, Math.max(0, s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"))).state;
    assert.equal(zone(s, a.ids[VIKTOR]), "BATTLEFIELD");
    assert.equal(cost(s, a.ids[SANDEVISTAN]), 3);
});

test("a rival's Viktor reduces nothing for the actor, and the history is per turn", () => {
    const a = arrange({ mine: [PSYCHO], theirs: [VIKTOR], hand: [SANDEVISTAN] });
    assert.equal(cost(a.state, a.ids[SANDEVISTAN]), 3);
    const b = arrange({ mine: [VIKTOR], theirs: [], hand: [SANDEVISTAN] }), played = playGear(b.state, b.ids[SANDEVISTAN], b.ids[VIKTOR]);
    assert.ok(played.state.turnHistory?.firstCyberwareGearPlays);
    assert.equal(end(played.state, context).state.turnHistory?.firstCyberwareGearPlays, undefined);
});

test("forged first-Gear history is rejected", () => {
    const a = arrange({ mine: [VIKTOR], theirs: [], hand: [PLAIN, SANDEVISTAN] });
    const forged = GameStateSchema.parse(structuredClone(a.state)); forged.turnHistory!.firstCyberwareGearPlays = { [actor]: a.ids[PLAIN] };
    assert.equal(validateState(forged, context).ok, false, "not CYBERWARE");
    const empty = GameStateSchema.parse(structuredClone(a.state)); empty.turnHistory!.firstCyberwareGearPlays = {};
    assert.equal(validateState(empty, context).ok, false, "empty");
    const theirs = GameStateSchema.parse(structuredClone(a.state)); theirs.turnHistory!.firstCyberwareGearPlays = { [rival]: a.ids[SANDEVISTAN] };
    assert.equal(validateState(theirs, context).ok, false, "another player's card");
});

test("the reviewed union contains Viktor Vektor: Drop Your Illusions", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === VIKTOR));
});
