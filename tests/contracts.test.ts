import test from "node:test";
import { z } from "zod";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameStateSchema, CardInstanceIdSchema, GigInstanceIdSchema, MatchIdSchema, DeckSchema, validateDeck, ContentBundleSchema, hashCanonical, createContentBundle } from "@tcg/domain";
import { validateState, RulesView, listLegalActions, applyAction, applyCommand, resolveActionId, observe, hashObservation, hashPosition, hashReplayState, modifyGigValue, rollGigDie, transferGigControl, drawDeterministicDie } from "@tcg/engine";
import { generatePosition, exportAttempts, TrainingAttemptSchema, TrainingPositionSchema, validateTrainingPosition, modelInput } from "@tcg/training-harness";
import { handleRequest, WireRequestSchema, WireResponseSchema } from "@tcg/wire";
import { fixtureContext, fixtureState, player, rival } from "./contract-fixture";
const context = fixtureContext(), state = fixtureState(context), cid = CardInstanceIdSchema.parse("p0-c3"), gid = GigInstanceIdSchema.parse("p0-D4");
function unwrap<T>(result: {
    ok: true;
    value: T;
} | {
    ok: false;
    errors: unknown;
}): T { if (!result.ok)
    throw new Error(JSON.stringify(result.errors)); return result.value; }
