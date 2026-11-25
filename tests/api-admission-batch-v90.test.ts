import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV90Cards, batchV90Context, batchV90Input, v90Source, CYBERPSYCHOSIS } from "./api-admission-batch-v90-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV90Context();
const [cyber] = batchV90Cards;
const ATLUS = "emergency-atlus", OCTANT = "octant", BLADES = "mantis-blades", DEADMAN = "deadman-transmitter", FLATHEAD = "mt0d12-flathead";
// A vanilla power-4 Unit; a power-8 Unit; a vanilla +2 Gear; a Gear defeated instead of its host; a vanilla power-7 Unit.
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function main(s: GameState): GameState {
    while (s.setup) s = choose(s, context, s.setup.stage === "FIRST_PLAYER" && s.timing.actingPlayer !== s.match.playerOrder[0] ? 1 : 0).state;
    while (s.timing.step !== "MAIN") s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return s;
}
const first = main(unwrap(createGameWithEvents(batchV90Input("batch-v90"), context)).state);
const base = fund(clearField(first, context), context), actor = base.timing.activePlayer;
/** The Rival's first Main Phase, after the actor's empty turn, funded for both players. */
const rivalBase = (() => { let s = take(base, context, a => a.action.kind === "END_TURN").state; s = main(s); return fund(fund(s, context), context, actor); })();
/** The actor's second Main Phase, when the Rival has a Gig to steal. */
const laterBase = fund(main(take(rivalBase, context, a => a.action.kind === "END_TURN").state), context);

type Unit = { card?: string; gears?: string[]; readiness?: "READY" | "SPENT" };
/** Trusted arrangement on `from`'s Main: `mine` and `theirs` Units (with Gear) on the active and other player's fields, `hand` for `holder`. */
function arrange(from: GameState, mine: Unit[], theirs: Unit[], hand: { holder: PlayerId; cards: string[] }) {
    const m = new TurnMutation(from, context), active = from.timing.activePlayer, other = from.match.playerOrder.find(p => p !== active)!;
    const draw = (cardId: string, player: PlayerId) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    const put = (u: Unit, player: PlayerId) => {
        const host = draw(u.card ?? ATLUS, player); moveCardLocation(m, host.id, "BATTLEFIELD"); host.statuses = []; host.readiness = u.readiness ?? "READY";
        host.attachments = (u.gears ?? []).map(g => { const c = draw(g, player); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c.id; }).sort();
        return host.id;
    };
    const ids = { mine: mine.map(u => put(u, active)), theirs: theirs.map(u => put(u, other)) };
    for (const id of hand.cards) draw(id, hand.holder);
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), ...ids };
}
/** Takes the first option of every pending choice (picking `target` when offered) until `done`. */
function settle(r: Step, done: (s: GameState) => boolean, target?: CardInstanceId): Step {
    const events = [...r.events]; let s = r.state;
    for (let n = 0; !done(s); n++) {
        assert.ok(n < 30, `stuck at ${s.timing.step}`);
        const next = s.timing.step === "RIVAL_REACT" && !s.resolution.choice ? take(s, context, x => x.action.kind === "PASS_REACT")
            : target && s.resolution.choice?.options.some(o => (o.kind === "CARD" && o.cardInstanceId === target) || (o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target))
                ? pick(s, context, o => (o.kind === "CARD" && o.cardInstanceId === target) || (o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target))
                : choose(s, context, 0);
        s = next.state; events.push(...(next.events as Events));
    }
    return { state: s, events };
}
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
function cast(s: GameState, target: CardInstanceId) { return settle(playCard(s, context, CYBERPSYCHOSIS) as Step, mainIdle, target); }
/** `attacker` attacks `target` (a Unit id, or the defending player for a Gig attack); every later choice takes its first option. */
function attack(s: GameState, attacker: CardInstanceId, target?: CardInstanceId) {
    const r = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === attacker);
    return settle(r as Step, mainIdle, target);
}
function endTurn(s: GameState) {
    const turn = s.timing.turn, r = take(s, context, a => a.action.kind === "END_TURN") as Step;
    return settle(r, x => x.timing.turn !== turn);
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));

