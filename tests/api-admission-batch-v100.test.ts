import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsDefeatReplacementGear } from "../packages/engine/src/defeat-replacement-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV100Cards, batchV100Context, batchV100Input, v100Source, JACKIE } from "./api-admission-batch-v100-fixture";
import { DEADMAN } from "./api-admission-batch-v89-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV100Context();
const [jackie] = batchV100Cards;
// A vanilla power-4 Unit; a power-8 Unit; a Program that defeats a spent Unit; a Unit with a {Defeated} ability.
const ATLUS = "emergency-atlus", SQUAD = "octant", WILD = "wild-in-the-streets", SCREW = "screw-lovelorn-fool";
type Events = { payload: { kind: string } & Record<string, unknown> }[];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV100Input("batch-v100"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    const funded = fund(clearField(state, context), context);
    return fund(funded, context, funded.match.playerOrder.find(p => p !== funded.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { owner?: PlayerId; host?: string; gears?: string[]; readiness?: "READY" | "SPENT"; hand?: string[]; jackie?: "LEGENDS" | "FIELD" | "NONE"; broke?: boolean };
/** Trusted arrangement on the actor's MAIN: `host` (default Emergency Atlus) on `owner`'s field (default the actor's), ready unless
 * `readiness`, holding `gears`; a spent Octant on the other field; Jackie face up in `owner`'s Legends area (or on their field after Go
 * Solo); `hand` in the actor's hand. `broke` spends every source of `owner`'s €$. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), owner = a.owner ?? actor, other = owner === actor ? rival : actor;
    const put = (cardId: string, player: PlayerId) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c;
    };
    const host = put(a.host ?? ATLUS, owner), gears = (a.gears ?? []).map(id => put(id, owner).id), squad = put(SQUAD, other);
    host.attachments = [...gears].sort(); host.readiness = a.readiness ?? "READY"; squad.readiness = "SPENT";
    let legend: CardInstanceId | undefined;
    if ((a.jackie ?? "LEGENDS") === "LEGENDS") {
        const c = m.state.objects.cards[m.state.players[owner].zones.LEGENDS[0]];
        c.cardId = jackie.id; c.revision = jackie.revision; c.face = "UP"; c.readiness = "READY"; legend = c.id;
    } else if (a.jackie === "FIELD") {
        const c = put(JACKIE, owner); c.statuses = ["GO_SOLO"]; legend = c.id;
    }
    if (a.broke) for (const id of [...m.state.players[owner].zones.EDDIES, ...m.state.players[owner].zones.LEGENDS]) m.state.objects.cards[id].readiness = "SPENT";
    for (const id of a.hand ?? []) { const deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === id)!; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); }
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), host: host.id, gears, squad: squad.id, legend: legend! };
}
/** The host attacks the spent Octant and loses, up to the first pause that is not part of the attack itself. */
function attack(a: ReturnType<typeof arrange>) {
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.host); const events = [...r.events] as Events;
    for (let n = 0; !(r.state.timing.step === "MAIN" && r.state.timing.combat.stage === "NONE") && r.state.resolution.choice?.continuationId !== "legend-defeat-replacement@1"; n++) {
        assert.ok(n < 20);
        r = r.state.timing.step === "RIVAL_REACT" && !r.state.resolution.choice ? take(r.state, context, x => x.action.kind === "PASS_REACT")
            : r.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET") ? pick(r.state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.squad) : choose(r.state, context, 0);
        events.push(...r.events as Events);
    }
    return { state: r.state, events };
}
/** Takes `first`, then the first option of every later choice, until the Main Phase. */
function finish(s: GameState, first: (s: GameState) => { state: GameState; events: unknown[] }) {
    let r = first(s); const events = [...r.events] as Events;
    for (let n = 0; !(r.state.timing.step === "MAIN" && r.state.timing.combat.stage === "NONE"); n++) { assert.ok(n < 20); r = choose(r.state, context, 0); events.push(...r.events as Events); }
    return { state: r.state, events };
}
const payWith = (id: CardInstanceId) => (s: GameState) => pick(s, context, o => o.kind === "PAYMENT" && o.source.cardInstanceId === id);
const decline = (s: GameState) => pick(s, context, o => o.kind === "CONFIRM" && !o.confirmed);
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const name = (slug: string) => context.content.cards.find(c => c.id === slug)!.displayName;

test("the V100 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(jackie.provenance.sourceHash, hashCanonical(v100Source(jackie.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === jackie.id), [jackie]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Jackie Welles: Mama's Favorite passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsFieldLegend]) assert.ok(gate(jackie, context).ok, gate.name);
    assert.equal(supportsDefeatReplacementGear(jackie, context).ok, false, "the Gear table does not admit it");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(jackie) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no Go Solo", d => { d.mechanics.keywords = []; }],
        ["plus Blocker", d => { d.mechanics.keywords = ["GO_SOLO", "BLOCKER"]; }],
        ["power 7", d => { d.power = 7; }],
        ["cost 5", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["tags", d => { d.tags = ["Merc", "Valentino"]; }],
        ["not sellable", d => { d.sellProfile = { ...d.sellProfile, allowed: false }; }],
        ["field-Legend scope", d => { d.execution = { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsFieldLegend]) assert.equal(gate(forge(edit), context).ok, false, `${label} via ${gate.name}`);
});

test("a friendly Unit loses a fight: spending 1 €$ defeats Jackie instead, and the Unit stays on the field", () => {
    const a = arrange(), r = attack(a), eddie = a.state.players[actor].zones.EDDIES[0];
    const choice = r.state.resolution.choice!;
    assert.equal(choice.actorId, actor); assert.equal(r.state.timing.step, "DEFEAT_ORDER_SELECTION");
    assert.deepEqual(choice.options[0], { kind: "CONFIRM", confirmed: false });
    assert.ok(choice.options.some(o => o.kind === "PAYMENT" && o.source.cardInstanceId === a.legend), "Jackie herself is a source of 1 €$");
    const labels = actions(r.state, context).map(x => x.descriptor.label);
    assert.ok(labels.includes(`Let ${name(ATLUS)} (${a.host}) be defeated`), labels.join(" | "));
    assert.ok(labels.includes(`Pay 1 with eddie 1 to defeat ${name(JACKIE)} instead of ${name(ATLUS)} (${a.host})`), labels.join(" | "));
    const done = finish(r.state, payWith(eddie));
    assert.ok(done.events.some(e => e.payload.kind === "PAYMENT_MADE"));
    assert.ok(done.events.some(e => e.payload.kind === "DEFEAT_REPLACED" && e.payload.cardInstanceId === a.host && e.payload.replacementId === a.legend && e.payload.defeatedBy === a.squad));
    assert.ok(done.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.legend));
    assert.equal(done.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.host), false);
    assert.equal(zone(done.state, a.host), "BATTLEFIELD"); assert.equal(zone(done.state, a.legend), "REMOVED");
    assert.equal(done.state.objects.cards[eddie].readiness, "SPENT");
});

test("the offer may be declined; paying with Jackie herself works; with no €$ nothing is offered", () => {
    const a = arrange(), declined = finish(attack(a).state, decline);
    assert.ok(declined.events.some(e => e.payload.kind === "DEFEAT_REPLACEMENT_DECLINED" && e.payload.cardInstanceId === a.host && e.payload.legendId === a.legend && e.payload.playerId === actor));
    assert.equal(zone(declined.state, a.host), "TRASH"); assert.equal(zone(declined.state, a.legend), "LEGENDS");
    const self = finish(attack(a).state, payWith(a.legend));
    assert.equal(zone(self.state, a.host), "BATTLEFIELD"); assert.equal(zone(self.state, a.legend), "REMOVED");
    const broke = arrange({ broke: true }), none = attack(broke);
    assert.equal(none.events.some(e => (e.payload as { continuationId?: string }).continuationId === "legend-defeat-replacement@1"), false);
    assert.equal(zone(none.state, broke.host), "TRASH"); assert.equal(zone(none.state, broke.legend), "LEGENDS");
});

test("Jackie on the field after Go Solo replaces another friendly Unit's defeat; a Deadman Transmitter applies first", () => {
    const a = arrange({ jackie: "FIELD" }), r = attack(a);
    assert.equal(r.state.resolution.choice?.continuationId, "legend-defeat-replacement@1");
    const done = finish(r.state, payWith(a.state.players[actor].zones.EDDIES[0]));
    assert.equal(zone(done.state, a.host), "BATTLEFIELD"); assert.equal(zone(done.state, a.legend), "REMOVED");
    const d = arrange({ gears: [DEADMAN] }), deadman = attack(d);
    assert.equal(deadman.events.some(e => e.payload.kind === "DEFEAT_REPLACEMENT_DECLINED"), false);
    assert.equal(zone(deadman.state, d.host), "BATTLEFIELD"); assert.equal(zone(deadman.state, d.gears[0]), "TRASH"); assert.equal(zone(deadman.state, d.legend), "LEGENDS");
});

test("a rival effect defeat is offered to the defeated Unit's controller; replaced, its {Defeated} ability does not trigger", () => {
    const a = arrange({ owner: rival, host: SCREW, readiness: "SPENT", hand: [WILD] }), played = playCard(a.state, context, WILD);
    let s = played.state; const events = [...played.events] as Events;
    for (let n = 0; s.resolution.choice && s.resolution.choice.continuationId !== "legend-defeat-replacement@1"; n++) {
        assert.ok(n < 10); const r = s.resolution.choice.options.some(o => o.kind === "CARD" && o.cardInstanceId === a.host) ? pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.host) : choose(s, context, 0); s = r.state; events.push(...r.events as Events);
    }
    assert.equal(s.resolution.choice?.actorId, rival); assert.equal(s.timing.actingPlayer, rival);
    let r = payWith(s.players[rival].zones.EDDIES[0])(s); events.push(...r.events as Events);
    for (let n = 0; r.state.resolution.choice; n++) { assert.ok(n < 10); r = choose(r.state, context, 0); events.push(...r.events as Events); }
    assert.ok(events.some(e => e.payload.kind === "DEFEAT_REPLACED" && e.payload.cardInstanceId === a.host && e.payload.replacementId === a.legend));
    assert.equal(zone(r.state, a.host), "BATTLEFIELD"); assert.equal(zone(r.state, a.legend), "REMOVED");
    assert.equal(events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === a.host), false, "no {Defeated} trigger");
    assert.equal(r.state.timing.step, "MAIN"); assert.equal(r.state.timing.actingPlayer, actor);
});

