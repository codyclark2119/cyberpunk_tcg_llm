import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CardSchema, CardRevisionSnapshotSchema, CardRevisionSchema, ContentBundleSchema, DeckSchema, DemoStarterPolicySchema, GameStateSchema, RulesetSchema, createContentBundle, demoManifests, hashCanonical, matchDemoManifest, normalizeDemoEntries, validateDeck, type Deck, type Result } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, resolveActionId, validateState } from "@tcg/engine";
import { handleRequest } from "@tcg/wire";
import { selectOpposedD20 } from "../packages/engine/src/first-player";
import { drawDeterministicInteger } from "../packages/engine/src/rng";
import { demoStarterContext, demoStarterInput } from "./demo-starter-fixture";
import { demoSetupReplay } from "./demo-setup-replay";
import { attackPowerContext, attackPowerInput } from "./attack-condition-power-fixture";
import { demoReferenceContext, demoReferences, referenceDeck } from "./demo-format-fixture";
import { unwrap } from "./turn-replay";
import vectors from "./fixtures/demo-first-player-vectors.v1.json";
import policy from "./fixtures/demo-application-policy.v1.json";
import golden from "./fixtures/demo-setup-replay.v1.json";
const context = demoStarterContext(), trace = demoSetupReplay(), initial = trace.initialized.state;
function failureCode<T>(result: Result<T>, code: string) { assert.equal(result.ok, false); if (result.ok) assert.fail("Unexpected success"); assert.ok(result.errors.some(e => e.code === code), JSON.stringify(result.errors)); }
const validate = (d: Deck) => validateDeck(d, context.content.cards, context.content.ruleset, { format: "DEMO_STARTER_V1", availability: { kind: "CATALOG" } });

