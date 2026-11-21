import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFreePlayCard } from "../packages/engine/src/free-play-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV68Cards, batchV68Context, batchV68Input, v68Source, PINCH } from "./api-admission-batch-v68-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV68Context();
const pinch = batchV68Cards[0];
const MANTIS = "mantis-blades", MANDIBULAR = "mandibular-upgrade", GORILLA = "gorilla-arms", PSYCHO = "psycho-squad"; // Cyberware 1, Cyberware 1, Cyberware 4, a vanilla Unit.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV68Input("batch-v68"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer;

/** Trusted arrangement on the actor's MAIN: Viktor in hand, the listed cards in the actor's trash and the listed Units ready on the
 * actor's field. */
function arrange(trash: string[], field: string[]) {
    const m = new TurnMutation(base, context), put = (cardId: string, zone: "TRASH" | "BATTLEFIELD" | "HAND") => {
        const deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
        if (zone !== "HAND") moveCardLocation(m, c.id, zone);
        if (zone === "BATTLEFIELD") { c.statuses = []; c.readiness = "READY"; }
        return c.id;
    };
    const viktor = put(PINCH, "HAND"), gear = trash.map(id => put(id, "TRASH")), units = field.map(id => put(id, "BATTLEFIELD"));
    return { state: unwrap(validateState(m.state, context)), viktor, gear, units };
}
/** Plays Viktor; a choice whose options are all among `ours` takes `picks` in order, any other (payment) takes its first option. */
function play(s: GameState, viktor: CardInstanceId, ours: CardInstanceId[], picks: CardInstanceId[] = []) {
    let r = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === viktor); const offered: CardInstanceId[][] = [];
    for (let n = 0; r.state.resolution.choice; n++) {
        assert.ok(n < 12); assert.ok(validateState(r.state, context).ok);
        const options = r.state.resolution.choice.options, ids = options.map(o => o.kind === "CARD" ? o.cardInstanceId : undefined);
        if (ids.every(id => id && ours.includes(id))) {
            offered.push(ids as CardInstanceId[]);
            r = choose(r.state, context, Math.max(ids.indexOf(picks.shift()), 0));
        } else r = choose(r.state, context, 0);
    }
    assert.equal(r.state.objects.cards[viktor].zone.zone, "BATTLEFIELD");
    return { state: r.state, offered };
}
const attachedTo = (s: GameState, gear: CardInstanceId) => Object.values(s.objects.cards).find(c => c.attachments?.includes(gear))?.id;

test("the V68 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(pinch.provenance.sourceHash, hashCanonical(v68Source(pinch.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === pinch.id), [pinch]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Viktor passes only his exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsFreePlayCard]) assert.ok(gate(pinch, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(pinch) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any Unit", d => { d.mechanics.abilities[0].effects = [{ kind: "PLAY_UNIT_FREE", from: "TRASH", maxCost: 9, exclude: "SUBJECT", then: "BOTTOM_DECK_SUBJECT" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["on attack", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["power", d => { d.power = 4; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsFreePlayCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("{Play}: a lone eligible Gear is played free from trash onto the lone other friendly Unit", () => {
    const a = arrange([MANTIS, GORILLA], [PSYCHO]), [mantis, gorilla] = a.gear, eddies = (s: GameState) => [...s.players[actor].zones.EDDIES, ...s.players[actor].zones.LEGENDS].filter(e => s.objects.cards[e].readiness === "READY").length;
    const before = eddies(a.state), r = play(a.state, a.viktor, [...a.gear, ...a.units]);
    assert.deepEqual(r.offered, [], "no choice: one eligible Gear, one host");
    assert.equal(r.state.objects.cards[mantis].zone.zone, "BATTLEFIELD"); assert.equal(attachedTo(r.state, mantis), a.units[0]);
    assert.equal(r.state.objects.cards[gorilla].zone.zone, "TRASH", "cost 4 is above 2");
    assert.equal(before - eddies(r.state), 3, "only Viktor's cost is paid");
    assert.equal(r.state.timing.step, "MAIN");
});

test("with several eligible Gear and hosts the controller chooses each; Viktor is never a host", () => {
    const a = arrange([MANTIS, MANDIBULAR], [PSYCHO, PSYCHO]), [mantis, mandibular] = a.gear, [first, second] = a.units;
    const r = play(a.state, a.viktor, [...a.gear, ...a.units, a.viktor], [mandibular, second]);
    assert.deepEqual(r.offered.map(o => [...o].sort()), [[mantis, mandibular].sort(), [first, second].sort()]);
    assert.equal(attachedTo(r.state, mandibular), second); assert.equal(r.state.objects.cards[mantis].zone.zone, "TRASH");
});

test("with no other friendly Unit, or no eligible Gear, it does nothing", () => {
    const lonely = arrange([MANTIS], []), r = play(lonely.state, lonely.viktor, [...lonely.gear, lonely.viktor]);
    assert.equal(r.state.objects.cards[lonely.gear[0]].zone.zone, "TRASH"); assert.deepEqual(r.offered, []);
    const none = arrange([GORILLA], [PSYCHO]), t = play(none.state, none.viktor, [...none.gear, ...none.units]);
    assert.equal(t.state.objects.cards[none.gear[0]].zone.zone, "TRASH"); assert.equal(t.state.objects.cards[none.units[0]].attachments?.length ?? 0, 0);
});

test("the reviewed union contains Viktor", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === PINCH));
});