test("Jackie never replaces her own defeat, and the open offer is validated exactly", () => {
    const a = arrange({ owner: rival, host: SCREW, readiness: "SPENT", hand: [WILD], jackie: "FIELD" }), m = new TurnMutation(a.state, context);
    m.state.objects.cards[a.host].readiness = "READY"; m.state.objects.cards[a.legend].readiness = "SPENT";
    let s = playCard(unwrap(validateState(m.state, context)), context, WILD).state; const events: Events = [];
    for (let n = 0; s.resolution.choice; n++) {
        assert.ok(n < 10); assert.notEqual(s.resolution.choice.continuationId, "legend-defeat-replacement@1");
        const r = s.resolution.choice.options.some(o => o.kind === "CARD" && o.cardInstanceId === a.legend) ? pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.legend) : choose(s, context, 0); s = r.state; events.push(...r.events as Events);
    }
    assert.equal(zone(s, a.legend), "REMOVED", "defeated after Go Solo, so removed from the game");
    const open = attack(arrange()).state, forged = GameStateSchema.parse(open);
    forged.resolution.choice = { ...forged.resolution.choice!, options: forged.resolution.choice!.options.slice(0, 1) };
    assert.equal(validateState(forged, context).ok, false, "the exact offer");
    const early = GameStateSchema.parse(open); early.resolution.defeatContinuation!.orders[0].cardIds = [early.resolution.defeatContinuation!.orders[0].targetId];
    assert.equal(validateState(early, context).ok, false, "no owner order before the offer");
});
