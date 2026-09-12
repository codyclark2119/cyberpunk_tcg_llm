import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CardInstanceIdSchema, GameActionSchema, GameStateSchema, hashCanonical, type GameState } from "@tcg/domain";
import { CreateGameInputSchema, applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, validateState } from "@tcg/engine";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, moveLegendToFieldWithAttachments } from "../packages/engine/src/card-movement";
import { paymentCandidates } from "../packages/engine/src/payment";
import { demoStarterContext } from "./demo-starter-fixture";
import { createDemoMatchPolicy } from "./demo-matrix-policy";
import { assertNoSuppressedDemoInteraction } from "./demo-match-replay";
import { unwrap } from "./turn-replay";
import review from "./fixtures/reboot-multiplicity-source-review.v1.json";
import reproducers from "./fixtures/reboot-multiplicity-reproducers.v1.json";
import originalSources from "./fixtures/combat-restrictions-card-sources.v1.json";
import originalReview from "./fixtures/demo-matrix-reboot-review.v1.json";
const context = demoStarterContext();
// Compare historical payload hashes under their historical engine pins without changing gameplay state.
function historical(state: GameState): GameState {
    return { ...state, match: { ...state.match, engineVersion: review.runtime.engine.version, engineArtifactHash: review.runtime.engine.artifactHash, contentManifestHash: review.runtime.contentManifestHash } };
}

test("focused source successor preserves original card, FAQ, rules, matrix and descriptor evidence", () => {
    for (const [file, sha256] of Object.entries(review.preservedFiles).filter(([file]) => !["tests/demo-match-replay.ts", "tests/fixtures/demo-matrix-overlap-replay.v1.json"].includes(file)))
        assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), sha256, file);
    assert.equal(context.content.manifest.engine.version, "0.4.0-reboot-multiplicity-1");
    assert.deepEqual(context.content.manifest.ruleset, review.runtime.ruleset);
    assert.notEqual(context.content.manifestHash, review.runtime.contentManifestHash);
    const card = context.content.cards.find(c => c.id === "reboot-optics")!;
    assert.equal(hashCanonical(card), review.runtime.revisionHash);
    assert.deepEqual(review.card.completeNormalizedRecord, originalSources.records.find(r => r.record.slug === card.id)!.record);
    assert.equal(hashCanonical(review.card.completeNormalizedRecord), review.comparisons.card.canonicalHash);
    assert.deepEqual(card.mechanics, review.card.mechanics);
    assert.deepEqual(card.execution, review.card.executionMetadata);
    assert.deepEqual(card.printings.map(p => p.id), review.printingReview.map(p => p.id));
    for (const previous of originalReview.faq.relevantRecords) {
        const current = review.faqRecords.find(r => r.id === previous.id)!;
        for (const key of ["question", "answer", "published_at", "cardId"] as const) assert.equal(current[key], previous[key]);
    }
    for (const id of ["8.16.2", "9.19.3", "10.12", "10.13", "10.16.2", "10.21", "10.24", "10.28.1", "10.29", "10.29.1"])
        assert.ok(review.rulesReviewed.some(r => r.id === id));
});

