import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV38Cards, batchV38Context, batchV38Input, v38Source, SAUL } from "./api-admission-batch-v38-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV38Context();
const saul = batchV38Cards[0];
const ATLUS = "emergency-atlus"; // A vanilla Unit with power 4.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV38Input("batch-v38"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: the player's last deck card becomes `cardId` on the field with the given readiness and no lag. */
function put(s: GameState, cardId: string, player: PlayerId, where: "READY" | "SPENT") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = where; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
function place(s: GameState, cards: [string, PlayerId, "READY" | "SPENT"][]) {
    const ids: CardInstanceId[] = [];
    for (const [cardId, player, where] of cards) { const placed = put(s, cardId, player, where); s = placed.state; ids.push(placed.id); }
    return { state: s, ids };
}
/** `attacker` attacks the spent rival Unit `target`; the attack is declared and locked. */
function attack(s: GameState, attacker: CardInstanceId, target: CardInstanceId) {
    const declared = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    return pick(declared, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target).state;
}
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const card = (s: GameState, id: CardInstanceId) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);
const endTurn = (s: GameState) => take(s, context, a => a.action.kind === "END_TURN");

test("the V38 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(saul.provenance.sourceHash, hashCanonical(v38Source(saul.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === saul.id), [saul]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Saul Bright: Stormrider passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(saul, context).ok); assert.ok(supportsPlay(saul, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(saul) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no aura", d => { d.mechanics.modifiers = []; }],
        ["Arasaka aura", d => { d.mechanics.modifiers = [{ kind: "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount: 1 }]; }],
        ["no end ready", d => { d.mechanics.abilities = []; }],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "SUBJECT_IS_SPENT" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 7 }; }],
        ["power", d => { d.power = 12; }],
        ["tags", d => { d.tags = ["Nomad"]; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("other friendly Units have +2 power only while attacking; Saul itself and rival Units never gain it", () => {
    const a = place(base, [[SAUL, actor, "READY"], [ATLUS, actor, "READY"], [ATLUS, actor, "READY"], [ATLUS, rival, "SPENT"], [ATLUS, rival, "SPENT"]]);
    const [s, x, y, target] = a.ids;
    assert.equal(effectivePower(a.state, x, context), 4, "not attacking");
    const attacking = attack(a.state, x, target);
    assert.equal(effectivePower(attacking, x, context), 6); assert.equal(effectivePower(attacking, y, context), 4, "only the attacker");
    assert.equal(effectivePower(attacking, target, context), 4, "a rival Unit is not friendly");
    assert.equal(effectivePower(attack(a.state, s, target), s, context), 14, "\"other\" friendly Units");
    const two = put(a.state, SAUL, actor, "READY"), both = attack(two.state, x, target);
    assert.equal(effectivePower(both, x, context), 8, "each Saul contributes");
});

test("at the end of the turn up to 3 friendly Units are readied one at a time; the controller may stop early", () => {
    const a = place(base, [[SAUL, actor, "SPENT"], [ATLUS, actor, "SPENT"], [ATLUS, actor, "SPENT"], [ATLUS, actor, "SPENT"], [ATLUS, rival, "SPENT"]]);
    const [s, x, y, z, theirs] = a.ids;
    let r = endTurn(a.state).state;
    assert.equal(r.timing.step, "TARGET_SELECTION"); assert.deepEqual(cards(r), [s, x, y, z].sort(), "Saul itself is friendly; the rival Unit is not");
    assert.ok(r.resolution.choice!.options.some(o => o.kind === "MODE" && o.mode === "DONE"));
    r = card(r, x).state; r = card(r, s).state;
    assert.deepEqual(r.resolution.triggerContinuation!.readiedUnits, [x, s]); assert.deepEqual(cards(r), [y, z].sort());
    const forged = GameStateSchema.parse(r); forged.resolution.triggerContinuation!.readiedUnits = [x, theirs];
    assert.equal(validateState(forged, context).ok, false, "only a friendly Unit can be held as readied");
    const done = card(r, z).state;
    for (const id of [s, x, z]) assert.equal(done.objects.cards[id].readiness, "READY");
    assert.equal(done.objects.cards[y].readiness, "SPENT", "at most 3"); assert.equal(done.timing.activePlayer, rival);
    const stopped = pick(card(endTurn(a.state).state, y).state, context, o => o.kind === "MODE" && o.mode === "DONE").state;
    assert.equal(stopped.objects.cards[y].readiness, "READY"); assert.equal(stopped.objects.cards[x].readiness, "SPENT"); assert.equal(stopped.timing.activePlayer, rival);
});

test("with Saul alone the only choice readies it or finishes", () => {
    const a = put(base, SAUL, actor, "SPENT"), r = endTurn(a.state).state;
    assert.deepEqual(cards(r), [a.id]);
    const done = card(r, a.id).state;
    assert.equal(done.objects.cards[a.id].readiness, "READY"); assert.equal(done.timing.activePlayer, rival);
});

test("the reviewed union admits the V38 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === SAUL));
});
