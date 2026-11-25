import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { attachedGear } from "../packages/engine/src/attachments";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV82Cards, batchV82Context, batchV82Input, v82Source } from "./api-admission-batch-v82-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV82Context();
const [panam] = batchV82Cards;
const ATLUS = "emergency-atlus", SQUAD = "psycho-squad", BLADES = "mantis-blades"; // Vanilla Units of power 4 and 6; a +2 power Gear.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV82Input("batch-v82"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context);
}
const base = setup(), actor = base.timing.activePlayer;

type Arrangement = { onPanam?: number; units?: [string, number, "READY" | "SPENT"][] };
/** Trusted arrangement on the actor's MAIN: Panam as the actor's last Legend, face up and ready, holding `onPanam` Mantis Blades (default
 * 1); and `units` on the actor's field as [card, attached Mantis Blades, readiness] (default one spent, unequipped Emergency Atlus). */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), take1 = (cardId: string) => {
        const deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    const legends = m.state.players[actor].zones.LEGENDS, l = m.state.objects.cards[legends[legends.length - 1]];
    l.cardId = panam.id; l.revision = panam.revision; l.face = "UP"; l.readiness = "READY";
    const equip = (hostId: CardInstanceId, zone: "LEGENDS" | "BATTLEFIELD") => { const g = take1(BLADES); moveCardLocation(m, g.id, zone); m.state.objects.cards[hostId].attachments.push(g.id); return g.id; };
    const blades = Array.from({ length: a.onPanam ?? 1 }, () => equip(l.id, "LEGENDS")), units: CardInstanceId[] = [];
    for (const [cardId, gear, readiness] of a.units ?? [[ATLUS, 0, "SPENT"]]) {
        const c = take1(cardId); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = readiness; units.push(c.id);
        for (let i = 0; i < gear; i++) equip(c.id, "BATTLEFIELD");
    }
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), panam: l.id, blades, units };
}
const label = (s: GameState) => actions(s, context).find(x => x.action.kind === "ACTIVATE_ABILITY" && x.descriptor.label.startsWith(`Activate ${panam.displayName}`))?.descriptor.label;
/** Activates Panam, paying with Eddies only, until no payment choice remains. */
function activate(s: GameState) {
    let r = take(s, context, x => x.action.kind === "ACTIVATE_ABILITY" && x.descriptor.label.startsWith(`Activate ${panam.displayName}`)); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0); r = choose(r.state, context, i); events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}
const gearOn = (s: GameState, id: CardInstanceId) => attachedGear(s, id, context).map(g => g.id);

test("the V82 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(panam.provenance.sourceHash, hashCanonical(v82Source(panam.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === panam.id), [panam]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Panam Palmer: Nomad Cavalry passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsLegendSpendCard(panam, context).ok);
    assert.ok(supportsTriggerCard(panam, context).ok, "its end-of-turn trigger routes to the Legend pin");
    assert.equal(supportsFieldLegend(panam, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(panam) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["cost 1", d => { d.mechanics.abilities[0].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }]; }],
        ["Quick", d => { d.mechanics.abilities[0].activation!.timing = "QUICK"; }],
        ["no end-turn ready", d => { d.mechanics.abilities = [d.mechanics.abilities[0]]; }],
        ["start of turn", d => { d.mechanics.abilities[1].trigger = "WHEN_OWN_TURN_STARTS"; }],
        ["tags", d => { d.tags = ["Merc", "Nomad"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }]
    ];
    for (const [name, edit] of forgeries) assert.equal(supportsLegendSpendCard(forge(edit), context).ok, false, name);
});

test("a lone Gear moves to a lone unequipped Unit without a choice, and the Unit readies", () => {
    const a = arrange(), [unit] = a.units, [blade] = a.blades;
    assert.equal(label(a.state), `Activate ${panam.displayName}: Pay 2 and spend to move a Gear from it to an unequipped friendly Unit and ready that Unit`);
    const r = activate(a.state), s = r.state;
    assert.ok(r.events.some(e => e.payload.kind === "GEAR_MOVED" && e.payload.gearInstanceId === blade && e.payload.fromHostId === a.panam && e.payload.toHostId === unit));
    assert.deepEqual(gearOn(s, a.panam), []); assert.deepEqual(gearOn(s, unit), [blade]);
    assert.equal(s.objects.cards[blade].zone.zone, "BATTLEFIELD");
    assert.equal(s.objects.cards[unit].readiness, "READY");
    assert.equal(s.objects.cards[a.panam].readiness, "SPENT");
    assert.equal(effectivePower(s, unit, context), 6);
    assert.equal(s.timing.step, "MAIN");
});

