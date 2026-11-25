import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsUnitGrantProgram } from "../packages/engine/src/ready-attack-grant";
import { supportsHandResetProgram } from "../packages/engine/src/hand-reset";
import { listAttackTargets } from "../packages/engine/src/combat-queries";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV79Cards, batchV79Context, batchV79Input, v79Source } from "./api-admission-batch-v79-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV79Context();
const [gunpoint] = batchV79Cards;
const FLATHEAD = "mt0d12-flathead", CORPO = "corpo-security", PSYCHO = "psycho-squad"; // Vanilla Units: power 7, 2 and 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV79Input("batch-v79"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { mine?: string[]; cred?: Record<PlayerId, number> };
/** Trusted arrangement on the actor's MAIN: Gunpoint Diplomacy in the actor's hand; `mine` ready on the actor's field (default a
 * Flathead and a Corpo Security); a ready Psycho Squad and a spent Corpo Security on the Rival's; and, with `cred`, each player's Gig area
 * holding one rolled Gig (its largest die below d20) of that value, so Street Cred is that value. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), mine: CardInstanceId[] = [], put = (player: PlayerId, cardId: string, zone: "HAND" | "BATTLEFIELD", readiness: "READY" | "SPENT" = "READY") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
        if (zone === "BATTLEFIELD") { moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = readiness; }
        return c.id;
    };
    const card = put(actor, gunpoint.id, "HAND");
    for (const id of a.mine ?? [FLATHEAD, CORPO]) mine.push(put(actor, id, "BATTLEFIELD"));
    const ready = put(rival, PSYCHO, "BATTLEFIELD"), spent = put(rival, CORPO, "BATTLEFIELD", "SPENT");
    const d = GameStateSchema.parse(m.state);
    if (a.cred) {
        const left: Record<PlayerId, number | undefined> = { ...a.cred };
        for (const pl of Object.values(d.players)) pl.gigs = { FIXER: [], GIGS: [] };
        for (const g of Object.values(d.objects.gigs).sort((x, y) => Number(y.dieType.slice(1)) - Number(x.dieType.slice(1)) || (x.id < y.id ? -1 : 1))) {
            const value = g.dieType === "D20" ? undefined : left[g.ownerId]; if (value !== undefined) left[g.ownerId] = undefined;
            g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
            g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
            d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        }
    }
    return { state: unwrap(validateState(d, context)), card, mine, ready, spent };
}
function play(s: GameState, id: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0); r = choose(r.state, context, i); events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}
const step = (s: GameState, f: Parameters<typeof pick>[2]) => { const r = pick(s, context, f); assert.ok(validateState(r.state, context).ok); return r; };
const cardTargets = (s: GameState, id: CardInstanceId) => listAttackTargets(s, id, actor, context).flatMap(t => t.kind === "CARD" ? [t.cardInstanceId] : []).sort();
const power = (s: GameState, id: CardInstanceId) => effectivePower(s, id, context);

test("the V79 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(gunpoint.provenance.sourceHash, hashCanonical(v79Source(gunpoint.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === gunpoint.id), [gunpoint]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Gunpoint Diplomacy passes only its exact pin; any changed field is rejected, and no other gate admits it", () => {
    for (const gate of [supportsPlay, supportsUnitGrantProgram]) assert.ok(gate(gunpoint, context).ok);
    for (const gate of [supportsCall, supportsTriggerCard, supportsFieldLegend, supportsHandResetProgram]) assert.equal(gate(gunpoint, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(gunpoint) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["a condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["another effect after", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["colors", d => { d.colors = ["GREEN"]; d.ram = { GREEN: 3 }; }],
        ["scope", d => { d.execution = { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsUnitGrantProgram]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("without less Street Cred the chosen Unit gets both: +3 power, and its next attack may target a ready Unit", () => {
    const a = arrange(), [flathead, corpo] = a.mine, s = play(a.state, a.card).state;
    for (const id of a.mine) assert.deepEqual(cardTargets(s, id), [a.spent], "no ready target before the grant");
    assert.equal(s.timing.actingPlayer, actor); assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(actions(s, context).map(x => x.descriptor.label).sort(), a.mine.map(id => `Give ${context.content.cards.find(r => r.id === s.objects.cards[id].cardId)!.displayName} (${id}) these effects`).sort());
    const done = step(s, o => o.kind === "CARD" && o.cardInstanceId === flathead), g = done.state;
    assert.equal(power(g, flathead), 10); assert.equal(power(g, corpo), 2);
    assert.deepEqual(cardTargets(g, flathead), [a.ready, a.spent].sort()); assert.deepEqual(cardTargets(g, corpo), [a.spent]);
    assert.equal(g.timing.step, "MAIN"); assert.equal(g.objects.cards[a.card].zone.zone, "TRASH");
    assert.ok(done.events.some(e => e.payload.kind === "READY_UNIT_ATTACK_GRANTED" && e.payload.targetId === flathead));
    // The attack on the ready Unit stays legal through the Rival's react window and resolves; the grant ends with it.
    const declared = take(g, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === flathead).state;
    let c = step(declared, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.ready).state;
    assert.equal(c.timing.step, "RIVAL_REACT"); assert.deepEqual(c.turnHistory?.readyUnitAttackGrants, [{ unitId: flathead, inAttack: true }]);
    c = take(c, context, x => x.action.kind === "PASS_REACT").state;
    for (let n = 0; c.resolution.choice || c.timing.combat.stage !== "NONE"; n++) { assert.ok(n < 10); c = choose(c, context, 0).state; assert.ok(validateState(c, context).ok); }
    assert.equal(c.objects.cards[a.ready].zone.zone, "TRASH", "power 10 defeats the ready power-6 Unit");
    assert.equal(c.turnHistory?.readyUnitAttackGrants, undefined, "used by that attack");
    assert.equal(power(c, flathead), 10, "the power lasts the turn");
});

test("a lone friendly Unit is chosen without a choice; with none nothing happens", () => {
    const a = arrange({ mine: [CORPO] }), r = play(a.state, a.card), s = r.state;
    assert.equal(s.timing.step, "MAIN"); assert.equal(power(s, a.mine[0]), 5);
    assert.ok(r.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === a.mine[0] && e.payload.forced));
    assert.deepEqual(s.turnHistory?.readyUnitAttackGrants, [{ unitId: a.mine[0], inAttack: false }]);
    const none = arrange({ mine: [] }), n = play(none.state, none.card);
    assert.equal(n.state.timing.step, "MAIN"); assert.equal(n.state.turnHistory?.readyUnitAttackGrants, undefined); assert.equal(n.state.temporaryModifiers, undefined);
    assert.equal(n.state.objects.cards[none.card].zone.zone, "TRASH");
});

test("with less Street Cred than the Rival, the Rival chooses one effect for the Unit", () => {
    for (const mode of ["READY_ATTACK", "POWER"] as const) {
        const a = arrange({ mine: [FLATHEAD], cred: { [actor]: 2, [rival]: 5 } }), unit = a.mine[0], s = play(a.state, a.card).state;
        assert.equal(s.timing.actingPlayer, rival); assert.equal(s.resolution.choice!.actorId, rival); assert.equal(s.timing.activePlayer, actor);
        assert.deepEqual(actions(s, context).map(x => x.descriptor.label).sort(), ["Give it +3 power this turn", "Its next attack this turn may target ready Units"]);
        const done = step(s, o => o.kind === "MODE" && o.mode === mode), g = done.state;
        assert.equal(g.timing.actingPlayer, actor); assert.equal(g.timing.step, "MAIN");
        assert.ok(done.events.some(e => e.payload.kind === "EFFECT_MODE_CHOSEN" && e.payload.playerId === rival && e.payload.effectIndex === (mode === "READY_ATTACK" ? 0 : 1)));
        assert.equal(power(g, unit), mode === "POWER" ? 10 : 7, mode);
        assert.deepEqual(cardTargets(g, unit), (mode === "READY_ATTACK" ? [a.ready, a.spent] : [a.spent]).sort(), mode);
    }
    const tied = arrange({ mine: [FLATHEAD], cred: { [actor]: 5, [rival]: 5 } }), t = play(tied.state, tied.card).state;
    assert.equal(t.timing.step, "MAIN"); assert.equal(power(t, tied.mine[0]), 10, "equal Street Cred gives both");
});

test("a Unit that leaves the field loses its grant", () => {
    const a = arrange({ mine: [FLATHEAD] }), s = play(a.state, a.card).state, m = new TurnMutation(s, context);
    moveCardLocation(m, a.mine[0], "HAND");
    const left = unwrap(validateState(GameStateSchema.parse(m.state), context));
    assert.equal(left.turnHistory?.readyUnitAttackGrants, undefined);
});