// Preserve all original submitted actions, then prove the formerly suppressed second play is legal.
// Historical hashes remain frozen; engine pins alone are normalized for comparison.
for (const record of reproducers.records) test(`frozen ${record.coordinate.seed}/${record.coordinate.seats}: exact prefix admits the second play under supplied ruling`, () => {
    assert.equal(review.runtime.contentManifestHash, reproducers.contentManifestHash);
    const input = CreateGameInputSchema.parse(record.initialization);
    assert.equal(input.decks.flatMap(d => d.main).filter(id => id === "reboot-optics").length, 2);
    const initial = unwrap(createGameWithEvents(input, context));
    assert.equal(hashCanonical({ ...initial, state: historical(initial.state) }), record.initializedHash);
    let state = initial.state;
    const choose = createDemoMatchPolicy({ chooseFirstOrSecond: "FIRST", mulligan: [false, false] });
    for (const [index, step] of record.steps.entries()) {
        assertNoSuppressedDemoInteraction(state, context);
        const action = GameActionSchema.parse(step.action);
        const legal = unwrap(listLegalActions(state, action.actorId, context));
        assert.equal(hashCanonical(legal), step.legalActionsHash, `legal actions ${index}`);
        const observations = state.match.playerOrder.map(id => unwrap(observe(state, id, context)));
        assert.equal(hashCanonical(observations), step.observationsHash, `both observations ${index}`);
        const actorObservation = observations[state.players[action.actorId].seat];
        assert.equal(choose(actorObservation, legal.map(({ actionId, descriptor }) => ({ actionId, descriptor }))), step.actionId);
        assert.deepEqual(legal.find(a => a.actionId === step.actionId)!.action, action.action);
        const before = hashReplayState(state);
        const result = unwrap(applyAction(state, action, context));
        assert.equal(hashReplayState(state), before, `immutable input ${index}`);
        assert.equal(hashCanonical(result.events), step.eventsHash, `events ${index}`);
        state = result.state;
        assert.equal(hashReplayState(historical(state)), step.stateHash, `state ${index}`);
        assert.equal(hashPosition(historical(state)), step.positionHash, `position ${index}`);
        assert.equal(hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step.observationHash);
    }
    assert.equal(hashReplayState(historical(state)), record.finalStateHash);
    assert.equal(hashPosition(historical(state)), record.positionHash);
    assert.equal(state.timing.turn, record.turn);
    assert.equal(state.match.outcome, undefined);
    assert.ok(validateState(state, context).ok);
    assert.deepEqual(state.fightPreventions, [record.outstanding]);
    const second = state.objects.cards[CardInstanceIdSchema.parse(record.secondSourceId)];
    const actor = state.timing.actingPlayer;
    assert.notEqual(second.id, record.outstanding.sourceId);
    assert.equal(second.cardId, "reboot-optics");
    assert.equal(second.zone.zone, "HAND");
    assert.equal(second.controllerId, actor);
    const revision = context.content.cards.find(c => c.id === second.cardId && c.revision === second.revision)!;
    assert.equal(revision.printedCost.kind, "EDDIES");
    if (revision.printedCost.kind === "EDDIES") assert.ok(paymentCandidates(state, actor, context, revision.printedCost.amount, []).length);
    assert.equal(unwrap(listLegalActions(state, actor, context)).some(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === second.id), true);
    const before = hashReplayState(state);
    assert.doesNotThrow(() => assertNoSuppressedDemoInteraction(state, context));
    const attempted = applyAction(state, { actorId: actor, action: { kind: "PLAY_CARD", cardInstanceId: second.id } }, context);
    assert.ok(attempted.ok);
    let next = unwrap(attempted).state;
    while (next.timing.step === "PAYMENT_SELECTION") {
        const legal = unwrap(listLegalActions(next, next.timing.actingPlayer, context));
        const id = choose(unwrap(observe(next, next.timing.actingPlayer, context)), legal.map(({ actionId, descriptor }) => ({ actionId, descriptor })));
        const selected = legal.find(a => a.actionId === id)!;
        next = unwrap(applyAction(next, { actorId: selected.actorId, action: selected.action }, context)).state;
    }
    assert.equal(next.fightPreventions!.length, 2);
    assert.equal(next.objects.cards[second.id].zone.zone, "TRASH");
    assert.equal(hashReplayState(state), before);
});

test("multiplicity: a protected friendly field Legend attacks, loses truthfully and stays on the field", () => {
    // Trusted combat arrangement from the real two-outstanding exact Demo state; no invented content or ready action.
    const state = GameStateSchema.parse(JSON.parse(readFileSync("tests/fixtures/reboot-multiplicity-replay.v1.json", "utf8")).steps[206].state);
    const m = new TurnMutation(state, context), controller = state.fightPreventions![0].controllerId;
    assert.equal(controller, state.timing.activePlayer);
    const legend = Object.values(m.state.objects.cards).find(c => c.controllerId === controller && c.cardId === "v-corporate-exile")!;
    legend.face = "UP";
    if (legend.zone.zone !== "BATTLEFIELD") unwrap(moveLegendToFieldWithAttachments(m, legend.id, "PLAY"));
    legend.readiness = "SPENT"; legend.statuses = [];
    const enemy = Object.values(m.state.objects.cards).find(c => c.controllerId !== controller && c.cardId === "minotaur")!;
    moveCardLocation(m, enemy.id, "BATTLEFIELD"); enemy.readiness = "SPENT"; enemy.statuses = [];
    m.state.timing.combat = { stage: "RIVAL_REACT", attackerId: legend.id, attackingPlayerId: controller, target: { kind: "CARD", cardInstanceId: enemy.id } };
    m.state.timing.actingPlayer = enemy.controllerId; m.state.timing.window = "RIVAL_REACT"; m.state.timing.step = "RIVAL_REACT";
    const ready = unwrap(validateState(m.state, context));
    const result = unwrap(applyAction(ready, { actorId: ready.timing.actingPlayer, action: { kind: "PASS_REACT" } }, context));
    const fight = result.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload;
    assert.ok(fight.kind === "FIGHT_RESULT"); assert.equal(fight.winnerId, enemy.id);
    assert.equal(result.events.filter(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED").length, 2);
    assert.equal(result.events.filter(e => e.payload.kind === "FIGHT_DEFEAT_PREVENTED").length, 1);
    assert.equal(result.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === legend.id), false);
    assert.equal(result.state.objects.cards[legend.id].zone.zone, "BATTLEFIELD");
    assert.equal(result.state.fightPreventions, undefined);
});