test("normalized locations, ownership, attachment and choice references are enforced", () => {
    assert.equal(Object.isFrozen(state.objects.cards[cid]), true);
    const duplicate = GameStateSchema.parse(state);
    duplicate.players[player].zones.EDDIES.push(cid);
    assert.equal(validateState(duplicate, context).ok, false);
    const orphan = GameStateSchema.parse(state);
    orphan.players[player].zones.HAND = [];
    assert.equal(validateState(orphan, context).ok, false);
    const prototype = GameStateSchema.parse(state);
    prototype.players[player].zones.HAND.push(CardInstanceIdSchema.parse("constructor"));
    assert.equal(validateState(prototype, context).ok, false);
    const controlled = GameStateSchema.parse(state);
    controlled.objects.cards[cid].controllerId = rival;
    assert.equal(validateState(controlled, context).ok, true);
    const missing = GameStateSchema.parse(state);
    missing.objects.cards[cid].attachments = [CardInstanceIdSchema.parse("missing")];
    assert.equal(validateState(missing, context).ok, false);
    const choice = GameStateSchema.parse(state);
    choice.resolution.stage = "CHOICE";
    choice.resolution.choice = { id: "pick", actorId: player, kind: "CARD", options: [{ kind: "CARD", cardInstanceId: CardInstanceIdSchema.parse("missing") }], min: 1, max: 1, ordered: false, continuationId: "test@1" };
    assert.equal(validateState(choice, context).ok, false);
});
test("selling retains physical identity, readiness, owner and revision; transport metadata is irrelevant", () => {
    const actions = unwrap(listLegalActions(state, player, context));
    assert.equal(actions.length, 1);
    const action = unwrap(resolveActionId(state, player, actions[0].actionId, context));
    const sold = unwrap(applyAction(state, action, context));
    const c = sold.state.objects.cards[cid];
    assert.equal(c.id, cid);
    assert.equal(c.cardId, state.objects.cards[cid].cardId);
    assert.equal(c.ownerId, player);
    assert.equal(c.face, "DOWN");
    assert.equal(c.readiness, "READY");
    assert.deepEqual(sold.state.players[player].zones.EDDIES, [cid]);
    assert.equal(sold.state.players[player].economy.sellsThisTurn, 1);
    assert.deepEqual(sold.events.map(e => e.payload.kind), ["CARD_MOVED", "CARD_SOLD"]);
    assert.equal(unwrap(listLegalActions(sold.state, player, context)).length, 0);
    assert.equal(resolveActionId(sold.state, player, actions[0].actionId, context).ok, false);
    for (const commandId of ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000005"])
        assert.deepEqual(unwrap(applyCommand(state, { ...action, commandId, idempotencyKey: commandId, expectedStateVersion: 0 }, context)), sold);
    const view = new RulesView(sold.state, context), sources = view.listPaymentSources(player);
    assert.equal(view.getReadyEddies(player).length, 1);
    assert.equal(view.validatePaymentChoice(player, [...sources, ...sources], { kind: "EDDIES", amount: 2 }).ok, false);
    assert.equal(view.validatePaymentChoice(player, [], { kind: "DASH" }).ok, false);
});
test("Gig rolls replay, D20 eligibility is explicit, transfer and modifications retain die/original roll", () => {
    assert.deepEqual(drawDeterministicDie(state.rng, 6), drawDeterministicDie(state.rng, 6));
    assert.equal(rollGigDie(state, GigInstanceIdSchema.parse("p0-D20"), context).ok, false);
    const rolled = unwrap(rollGigDie(state, gid, context));
    assert.deepEqual(rollGigDie(state, gid, context), rolled ? { ok: true, value: rolled } : null);
    const acquired = unwrap(transferGigControl(rolled.state, gid, rival, context));
    const modified = unwrap(modifyGigValue(acquired.state, gid, 1, context));
    const before = rolled.state.objects.gigs[gid], after = modified.state.objects.gigs[gid];
    assert.equal(after.ownerId, player);
    assert.equal(after.controllerId, rival);
    assert.equal(after.dieType, before.dieType);
    assert.equal(after.roll.kind, "ROLLED");
    if (after.roll.kind !== "ROLLED" || before.roll.kind !== "ROLLED")
        return;
    assert.equal(after.roll.initialValue, before.roll.initialValue);
    assert.equal(after.roll.currentValue, before.roll.currentValue + 1);
    assert.equal(new RulesView(modified.state, context).getStreetCred(rival), after.roll.currentValue);
    assert.equal(modifyGigValue(modified.state, gid, 1000, context).ok, false);
    const two = GameStateSchema.parse(modified.state), other = GigInstanceIdSchema.parse("p0-D6");
    two.objects.gigs[other].roll = { kind: "ROLLED", initialValue: 1, currentValue: after.roll.currentValue };
    const both = unwrap(transferGigControl(two, other, rival, context)).state, view = new RulesView(both, context);
    assert.equal(view.testCondition(rival, { kind: "DISTINCT_GIG_DIE_TYPES", minimum: 2 }), true);
    assert.equal(view.testCondition(rival, { kind: "DISTINCT_GIG_VALUES", minimum: 2 }), false);
});
test("Legends start down and independently spent; Go Solo derives Unit without changing printed identity", () => {
    const id = CardInstanceIdSchema.parse("p0-c0");
    assert.equal(state.objects.cards[id].face, "DOWN");
    assert.equal(state.objects.cards[id].readiness, "SPENT");
    const solo = GameStateSchema.parse(state);
    solo.players[player].zones.LEGENDS.shift();
    solo.players[player].zones.BATTLEFIELD.push(id);
    solo.objects.cards[id].zone.zone = "BATTLEFIELD";
    solo.objects.cards[id].statuses.push("GO_SOLO");
    solo.objects.cards[id].face = "UP";
    const view = new RulesView(unwrap(validateState(solo, context)), context);
    assert.deepEqual(view.getEffectiveCardTypes(id), ["LEGEND", "UNIT"]);
    assert.equal(view.getRevision(id)?.type, "LEGEND");
    assert.equal(view.getRevision(id)?.printedCost.kind, "DASH");
});
test("observations omit hidden identities, opponent hand, deck order and future RNG", () => {
    const observed = unwrap(observe(state, player, context));
    const json = JSON.stringify(observed);
    assert.equal(json.includes("fixture-seed"), false);
    assert.equal(json.includes("dev-legend"), false);
    assert.equal(json.includes("p1-c3"), false);
    assert.equal(json.includes("p0-c4"), false);
    const changed = GameStateSchema.parse(state);
    changed.rng.seed = "different";
    changed.objects.cards[CardInstanceIdSchema.parse("p1-c3")].counters.secret = 1;
    assert.deepEqual(unwrap(observe(changed, player, context)), observed);
    assert.notEqual(hashReplayState(changed), hashReplayState(state));
    assert.notEqual(hashObservation(observed), hashReplayState(state));
});
test("semantic hashes/action IDs ignore match identity and registry insertion order", () => {
    const same = GameStateSchema.parse(state);
    same.match.id = MatchIdSchema.parse("00000000-0000-4000-8000-000000000006");
    same.objects.cards = Object.fromEntries(Object.entries(same.objects.cards).reverse());
    assert.notEqual(hashReplayState(same), hashReplayState(state));
    assert.equal(hashPosition(same), hashPosition(state));
    assert.deepEqual(listLegalActions(same, player, context), listLegalActions(state, player, context));
});
test("positions are reusable; attempts remain separate and model input excludes replay secrets", () => {
    const p = unwrap(generatePosition(state, player, context, "position-A"));
    assert.notEqual(p.positionId, p.stateHash);
    const attempt = TrainingAttemptSchema.parse({ schemaVersion: 1, attemptId: "attempt-1", positionId: p.positionId, rawModelOutput: "bad", parsedChoice: null, validation: { ok: false, codes: ["INVALID_MODEL_OUTPUT"] }, resultingStateHash: null, modelRevision: "model-1", tokenizerRevision: "tokenizer-1", adapterRevision: "adapter-1", promptFingerprint: hashCanonical("prompt"), decoding: { temperature: 0, topP: 1, maxTokens: 100, seed: 1 }, elapsedMs: 2, inputTokens: 10, outputTokens: 1 });
    assert.equal(exportAttempts([attempt, { ...attempt, attemptId: "attempt-2" }]).trim().split("\n").length, 2);
    assert.equal(JSON.stringify(modelInput(p)).includes("fixture-seed"), false);
});
test("format and available quantities are independent; duplicate entries cannot bypass limits", () => {
    const deck = DeckSchema.parse({ name: "test", legends: context.content.cards.filter(c => c.type === "LEGEND").map(c => c.id), cards: [{ cardId: "dev-unit-red", quantity: 3 }] });
    const pool = context.content.cards.map(c => ({ cardId: c.id, quantity: c.type === "LEGEND" ? 1 : 2 }));
    assert.equal(validateDeck(deck, context.content.cards, context.content.ruleset).legal, true);
    assert.equal(validateDeck(deck, context.content.cards, context.content.ruleset, { format: "CONSTRUCTED", availability: { kind: "OWNED", cards: pool } }).legal, false);
    assert.equal(validateDeck(deck, context.content.cards, context.content.ruleset, { format: "SEALED_LIMITED", availability: { kind: "SEALED", cards: pool.map(c => ({ ...c, quantity: 3 })) } }).legal, true);
    assert.equal(validateDeck({ ...deck, cards: [...deck.cards, ...deck.cards] }, context.content.cards, context.content.ruleset).issues.some(i => i.code === "COPY_LIMIT"), true);
});
test("tampered bundles fail and unsupported abilities never silently execute", () => {
    assert.equal(ContentBundleSchema.safeParse({ ...context.content, manifestHash: "0".repeat(64) }).success, false);
    const cards = structuredClone(context.content.cards);
    cards[0].mechanics.abilities.push({ id: "todo", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "CUSTOM", handlerId: "review-required@1" }] });
    const unsupported = { content: createContentBundle(context.content.ruleset, cards, context.content.manifest.engine) };
    assert.equal(listLegalActions(fixtureState(unsupported), player, unsupported).ok, false);
});
test("checked-in wire golden vectors match Node hashes, actions, transitions and errors", () => {
    const vectors = JSON.parse(readFileSync("tests/fixtures/wire-golden.v1.json", "utf8"));
    assert.ok(vectors.cases.length >= 7);
    assert.equal(vectors.cases[0].request.content.manifest.engine.artifactHash, context.content.manifest.engine.artifactHash, "Regenerate stale artifact vectors");
    for (const c of vectors.cases) {
        assert.equal(WireRequestSchema.safeParse(c.request).success, true);
        assert.equal(WireResponseSchema.safeParse(c.response).success, true);
        assert.deepEqual(handleRequest(c.request), c.response);
    }
});
test("differential corpus contains positive and targeted negative legality controls", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/deck-differential.v1.json", "utf8"));
    const source = context.content.cards[0];
    const pool = fixture.cards.map((c: object) => ({ ...source, ...c }));
    const rules = { ...context.content.ruleset, schemaVersion: 1 as const, formats: undefined, gameplay: undefined, deckbuilding: { mainDeck: { min: 40, max: 50 }, legendCount: 3, maxCopies: 3 } };
    for (const c of fixture.cases)
        assert.deepEqual(validateDeck(DeckSchema.parse(c.deck), pool, rules).issues.map(i => i.code).sort(), [...c.typescriptIssues].sort(), c.name);
});

test("exported schemas match runtime contracts and forged training labels are rejected", () => {
    for (const [name, schema] of Object.entries({request: WireRequestSchema, response: WireResponseSchema, trainingPosition: TrainingPositionSchema, trainingAttempt: TrainingAttemptSchema})) {
        assert.deepEqual(JSON.parse(readFileSync(`packages/wire/schemas/${name}.v1.json`, "utf8")), z.toJSONSchema(schema, {io: "input"}));
    }
    const position = unwrap(generatePosition(state, player, context, "verified-position"));
    assert.equal(validateTrainingPosition(position, context).ok, true);
    position.legalActions[0].descriptor.label = "Fabricated label";
    assert.equal(validateTrainingPosition(position, context).ok, false);
});
