import test from "node:test";
import assert from "node:assert/strict";
import { validateDeck, type GameState } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, listLegalActions, resolveActionId, validateState } from "@tcg/engine";
import { constructedContext, constructedDeck, constructedInput, constructedReferenceDecks } from "./constructed-format-fixture";

const context = constructedContext(), file = constructedReferenceDecks();
const constructed = { format: "CONSTRUCTED" as const, availability: { kind: "CATALOG" as const } };

function play(seed: string, pick: (count: number, step: number) => number, maxDecisions = 3000) {
    const created = createGameWithEvents(constructedInput(seed), context);
    assert.ok(created.ok, JSON.stringify(!created.ok && created.errors));
    let s: GameState = created.value.state, n = 0;
    for (; n < maxDecisions && !s.match.outcome; n++) {
        const actor = s.timing.actingPlayer, offered = listLegalActions(s, actor, context);
        assert.ok(offered.ok, JSON.stringify(!offered.ok && offered.errors));
        assert.ok(offered.value.length > 0, "an unfinished game must offer an action");
        const chosen = offered.value[pick(offered.value.length, n)]!;
        const action = resolveActionId(s, actor, chosen.actionId, context);
        assert.ok(action.ok, JSON.stringify(!action.ok && action.errors));
        const applied = applyAction(s, action.value, context);
        assert.ok(applied.ok, JSON.stringify(!applied.ok && applied.errors));
        s = applied.value.state;
    }
    return { state: s, decisions: n };
}

test("the reference decks are legal CONSTRUCTED decks of reviewed executable revisions", () => {
    for (const deck of file.decks) {
        const result = validateDeck(constructedDeck(deck), context.content.cards, context.content.ruleset, constructed);
        assert.deepEqual(result.issues, [], deck.id);
        assert.equal(result.mainDeckCount, 40);
        assert.equal(deck.legends.length, 3);
    }
    for (const card of context.content.cards) assert.equal(card.schemaVersion === 2 && card.execution?.status, "SUPPORTED", card.id);
});

test("a CONSTRUCTED game initializes through engine setup and validates", () => {
    const created = createGameWithEvents(constructedInput("constructed-init"), context);
    assert.ok(created.ok, JSON.stringify(!created.ok && created.errors));
    const s = created.value.state;
    assert.equal(s.match.format, undefined, "CONSTRUCTED keeps the legacy format-less match record");
    assert.equal(s.firstPlayerRolls, undefined, "Demo's literal d20 rolls are Demo-only");
    assert.equal(s.setup?.stage, "FIRST_PLAYER");
    assert.ok(validateState(s, context).ok);
});

for (const seed of ["constructed-0", "constructed-1", "constructed-2"]) {
    test(`${seed}: plays to an engine outcome choosing first and last offered actions`, () => {
        for (const pick of [(_: number) => 0, (count: number) => count - 1]) {
            const { state } = play(seed, pick);
            assert.ok(state.match.outcome, "game must finish");
            assert.equal(state.timing.step, "FINISHED");
        }
    });
}

test("CONSTRUCTED games are deterministic for a seed", () => {
    const pick = (count: number, step: number) => (step * 7) % count;
    const a = play("constructed-det", pick), b = play("constructed-det", pick);
    assert.equal(a.decisions, b.decisions);
    assert.equal(hashPosition(a.state), hashPosition(b.state));
});

test("CONSTRUCTED decks are held to the deck rules at createGame", () => {
    const base = constructedInput("constructed-bad");
    const short = { ...base, decks: [{ ...base.decks[0]!, main: base.decks[0]!.main.slice(0, 39) }, base.decks[1]!] };
    const r1 = createGameWithEvents(short, context);
    assert.equal(r1.ok, false); assert.ok(!r1.ok && r1.errors.some(e => e.code === "INVALID_DECK" && e.message.includes("MAIN_DECK_SIZE")));
    const main = base.decks[0]!.main, repeated = main.find(id => main.filter(x => x === id).length === 3)!;
    const fourth = { ...base, decks: [{ ...base.decks[0]!, main: [...main, repeated] }, base.decks[1]!] };
    const r2 = createGameWithEvents(fourth, context);
    assert.equal(r2.ok, false); assert.ok(!r2.ok && r2.errors.some(e => e.code === "INVALID_DECK" && e.message.includes("COPY_LIMIT")));
    const twoLegends = { ...base, decks: [{ ...base.decks[0]!, legends: base.decks[0]!.legends.slice(0, 2) }, base.decks[1]!] };
    const r3 = createGameWithEvents(twoLegends, context);
    assert.equal(r3.ok, false); assert.ok(!r3.ok && r3.errors.some(e => e.code === "INVALID_DECK"), JSON.stringify(!r3.ok && r3.errors));
});

test("a CONSTRUCTED deck cannot be smuggled in as Demo", () => {
    const r = createGameWithEvents({ ...constructedInput("constructed-as-demo"), format: "DEMO_STARTER_V1" }, context);
    assert.equal(r.ok, false); assert.ok(!r.ok && r.errors.some(e => e.code === "DEMO_MANIFEST_MISMATCH"));
});