test("with two Gear and two unequipped Units the controller chooses each; equipped Units are not offered", () => {
    const a = arrange({ onPanam: 2, units: [[ATLUS, 0, "SPENT"], [SQUAD, 0, "SPENT"], [ATLUS, 1, "SPENT"]] }), [atlus, squad, equipped] = a.units;
    const s = activate(a.state).state;
    assert.deepEqual(actions(s, context).map(x => x.descriptor.label).sort(), a.blades.map(id => `Move ${context.content.cards.find(r => r.id === BLADES)!.displayName} (${id}) off ${panam.displayName}`).sort());
    const gear = a.blades[1], second = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === gear);
    assert.ok(validateState(second.state, context).ok);
    assert.equal(second.state.resolution.playContinuation?.movedGearId, gear);
    assert.deepEqual(second.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [atlus, squad].sort());
    const done = pick(second.state, context, o => o.kind === "CARD" && o.cardInstanceId === squad);
    assert.deepEqual(gearOn(done.state, squad), [gear]); assert.deepEqual(gearOn(done.state, a.panam), [a.blades[0]]);
    assert.equal(done.state.objects.cards[squad].readiness, "READY");
    assert.equal(done.state.objects.cards[atlus].readiness, "SPENT"); assert.equal(done.state.objects.cards[equipped].readiness, "SPENT");
    assert.equal(done.state.timing.step, "MAIN");
});

test("with no Gear on Panam, or no unequipped Unit, nothing moves and nothing readies", () => {
    for (const a of [arrange({ onPanam: 0 }), arrange({ units: [[ATLUS, 1, "SPENT"]] })]) {
        const r = activate(a.state);
        assert.equal(r.events.some(e => e.payload.kind === "GEAR_MOVED" || e.payload.kind === "CARD_READIED"), false);
        assert.equal(r.state.objects.cards[a.units[0]].readiness, "SPENT");
        assert.equal(r.state.objects.cards[a.panam].readiness, "SPENT");
        assert.equal(r.state.timing.step, "MAIN");
    }
});

test("at the end of the turn, 5 equipped friendly Units and Legends ready; 4 do not", () => {
    const four: Arrangement["units"] = [[ATLUS, 1, "SPENT"], [SQUAD, 1, "SPENT"], [ATLUS, 1, "SPENT"], [SQUAD, 1, "SPENT"]];
    for (const [units, ready] of [[four, true], [four.slice(1), false]] as const) {
        const a = arrange({ units: [...units] }), d = GameStateSchema.parse(a.state);
        d.objects.cards[a.panam].readiness = "SPENT";
        const ended = take(unwrap(validateState(d, context)), context, x => x.action.kind === "END_TURN");
        assert.ok(ended.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === ready), String(ready));
        for (const id of [a.panam, ...a.units]) assert.equal(ended.state.objects.cards[id].readiness, ready ? "READY" : "SPENT", `${id} ${ready}`);
        assert.notEqual(ended.state.timing.activePlayer, actor);
    }
});

test("a held Gear is validated", () => {
    const a = arrange({ onPanam: 2, units: [[ATLUS, 0, "SPENT"], [SQUAD, 0, "SPENT"]] }), s = pick(activate(a.state).state, context, o => o.kind === "CARD" && o.cardInstanceId === a.blades[0]).state;
    const tamper = (edit: (d: ReturnType<typeof GameStateSchema.parse>) => void) => { const d = GameStateSchema.parse(s); edit(d); return validateState(d, context).ok; };
    assert.ok(tamper(() => undefined));
    assert.equal(tamper(d => { d.resolution.playContinuation!.movedGearId = a.units[0]; }), false, "not a Gear on Panam");
    assert.equal(tamper(d => { delete d.resolution.playContinuation!.movedGearId; }), false, "the Unit choice without its held Gear");
});
