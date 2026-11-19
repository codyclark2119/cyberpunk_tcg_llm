import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, observe, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsAttackSearchUnit } from "../packages/engine/src/attack-search-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV19Cards, batchV19Context, batchV19Input, v19Source, RIPPER } from "./api-admission-batch-v19-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, withGigs } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV19Context();
const ripper = batchV19Cards.find(c => c.id === RIPPER)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV19Input("batch-v19"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const gear = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "GEAR" && c.printedCost.kind === "EDDIES" && c.printedCost.amount >= 3)!.id;
const unit = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.id !== RIPPER)!.id;
const gigOf = (s: GameState, p: PlayerId) => Object.values(s.objects.gigs).filter(g => g.controllerId === p).map(g => g.id).sort()[0] as GigInstanceId;
/** Trusted arrangement: Sketchy Ripper ready on the actor's field, the actor's top deck cards rewritten as `top`, and a rival Gig to attack. */
function arrange(top: string[]) {
    const s = withGigs(base, context, { [gigOf(base, rival)]: 2 }), m = new TurnMutation(s, context), deck = m.state.players[actor].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = ripper.id; c.revision = ripper.revision;
    moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = [];
    top.forEach((cardId, i) => { const t = m.state.objects.cards[m.state.players[actor].zones.DECK[i]], r = context.content.cards.find(x => x.id === cardId)!; t.cardId = r.id; t.revision = r.revision; });
    return { state: unwrap(validateState(m.state, context)), id: c.id, looked: m.state.players[actor].zones.DECK.slice(0, top.length) };
}
function attack(s: GameState, id: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id).state;
    while (state.timing.step === "ATTACK_TARGET_SELECTION") state = choose(state, context).state;
    return state;
}
const options = (s: GameState) => s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : o.kind === "MODE" ? o.mode : null);

test("V19 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(ripper.provenance.sourceHash, hashCanonical(v19Source(ripper.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === ripper.id), [ripper]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Sketchy Ripper passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsAttackSearchUnit, supportsTriggerCard, supportsPlay]) assert.ok(gate(ripper, context).ok, gate.name);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(ripper) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const search = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as { count: number; maxTake: number; maxCost?: number };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["play trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["count 4", d => { search(d).count = 4; }],
        ["take 2", d => { search(d).maxTake = 2; }],
        ["cost cap", d => { search(d).maxCost = 2; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "STREET_CRED_GREATER_THAN_RIVAL" }] as never; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["power", d => { d.power = 1; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["inherited", d => { d.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }]
    ];
    for (const [label, edit] of forgeries) { const f = forge(edit); assert.equal(supportsTriggerCard(f, context).ok, false, label); assert.equal(supportsAttackSearchUnit(f, context).ok, false, label); }
});

test("attacking searches the top 3 privately; the chosen Gear is revealed into hand and the rest bottom-decked", () => {
    const a = arrange([gear, unit, gear]), deckBefore = a.state.players[actor].zones.DECK, handBefore = a.state.players[actor].zones.HAND;
    const s = attack(a.state, a.id);
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(s.resolution.triggerContinuation!.origin, { kind: "ATTACK", subjectId: a.id });
    assert.deepEqual(options(s), ["DONE", a.looked[0], a.looked[2]], "only looked-at Gears, and taking none is allowed (11.17.4.1)");
    assert.deepEqual(unwrap(observe(s, actor, context)).inspectedCards?.map(c => c.instanceId), a.looked, "the searcher sees the three cards");
    assert.equal(unwrap(observe(s, rival, context)).inspectedCards, undefined, "the Rival does not");
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: a.looked[1] });
    assert.equal(validateState(forged, context).ok, false, "a looked-at Unit is never an option");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.looked[2]), after = done.state;
    assert.equal(after.objects.cards[a.looked[2]].zone.zone, "HAND");
    assert.deepEqual(after.players[actor].zones.HAND, [...handBefore, a.looked[2]]);
    assert.ok(done.events.some(e => e.payload.kind === "CARD_REVEALED" && e.payload.cardInstanceId === a.looked[2]));
    const deck = after.players[actor].zones.DECK;
    assert.deepEqual(deck.slice(0, deck.length - 2), deckBefore.slice(3), "the unlooked deck moves up");
    assert.deepEqual([...deck.slice(-2)].sort(), [a.looked[0], a.looked[1]].sort(), "the rest go to the bottom");
    assert.equal(after.resolution.searchContinuation, undefined);
    assert.equal(after.resolution.triggerContinuation, undefined);
    assert.equal(after.timing.combat.stage, "RIVAL_REACT");
    assert.equal(after.timing.actingPlayer, rival);
});

test("taking no Gear bottom-decks all three; with no Gear the search ends without a choice", () => {
    const a = arrange([gear, unit, unit]), s = attack(a.state, a.id);
    assert.deepEqual(options(s), ["DONE", a.looked[0]]);
    const none = pick(s, context, o => o.kind === "MODE" && o.mode === "DONE").state;
    assert.deepEqual(none.players[actor].zones.HAND, a.state.players[actor].zones.HAND);
    assert.deepEqual([...none.players[actor].zones.DECK.slice(-3)].sort(), [...a.looked].sort());
    assert.equal(none.timing.combat.stage, "RIVAL_REACT");
    const b = arrange([unit, unit, unit]), plain = take(b.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === b.id);
    let t = plain.state; const events = [...plain.events];
    while (t.timing.step === "ATTACK_TARGET_SELECTION") { const r = choose(t, context); t = r.state; events.push(...r.events); }
    assert.equal(t.timing.combat.stage, "RIVAL_REACT");
    assert.deepEqual([...t.players[actor].zones.DECK.slice(-3)].sort(), [...b.looked].sort());
    assert.ok(events.some(e => e.payload.kind === "SEARCH_REMAINDER_BOTTOMED"));
    assert.equal(events.some(e => e.payload.kind === "CARD_REVEALED"), false, "a failed search reveals nothing");
});

test("the reviewed union admits the V19 card", () => {
    const ids: string[] = reviewedUnionContext().content.cards.map(c => c.id);
    assert.ok(ids.includes(RIPPER));
});