test("the V90 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(cyber.provenance.sourceHash, hashCanonical(v90Source(cyber.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === cyber.id), [cyber]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Cyberpsychosis passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsTargetedDefeatCard]) assert.ok(gate(cyber, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(cyber) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const effect = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as Record<string, unknown>;
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["+2 per Gear", d => { effect(d).amount = 2; }],
        ["no end-of-turn defeat", d => { delete effect(d).ifStealsOrFights; }],
        ["defeats the opposing Unit", d => { effect(d).ifStealsOrFights = { timing: "END_OF_TURN", effect: { kind: "DEFEAT_UNIT", target: { kind: "OPPOSING_UNIT" } } }; }],
        ["not Quick", d => { d.mechanics.keywords = []; }],
        ["cost 2", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["tags", d => { d.tags = ["Braindance"]; }],
        ["React scope", d => { d.execution = { scope: "COMBAT_REACT_V1", status: "SUPPORTED" }; }]
    ];
    for (const [name, edit] of forgeries) {
        let forged: CardRevisionSnapshot;
        try { forged = forge(edit); } catch { continue; } // A shape the schema itself refuses is rejected too.
        for (const gate of [supportsPlay, supportsTargetedDefeatCard]) assert.equal(gate(forged, context).ok, false, name);
    }
});

test("only equipped Units are offered, either player's; +3 per Gear, and with no fight or steal nothing happens at end of turn", () => {
    const a = arrange(base, [{ gears: [BLADES, BLADES] }, { card: FLATHEAD }], [{ card: OCTANT, gears: [BLADES] }], { holder: actor, cards: [CYBERPSYCHOSIS] });
    const played = playCard(a.state, context, CYBERPSYCHOSIS);
    assert.deepEqual(played.state.resolution.choice?.options.map(o => o.kind === "CARD" ? o.cardInstanceId : o.kind).sort(), [a.mine[0], a.theirs[0]].sort(), "the unequipped Flathead is not offered");
    const r = settle(played as Step, mainIdle, a.mine[0]);
    const power = r.events.find(e => e.payload.kind === "POWER_MODIFIER_APPLIED")!.payload.modifier as { amount: number; targetId: string };
    assert.deepEqual([power.amount, power.targetId], [6, a.mine[0]]);
    assert.ok(has(r.events, "END_TURN_DEFEAT_REGISTERED"));
    const ended = endTurn(r.state);
    assert.equal(zone(ended.state, a.mine[0]), "BATTLEFIELD");
    assert.equal(has(ended.events, "CARD_DEFEATED"), false);
});

test("it fights: the Unit wins with +6 and is defeated at the end of the turn, its owner ordering the trash", () => {
    const a = arrange(base, [{ gears: [BLADES, BLADES] }], [{ card: OCTANT, readiness: "SPENT" }], { holder: actor, cards: [CYBERPSYCHOSIS] });
    const cast1 = cast(a.state, a.mine[0]);
    const fought = attack(cast1.state, a.mine[0], a.theirs[0]);
    const result = fought.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload as unknown as { winnerId: string; attackerComparisonPower: number };
    assert.deepEqual([result.winnerId, result.attackerComparisonPower], [a.mine[0], 14], "4 + 2 + 2 + 6");
    assert.ok(has(fought.events, "END_TURN_DEFEAT_ARMED", p => p.subjectId === a.mine[0] && p.by === "FIGHT"));
    assert.equal(zone(fought.state, a.mine[0]), "BATTLEFIELD");
    const ended = endTurn(fought.state);
    assert.ok(has(ended.events, "CARD_DEFEATED", p => p.cardInstanceId === a.mine[0]));
    assert.equal(zone(ended.state, a.mine[0]), "TRASH");
    assert.ok(ended.state.players[actor].zones.TRASH.includes(a.mine[0]));
});

test("it steals: a Gig attack arms the defeat too", () => {
    const a = arrange(laterBase, [{ gears: [BLADES] }], [], { holder: actor, cards: [CYBERPSYCHOSIS] });
    const stolen = attack(cast(a.state, a.mine[0]).state, a.mine[0]);
    assert.ok(has(stolen.events, "GIG_STOLEN", p => p.attackerId === a.mine[0]));
    assert.ok(has(stolen.events, "END_TURN_DEFEAT_ARMED", p => p.by === "STEAL"));
    assert.equal(zone(endTurn(stolen.state).state, a.mine[0]), "TRASH");
});

