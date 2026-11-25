import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PendingChoice, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { friendlyMaxGigs } from "../packages/engine/src/paid-attack-power";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV91Cards, batchV91Context, batchV91Input, v91Source, SOMBRERO } from "./api-admission-batch-v91-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV91Context();
const [sombrero] = batchV91Cards;
const OCTANT = "octant"; // A vanilla power-8 Unit.
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function main(s: GameState): GameState {
    while (s.setup) s = choose(s, context, s.setup.stage === "FIRST_PLAYER" && s.timing.actingPlayer !== s.match.playerOrder[0] ? 1 : 0).state;
    while (s.timing.step !== "MAIN") s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return s;
}
const base = fund(clearField(main(unwrap(createGameWithEvents(batchV91Input("batch-v91"), context)).state), context), context), actor = base.timing.activePlayer;
const rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { maxGigs?: number; readySources?: number };
/** Trusted arrangement on the actor's Main: a ready El Sombrerón and a spent rival Octant; `maxGigs` friendly Gigs of different dice at
 * their top face (the rest below it); only `readySources` of the actor's Eddies ready (default all) and their Legends spent. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context);
    const put = (cardId: string, player: PlayerId) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c;
    };
    const unit = put(SOMBRERO, actor), octant = put(OCTANT, rival); octant.readiness = "SPENT";
    const gigs = Object.values(m.state.objects.gigs).filter(g => g.ownerId === actor)
        .sort((x, y) => Number(y.location.zone === "GIGS") - Number(x.location.zone === "GIGS") || Number(x.dieType.slice(1)) - Number(y.dieType.slice(1))); // Rolled first, then small dice (a D20 rolls last).
    for (const [i, g] of gigs.entries()) {
        const top = Number(g.dieType.slice(1));
        if (i < (a.maxGigs ?? 0)) {
            const zones = m.state.players[actor].gigs;
            if (g.location.zone === "FIXER") { zones.FIXER = zones.FIXER.filter(id => id !== g.id); zones.GIGS.push(g.id); }
            g.location = { playerId: actor, zone: "GIGS" }; g.roll = { kind: "ROLLED", initialValue: top, currentValue: top };
        }
        else if (g.location.zone === "GIGS") g.roll = { kind: "ROLLED", initialValue: 1, currentValue: 1 };
    }
    if (a.readySources !== undefined) {
        m.state.players[actor].zones.EDDIES.forEach((id, i) => { m.state.objects.cards[id].readiness = i < a.readySources! ? "READY" : "SPENT"; });
        for (const id of m.state.players[actor].zones.LEGENDS) m.state.objects.cards[id].readiness = "SPENT";
    }
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), unit: unit.id, octant: octant.id };
}
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
/** Declares the attack on the Octant and stops at the first choice of the paid power (or at Main if none comes). */
function attack(a: ReturnType<typeof arrange>): Step {
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.unit) as Step; const events = [...r.events];
    for (let n = 0; !mainIdle(r.state) && !isPaid(r.state); n++) {
        assert.ok(n < 20);
        r = (r.state.timing.step === "RIVAL_REACT" && !r.state.resolution.choice ? take(r.state, context, x => x.action.kind === "PASS_REACT")
            : r.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET") ? pick(r.state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.octant) : choose(r.state, context, 0)) as Step;
        events.push(...r.events);
    }
    return { state: r.state, events };
}
const isPaid = (s: GameState) => s.resolution.current?.effect.kind === "MAY_PAY_FOR_POWER_EQUAL_TO_FRIENDLY_MAX_GIG" && Boolean(s.resolution.choice);
/** Answers with `answer` on each paid-power choice, then lets the attack finish. */
function answer(r: Step, answers: ((c: DeepReadonly<PendingChoice>) => number)[]): Step {
    const events = [...r.events]; let s = r.state;
    for (const f of answers) { assert.ok(isPaid(s), `expected a paid-power choice at ${s.timing.step}`); const next = choose(s, context, f(s.resolution.choice!)); s = next.state; events.push(...(next.events as Events)); }
    assert.equal(isPaid(s), false, "no further paid-power choice");
    for (let n = 0; !mainIdle(s); n++) {
        assert.ok(n < 20);
        const next = s.timing.step === "RIVAL_REACT" && !s.resolution.choice ? take(s, context, x => x.action.kind === "PASS_REACT") : choose(s, context, 0);
        s = next.state; events.push(...(next.events as Events));
    }
    return { state: s, events };
}
const yes = (c: DeepReadonly<PendingChoice>) => c.options.findIndex(o => o.kind === "CONFIRM" && o.confirmed);
const no = (c: DeepReadonly<PendingChoice>) => c.options.findIndex(o => o.kind === "CONFIRM" && !o.confirmed);
const first = () => 0;
const power = (events: Events) => events.filter(e => e.payload.kind === "POWER_MODIFIER_APPLIED").map(e => (e.payload.modifier as { amount: number; scaled?: string }));
const fight = (events: Events) => events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload as unknown as { attackerComparisonPower: number; winnerId: string };

