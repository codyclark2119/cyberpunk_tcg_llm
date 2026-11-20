import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV35Cards, batchV35Context, batchV35Input, v35Source, HANAKO_CAGE } from "./api-admission-batch-v35-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV35Context();
const hanako = batchV35Cards[0];
// Printed costs: Mantis Blades 1, Jacked-In Voodoo Boy 2, Emergency Atlus 3, Psycho Squad 4.
const MANTIS = "mantis-blades", VOODOO = "jacked-in-voodoo-boy", ATLUS = "emergency-atlus", SQUAD = "psycho-squad";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV35Input("batch-v35"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Hanako in hand (from the deck's bottom), then the top 4 deck cards become `top`, in order. */
function arrange(s: GameState, top: string[]) {
    const m = new TurnMutation(s, context), deck = m.state.players[actor].zones.DECK, revision = (id: string) => context.content.cards.find(c => c.id === id)!;
    const hand = m.state.objects.cards[deck[deck.length - 1]], h = revision(HANAKO_CAGE); hand.cardId = h.id; hand.revision = h.revision; moveCardLocation(m, hand.id, "HAND");
    const ids = m.state.players[actor].zones.DECK.slice(0, top.length);
    ids.forEach((id, i) => { const r = revision(top[i]); m.state.objects.cards[id].cardId = r.id; m.state.objects.cards[id].revision = r.revision; });
    return { state: unwrap(validateState(m.state, context)), ids };
}
/** Trusted arrangement: each listed die is rolled into its owner's Gig area at its value; all other dice wait in fixer areas. */
function gigs(s: GameState, rolled: { player: PlayerId; die: string; value: number }[]) {
    const d = GameStateSchema.parse(s);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const find = (x: { player: PlayerId; die: string }) => Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id;
    const chosen = new Map(rolled.map(x => [find(x), x.value]));
    for (const g of Object.values(d.objects.gigs)) {
        const value = chosen.get(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return unwrap(validateState(d, context));
}
// A friendly 3 and 4; the Rival's 2 is not friendly.
const ROLLED = [{ player: actor, die: "D4", value: 3 }, { player: actor, die: "D6", value: 4 }, { player: rival, die: "D8", value: 2 }];
const TOP = [MANTIS, ATLUS, VOODOO, SQUAD];
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const take1 = (s: GameState, id: CardInstanceId) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);
const bottom = (s: GameState, n: number) => s.players[actor].zones.DECK.slice(-n);

test("the V35 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(hanako.provenance.sourceHash, hashCanonical(v35Source(hanako.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === hanako.id), [hanako]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Hanako Arasaka: In a Gilded Cage passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(hanako, context).ok); assert.ok(supportsPlay(hanako, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(hanako) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["Gear search", d => { d.mechanics.abilities[0].effects = [{ kind: "SEARCH_GEAR", count: 4, maxTake: 2 }]; }],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["second ability", d => { d.mechanics.abilities.push({ ...d.mechanics.abilities[0], id: `${HANAKO_CAGE}-again@1`, trigger: "WHEN_DEFEATED" }); }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["power", d => { d.power = 2; }],
        ["tags", d => { d.tags = ["Arasaka"]; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("{Play} offers only looked-at cards costing a friendly Gig's value; any number are taken, the rest bottom-decked", () => {
    const a = arrange(gigs(base, ROLLED), TOP), [mantis, atlus, voodoo, squad] = a.ids;
    let s = playCard(a.state, context, HANAKO_CAGE).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(cards(s), [atlus, squad].sort(), "costs 3 and 4; the Rival's 2 does not count");
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "MODE" && o.mode === "DONE"));
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: voodoo });
    assert.equal(validateState(forged, context).ok, false);
    s = take1(s, squad).state;
    assert.equal(s.timing.step, "TARGET_SELECTION", "\"any number\": another may be taken"); assert.deepEqual(cards(s), [atlus]);
    const held = GameStateSchema.parse(s); held.resolution.searchContinuation!.selected = [voodoo];
    assert.equal(validateState(held, context).ok, false, "only an eligible card can be held as taken");
    const done = take1(s, atlus);
    assert.ok(done.state.players[actor].zones.HAND.includes(atlus) && done.state.players[actor].zones.HAND.includes(squad));
    assert.deepEqual(bottom(done.state, 2).sort(), [mantis, voodoo].sort());
    assert.equal(done.events.filter(e => e.payload.kind === "CARD_REVEALED").length, 2);
    assert.equal(done.state.timing.step, "MAIN");
});

test("the controller may stop early or take none; with no matching card all 4 are bottom-decked without a choice", () => {
    const a = arrange(gigs(base, ROLLED), TOP), [, atlus, , squad] = a.ids;
    const one = pick(take1(playCard(a.state, context, HANAKO_CAGE).state, atlus).state, context, o => o.kind === "MODE" && o.mode === "DONE").state;
    assert.ok(one.players[actor].zones.HAND.includes(atlus)); assert.ok(bottom(one, 3).includes(squad));
    const none = pick(playCard(a.state, context, HANAKO_CAGE).state, context, o => o.kind === "MODE" && o.mode === "DONE").state;
    assert.deepEqual(bottom(none, 4).sort(), [...a.ids].sort());
    const miss = arrange(gigs(base, [{ player: actor, die: "D4", value: 2 }, { player: rival, die: "D8", value: 3 }]), [MANTIS, ATLUS, SQUAD, MANTIS]);
    const played = playCard(miss.state, context, HANAKO_CAGE);
    assert.equal(played.state.timing.step, "MAIN");
    assert.deepEqual(bottom(played.state, 4).sort(), [...miss.ids].sort());
    assert.ok(played.events.some(e => e.payload.kind === "SEARCH_REMAINDER_BOTTOMED"));
});

test("the reviewed union admits the V35 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === HANAKO_CAGE));
});