for (const manifest of demoReferences) {
    test(manifest.id + " admits the exact normalized 27+3 with standard copy/RAM/name checks", () => {
        const deck = referenceDeck(manifest), result = validate(deck);
        assert.equal(matchDemoManifest(deck, context.content.cards), manifest.id);
        assert.equal(result.legal, true); assert.equal(result.mainDeckCount, 27); assert.deepEqual(result.issues, []);
        const split = DeckSchema.parse(deck), entry = split.cards.find(e => e.quantity === 3)!;
        entry.quantity = 1; split.cards.push({ cardId: entry.cardId, quantity: 2 }); split.cards.reverse(); split.legends.reverse();
        assert.deepEqual(validate(split), result); assert.equal(matchDemoManifest(split, context.content.cards), manifest.id);
    });
    test(manifest.id + " never receives a constructed size exception", () => {
        for (const format of [undefined, "CONSTRUCTED"] as const) {
            const result = validateDeck(referenceDeck(manifest), context.content.cards, context.content.ruleset, format ? { format, availability: { kind: "CATALOG" } } : undefined);
            assert.deepEqual(result.issues.map(e => e.code), ["MAIN_DECK_SIZE"]);
        }
    });
    for (const mutation of ["main", "quantity", "zone", "legend", "add", "remove"] as const) test(manifest.id + " rejects fixed composition mutation: " + mutation, () => {
        const d = referenceDeck(manifest), other = demoReferences.find(m => m.id !== manifest.id)!;
        if (mutation === "main") d.cards[0].cardId = referenceDeck(other).cards[0].cardId;
        if (mutation === "quantity") { d.cards[0].quantity++; d.cards[1].quantity--; d.cards = d.cards.filter(e => e.quantity); }
        if (mutation === "zone") [d.cards[0].cardId, d.legends[0]] = [d.legends[0], d.cards[0].cardId];
        if (mutation === "legend") d.legends[0] = referenceDeck(other).legends[0];
        if (mutation === "add") d.cards.push({ ...d.cards[0], quantity: 1 });
        if (mutation === "remove") { d.cards[0].quantity--; d.cards = d.cards.filter(e => e.quantity); }
        assert.equal(validate(d).issues[0].code, "DEMO_MANIFEST_MISMATCH");
        const input = demoStarterInput(); input.decks[demoReferences.indexOf(manifest)] = { legends: d.legends, main: d.cards.flatMap(e => Array.from({ length: e.quantity }, () => e.cardId)) };
        failureCode(createGameWithEvents(input, context), "DEMO_MANIFEST_MISMATCH");
    });
    test(manifest.id + " split four-copy entries cannot bypass fixed list or copy rule", () => {
        const d = referenceDeck(manifest), three = d.cards.find(e => e.quantity === 3)!;
        d.cards.push({ cardId: three.cardId, quantity: 1 });
        assert.ok(validate(d).issues.some(e => e.code === "COPY_LIMIT"));
        assert.equal(validate(d).issues[0].code, "DEMO_MANIFEST_MISMATCH");
    });
}
test("runtime compositions equal immutable source manifests; printings are provenance only", () => {
    for (const [i, manifest] of demoManifests.entries()) {
        assert.equal(manifest.compositionHash, demoReferences[i].compositionHash);
        assert.deepEqual(normalizeDemoEntries(manifest.entries), normalizeDemoEntries(demoReferences[i].entries));
    }
    const cards = context.content.cards.map(c => CardSchema.parse({ ...c, printings: c.printings.map(p => ({ ...p, collectorNumber: "provenance-only" })) }));
    assert.equal(matchDemoManifest(referenceDeck(demoReferences[0]), cards), "ARASAKA_DEMO_V1");
});
test("exact pair initializes in either seat; format remains explicit in state and public context", () => {
    for (const reversed of [false, true]) {
        const input = demoStarterInput(); if (reversed) input.decks.reverse();
        const result = unwrap(createGameWithEvents(input, context));
        assert.ok(validateState(result.state, context).ok); assert.equal(result.state.match.format, "DEMO_STARTER_V1");
        assert.equal(Object.keys(result.state.objects.cards).length, 60);
        assert.equal(unwrap(observe(result.state, result.state.match.playerOrder[0], context)).format, "DEMO_STARTER_V1");
    }
});
for (const seat of [0, 1]) test("same-manifest mirror rejects with specific pair error: " + seat, () => {
    const input = demoStarterInput(); input.decks = [input.decks[seat], input.decks[seat]];
    failureCode(createGameWithEvents(input, context), "DEMO_PAIR_INVALID");
});
test("missing format and explicit constructed remain constructed even in Demo-enabled ruleset", () => {
    const input = { ...demoStarterInput(), format: undefined };
    for (const request of [input, { ...input, format: "CONSTRUCTED" as const }]) {
        const result = createGameWithEvents(request, context); failureCode(result, "INVALID_DECK");
        if (!result.ok) assert.match(result.errors[0].message, /MAIN_DECK_SIZE/);
    }
});
test("known format requires its new policy; 42-main support decks cannot become Demo", () => {
    failureCode(createGameWithEvents(demoStarterInput(), demoReferenceContext()), "UNSUPPORTED_FORMAT");
    failureCode(createGameWithEvents({ ...attackPowerInput("support"), format: "DEMO_STARTER_V1" }, context), "DEMO_MANIFEST_MISMATCH");
});
for (const format of ["DEMO_STARTER", "DEMO_STARTER_V2", "unknown-format"]) test("wire v1 rejects unknown format " + format, () => {
    const result = handleRequest({ schemaVersion: 1, requestId: "demo-bad-format", op: "createGame", content: context.content, initialization: { ...demoStarterInput(), format } });
    failureCode(result, "INVALID_REQUEST");
});
test("wire v1 creates Demo and submits FIRST/SECOND via opaque current action IDs", () => {
    const created = handleRequest({ schemaVersion: 1, requestId: "demo-create", op: "createGame", content: context.content, initialization: demoStarterInput("demo-setup-14") });
    assert.ok(created.ok);
    assert.deepEqual(unwrap(listLegalActions(initial, initial.match.playerOrder[1], context)), []);
    const selected = trace.steps[0];
    const resolved = unwrap(resolveActionId(initial, selected.actorId, selected.actionId, context));
    const applied = unwrap(applyAction(initial, resolved, context));
    assert.equal(hashReplayState(applied.state), selected.stateHash);
    failureCode(resolveActionId(applied.state, selected.actorId, selected.actionId, context), "UNKNOWN_ACTION_ID");
});
test("Demo policy fails closed on alias, mirror permission, random-seat method, and unknown fields", () => {
    const p = context.content.ruleset.demoStarter!;
    for (const patch of [{ firstPlayerMethod: "RANDOM_SELECTED_PLAYER" }, { seatAssignment: "MIRRORS_ALLOWED" }, { manifests: ["ARASAKA_DEMO_V1", "UNKNOWN"] }, { setupSequence: "DEMO_SETUP_V1" }, { arbitrary27: true }, { authority: "PUBLISHER_CONFIRMED" }])
        assert.equal(DemoStarterPolicySchema.safeParse({ ...p, ...patch }).success, false);
    const missing = RulesetSchema.parse(context.content.ruleset); delete missing.demoStarter;
    assert.equal(RulesetSchema.safeParse(missing).success, false);
    for (const kind of ["size", "copy", "constructed", "hand", "spent", "win", "empty", "order", "overtime"] as const) {
        const rules = RulesetSchema.parse(context.content.ruleset);
        if (kind === "size") rules.formats!.DEMO_STARTER_V1!.mainDeck.max++;
        if (kind === "copy") rules.formats!.DEMO_STARTER_V1!.maxCopies++;
        if (kind === "constructed") rules.formats!.CONSTRUCTED!.mainDeck.min = 27;
        if (kind === "hand") rules.gameplay!.openingHand++;
        if (kind === "spent") rules.gameplay!.firstPlayerSpentLegends++;
        if (kind === "win") rules.gameplay!.turnSlice!.startTurnGigWinCount++;
        if (kind === "empty") rules.gameplay!.turnSlice!.emptyDraw = "UNSUPPORTED";
        if (kind === "order") rules.gameplay!.turnSlice!.setup = "AGREED_FIRST_PLAYER_DECLINED_MULLIGANS_AND_CUTS";
        const input = kind === "overtime" ? { ...rules, gameplay: { ...rules.gameplay, turnSlice: { ...rules.gameplay!.turnSlice, overtime: "DISABLED" } } } : rules;
        assert.equal(RulesetSchema.safeParse(input).success, false, kind);
    }
});
for (const change of ["revision", "unsupported", "extra-content"] as const) test("content mutation rejected without synthetic padding: " + change, () => {
    const bundle = ContentBundleSchema.parse(context.content);
    if (change === "revision") bundle.cards[0].revision = CardRevisionSchema.parse(2);
    if (change === "unsupported") bundle.cards[0] = CardRevisionSnapshotSchema.parse({ ...bundle.cards[0], execution: { ...bundle.cards[0].execution, status: "UNSUPPORTED" } });
    if (change === "extra-content") bundle.cards.push(CardRevisionSnapshotSchema.parse(attackPowerContext().content.cards.find(c => !bundle.cards.some(b => b.id === c.id))!));
    const mutated = { content: createContentBundle(bundle.ruleset, bundle.cards, bundle.manifest.engine) };
    failureCode(createGameWithEvents(demoStarterInput(), mutated), change === "extra-content" ? "DEMO_CONTENT_INVALID" : "DEMO_MANIFEST_MISMATCH");
});
for (const [name, vector] of Object.entries(vectors.vectors)) test("literal seeded d20 vector: " + name, () => {
    const result = unwrap(createGameWithEvents(demoStarterInput(vector.seed), context));
    assert.deepEqual(result.state.firstPlayerRolls, vector.rounds); assert.equal(result.state.setup!.decidingSeat, vector.winner);
    assert.equal(result.state.rng.counter, vector.rngCounter); assert.equal(result.state.timing.actingPlayer, result.state.match.playerOrder[vector.winner]);
    assert.deepEqual(result, unwrap(createGameWithEvents(demoStarterInput(vector.seed), context)));
    let rng = { ...result.state.rng, counter: 0 };
    for (const round of vector.rounds) {
        const seat0 = drawDeterministicInteger(rng, 20), seat1 = drawDeterministicInteger(seat0.rng, 20); rng = seat1.rng;
        assert.deepEqual(round, [seat0.rawValue, seat1.rawValue]);
    }
    assert.deepEqual(result.events.filter(e => e.payload.kind === "FIRST_PLAYER_ROLLED").map(e => e.payload), vector.rounds.map((rolls, i) => ({ kind: "FIRST_PLAYER_ROLLED", round: i + 1, rolls, tied: rolls[0] === rolls[1] })));
    assert.equal(result.events.at(-1)!.payload.kind, "FIRST_PLAYER_DETERMINED");
    assert.ok(!result.events.some(e => e.payload.kind === "SETUP_SHUFFLED"));
});
test("seed vectors differ and opposed rolls use both inclusive endpoints without one-sided tie handling", () => {
    assert.notDeepEqual(vectors.vectors.first_0.rounds, vectors.vectors.first_1.rounds);
    const result = selectOpposedD20({ algorithm: "SHA256_COUNTER_V1", seed: "demo-setup-12", counter: 0 });
    assert.deepEqual(result.rounds, [[1, 6]]);
    assert.ok(result.rounds.flat().every(n => n >= 1 && n <= 20));
    // Fixed endpoint vector; 20 is also present in the real tie smoke.
    assert.ok(vectors.vectors.tie_0.rounds.flat().includes(20));
});
test("real setup trace preserves semantic order and stops before first normal turn", () => {
    assert.deepEqual(trace, golden);
    const events = [...trace.initialized.events, ...trace.steps.flatMap(s => s.events)], kinds = events.map(e => e.payload.kind);
    assert.deepEqual(kinds.slice(0, 6), ["FIRST_PLAYER_ROLLED", "FIRST_PLAYER_ROLLED", "FIRST_PLAYER_DETERMINED", "FIRST_PLAYER_CHOSEN", "SETUP_SHUFFLED", "SETUP_SHUFFLED"]);
    const at = (kind: typeof kinds[number]) => kinds.indexOf(kind);
    assert.ok(at("FIRST_PLAYER_CHOSEN") < at("SETUP_SHUFFLED"));
    assert.ok(at("SETUP_CUT") < at("SETUP_LEGEND_SPENT")); assert.ok(at("SETUP_LEGEND_SPENT") < at("FIXER_PREPARED"));
    assert.ok(at("FIXER_PREPARED") < at("CARD_MOVED")); assert.ok(at("CARD_MOVED") < at("MULLIGAN_DECLARED"));
    assert.ok(!kinds.includes("GAME_SETUP_COMPLETED")); assert.ok(!kinds.includes("TURN_STARTED"));
    const shuffles = events.flatMap(e => e.payload.kind === "SETUP_SHUFFLED" ? [e.payload] : []);
    assert.deepEqual(shuffles.map(e => e.zone), ["DECK", "DECK", "LEGENDS", "LEGENDS", "DECK"]);
    assert.equal(shuffles[0].rngCounter, 4);
    const cuts = events.flatMap(e => e.payload.kind === "SETUP_CUT" ? [e.payload] : []);
    assert.deepEqual(cuts.map(e => e.zone), ["DECK", "DECK", "LEGENDS", "LEGENDS"]);
    assert.ok(cuts.every(c => c.playerId !== c.ownerId));
    assert.equal(trace.steps.length, 6); assert.equal(trace.finalState.timing.turn, 0);
    assert.deepEqual(trace.finalState.setup, { stage: "MULLIGAN", completed: 1, decidingSeat: 0 });
    assert.equal(trace.finalState.timing.step, "MULLIGAN_DECISION");
});
test("p0 wins but chooses SECOND: p1 spends its leftmost two Legends and mulligans first", () => {
    const state = trace.finalState, [p0, p1] = state.match.playerOrder;
    assert.equal(initial.setup!.decidingSeat, 0); assert.equal(state.timing.firstPlayer, p1);
    assert.deepEqual(state.players[p1].zones.LEGENDS.map(id => state.objects.cards[id].readiness), ["SPENT", "SPENT", "READY"]);
    assert.deepEqual(state.players[p0].zones.LEGENDS.map(id => state.objects.cards[id].readiness), ["READY", "READY", "READY"]);
    const declared = trace.steps.flatMap(s => s.events).find(e => e.payload.kind === "MULLIGAN_DECLARED")!.payload;
    assert.deepEqual(declared, { kind: "MULLIGAN_DECLARED", playerId: p1, accepted: true });
    for (const player of Object.values(state.players)) { assert.equal(player.zones.HAND.length, 6); assert.equal(player.zones.DECK.length, 21); }
    const replacement = trace.steps.at(-1)!.events;
    assert.equal(replacement.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "HAND").length, 6);
    assert.equal(replacement.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "DECK").length, 6);
});
test("setup d20 rounds never become Fixer dice, controlled Gigs, or card objects", () => {
    for (const state of [initial, trace.finalState]) {
        const gigs = Object.values(state.objects.gigs); assert.equal(gigs.length, 12); assert.ok(gigs.every(g => g.roll.kind === "UNROLLED" && g.location.zone === "FIXER"));
        for (const id of state.match.playerOrder) assert.deepEqual(gigs.filter(g => g.ownerId === id).map(g => g.dieType).sort(), ["D10", "D12", "D20", "D4", "D6", "D8"]);
        assert.equal(Object.keys(state.objects.cards).length, 60);
    }
});
test("public roll observations include chooser for both seats but omit seed and RNG internals", () => {
    for (const actor of initial.match.playerOrder) {
        const o = unwrap(observe(initial, actor, context));
        assert.equal(o.format, "DEMO_STARTER_V1"); assert.deepEqual(o.firstPlayerRolls, [[20, 20], [12, 11]]);
        assert.equal(o.selectedSeat, 0); assert.equal(o.actingSeat, 0); assert.equal(o.choice!.actorSeat, 0);
        assert.ok(!JSON.stringify(o).includes(initial.rng.seed)); assert.ok(!Object.hasOwn(o, "rng"));
        assert.notEqual(hashObservation(o), hashObservation({ ...o, firstPlayerRolls: [[1, 1], [12, 11]] }));
    }
    assert.equal(trace.positions.length, 1); assert.equal(trace.positions[0].legalActions.length, 2);
});
test("exact replay hash retains rolls; semantic hash excludes past numbers but keeps chooser/format/future RNG", () => {
    // Deliberately invalid copies exercise projection only, never accepted/replayed engine states.
    const historical = GameStateSchema.parse(initial); historical.firstPlayerRolls![0] = [1, 1];
    assert.notEqual(hashReplayState(historical), hashReplayState(initial)); assert.equal(hashPosition(historical), hashPosition(initial));
    const format = GameStateSchema.parse(initial); delete format.match.format;
    assert.notEqual(hashPosition(format), hashPosition(initial));
    const chooser = GameStateSchema.parse(initial); chooser.setup!.decidingSeat = 1;
    assert.notEqual(hashPosition(chooser), hashPosition(initial));
    const future = GameStateSchema.parse(initial); future.rng.counter++;
    assert.notEqual(hashPosition(future), hashPosition(initial));
});
for (const mutation of ["absent-rolls", "forged-rolls", "missing-format", "wrong-winner", "tie-last", "after-decisive", "counter"] as const) test("untrusted setup state rejects " + mutation, () => {
    const s = GameStateSchema.parse(initial);
    if (mutation === "absent-rolls") delete s.firstPlayerRolls;
    if (mutation === "forged-rolls") s.firstPlayerRolls![0] = [1, 1];
    if (mutation === "missing-format") { delete s.match.format; delete s.firstPlayerRolls; }
    if (mutation === "wrong-winner") s.setup!.decidingSeat = 1;
    if (mutation === "tie-last") s.firstPlayerRolls![1] = [12, 12];
    if (mutation === "after-decisive") s.firstPlayerRolls!.push([1, 2]);
    if (mutation === "counter") s.rng.counter++;
    assert.equal(validateState(s, context).ok, false);
});
test("constructed keeps binary selection, old event shape and no Demo observations", () => {
    const ctx = attackPowerContext(), input = attackPowerInput("demo-setup-14"), result = unwrap(createGameWithEvents(input, ctx));
    const selected = drawDeterministicInteger({ ...result.state.rng, counter: 0 }, 2);
    assert.equal(result.state.setup!.decidingSeat, selected.rawValue - 1); assert.equal(result.state.rng.counter, selected.rng.counter);
    assert.deepEqual(result.events.map(e => e.payload.kind), ["FIRST_PLAYER_DETERMINED"]);
    assert.ok(!Object.hasOwn(result.state, "firstPlayerRolls")); assert.ok(!Object.hasOwn(result.state.match, "format"));
    assert.ok(!Object.hasOwn(unwrap(observe(result.state, result.state.timing.actingPlayer, ctx)), "firstPlayerRolls"));
    const forged = GameStateSchema.parse(result.state); forged.firstPlayerRolls = [[1, 2]];
    failureCode(validateState(forged, ctx), "UNSUPPORTED_SETUP_ROLLS");
});
test("only real reviewed immutable revisions; new ruleset keeps overtime UNSUPPORTED and source conflict historical", () => {
    assert.equal(context.content.cards.length, 29);
    for (const e of demoReferences.flatMap(m => m.entries)) assert.equal(hashCanonical(context.content.cards.find(c => c.id === e.cardId)), e.revisionHash);
    assert.equal(context.content.ruleset.gameplay!.turnSlice!.overtime, "UNSUPPORTED");
    assert.equal(policy.authority, "APPLICATION_DECISION"); assert.equal(policy.sourceConflict, "HISTORICALLY_UNRESOLVED");
    for (const [name, hash] of Object.entries(policy.reviewArtifacts)) assert.equal(createHash("sha256").update(readFileSync("tests/fixtures/" + name)).digest("hex"), hash);
});
