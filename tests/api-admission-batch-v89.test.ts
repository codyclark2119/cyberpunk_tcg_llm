import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsCapabilityGear } from "../packages/engine/src/capability-support";
import { defeatBatch, defeatReplacement } from "../packages/engine/src/defeat";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV89Cards, batchV89Context, batchV89Input, v89Source, DEADMAN } from "./api-admission-batch-v89-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV89Context();
const [deadman] = batchV89Cards;
const ATLUS = "emergency-atlus", SQUAD = "octant", NETDRIVER = "netwatch-netdriver", WILD = "wild-in-the-streets", SCREW = "screw-lovelorn-fool";
// A vanilla power-4 Unit; a power-8 Unit; a Gear whose holder draws 1 when spent; a Program that defeats a spent Unit; a Unit with a {Defeated} ability.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV89Input("batch-v89"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { owner?: PlayerId; host?: string; gears?: string[]; readiness?: "READY" | "SPENT"; hand?: string[] };
/** Trusted arrangement on the actor's MAIN: `host` (default Emergency Atlus) on `owner`'s field (default the actor's), ready unless
 * `readiness`, holding `gears` (default one Deadman Transmitter); a spent Octant on the other field; `hand` in the actor's hand. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), owner = a.owner ?? actor, other = owner === actor ? rival : actor;
    const put = (cardId: string, player: PlayerId) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c;
    };
    const host = put(a.host ?? ATLUS, owner), gears = (a.gears ?? [DEADMAN]).map(id => put(id, owner).id), squad = put(SQUAD, other);
    host.attachments = [...gears].sort(); host.readiness = a.readiness ?? "READY"; squad.readiness = "SPENT";
    for (const id of a.hand ?? []) { const deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === id)!; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); }
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), host: host.id, gears, squad: squad.id };
}
/** The host attacks the spent Octant and loses; every later choice takes its first option, until the Main Phase. */
function attack(a: ReturnType<typeof arrange>) {
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.host); const events = [...r.events];
    for (let n = 0; !(r.state.timing.step === "MAIN" && r.state.timing.combat.stage === "NONE"); n++) {
        assert.ok(n < 20);
        r = r.state.timing.step === "RIVAL_REACT" && !r.state.resolution.choice ? take(r.state, context, x => x.action.kind === "PASS_REACT")
            : r.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET") ? pick(r.state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.squad) : choose(r.state, context, 0);
        events.push(...r.events);
    }
    return { state: r.state, events };
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);

test("the V89 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(deadman.provenance.sourceHash, hashCanonical(v89Source(deadman.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === deadman.id), [deadman]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Deadman Transmitter passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsTriggerCard]) assert.ok(gate(deadman, context).ok);
    assert.equal(supportsCapabilityGear(deadman, context).ok, false, "the capability table does not admit it");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(deadman) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no printed power", d => { d.mechanics.modifiers = [{ kind: "DEFEAT_THIS_GEAR_INSTEAD_OF_HOST" }]; }],
        ["plus Blocker", d => { d.mechanics.modifiers.push({ kind: "GRANT_KEYWORD_TO_HOST", keyword: "BLOCKER" }); }],
        ["power 2", d => { d.power = 2; }],
        ["cost 2", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["tags", d => { d.tags = ["Cyberware"]; }],
        ["Gear scope", d => { d.execution = { scope: "GEAR_CAPABILITIES_V1", status: "SUPPORTED" }; }]
    ];
    for (const [name, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, name);
});

test("its host loses a fight: the Transmitter is defeated instead, and the host stays on the field", () => {
    const a = arrange(), r = attack(a);
    const fight = r.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload as { loserIds: string[] };
    assert.deepEqual(fight.loserIds, [a.host], "the host still lost");
    assert.ok(r.events.some(e => e.payload.kind === "DEFEAT_REPLACED" && e.payload.cardInstanceId === a.host && e.payload.replacementId === a.gears[0] && e.payload.defeatedBy === a.squad));
    assert.ok(r.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.gears[0]));
    assert.equal(r.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.host), false);
    assert.equal(zone(r.state, a.host), "BATTLEFIELD"); assert.equal(zone(r.state, a.gears[0]), "TRASH");
    assert.deepEqual(r.state.objects.cards[a.host].attachments, []);
    assert.equal(kinds(r.events).includes("PHASE_CHANGED") && r.events.some(e => e.payload.kind === "PHASE_CHANGED" && e.payload.step === "DEFEAT_ORDER_SELECTION"), false, "no trash order to choose");
});

test("with another Gear only the Transmitter goes; with two Transmitters only one; with none the host is defeated", () => {
    const other = attack(arrange({ gears: [DEADMAN, NETDRIVER] })).state, a = arrange({ gears: [DEADMAN, NETDRIVER] });
    const [transmitter, netdriver] = a.gears;
    assert.equal(zone(other, a.host), "BATTLEFIELD"); assert.equal(zone(other, transmitter), "TRASH"); assert.equal(zone(other, netdriver), "BATTLEFIELD");
    assert.deepEqual(other.objects.cards[a.host].attachments, [netdriver]);
    const two = arrange({ gears: [DEADMAN, DEADMAN] }), s = attack(two).state, lowest = [...two.gears].sort()[0];
    assert.equal(defeatReplacement(two.state, two.host, context), lowest); assert.deepEqual(defeatBatch(two.state, two.host, context), [lowest]);
    assert.equal(zone(s, two.host), "BATTLEFIELD"); assert.equal(zone(s, lowest), "TRASH"); assert.deepEqual(s.objects.cards[two.host].attachments, two.gears.filter(g => g !== lowest));
    const none = arrange({ gears: [NETDRIVER] }), plain = attack(none);
    assert.equal(zone(plain.state, none.host), "TRASH"); assert.equal(plain.events.some(e => e.payload.kind === "DEFEAT_REPLACED"), false);
});

test("an effect defeat is replaced too, and the host's {Defeated} ability does not trigger", () => {
    const a = arrange({ owner: rival, host: SCREW, readiness: "SPENT", hand: [WILD] }), played = playCard(a.state, context, WILD);
    let s = played.state; const events = [...played.events];
    for (let n = 0; s.resolution.choice; n++) { assert.ok(n < 10); const r = s.resolution.choice.options.some(o => o.kind === "CARD" && o.cardInstanceId === a.host) ? pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.host) : choose(s, context, 0); s = r.state; events.push(...r.events); }
    assert.ok(events.some(e => e.payload.kind === "DEFEAT_REPLACED" && e.payload.cardInstanceId === a.host));
    assert.equal(zone(s, a.host), "BATTLEFIELD"); assert.equal(zone(s, a.gears[0]), "TRASH");
    assert.equal(events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === a.host), false, "no {Defeated} trigger");
    assert.equal(s.timing.step, "MAIN");
});

test("a Transmitter another player controls replaces nothing, and a Gear itself is never replaced", () => {
    const a = arrange(), d = GameStateSchema.parse(a.state);
    d.objects.cards[a.gears[0]].controllerId = rival;
    assert.equal(defeatReplacement(d, a.host, context), undefined);
    assert.equal(defeatReplacement(a.state, a.gears[0], context), undefined, "a Gear is not a Unit that would be defeated");
});