test("the V91 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(sombrero.provenance.sourceHash, hashCanonical(v91Source(sombrero.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === sombrero.id), [sombrero]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("El Sombrerón passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsTriggerCard]) assert.ok(gate(sombrero, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(sombrero) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["{Play} instead of {Attack}", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["plus Blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["power 5", d => { d.power = 5; }],
        ["cost 4", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["React scope", d => { d.execution = { scope: "COMBAT_REACT_V1", status: "SUPPORTED" }; }]
    ];
    for (const [name, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, name);
});

test("it pays 2 of its Eddies and gains a max Gig's value for its fight", () => {
    const a = arrange({ maxGigs: 1 }), gig = friendlyMaxGigs(a.state, actor)[0], top = Number(a.state.objects.gigs[gig].dieType.slice(1));
    const r = attack(a);
    assert.equal(r.state.resolution.choice?.kind, "OPTIONAL");
    const labels = actions(r.state, context).map(x => x.descriptor.label);
    assert.ok(labels.includes("Pay 2 to gain power equal to a friendly max Gig this turn") && labels.includes("Pay nothing"), labels.join(" | "));
    const done = answer(r, [yes, first, first]); // Accept, then two of the eight ready Eddies.
    const paid = done.events.find(e => e.payload.kind === "PAYMENT_MADE")!.payload.sources as { kind: string }[];
    assert.equal(paid.length, 2);
    assert.deepEqual(power(done.events).map(x => [x.amount, x.scaled]), [[top, "PAID_MAX_GIG"]]);
    assert.equal(fight(done.events).attackerComparisonPower, 4 + top);
});

test("declining pays nothing; paying without a max Gig gains nothing; with exactly 2 ready sources the payment is not a choice", () => {
    const declined = answer(attack(arrange({ maxGigs: 1 })), [no]);
    assert.equal(declined.events.some(e => e.payload.kind === "PAYMENT_MADE"), false);
    assert.deepEqual(power(declined.events), []);
    assert.equal(fight(declined.events).attackerComparisonPower, 4);
    const none = answer(attack(arrange({ maxGigs: 0, readySources: 2 })), [yes]);
    assert.equal((none.events.find(e => e.payload.kind === "PAYMENT_MADE")!.payload.sources as unknown[]).length, 2);
    assert.deepEqual(power(none.events), []);
});

test("with fewer than 2 €$ to pay with, nothing is offered", () => {
    const r = attack(arrange({ maxGigs: 1, readySources: 1 }));
    assert.equal(isPaid(r.state), false);
    assert.deepEqual(power(r.events), []);
});

test("max Gigs of different values are a choice; the chosen one's value is gained", () => {
    const a = arrange({ maxGigs: 2, readySources: 2 }), gigs = friendlyMaxGigs(a.state, actor);
    assert.equal(gigs.length, 2);
    const values = gigs.map(id => Number(a.state.objects.gigs[id].dieType.slice(1)));
    const smaller = gigs[values.indexOf(Math.min(...values))];
    const done = answer(attack(a), [yes, c => c.options.findIndex(o => o.kind === "GIG" && o.gigInstanceId === smaller)]);
    assert.deepEqual(power(done.events).map(x => x.amount), [Math.min(...values)]);
    assert.ok(done.events.some(e => e.payload.kind === "GIG_TARGET_SELECTED" && e.payload.gigInstanceId === smaller));
});

test("a paused payment holds only distinct ready sources short of the cost; a forged one is rejected", () => {
    const r = attack(arrange({ maxGigs: 1 }));
    const paying = choose(r.state, context, yes(r.state.resolution.choice!)).state;
    assert.equal(paying.resolution.triggerContinuation?.phase, "PAYMENT");
    const labels = actions(paying, context).map(x => x.descriptor.label); // 11.20.1: Eddies and/or Legends pay.
    assert.ok(labels.length === 11 && labels.every(l => l.startsWith("Pay with eddie") || l.startsWith("Pay with legend")), labels.join(" | "));
    const one = choose(paying, context, 0).state, held = one.resolution.triggerContinuation!.paymentSelected!;
    assert.equal(held.length, 1);
    const forged = GameStateSchema.parse(one);
    forged.objects.cards[held[0].cardInstanceId as CardInstanceId].readiness = "SPENT";
    assert.equal(validateState(forged, context).ok, false, "a selected source must still be ready");
    const doubled = GameStateSchema.parse(one); doubled.resolution.triggerContinuation!.paymentSelected = [held[0], held[0]];
    assert.equal(validateState(doubled, context).ok, false);
});
