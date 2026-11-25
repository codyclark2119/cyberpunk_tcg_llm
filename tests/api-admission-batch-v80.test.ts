import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { listAttackTargets, isAttackEligible } from "../packages/engine/src/combat-queries";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV80Cards, batchV80Context, batchV80Input, v80Source } from "./api-admission-batch-v80-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV80Context();
const [johnny] = batchV80Cards;
const CORPO = "corpo-security", ATLUS = "emergency-atlus", ROCKER = "kerry-eurodyne-the-last-rockerboy"; // Vanilla Units of power 2 (it can't attack) and 4; a power-5 ROCKER Unit.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV80Input("batch-v80"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { mine?: [string, boolean][]; gigs?: number[] };
/** Trusted arrangement on the actor's MAIN: Johnny as the actor's last Legend, face up and ready; `mine` on the actor's field as
 * [card, played this turn] (played Units have Lag; default one just-played Corpo Security); a spent Corpo Security on the Rival's field;
 * and, with `gigs`, the actor's Gig area holding one rolled Gig per value (largest dice first, below d20). */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), mine: CardInstanceId[] = [], put = (player: PlayerId, cardId: string, lag: boolean, readiness: "READY" | "SPENT" = "READY") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = lag ? ["LAG"] : []; c.readiness = readiness;
        return c.id;
    };
    for (const [id, lag] of a.mine ?? [[ATLUS, true]]) mine.push(put(actor, id, lag));
    const spent = put(rival, CORPO, false, "SPENT");
    const d = GameStateSchema.parse(m.state), legends = d.players[actor].zones.LEGENDS, l = d.objects.cards[legends[legends.length - 1]];
    l.cardId = johnny.id; l.revision = johnny.revision; l.face = "UP"; l.readiness = "READY";
    if (a.gigs) {
        const left = [...a.gigs];
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === actor).sort((x, y) => Number(y.dieType.slice(1)) - Number(x.dieType.slice(1)) || (x.id < y.id ? -1 : 1))) {
            const value = g.dieType === "D20" ? undefined : left.shift();
            const from = d.players[actor].gigs[g.location.zone]; from.splice(from.indexOf(g.id), 1);
            g.controllerId = actor; g.location = { playerId: actor, zone: value === undefined ? "FIXER" : "GIGS" };
            g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
            d.players[actor].gigs[g.location.zone].push(g.id);
        }
    }
    return { state: unwrap(validateState(d, context)), johnny: l.id, mine, spent };
}
const activation = (s: GameState) => actions(s, context).find(x => x.action.kind === "ACTIVATE_ABILITY" && x.descriptor.label.startsWith(`Activate ${johnny.displayName}`));
/** Activates Johnny, paying with Eddies only, until no payment choice remains. */
function activate(s: GameState) {
    let r = take(s, context, x => x.action.kind === "ACTIVATE_ABILITY" && x.descriptor.label.startsWith(`Activate ${johnny.displayName}`)); const events = [...r.events], paid: number[] = [];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0); r = choose(r.state, context, i); events.push(...r.events); paid.push(n);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events, payments: events.filter(e => e.payload.kind === "PAYMENT_MADE").flatMap(e => e.payload.kind === "PAYMENT_MADE" ? e.payload.sources : []).length };
}
const cardTargets = (s: GameState, id: CardInstanceId) => listAttackTargets(s, id, actor, context).map(t => t.kind === "CARD" ? t.cardInstanceId : t.kind).sort();

test("the V80 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(johnny.provenance.sourceHash, hashCanonical(v80Source(johnny.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === johnny.id), [johnny]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Johnny Silverhand: Rocking Renegade passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsLegendSpendCard(johnny, context).ok);
    for (const gate of [supportsTriggerCard, supportsFieldLegend]) assert.equal(gate(johnny, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(johnny) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no reduction", d => { delete d.mechanics.abilities[0].activation!.costReduction; }],
        ["cost 1", d => { d.mechanics.abilities[0].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }]; }],
        ["Quick", d => { d.mechanics.abilities[0].activation!.timing = "QUICK"; }],
        ["a condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["tags", d => { d.tags = ["Merc", "Samurai"]; }],
        ["colors", d => { d.colors = ["BLUE"]; d.ram = { BLUE: 2 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsLegendSpendCard(forge(edit), context).ok, false, label);
});

test("the cost is 2, -1 for each friendly Gig with 8+ value, to 0", () => {
    for (const [gigs, cost] of [[[3], 2], [[8, 3], 1], [[9, 8], 0]] as const) {
        const a = arrange({ gigs: [...gigs] }), act = activation(a.state);
        assert.ok(act, JSON.stringify(gigs));
        assert.equal(act!.descriptor.label, `Activate ${johnny.displayName}: Pay ${cost} and spend to let a friendly Unit attack spent rival Units the turn it's played`);
        const r = activate(a.state);
        assert.equal(r.payments, cost, JSON.stringify(gigs));
        assert.equal(r.state.objects.cards[a.johnny].readiness, "SPENT");
        assert.equal(r.state.timing.step, "MAIN");
    }
});

test("a Unit played this turn may then attack spent rival Units, not the Gig area; the grant does nothing for power unless ROCKER", () => {
    const a = arrange(), unit = a.mine[0];
    assert.equal(isAttackEligible(a.state, actor, unit, context), false, "Lag stops the attack");
    const r = activate(a.state), s = r.state;
    assert.ok(r.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === unit && e.payload.forced));
    assert.ok(r.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    assert.deepEqual(s.turnHistory?.rivalUnitAttackGrants, [unit]);
    assert.ok(isAttackEligible(s, actor, unit, context));
    assert.deepEqual(cardTargets(s, unit), [a.spent], "spent rival Units only; the Gig area stays closed");
    assert.equal(effectivePower(s, unit, context), 4);
});

test("with two friendly Units the controller chooses; a ROCKER also gets +2 power this turn", () => {
    const a = arrange({ mine: [[ATLUS, true], [ROCKER, true]] }), [atlus, rocker] = a.mine, s = activate(a.state).state;
    assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(actions(s, context).map(x => x.descriptor.label).sort(), a.mine.map(id => `Let ${context.content.cards.find(r => r.id === s.objects.cards[id].cardId)!.displayName} (${id}) attack spent rival Units the turn it's played`).sort());
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === rocker);
    assert.ok(validateState(done.state, context).ok);
    assert.equal(effectivePower(done.state, rocker, context), 7); assert.equal(effectivePower(done.state, atlus, context), 4);
    assert.deepEqual(done.state.turnHistory?.rivalUnitAttackGrants, [rocker]);
    assert.ok(isAttackEligible(done.state, actor, rocker, context)); assert.equal(isAttackEligible(done.state, actor, atlus, context), false);
    assert.equal(done.state.timing.step, "MAIN");
});

test("with no friendly Unit the activation still spends Johnny and does nothing", () => {
    const a = arrange({ mine: [] }), r = activate(a.state);
    assert.equal(r.state.objects.cards[a.johnny].readiness, "SPENT");
    assert.equal(r.state.turnHistory?.rivalUnitAttackGrants, undefined);
    assert.equal(r.state.timing.step, "MAIN");
});
