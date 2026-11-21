import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV52Cards, batchV52Context, batchV52Input, JOHNNY, v52Source } from "./api-admission-batch-v52-fixture";
import { DRAGON } from "./api-admission-batch-v50-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV52Context();
const johnny = batchV52Cards[0];
const PSYCHO = "psycho-squad", OCTANT = "octant", HACKED = "hacked-corpo", ODA = "sandayu-oda-hanako-s-guardian"; // Power 6, 8, 3 (Corpo) and 8 (Corpo); only {Play} abilities.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV52Input("batch-v52"), context)).state;
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
/** `attacker` attacks `target`; the defender passes React; every later choice takes its first option. */
function fight(s: GameState, attacker: CardInstanceId, target: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target).state;
    const events = [];
    while (!(state.timing.step === "MAIN" && state.timing.combat.stage === "NONE")) {
        assert.ok(validateState(state, context).ok);
        const r = state.timing.step === "RIVAL_REACT" ? take(state, context, a => a.action.kind === "PASS_REACT") : choose(state, context, 0);
        state = r.state; events.push(...r.events);
    }
    return { state, events };
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const readiness = (s: GameState, id: CardInstanceId) => s.objects.cards[id].readiness;
const fightResult = (events: { payload: { kind: string } }[]) => events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload as unknown as { winnerId: string | null; loserIds: string[]; forcedWinnerId?: string };

test("the V52 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(johnny.provenance.sourceHash, hashCanonical(v52Source(johnny.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === johnny.id), [johnny]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Johnny Silverhand passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard]) assert.ok(gate(johnny, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(johnny) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no guard", d => { delete d.mechanics.abilities[0].guard; }],
        ["no override", d => { d.mechanics.modifiers = []; }],
        ["no ready", d => { d.mechanics.abilities = []; }],
        ["lost", d => { d.mechanics.abilities[0].trigger = "WHEN_FIGHT_LOST"; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["power", d => { d.power = 9; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["sellable", d => { d.sellProfile.allowed = true; }],
        ["Blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the first fight Johnny wins readies him; the second win that turn does not", () => {
    const a = arrange({ mine: [JOHNNY], theirs: [PSYCHO, HACKED], spent: [PSYCHO, HACKED] }), j = a.ids[JOHNNY];
    const first = fight(a.state, j, a.ids[PSYCHO]);
    assert.equal(zone(first.state, a.ids[PSYCHO]), "TRASH"); assert.equal(readiness(first.state, j), "READY");
    assert.equal(first.state.turnHistory?.fightWins?.[j], 1);
    const second = fight(first.state, j, a.ids[HACKED]);
    assert.equal(zone(second.state, a.ids[HACKED]), "TRASH"); assert.equal(readiness(second.state, j), "SPENT", "only the first win each turn");
    assert.equal(second.state.turnHistory?.fightWins?.[j], 2);
});

test("a tie against a non-Corpo Unit is no win: both are defeated and nothing readies", () => {
    const a = arrange({ mine: [JOHNNY], theirs: [OCTANT], spent: [OCTANT] }), j = a.ids[JOHNNY];
    const done = fight(a.state, j, a.ids[OCTANT]);
    assert.equal(fightResult(done.events).winnerId, null); assert.equal(fightResult(done.events).forcedWinnerId, undefined);
    assert.equal(zone(done.state, j), "TRASH"); assert.equal(zone(done.state, a.ids[OCTANT]), "TRASH");
});

test("against an equal-power Corpo Unit Johnny wins, survives and readies (11.4.1.4)", () => {
    const a = arrange({ mine: [JOHNNY], theirs: [ODA], spent: [ODA] }), j = a.ids[JOHNNY], o = a.ids[ODA];
    const done = fight(a.state, j, o), r = fightResult(done.events);
    assert.equal(r.winnerId, j); assert.equal(r.forcedWinnerId, j); assert.deepEqual(r.loserIds, [o]);
    assert.equal(zone(done.state, j), "BATTLEFIELD"); assert.equal(zone(done.state, o), "TRASH"); assert.equal(readiness(done.state, j), "READY");
});

test("defending against a stronger Corpo attacker on the rival's turn, Johnny wins and readies", () => {
    const a = arrange({ mine: [JOHNNY], theirs: [DRAGON], spent: [JOHNNY] }), j = a.ids[JOHNNY], y = a.ids[DRAGON];
    let s = end(a.state, context).state;
    while (!(s.timing.step === "MAIN" && s.timing.activePlayer === rival)) s = take(s, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    assert.equal(s.turnHistory?.fightWins, undefined, "the history is per turn");
    const done = fight(s, y, j), r = fightResult(done.events);
    assert.equal(r.winnerId, j); assert.equal(r.forcedWinnerId, j);
    assert.equal(zone(done.state, y), "TRASH"); assert.equal(zone(done.state, j), "BATTLEFIELD"); assert.equal(readiness(done.state, j), "READY");
});

test("forged fight-win history is rejected", () => {
    const a = arrange({ mine: [JOHNNY, PSYCHO], theirs: [] }), forged = GameStateSchema.parse(structuredClone(a.state));
    forged.turnHistory!.fightWins = { [a.ids[PSYCHO]]: 1 };
    assert.equal(validateState(forged, context).ok, false);
    const stale = GameStateSchema.parse(structuredClone(a.state)); stale.turnHistory!.fightWins = {};
    assert.equal(validateState(stale, context).ok, false);
});

test("the reviewed union contains Johnny Silverhand: Never Stop Fighting", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === JOHNNY));
});