test("a Unit that leaves the field takes no record with it; a Deadman Transmitter is defeated instead at the end of the turn", () => {
    const lost = arrange(base, [{ gears: [BLADES] }], [{ card: FLATHEAD, gears: [BLADES, BLADES], readiness: "SPENT" }], { holder: actor, cards: [CYBERPSYCHOSIS] });
    const cast1 = cast(lost.state, lost.mine[0]), fought = attack(cast1.state, lost.mine[0], lost.theirs[0]);
    assert.equal(zone(fought.state, lost.mine[0]), "TRASH", "7 + 4 beats 4 + 2 + 3");
    assert.equal(fought.state.turnHistory?.endTurnDefeats, undefined);
    const replaced = arrange(base, [{ gears: [DEADMAN, BLADES] }], [{ card: OCTANT, readiness: "SPENT" }], { holder: actor, cards: [CYBERPSYCHOSIS] });
    const ended = endTurn(attack(cast(replaced.state, replaced.mine[0]).state, replaced.mine[0], replaced.theirs[0]).state);
    const transmitter = replaced.state.objects.cards[replaced.mine[0]].attachments.find(id => replaced.state.objects.cards[id].cardId === DEADMAN)!;
    assert.ok(has(ended.events, "DEFEAT_REPLACED", p => p.cardInstanceId === replaced.mine[0] && p.replacementId === transmitter));
    assert.equal(zone(ended.state, replaced.mine[0]), "BATTLEFIELD"); assert.equal(zone(ended.state, transmitter), "TRASH");
});

test("played in the Rival's attack on their attacker: it fights, and their Unit is defeated at the end of their turn", () => {
    const a = arrange(rivalBase, [{ gears: [BLADES] }], [{ card: OCTANT, readiness: "SPENT" }], { holder: actor, cards: [CYBERPSYCHOSIS] });
    // The Rival (active) attacks the actor's spent Octant; the actor answers in the React Step.
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.mine[0]) as Step;
    r = settle(r, s => s.timing.step === "RIVAL_REACT" && !s.resolution.choice || mainIdle(s), a.theirs[0]);
    assert.equal(r.state.timing.step, "RIVAL_REACT");
    const reacted = settle(playCard(r.state, context, CYBERPSYCHOSIS) as Step, s => s.timing.step === "RIVAL_REACT" && !s.resolution.choice || mainIdle(s), a.mine[0]);
    assert.ok(has(reacted.events, "END_TURN_DEFEAT_REGISTERED", p => (p.record as { controllerId: string }).controllerId === actor));
    const fought = settle(reacted, mainIdle);
    assert.ok(has(fought.events, "FIGHT_RESULT", p => p.winnerId === a.mine[0]), "4 + 2 + 3 beats 8");
    const ended = endTurn(fought.state);
    assert.ok(has(ended.events, "CARD_DEFEATED", p => p.cardInstanceId === a.mine[0]));
    assert.equal(zone(ended.state, a.mine[0]), "TRASH");
});

test("a record needs its own resolved effect and a face-up field Unit; a forged one is rejected", () => {
    const a = arrange(base, [{ gears: [BLADES] }, { card: FLATHEAD }], [], { holder: actor, cards: [CYBERPSYCHOSIS] }), s = cast(a.state, a.mine[0]).state;
    assert.equal(s.turnHistory?.endTurnDefeats?.length, 1);
    const forged = (edit: (d: { id: string; subjectId: string; armed: boolean; abilityId: string }) => void) => { const d = GameStateSchema.parse(s); edit(d.turnHistory!.endTurnDefeats![0]); return validateState(d, context).ok; };
    assert.equal(forged(() => undefined), true);
    assert.equal(forged(d => { d.id = hashCanonical({ forged: true }); }), false, "identity derives from the resolved effect");
    assert.equal(forged(d => { d.subjectId = s.players[actor].zones.DECK[0]; }), false, "the Unit must be on the field");
    assert.equal(forged(d => { d.abilityId = "other@1"; }), false);
});
